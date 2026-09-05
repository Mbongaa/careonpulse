import type { CareonMetric } from "./careon-types";

export const OPENSTAAND_TOTAAL = 96400;
export const OPENSTAAND_90_DAGEN = 21300;

export const FINANCIEEL_METRICS: CareonMetric[] = [
  { label: "Omzet verzekeraars", value: 425000, prev: 401000, f: "eurK", detailId: "omzetverz" },
  { label: "Omzet Infomedics", value: 68000, prev: 59000, f: "eurK", detailId: "omzetinfo" },
  { label: "Onderhanden werk", value: 182000, prev: 174000, f: "eurK", neutralDown: true, detailId: "ohw" },
  {
    label: "Openstaande declaraties",
    value: OPENSTAAND_TOTAAL,
    prev: 104800,
    f: "eurK",
    betterLow: true,
    detailId: "openstaand",
  },
  { label: "Afgekeurde declaraties", value: 12300, prev: 15100, f: "eurK", betterLow: true, detailId: "afgekeurd" },
  { label: "Gem. omzet / cliënt", value: 2140, prev: 2075, f: "eur", detailId: "omzet-client" },
  { label: "Gem. omzet / traject", value: 3680, prev: 3590, f: "eur", detailId: "omzet-traject" },
  {
    label: "Declaraties >90 dgn",
    value: OPENSTAAND_90_DAGEN,
    prev: 26800,
    f: "eurK",
    betterLow: true,
    detailId: "declaraties90",
  },
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

// De audit draagt twee eurobedragen, geen betrouwbare verdeling over de drie
// jongere buckets. Toon alleen die bekende uitsplitsing, met afgeleide aandelen.
export const DECLARATIE_OUDERDOM = [
  { label: "Tot en met 90 dagen", bedrag: OPENSTAAND_TOTAAL - OPENSTAAND_90_DAGEN },
  { label: "Ouder dan 90 dagen", bedrag: OPENSTAAND_90_DAGEN },
].map((row) => ({ ...row, pct: Math.round((row.bedrag / OPENSTAAND_TOTAAL) * 1000) / 10 }));

export const FINANCIEEL_NOTE =
  "€ 21.300 staat langer dan 90 dagen open, gebundeld bij 3 verzekeraars. Zie Signaleringen voor de specificatie.";
