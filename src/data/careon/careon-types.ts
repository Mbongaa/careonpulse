import type { LucideIcon } from "lucide-react";

export type CareonKpiFormat = "int" | "pct" | "pct0" | "dec1" | "eurK" | "eur";

export interface CareonMetric {
  label: string;
  value: number;
  prev: number;
  f: CareonKpiFormat;
  betterLow?: boolean;
  neutralDown?: boolean;
}

// Weergavevariant voor productie-modus: prev === null betekent dat er nog geen
// historische meting is (snapshot-veld); de UI verbergt dan de delta-badge.
// windowLabel/prevLabel/noData sturen de subtekst (venster van de meting,
// afwijkend vergelijkingsvenster, geen meetwaarde) — demo-metrics zetten ze nooit.
export interface CareonMetricLike extends Omit<CareonMetric, "prev"> {
  prev: number | null;
  windowLabel?: string;
  prevLabel?: string;
  noData?: boolean;
}

export type CareonPageId =
  | "cockpit"
  | "signaleringen"
  | "patienten"
  | "planning"
  | "behandelaren"
  | "dossiers"
  | "dossiersProductie"
  | "kwaliteit"
  | "financieel"
  | "hr"
  | "databron";

export interface CareonKpi extends CareonMetric {
  id: string;
  icon: LucideIcon;
  spark: number[];
  page: CareonPageId;
  scale?: boolean;
}

export type CareonSeverity = "kritiek" | "hoog" | "middel";

export interface CareonAlert {
  sev: CareonSeverity;
  titel: string;
  unit: string;
  detail: string;
  n: number;
  page: CareonPageId;
}

export type CareonPeriodId = "12m" | "kw" | "mnd";

export type CareonSourceMode = "demo" | "csv" | "api" | "productie";

export interface CareonSource {
  mode: CareonSourceMode;
  label: string;
  detail: string;
}

export interface CareonFilters {
  periode: CareonPeriodId;
  locatie: string;
  team: string;
}

export type CareonKpiOverrides = Record<string, { value: number; prev: number }>;
