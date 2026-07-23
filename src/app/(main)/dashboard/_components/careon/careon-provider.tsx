"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { CRITICAL_ALERT_COUNT } from "@/data/careon/careon-alerts";
import { CAREON_LOCATION_SCALE, CAREON_LOCATIONS } from "@/data/careon/careon-filters";
import { COCKPIT_KPIS } from "@/data/careon/careon-kpis";
import type { CareonFilters, CareonKpi, CareonKpiOverrides, CareonSource } from "@/data/careon/careon-types";
import { computeProductionSnapshot, KNOWN_LOCATIES } from "@/lib/careon-production/compute-snapshot";
import {
  fetchRemoteAgendaFacts,
  fetchRemoteDeclaratiesFacts,
  fetchRemoteProductionState,
  fetchRemoteToeslagenFacts,
  fetchRemoteVerwijzersFacts,
  type PushResult,
  pushRemoteAgendaFacts,
  pushRemoteDeclaratiesFacts,
  pushRemoteProductionState,
  pushRemoteToeslagenFacts,
  pushRemoteVerwijzersFacts,
} from "@/lib/careon-production/remote.client";
import {
  clearAuxFacts,
  clearProductionState,
  hasProductionOptOut,
  loadAgendaFacts,
  loadDeclaratiesFacts,
  loadProductionState,
  loadToeslagenFacts,
  loadVerwijzersFacts,
  saveAgendaFacts,
  saveDeclaratiesFacts,
  saveProductionState,
  saveToeslagenFacts,
  saveVerwijzersFacts,
  setProductionOptOut,
} from "@/lib/careon-production/storage.client";
import type {
  AgendaFacts,
  DeclaratiesFacts,
  ProductionSnapshot,
  ProductionState,
  ToeslagenFacts,
  VerwijzersFacts,
} from "@/lib/careon-production/types";

export interface ActivationResult {
  /** false: localStorage-opslag mislukt (quota) — modus overleeft geen herlaad. */
  persisted: boolean;
  /** Resultaat van de centrale (Supabase) synchronisatie. */
  sync: PushResult;
}

interface CareonContextValue {
  filters: CareonFilters;
  setFilter: (key: keyof CareonFilters, value: string) => void;
  source: CareonSource;
  setSource: (source: CareonSource) => void;
  overrides: CareonKpiOverrides;
  setOverrides: (overrides: CareonKpiOverrides) => void;
  restoreDemo: () => void;
  kpis: CareonKpi[];
  factor: number;
  alertCount: number;
  /** Gefilterde productie-snapshot; null buiten productie-modus. */
  production: ProductionSnapshot | null;
  isProduction: boolean;
  activateProduction: (state: ProductionState) => Promise<ActivationResult>;
  /** Aanvullende exports (vereisen actieve productie-modus). */
  activateAgenda: (facts: AgendaFacts) => Promise<ActivationResult>;
  activateVerwijzers: (facts: VerwijzersFacts) => Promise<ActivationResult>;
  activateToeslagen: (facts: ToeslagenFacts) => Promise<ActivationResult>;
  activateDeclaraties: (facts: DeclaratiesFacts) => Promise<ActivationResult>;
  /** Beschikbare locatiefilter-opties (productie: alleen vestigingen uit de data). */
  locatieOpties: string[];
}

const DEMO_SOURCE: CareonSource = { mode: "demo", label: "Demo-data", detail: "Voorbeeldset Careon" };

const CareonContext = createContext<CareonContextValue | null>(null);

export function useCareon(): CareonContextValue {
  const ctx = useContext(CareonContext);
  if (!ctx) {
    throw new Error("useCareon must be used within a CareonProvider");
  }
  return ctx;
}

function productionSource(state: ProductionState): CareonSource {
  return {
    mode: "productie",
    label: "Productie-data",
    detail: `ZSG-export · ${state.fileName}`,
  };
}

export function CareonProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [filters, setFilters] = useState<CareonFilters>({
    periode: "12m",
    locatie: "Alle locaties",
    team: "Alle teams",
  });
  const [source, setSourceState] = useState<CareonSource>(DEMO_SOURCE);
  const [overrides, setOverrides] = useState<CareonKpiOverrides>({});
  const [productionState, setProductionState] = useState<ProductionState | null>(null);
  const [agendaFacts, setAgendaFacts] = useState<AgendaFacts | null>(null);
  const [verwijzersFacts, setVerwijzersFacts] = useState<VerwijzersFacts | null>(null);
  const [toeslagenFacts, setToeslagenFacts] = useState<ToeslagenFacts | null>(null);
  const [declaratiesFacts, setDeclaratiesFacts] = useState<DeclaratiesFacts | null>(null);

  // Zodra de gebruiker zelf een bron kiest (import, csv, api, herstel demo)
  // mag een nog lopende remote-fetch die keuze niet meer overschrijven.
  const userChoseSourceRef = useRef(false);

  // Hydratatie na mount (nooit tijdens SSR): een eerder geactiveerde
  // productie-import overleeft zo een herlaad van de app. Lokale opslag wint
  // (directe start); daarna wordt best-effort de centrale Supabase-run
  // opgehaald. De centrale run wint van de lokale kopie wanneer die NIEUWER
  // is — zo landt een server-side dataverversing ook in browsers die nog een
  // oudere import in localStorage hebben. Een expliciete demo-keuze
  // ("Herstel demo-data") blokkeert de auto-activatie tot een nieuwe import.
  useEffect(() => {
    const stored = loadProductionState();
    const storedAgenda = loadAgendaFacts();
    const storedVerwijzers = loadVerwijzersFacts();
    const storedToeslagen = loadToeslagenFacts();
    const storedDeclaraties = loadDeclaratiesFacts();
    if (stored) {
      setProductionState(stored);
      setSourceState(productionSource(stored));
      if (storedAgenda) setAgendaFacts(storedAgenda);
      if (storedVerwijzers) setVerwijzersFacts(storedVerwijzers);
      if (storedToeslagen) setToeslagenFacts(storedToeslagen);
      if (storedDeclaraties) setDeclaratiesFacts(storedDeclaraties);
    } else if (hasProductionOptOut()) {
      return;
    }
    let cancelled = false;
    const isNieuwer = (remote: { importedAt: string }, lokaal: { importedAt: string } | null) =>
      lokaal === null || Date.parse(remote.importedAt) > Date.parse(lokaal.importedAt);
    void fetchRemoteProductionState().then((remote) => {
      if (remote && !cancelled && !userChoseSourceRef.current && isNieuwer(remote, stored)) {
        setProductionState(remote);
        saveProductionState(remote);
        setSourceState(productionSource(remote));
      }
    });
    void fetchRemoteAgendaFacts().then((remote) => {
      if (remote && !cancelled && !userChoseSourceRef.current && isNieuwer(remote, storedAgenda)) {
        setAgendaFacts(remote);
        saveAgendaFacts(remote);
      }
    });
    void fetchRemoteVerwijzersFacts().then((remote) => {
      if (remote && !cancelled && !userChoseSourceRef.current && isNieuwer(remote, storedVerwijzers)) {
        setVerwijzersFacts(remote);
        saveVerwijzersFacts(remote);
      }
    });
    void fetchRemoteToeslagenFacts().then((remote) => {
      if (remote && !cancelled && !userChoseSourceRef.current && isNieuwer(remote, storedToeslagen)) {
        setToeslagenFacts(remote);
        saveToeslagenFacts(remote);
      }
    });
    void fetchRemoteDeclaratiesFacts().then((remote) => {
      if (remote && !cancelled && !userChoseSourceRef.current && isNieuwer(remote, storedDeclaraties)) {
        setDeclaratiesFacts(remote);
        saveDeclaratiesFacts(remote);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setFilter = useCallback((key: keyof CareonFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Publieke setSource (gebruikt door de csv- en api-kaarten): een keuze voor
  // een niet-productiebron maakt de bewaarde productie-import ongedaan, zodat
  // de bronnen elkaar nooit stilzwijgend overlappen.
  // Terug naar demo: ook het locatiefilter terug naar de geauditeerde lijst —
  // een productie-vestiging (bijv. Veghel) bestaat daar niet.
  const resetDemoFilters = useCallback(() => {
    setFilters((prev) =>
      (CAREON_LOCATIONS as readonly string[]).includes(prev.locatie) ? prev : { ...prev, locatie: "Alle locaties" },
    );
  }, []);

  const clearProductionSlices = useCallback(() => {
    setProductionState(null);
    setAgendaFacts(null);
    setVerwijzersFacts(null);
    setToeslagenFacts(null);
    setDeclaratiesFacts(null);
    clearProductionState();
    clearAuxFacts();
  }, []);

  const setSource = useCallback(
    (next: CareonSource) => {
      userChoseSourceRef.current = true;
      if (next.mode !== "productie") {
        clearProductionSlices();
        setProductionOptOut(true);
        resetDemoFilters();
      }
      setSourceState(next);
    },
    [clearProductionSlices, resetDemoFilters],
  );

  const restoreDemo = useCallback(() => {
    userChoseSourceRef.current = true;
    setOverrides({});
    clearProductionSlices();
    setProductionOptOut(true);
    resetDemoFilters();
    setSourceState(DEMO_SOURCE);
  }, [clearProductionSlices, resetDemoFilters]);

  // De activatie zelf is synchroon (state + bron flippen direct); opslag- en
  // sync-uitkomsten gaan terug naar de aanroeper zodat een quota- of
  // push-fout zichtbaar wordt i.p.v. een stille terugval na herladen.
  const activateProduction = useCallback(async (state: ProductionState): Promise<ActivationResult> => {
    userChoseSourceRef.current = true;
    setOverrides({});
    setProductionState(state);
    const persisted = saveProductionState(state);
    setProductionOptOut(false);
    setSourceState(productionSource(state));
    const sync = await pushRemoteProductionState(state);
    return { persisted, sync };
  }, []);

  const activateAgenda = useCallback(async (facts: AgendaFacts): Promise<ActivationResult> => {
    setAgendaFacts(facts);
    const persisted = saveAgendaFacts(facts);
    const sync = await pushRemoteAgendaFacts(facts);
    return { persisted, sync };
  }, []);

  const activateVerwijzers = useCallback(async (facts: VerwijzersFacts): Promise<ActivationResult> => {
    setVerwijzersFacts(facts);
    const persisted = saveVerwijzersFacts(facts);
    const sync = await pushRemoteVerwijzersFacts(facts);
    return { persisted, sync };
  }, []);

  const activateToeslagen = useCallback(async (facts: ToeslagenFacts): Promise<ActivationResult> => {
    setToeslagenFacts(facts);
    const persisted = saveToeslagenFacts(facts);
    const sync = await pushRemoteToeslagenFacts(facts);
    return { persisted, sync };
  }, []);

  const activateDeclaraties = useCallback(async (facts: DeclaratiesFacts): Promise<ActivationResult> => {
    setDeclaratiesFacts(facts);
    const persisted = saveDeclaratiesFacts(facts);
    const sync = await pushRemoteDeclaratiesFacts(facts);
    return { persisted, sync };
  }, []);

  const isProduction = source.mode === "productie" && productionState !== null;

  // Productie filtert echt op vestiging; de demo-schaalfactor blijft een
  // demo-affordance en staat in productie altijd op 1.
  const factor = isProduction ? 1 : (CAREON_LOCATION_SCALE[filters.locatie] ?? 1);

  // Referentiedatum = importmoment: dezelfde import geeft altijd dezelfde
  // cijfers (geen stille "verval" van KPI's naarmate de klok doorloopt).
  const production = useMemo(
    () =>
      isProduction && productionState
        ? computeProductionSnapshot(
            productionState,
            { locatie: filters.locatie },
            new Date(productionState.importedAt),
            {
              agenda: agendaFacts,
              verwijzers: verwijzersFacts,
              toeslagen: toeslagenFacts,
              declaraties: declaratiesFacts,
            },
          )
        : null,
    [isProduction, productionState, filters.locatie, agendaFacts, verwijzersFacts, toeslagenFacts, declaratiesFacts],
  );

  // Locatiefilter-opties: demo toont de geauditeerde lijst; productie alleen
  // vestigingen die echt in de data voorkomen (incl. Veghel sinds juli 2026).
  const locatieOpties = useMemo<string[]>(() => {
    if (!isProduction || !productionState) return [...CAREON_LOCATIONS];
    const aanwezig = new Set(
      productionState.records
        .map((record) => record.vestiging)
        .filter((vestiging): vestiging is string => vestiging !== null),
    );
    return ["Alle locaties", ...KNOWN_LOCATIES.filter((loc) => aanwezig.has(loc))];
  }, [isProduction, productionState]);

  const kpis = useMemo(
    () =>
      COCKPIT_KPIS.map((kpi) => {
        const override = overrides[kpi.id];
        const base = override ? { ...kpi, value: override.value, prev: override.prev } : kpi;
        if (!base.scale || factor === 1) {
          return base;
        }
        return {
          ...base,
          value: Math.round(base.value * factor),
          prev: Math.round(base.prev * factor),
          spark: base.spark.map((point) => point * factor),
        };
      }),
    [overrides, factor],
  );

  const alertCount = production
    ? production.signaleringen.filter((alert) => alert.sev === "kritiek").length
    : CRITICAL_ALERT_COUNT;

  // Verborgen filters zijn in productie ook semantisch uitgeschakeld: een in
  // demo gekozen team/periode mag niet onzichtbaar doorwerken (bijv. in de
  // assistent-scope). De onderliggende keuze blijft bewaard voor demo-herstel.
  const exposedFilters = useMemo<CareonFilters>(
    () => (isProduction ? { ...filters, periode: "12m", team: "Alle teams" } : filters),
    [isProduction, filters],
  );

  const value = useMemo(
    () => ({
      filters: exposedFilters,
      setFilter,
      source,
      setSource,
      overrides,
      setOverrides,
      restoreDemo,
      kpis,
      factor,
      alertCount,
      production,
      isProduction,
      activateProduction,
      activateAgenda,
      activateVerwijzers,
      activateToeslagen,
      activateDeclaraties,
      locatieOpties,
    }),
    [
      exposedFilters,
      setFilter,
      source,
      setSource,
      overrides,
      restoreDemo,
      kpis,
      factor,
      alertCount,
      production,
      isProduction,
      activateProduction,
      activateAgenda,
      activateVerwijzers,
      activateToeslagen,
      activateDeclaraties,
      locatieOpties,
    ],
  );

  return <CareonContext.Provider value={value}>{children}</CareonContext.Provider>;
}
