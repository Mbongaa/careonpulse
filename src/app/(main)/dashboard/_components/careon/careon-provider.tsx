"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { CRITICAL_ALERT_COUNT } from "@/data/careon/careon-alerts";
import { CAREON_LOCATION_SCALE, CAREON_LOCATIONS } from "@/data/careon/careon-filters";
import { COCKPIT_KPIS } from "@/data/careon/careon-kpis";
import type { CareonFilters, CareonKpi, CareonKpiOverrides, CareonSource } from "@/data/careon/careon-types";
import { filterFinancieleAlerts } from "@/lib/careon-financieel-rol";
import { aanwezigeVestigingen, computeProductionSnapshot } from "@/lib/careon-production/compute-snapshot";
import { redigeerAgendaFactsFinancieel } from "@/lib/careon-production/redactie";
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
  clearFinancieleAuxFacts,
  clearProductionState,
  hasProductionOptOut,
  isAgendaOpslagGeredigeerd,
  loadAgendaFacts,
  loadDeclaratiesFacts,
  loadProductionState,
  loadToeslagenFacts,
  loadVerwijzersFacts,
  saveAgendaFacts,
  saveAgendaFactsGeredigeerd,
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
import { bewaakCacheEigenaar, careonCacheEigenaar } from "@/lib/careon-tenant/cache-owner.client";

import { useCareonSessionInfo } from "./careon-session-provider";

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
  // Financiële rolregel (klantbesluit 28-07-2026): leden krijgen server-side
  // al geredigeerde aggregaten, maar dezelfde redactie draait hier nogmaals
  // over álles wat de provider binnenkomt — ook een oudere localStorage-kopie
  // van een gedeelde werkplek toont een lid dan nooit financiële cijfers.
  // Naast de rol telt de organisatie: een cache van org A mag nooit in een
  // sessie van org B landen (gedeelde werkplek, sessie verlopen zonder
  // uitloggen). De eigenaarscontrole draait vóór elke hydratatie.
  const sessie = useCareonSessionInfo();
  const financieelZichtbaar = sessie.financieelZichtbaar;
  const cacheEigenaar = careonCacheEigenaar(sessie);
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
    bewaakCacheEigenaar(cacheEigenaar);
    const stored = loadProductionState();
    // Een gemarkeerd-geredigeerde (leden)kopie is voor een beheerder
    // onbruikbaar — negeren, zodat de volledige centrale versie zo dadelijk
    // wél wordt geadopteerd (redactie behoudt importedAt, dus de gewone
    // "nieuwer"-vergelijking zou de genulde kopie laten staan).
    const agendaRuw = financieelZichtbaar && isAgendaOpslagGeredigeerd() ? null : loadAgendaFacts();
    const storedAgenda = agendaRuw && !financieelZichtbaar ? redigeerAgendaFactsFinancieel(agendaRuw) : agendaRuw;
    const storedVerwijzers = loadVerwijzersFacts();
    const storedToeslagen = financieelZichtbaar ? loadToeslagenFacts() : null;
    const storedDeclaraties = financieelZichtbaar ? loadDeclaratiesFacts() : null;
    if (!financieelZichtbaar) {
      // Achtergebleven financiële kopieën van een eerdere (admin-)sessie op
      // dezelfde werkplek opruimen; de geredigeerde agenda overschrijft de
      // volledige lokale kopie — mét markering, zodat een latere
      // beheerderssessie hem herkent en de centrale versie terughaalt.
      clearFinancieleAuxFacts();
      if (storedAgenda) saveAgendaFactsGeredigeerd(storedAgenda);
    }
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
        if (financieelZichtbaar) {
          setAgendaFacts(remote);
          saveAgendaFacts(remote);
        } else {
          const facts = redigeerAgendaFactsFinancieel(remote);
          setAgendaFacts(facts);
          saveAgendaFactsGeredigeerd(facts);
        }
      }
    });
    void fetchRemoteVerwijzersFacts().then((remote) => {
      if (remote && !cancelled && !userChoseSourceRef.current && isNieuwer(remote, storedVerwijzers)) {
        setVerwijzersFacts(remote);
        saveVerwijzersFacts(remote);
      }
    });
    if (financieelZichtbaar) {
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
    }
    return () => {
      cancelled = true;
    };
    // Beide waarden zijn server-gezaaid en veranderen nooit binnen een sessie.
  }, [financieelZichtbaar, cacheEigenaar]);

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

  // Een lid mag de (gemengde) agenda-export wél koppelen — het bestand komt
  // van zijn eigen werkplek — maar houdt lokaal alleen de geredigeerde
  // variant over. De centrale push slaagt alleen voor organisatiebeheerders:
  // de route weigert een ledenpush met 403 ("alleen_beheerder"), omdat een
  // teruggeposte geredigeerde kopie anders de omzet van de hele organisatie
  // zou wissen. Voor een lid blijft de import dus beperkt tot zijn eigen
  // browser; de importkaart meldt dat rolbesluit apart van een echte
  // synchronisatiefout.
  const activateAgenda = useCallback(
    async (facts: AgendaFacts): Promise<ActivationResult> => {
      const zichtbaar = financieelZichtbaar ? facts : redigeerAgendaFactsFinancieel(facts);
      setAgendaFacts(zichtbaar);
      const persisted = financieelZichtbaar ? saveAgendaFacts(facts) : saveAgendaFactsGeredigeerd(zichtbaar);
      const sync = await pushRemoteAgendaFacts(facts);
      return { persisted, sync };
    },
    [financieelZichtbaar],
  );

  const activateVerwijzers = useCallback(async (facts: VerwijzersFacts): Promise<ActivationResult> => {
    setVerwijzersFacts(facts);
    const persisted = saveVerwijzersFacts(facts);
    const sync = await pushRemoteVerwijzersFacts(facts);
    return { persisted, sync };
  }, []);

  // Volledig financiële aggregaten: de uploadkaarten zijn voor leden
  // verborgen en de route weigert hun push (403) — mocht dit pad toch ooit
  // lopen, dan raakt het de zichtbare staat niet.
  const activateToeslagen = useCallback(
    async (facts: ToeslagenFacts): Promise<ActivationResult> => {
      if (!financieelZichtbaar) {
        return { persisted: false, sync: await pushRemoteToeslagenFacts(facts) };
      }
      setToeslagenFacts(facts);
      const persisted = saveToeslagenFacts(facts);
      const sync = await pushRemoteToeslagenFacts(facts);
      return { persisted, sync };
    },
    [financieelZichtbaar],
  );

  const activateDeclaraties = useCallback(
    async (facts: DeclaratiesFacts): Promise<ActivationResult> => {
      if (!financieelZichtbaar) {
        return { persisted: false, sync: await pushRemoteDeclaratiesFacts(facts) };
      }
      setDeclaratiesFacts(facts);
      const persisted = saveDeclaratiesFacts(facts);
      const sync = await pushRemoteDeclaratiesFacts(facts);
      return { persisted, sync };
    },
    [financieelZichtbaar],
  );

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

  // Locatiefilter-opties: demo houdt de geauditeerde lijst (CAREON_LOCATIONS is
  // vastgelegd in verify:careon). Productie leidt de opties af uit de import
  // zelf, niet uit een vaste vier — een nieuwe vestiging in het EPD (De
  // Zorgpoort, TGC Eindhoven) is daarmee meteen filterbaar in plaats van stil
  // op te gaan in "Onbekend".
  const locatieOpties = useMemo<string[]>(() => {
    if (!isProduction || !productionState) return [...CAREON_LOCATIONS];
    return ["Alle locaties", ...aanwezigeVestigingen(productionState.records)];
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

  // Badge = kritieke signaleringen zoals deze gebruiker ze op Signaleringen
  // ziet: een financiële regel die voor een lid is weggefilterd mag niet als
  // onvindbaar cijfer in de badge blijven staan. In demo verandert dat de
  // geauditeerde telling niet (die regels zijn "middel"/"hoog").
  const alertCount = production
    ? filterFinancieleAlerts(production.signaleringen, financieelZichtbaar).filter((alert) => alert.sev === "kritiek")
        .length
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
