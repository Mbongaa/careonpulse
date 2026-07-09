import type { CareonMetric } from "./careon-types";

export const FINANCIEEL_METRICS: CareonMetric[] = [
  { label: "Omzet verzekeraars", value: 425000, prev: 401000, f: "eurK" },
  { label: "Omzet Infomedics", value: 68000, prev: 59000, f: "eurK" },
  { label: "Onderhanden werk", value: 182000, prev: 174000, f: "eurK", neutralDown: true },
  { label: "Openstaande declaraties", value: 96400, prev: 104800, f: "eurK", betterLow: true },
  { label: "Afgekeurde declaraties", value: 12300, prev: 15100, f: "eurK", betterLow: true },
  { label: "Gem. omzet / cliënt", value: 2140, prev: 2075, f: "eur" },
  { label: "Gem. omzet / traject", value: 3680, prev: 3590, f: "eur" },
  { label: "Declaraties >90 dgn", value: 21300, prev: 26800, f: "eurK", betterLow: true },
];

export const OMZET_PER_VERZEKERAAR = [
  { name: "VGZ", value: 128, color: "var(--chart-1)" },
  { name: "CZ", value: 104, color: "var(--chart-2)" },
  { name: "Zilveren Kruis", value: 92, color: "var(--chart-3)" },
  { name: "Menzis", value: 58, color: "var(--chart-4)" },
  { name: "DSW", value: 27, color: "var(--chart-5)" },
  { name: "Overig", value: 16, color: "var(--muted-foreground)" },
];

export const OMZET_PER_LOCATIE = [
  { loc: "Tilburg", omzet: 214 },
  { loc: "Breda", omzet: 168 },
  { loc: "Roermond", omzet: 111 },
];

export const OPENSTAAND_TOTAAL = 96400;

export const DECLARATIE_OUDERDOM = [
  { label: "Binnen 30 dagen", pct: 68 },
  { label: "30-60 dagen", pct: 21 },
  { label: "60-90 dagen", pct: 6 },
  { label: "Ouder dan 90 dagen", pct: 5 },
];

export const FINANCIEEL_NOTE =
  "€ 21.300 staat langer dan 90 dagen open, gebundeld bij 3 verzekeraars. Zie Signaleringen voor de specificatie.";
