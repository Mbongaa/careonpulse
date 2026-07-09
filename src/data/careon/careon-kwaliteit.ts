import type { CareonMetric } from "./careon-types";

export const KWALITEIT_COMPLIANCE = [
  { label: "ROM-compliance", value: 78, prev: 73, doel: 85 },
  { label: "PROM-compliance", value: 71, prev: 68, doel: 80 },
  { label: "Evaluaties op tijd", value: 84, prev: 81, doel: 90 },
  { label: "Zorgplannen compleet", value: 88, prev: 85, doel: 95 },
  { label: "Medicatiecontroles", value: 96, prev: 94, doel: 98 },
  { label: "Suïcidaliteitsscreening", value: 91, prev: 89, doel: 100 },
];

export const KWALITEIT_COUNTERS: CareonMetric[] = [
  { label: "Incidenten (MIC)", value: 6, prev: 9, f: "int", betterLow: true },
  { label: "Klachten", value: 2, prev: 3, f: "int", betterLow: true },
  { label: "Dossierkwaliteit", value: 8.1, prev: 7.8, f: "dec1" },
  { label: "Cliënttevredenheid", value: 8.4, prev: 8.2, f: "dec1" },
];

export const KWALITEIT_NOTE =
  "Doelen zijn instelbaar per zorgvorm. Kleurgrenzen: binnen 2 pt van het doel = groen, binnen 8 pt = oranje.";

// Compliance rows are colored by distance to their goal.
export function complianceTone(value: number, doel: number): "good" | "warn" | "bad" {
  const gap = doel - value;
  if (gap <= 2) return "good";
  if (gap <= 8) return "warn";
  return "bad";
}
