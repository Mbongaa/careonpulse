"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { CRITICAL_ALERT_COUNT } from "@/data/careon/careon-alerts";
import { CAREON_LOCATION_SCALE } from "@/data/careon/careon-filters";
import { COCKPIT_KPIS } from "@/data/careon/careon-kpis";
import type { CareonFilters, CareonKpi, CareonKpiOverrides, CareonSource } from "@/data/careon/careon-types";
import { computeProductionSnapshot } from "@/lib/careon-production/compute-snapshot";
import {
  fetchRemoteProductionState,
  type PushResult,
  pushRemoteProductionState,
} from "@/lib/careon-production/remote.client";
import {
  clearProductionState,
  hasProductionOptOut,
  loadProductionState,
  saveProductionState,
  setProductionOptOut,
} from "@/lib/careon-production/storage.client";
import type { ProductionSnapshot, ProductionState } from "@/lib/careon-production/types";

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

  // Zodra de gebruiker zelf een bron kiest (import, csv, api, herstel demo)
  // mag een nog lopende remote-fetch die keuze niet meer overschrijven.
  const userChoseSourceRef = useRef(false);

  // Hydratatie na mount (nooit tijdens SSR): een eerder geactiveerde
  // productie-import overleeft zo een herlaad van de app. Lokale opslag wint
  // (directe start); daarna wordt best-effort de centrale Supabase-run
  // opgehaald zodat collega's dezelfde import zien. Een expliciete demo-keuze
  // ("Herstel demo-data") blokkeert die auto-activatie tot een nieuwe import.
  useEffect(() => {
    const stored = loadProductionState();
    if (stored) {
      setProductionState(stored);
      setSourceState(productionSource(stored));
      return;
    }
    if (hasProductionOptOut()) {
      return;
    }
    let cancelled = false;
    void fetchRemoteProductionState().then((remote) => {
      if (remote && !cancelled && !userChoseSourceRef.current) {
        setProductionState(remote);
        saveProductionState(remote);
        setSourceState(productionSource(remote));
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
  const setSource = useCallback((next: CareonSource) => {
    userChoseSourceRef.current = true;
    if (next.mode !== "productie") {
      setProductionState(null);
      clearProductionState();
      setProductionOptOut(true);
    }
    setSourceState(next);
  }, []);

  const restoreDemo = useCallback(() => {
    userChoseSourceRef.current = true;
    setOverrides({});
    setProductionState(null);
    clearProductionState();
    setProductionOptOut(true);
    setSourceState(DEMO_SOURCE);
  }, []);

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

  const isProduction = source.mode === "productie" && productionState !== null;

  // Productie filtert echt op vestiging; de demo-schaalfactor blijft een
  // demo-affordance en staat in productie altijd op 1.
  const factor = isProduction ? 1 : (CAREON_LOCATION_SCALE[filters.locatie] ?? 1);

  // Referentiedatum = importmoment: dezelfde import geeft altijd dezelfde
  // cijfers (geen stille "verval" van KPI's naarmate de klok doorloopt).
  const production = useMemo(
    () =>
      isProduction && productionState
        ? computeProductionSnapshot(productionState, { locatie: filters.locatie }, new Date(productionState.importedAt))
        : null,
    [isProduction, productionState, filters.locatie],
  );

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
    ],
  );

  return <CareonContext.Provider value={value}>{children}</CareonContext.Provider>;
}
