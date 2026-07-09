import type { CareonMetric } from "./careon-types";

export const HR_METRICS: CareonMetric[] = [
  { label: "Ziekteverzuim", value: 5.8, prev: 6.4, f: "pct", betterLow: true },
  { label: "Verloop (12m)", value: 11, prev: 14, f: "pct0", betterLow: true },
  { label: "Openstaande vacatures", value: 4, prev: 6, f: "int", betterLow: true },
  { label: "Lopende opleidingen", value: 12, prev: 9, f: "int" },
  { label: "Intervisie-deelname", value: 92, prev: 88, f: "pct0" },
  { label: "Werkdrukscore", value: 6.9, prev: 7.3, f: "dec1", betterLow: true },
];

export const BIG_REGISTRATIES = [
  { naam: "L. Vermeer", functie: "GZ-psycholoog", verloopt: "14 aug 2026", dagen: 39 },
  { naam: "T. Bakker", functie: "Psychotherapeut", verloopt: "2 sep 2026", dagen: 58 },
  { naam: "S. Yılmaz", functie: "SPV", verloopt: "28 sep 2026", dagen: 84 },
];

export const HR_BIG_NOTE =
  "Careon Pulse mailt medewerker en teamleider automatisch 90, 60 en 30 dagen vóór het verlopen van de registratie.";
