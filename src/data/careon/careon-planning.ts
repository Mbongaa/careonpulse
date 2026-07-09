import type { CareonMetric } from "./careon-types";

export const PLANNING_METRICS: CareonMetric[] = [
  { label: "Afspraken deze maand", value: 1842, prev: 1789, f: "int" },
  { label: "No-shows", value: 63, prev: 74, f: "int", betterLow: true },
  { label: "Geannuleerd", value: 118, prev: 131, f: "int", betterLow: true },
  { label: "Agenda-bezetting", value: 87, prev: 84, f: "pct0" },
  { label: "Beschikbare uren", value: 4520, prev: 4480, f: "int" },
  { label: "Productieve uren", value: 3610, prev: 3495, f: "int" },
  { label: "Behandeluren", value: 2930, prev: 2860, f: "int" },
  { label: "Indirecte uren", value: 680, prev: 635, f: "int", betterLow: true },
  { label: "Gem. wachttijd (wkn)", value: 5.2, prev: 6, f: "dec1", betterLow: true },
];

export const NOSHOW_PER_WEEKDAG = [
  { dag: "ma", pct: 2.8 },
  { dag: "di", pct: 3.1 },
  { dag: "wo", pct: 3.4 },
  { dag: "do", pct: 3.9 },
  { dag: "vr", pct: 4.6 },
];

export const BEZETTING_PER_LOCATIE = [
  { loc: "Tilburg", pct: 91 },
  { loc: "Breda", pct: 86 },
  { loc: "Roermond", pct: 82 },
];

export const BEZETTING_TOTAAL = 87;

export const URENVERDELING = [
  { name: "Behandeluren", value: 2930, color: "var(--chart-1)" },
  { name: "Overig productief", value: 680, color: "var(--chart-2)" },
  { name: "Indirecte uren", value: 680, color: "var(--chart-3)" },
  { name: "Niet ingevuld", value: 230, color: "var(--muted-foreground)" },
];

export const PLANNING_INSIGHT =
  "Tip van Careon Insights: sms-herinnering 24 u vooraf verlaagde no-show op vrijdag met 1,8 pt in de pilot.";
