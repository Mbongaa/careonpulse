"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

import { CRITICAL_ALERT_COUNT } from "@/data/careon/careon-alerts";
import { CAREON_LOCATION_SCALE } from "@/data/careon/careon-filters";
import { COCKPIT_KPIS } from "@/data/careon/careon-kpis";
import type { CareonFilters, CareonKpi, CareonKpiOverrides, CareonSource } from "@/data/careon/careon-types";

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

export function CareonProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [filters, setFilters] = useState<CareonFilters>({
    periode: "12m",
    locatie: "Alle locaties",
    team: "Alle teams",
  });
  const [source, setSource] = useState<CareonSource>(DEMO_SOURCE);
  const [overrides, setOverrides] = useState<CareonKpiOverrides>({});

  const setFilter = useCallback((key: keyof CareonFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const restoreDemo = useCallback(() => {
    setOverrides({});
    setSource(DEMO_SOURCE);
  }, []);

  const factor = CAREON_LOCATION_SCALE[filters.locatie] ?? 1;

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

  const value = useMemo(
    () => ({
      filters,
      setFilter,
      source,
      setSource,
      overrides,
      setOverrides,
      restoreDemo,
      kpis,
      factor,
      alertCount: CRITICAL_ALERT_COUNT,
    }),
    [filters, setFilter, source, overrides, restoreDemo, kpis, factor],
  );

  return <CareonContext.Provider value={value}>{children}</CareonContext.Provider>;
}
