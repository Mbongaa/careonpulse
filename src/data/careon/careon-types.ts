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

export type CareonPageId =
  | "cockpit"
  | "signaleringen"
  | "patienten"
  | "planning"
  | "behandelaren"
  | "dossiers"
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

export type CareonSourceMode = "demo" | "csv" | "api";

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
