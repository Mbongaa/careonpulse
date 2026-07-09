import type { CareonMetric } from "./careon-types";

export const PATIENTEN_METRICS: CareonMetric[] = [
  { label: "Actieve patiënten", value: 1248, prev: 1215, f: "int" },
  { label: "Nieuwe patiënten", value: 86, prev: 79, f: "int" },
  { label: "Uitstroom", value: 74, prev: 82, f: "int", neutralDown: true },
  { label: "Wachtlijst intake", value: 43, prev: 51, f: "int", betterLow: true },
  { label: "Wachtlijst behandeling", value: 27, prev: 31, f: "int", betterLow: true },
  { label: "Zonder behandelaar", value: 9, prev: 14, f: "int", betterLow: true },
  { label: "Zonder vervolgafspraak", value: 31, prev: 42, f: "int", betterLow: true },
  { label: ">30 dgn geen contact", value: 58, prev: 66, f: "int", betterLow: true },
  { label: ">60 dgn geen contact", value: 23, prev: 28, f: "int", betterLow: true },
  { label: "Crisiscliënten", value: 7, prev: 5, f: "int", betterLow: true },
];

export const TREEKNORM_WEKEN = 14;
export const TREEK_CHART_MAX = 16;

export const TREEK_LOCATIES = [
  { loc: "Tilburg", intake: 3.1, behandeling: 4.6 },
  { loc: "Breda", intake: 4.2, behandeling: 5.4 },
  { loc: "Roermond", intake: 15.2, behandeling: 6.1 },
];

export const ZORGVORM_VERDELING = [
  { name: "SGGZ", value: 46, color: "var(--chart-1)" },
  { name: "BGGZ", value: 27, color: "var(--chart-2)" },
  { name: "FACT", value: 15, color: "var(--chart-3)" },
  { name: "Ouderen", value: 12, color: "var(--chart-4)" },
];

export const PATIENTEN_RISICO = [
  { id: "P-4817", naam: "D. van Leeuwen", team: "SGGZ", loc: "Roermond", signaal: ">60 dgn geen contact", dagen: 74 },
  { id: "P-4522", naam: "H. Özdemir", team: "FACT", loc: "Tilburg", signaal: ">60 dgn geen contact", dagen: 68 },
  { id: "P-4930", naam: "W. Smulders", team: "BGGZ", loc: "Breda", signaal: "Geen vervolgafspraak", dagen: 61 },
  { id: "P-5104", naam: "A. Kowalski", team: "SGGZ", loc: "Tilburg", signaal: "Zonder behandelaar", dagen: 19 },
  { id: "P-5121", naam: "M. Jacobs", team: "Ouderen", loc: "Roermond", signaal: "Geen vervolgafspraak", dagen: 44 },
];
