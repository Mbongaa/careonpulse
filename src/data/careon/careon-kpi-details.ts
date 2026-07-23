// Register van alle KPI-drilldowns: elke KPI-kaart in het dashboard linkt naar
// /dashboard/details/<id>. Eén entry per uniek getal — KPI's die op meerdere
// pagina's staan (bijv. "Actieve patiënten" op cockpit én Patiënten) delen één
// detailpagina. Waarden zijn de geauditeerde constanten; de demo-rijen komen
// uit careon-detail-records.ts en reconciliëren exact (bewaakt in verify:careon).

import { COCKPIT_KPIS } from "./careon-kpis";
import { CAREON_MONTHLY } from "./careon-shared-charts";
import type { CareonKpiFormat, CareonPageId } from "./careon-types";

export type KpiDetailCategory = "clienten" | "events" | "eur" | "uren" | "verdeling";

export interface KpiDetailColumn {
  key: string;
  header: string;
  /** "client" = identiteitscel (naam + id · team), "person" = naam + team · locatie, "link" = externe dossierlink. */
  format?: "text" | "int" | "eur" | "dec1" | "pct" | "pct0" | "client" | "person" | "link";
  align?: "left" | "right";
  hideOnMobile?: boolean;
  /** Kleurgrens voor getalkolommen: waarde ≥ bad → rood, ≥ warn → oranje. */
  tone?: { warn: number; bad: number };
}

export type KpiDetailReconcile =
  | { kind: "count"; expected?: number }
  | { kind: "sum"; field: string }
  | { kind: "weightedMean"; nField: string; vField: string }
  | { kind: "mean"; field: string }
  | { kind: "none" };

export interface KpiDetailDef {
  id: string;
  title: string;
  sub: string;
  f: CareonKpiFormat;
  value: number;
  prev: number | null;
  betterLow?: boolean;
  neutralDown?: boolean;
  /** Spiegelt de cockpit-scale-vlag: demo-header schaalt mee met het locatiefilter. */
  scale?: boolean;
  /** Eigenaarspagina: doorlink onder de terugknop + live-banner + herkomst. */
  page: CareonPageId;
  provenance: { page: string; widget: string };
  category: KpiDetailCategory;
  /** 12 maandpunten (eurK-reeksen in duizenden, zoals de cockpit-sparks). */
  trend: number[];
  trendLabel: string;
  columns: KpiDetailColumn[];
  reconcile: KpiDetailReconcile;
}

export function careonDetailHref(id: string): string {
  return `/dashboard/details/${id}`;
}

// ---- Trendreeksen ----

function cockpitSpark(id: string): number[] {
  const kpi = COCKPIT_KPIS.find((k) => k.id === id);
  if (!kpi) {
    throw new Error(`Onbekende cockpit-KPI: ${id}`);
  }
  return kpi.spark;
}

// Deterministische 12-maandsreeks voor KPI's zonder geauditeerde historie:
// seeded walk die exact eindigt op [.., prev, value] zodat kaart en grafiek
// hetzelfde verhaal vertellen.
function buildTrend(id: string, value: number, prev: number, decimals: 0 | 1 = 0): number[] {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  }
  let state = hash >>> 0;
  const rng = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const round = (v: number) => (decimals === 1 ? Math.round(v * 10) / 10 : Math.round(v));
  const step = Math.max(Math.abs(value - prev), Math.abs(value) * 0.06, decimals === 1 ? 0.2 : 1);
  const serie = new Array<number>(12);
  serie[11] = round(value);
  serie[10] = round(prev);
  for (let i = 9; i >= 0; i -= 1) {
    const next = serie[i + 1] + (rng() - 0.5) * step;
    serie[i] = round(Math.max(next, decimals === 1 ? 0.1 : 0));
  }
  return serie;
}

const VERZUIM_TREND = CAREON_MONTHLY.map((p) => p.verzuim);

// ---- Kolompresets ----

const COL_CLIENT: KpiDetailColumn = { key: "naam", header: "Cliënt", format: "client" };
const COL_PERSON: KpiDetailColumn = { key: "naam", header: "Medewerker", format: "person" };
const COL_LOC: KpiDetailColumn = { key: "loc", header: "Locatie" };
const COL_TEAM: KpiDetailColumn = { key: "team", header: "Team", hideOnMobile: true };
const COL_BEHANDELAAR: KpiDetailColumn = { key: "behandelaar", header: "Behandelaar", hideOnMobile: true };
const COL_BEDRAG: KpiDetailColumn = { key: "bedrag", header: "Bedrag", format: "eur", align: "right" };

const WACHTLIJST_COLUMNS: KpiDetailColumn[] = [
  COL_CLIENT,
  { key: "fase", header: "Fase" },
  { key: "dagen", header: "Dagen wachtend", format: "int", align: "right", tone: { warn: 31, bad: 61 } },
  { key: "urgentie", header: "Urgentie" },
  COL_TEAM,
  COL_LOC,
];

const TEAM_STAT_COLUMNS = (
  nHeader: string,
  vKey: string,
  vHeader: string,
  vFormat: KpiDetailColumn["format"],
): KpiDetailColumn[] => [
  { key: "key", header: "Team" },
  { key: "mw", header: nHeader, format: "int", align: "right" },
  { key: vKey, header: vHeader, format: vFormat, align: "right" },
];

// ---- Het register ----

export const KPI_DETAILS: KpiDetailDef[] = [
  // -- Cockpit-gedeelde KPI's --
  {
    id: "actief",
    title: "Actieve patiënten",
    sub: "Eén rij per actieve cliënt — peilmoment deze maand.",
    f: "int",
    value: 1248,
    prev: 1215,
    scale: true,
    page: "patienten",
    provenance: { page: "patienten", widget: "Actieve patiënten" },
    category: "clienten",
    trend: cockpitSpark("actief"),
    trendLabel: "Actieve patiënten per maand",
    columns: [
      COL_CLIENT,
      { key: "diagnose", header: "Diagnosegroep" },
      COL_TEAM,
      COL_LOC,
      { key: "leeftijd", header: "Leeftijd", format: "int", align: "right", hideOnMobile: true },
      COL_BEHANDELAAR,
      { key: "sinds", header: "In zorg sinds", align: "right" },
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "aanmeldingen",
    title: "Nieuwe aanmeldingen",
    sub: "Eén rij per nieuwe aanmelding in de lopende maand (juli).",
    f: "int",
    value: 86,
    prev: 79,
    scale: true,
    page: "patienten",
    provenance: { page: "patienten", widget: "Nieuwe patiënten" },
    category: "events",
    trend: cockpitSpark("aanmeldingen"),
    trendLabel: "Aanmeldingen per maand",
    columns: [
      COL_CLIENT,
      { key: "datum", header: "Aangemeld" },
      { key: "verwijzer", header: "Verwijzer" },
      COL_TEAM,
      COL_LOC,
      { key: "status", header: "Status", hideOnMobile: true },
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "gesloten",
    title: "Gesloten dossiers",
    sub: "Eén rij per gesloten dossier in de lopende maand (juli).",
    f: "int",
    value: 74,
    prev: 82,
    neutralDown: true,
    scale: true,
    page: "patienten",
    provenance: { page: "patienten", widget: "Uitstroom" },
    category: "events",
    trend: cockpitSpark("gesloten"),
    trendLabel: "Gesloten dossiers per maand",
    columns: [
      COL_CLIENT,
      { key: "datum", header: "Gesloten op" },
      { key: "reden", header: "Reden uitstroom" },
      COL_BEHANDELAAR,
      COL_TEAM,
      COL_LOC,
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "noshow",
    title: "No-show",
    sub: "Eén rij per gemiste afspraak in juli — 63 van 1.842 afspraken (3,4%).",
    f: "pct",
    value: 3.4,
    prev: 4.1,
    betterLow: true,
    page: "planning",
    provenance: { page: "planning", widget: "No-shows" },
    category: "events",
    trend: cockpitSpark("noshow"),
    trendLabel: "No-show-percentage per maand",
    columns: [
      { key: "datum", header: "Datum" },
      COL_CLIENT,
      { key: "behandelaar", header: "Behandelaar" },
      COL_TEAM,
      COL_LOC,
    ],
    reconcile: { kind: "count", expected: 63 },
  },
  {
    id: "zondervervolg",
    title: "Zonder vervolgafspraak",
    sub: "Eén rij per actieve cliënt zonder geplande vervolgafspraak.",
    f: "int",
    value: 31,
    prev: 42,
    betterLow: true,
    scale: true,
    page: "patienten",
    provenance: { page: "patienten", widget: "Zonder vervolgafspraak" },
    category: "clienten",
    trend: cockpitSpark("zondervervolg"),
    trendLabel: "Cliënten zonder vervolgafspraak",
    columns: [
      COL_CLIENT,
      { key: "laatste", header: "Laatste afspraak" },
      { key: "dagen", header: "Dagen geleden", format: "int", align: "right", tone: { warn: 30, bad: 60 } },
      COL_BEHANDELAAR,
      COL_LOC,
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "dossiersnc",
    title: "Dossiers niet compleet",
    sub: "Eén rij per dossier met ontbrekende verplichte onderdelen.",
    f: "int",
    value: 18,
    prev: 27,
    betterLow: true,
    scale: true,
    page: "dossiers",
    provenance: { page: "dossiers", widget: "Niet compleet" },
    category: "clienten",
    trend: cockpitSpark("dossiersnc"),
    trendLabel: "Onvolledige dossiers per maand",
    columns: [
      COL_CLIENT,
      { key: "ontbreekt", header: "Ontbreekt" },
      { key: "dagen", header: "Dagen open", format: "int", align: "right", tone: { warn: 45, bad: 75 } },
      COL_BEHANDELAAR,
      COL_LOC,
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "omzetverz",
    title: "Omzet verzekeraars",
    sub: "Eén rij per declaratie aan een zorgverzekeraar in juli.",
    f: "eurK",
    value: 425000,
    prev: 401000,
    scale: true,
    page: "financieel",
    provenance: { page: "financieel", widget: "Omzet verzekeraars" },
    category: "eur",
    trend: cockpitSpark("omzetverz"),
    trendLabel: "Omzet verzekeraars per maand (× € 1.000)",
    columns: [
      { key: "key", header: "Declaratie" },
      { key: "naam", header: "Cliënt", hideOnMobile: true },
      { key: "verzekeraar", header: "Verzekeraar" },
      { key: "datum", header: "Datum", hideOnMobile: true },
      COL_LOC,
      COL_BEDRAG,
    ],
    reconcile: { kind: "sum", field: "bedrag" },
  },
  {
    id: "omzetinfo",
    title: "Omzet Infomedics",
    sub: "Eén rij per factuur via Infomedics in juli.",
    f: "eurK",
    value: 68000,
    prev: 59000,
    scale: true,
    page: "financieel",
    provenance: { page: "financieel", widget: "Omzet Infomedics" },
    category: "eur",
    trend: cockpitSpark("omzetinfo"),
    trendLabel: "Omzet Infomedics per maand (× € 1.000)",
    columns: [
      { key: "key", header: "Factuur" },
      { key: "naam", header: "Cliënt" },
      { key: "datum", header: "Datum", hideOnMobile: true },
      COL_LOC,
      COL_BEDRAG,
    ],
    reconcile: { kind: "sum", field: "bedrag" },
  },
  // Productie-exclusieve kaarten (driedeling van het facturatie-overzicht van
  // de klant, zie agent-handoff/10): "Totale omzet" en "Omzet RMO/RMA" hebben
  // geen demo-kaart; de demo-waarden hieronder zijn de som van de geauditeerde
  // omzetkaarten resp. 0 (RMO/RMA bestaat alleen in het EPD, niet in de demo).
  {
    id: "omzettotaal",
    title: "Totale omzet",
    sub: "Alle gefactureerde omzet in juli — som van de losse omzetkaarten.",
    f: "eurK",
    value: 493000,
    prev: 460000,
    scale: true,
    page: "financieel",
    provenance: { page: "financieel", widget: "Totale omzet" },
    category: "eur",
    trend: cockpitSpark("omzetverz").map((v, i) => v + cockpitSpark("omzetinfo")[i]),
    trendLabel: "Totale omzet per maand (× € 1.000)",
    columns: [
      { key: "key", header: "Factuur/declaratie" },
      { key: "naam", header: "Cliënt", hideOnMobile: true },
      { key: "verzekeraar", header: "Kanaal" },
      { key: "datum", header: "Datum", hideOnMobile: true },
      COL_LOC,
      COL_BEDRAG,
    ],
    reconcile: { kind: "sum", field: "bedrag" },
  },
  {
    id: "omzetrmo",
    title: "Omzet RMO/RMA",
    sub: "RMO/RMA-regelingen (asielzoekers/ontheemden, uitgevoerd door DSW) — beschikbaar in productie-modus na de agenda-import.",
    f: "eurK",
    value: 0,
    prev: null,
    page: "financieel",
    provenance: { page: "financieel", widget: "Omzet RMO/RMA" },
    category: "eur",
    trend: new Array(12).fill(0),
    trendLabel: "Omzet RMO/RMA per maand (× € 1.000)",
    columns: [
      { key: "key", header: "Factuur" },
      { key: "naam", header: "Cliënt" },
      { key: "datum", header: "Datum", hideOnMobile: true },
      COL_LOC,
      COL_BEDRAG,
    ],
    reconcile: { kind: "none" },
  },
  {
    id: "outreach",
    title: "Outreachende cliënten",
    sub: "Eén rij per cliënt in outreachende zorg (bezoek aan huis).",
    f: "int",
    value: 114,
    prev: 109,
    scale: true,
    page: "patienten",
    provenance: { page: "cockpit", widget: "Outreachende cliënten" },
    category: "clienten",
    trend: cockpitSpark("outreach"),
    trendLabel: "Outreachende cliënten per maand",
    columns: [
      COL_CLIENT,
      { key: "team", header: "Team" },
      { key: "frequentie", header: "Bezoekfrequentie" },
      { key: "bezoek", header: "Laatste bezoek", align: "right" },
      COL_LOC,
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "tevredenheid",
    title: "Cliënttevredenheid",
    sub: "Gemiddelde score per team en locatie — gewogen gemiddelde 8,4.",
    f: "dec1",
    value: 8.4,
    prev: 8.2,
    page: "kwaliteit",
    provenance: { page: "kwaliteit", widget: "Cliënttevredenheid" },
    category: "verdeling",
    trend: cockpitSpark("tevredenheid"),
    trendLabel: "Tevredenheidsscore per maand",
    columns: [
      { key: "key", header: "Team · locatie" },
      { key: "n", header: "Respondenten", format: "int", align: "right" },
      { key: "score", header: "Score", format: "dec1", align: "right" },
    ],
    reconcile: { kind: "weightedMean", nField: "n", vField: "score" },
  },

  // -- Patiënten --
  {
    id: "wachtlijst-intake",
    title: "Wachtlijst intake",
    sub: "Eén rij per cliënt die wacht op intake.",
    f: "int",
    value: 43,
    prev: 51,
    betterLow: true,
    page: "patienten",
    provenance: { page: "patienten", widget: "Wachtlijst intake" },
    category: "clienten",
    trend: buildTrend("wachtlijst-intake", 43, 51),
    trendLabel: "Wachtenden op intake per maand",
    columns: WACHTLIJST_COLUMNS,
    reconcile: { kind: "count" },
  },
  {
    id: "wachtlijst-behandeling",
    title: "Wachtlijst behandeling",
    sub: "Eén rij per cliënt die na intake wacht op behandeling.",
    f: "int",
    value: 27,
    prev: 31,
    betterLow: true,
    page: "patienten",
    provenance: { page: "patienten", widget: "Wachtlijst behandeling" },
    category: "clienten",
    trend: buildTrend("wachtlijst-behandeling", 27, 31),
    trendLabel: "Wachtenden op behandeling per maand",
    columns: WACHTLIJST_COLUMNS,
    reconcile: { kind: "count" },
  },
  {
    id: "zonder-behandelaar",
    title: "Zonder behandelaar",
    sub: "Eén rij per actieve cliënt zonder toegewezen behandelaar.",
    f: "int",
    value: 9,
    prev: 14,
    betterLow: true,
    page: "patienten",
    provenance: { page: "patienten", widget: "Zonder behandelaar" },
    category: "clienten",
    trend: buildTrend("zonder-behandelaar", 9, 14),
    trendLabel: "Cliënten zonder behandelaar",
    columns: [
      COL_CLIENT,
      { key: "oorzaak", header: "Oorzaak" },
      { key: "dagen", header: "Dagen zonder", format: "int", align: "right", tone: { warn: 14, bad: 21 } },
      COL_TEAM,
      COL_LOC,
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "contact30",
    title: ">30 dgn geen contact",
    sub: "Eén rij per actieve cliënt zonder contact in de afgelopen 30 dagen.",
    f: "int",
    value: 58,
    prev: 66,
    betterLow: true,
    page: "patienten",
    provenance: { page: "patienten", widget: ">30 dgn geen contact" },
    category: "clienten",
    trend: buildTrend("contact30", 58, 66),
    trendLabel: "Cliënten >30 dagen zonder contact",
    columns: [
      COL_CLIENT,
      { key: "laatste", header: "Laatste contact" },
      { key: "dagen", header: "Dagen", format: "int", align: "right", tone: { warn: 31, bad: 61 } },
      COL_BEHANDELAAR,
      COL_LOC,
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "contact60",
    title: ">60 dgn geen contact",
    sub: "Eén rij per actieve cliënt zonder contact in de afgelopen 60 dagen.",
    f: "int",
    value: 23,
    prev: 28,
    betterLow: true,
    page: "patienten",
    provenance: { page: "patienten", widget: ">60 dgn geen contact" },
    category: "clienten",
    trend: buildTrend("contact60", 23, 28),
    trendLabel: "Cliënten >60 dagen zonder contact",
    columns: [
      COL_CLIENT,
      { key: "laatste", header: "Laatste contact" },
      { key: "dagen", header: "Dagen", format: "int", align: "right", tone: { warn: 31, bad: 61 } },
      COL_BEHANDELAAR,
      COL_LOC,
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "crisis",
    title: "Crisiscliënten",
    sub: "Eén rij per cliënt met een actief crisissignaal.",
    f: "int",
    value: 7,
    prev: 5,
    betterLow: true,
    page: "patienten",
    provenance: { page: "patienten", widget: "Crisiscliënten" },
    category: "clienten",
    trend: buildTrend("crisis", 7, 5),
    trendLabel: "Crisiscliënten per maand",
    columns: [
      COL_CLIENT,
      { key: "status", header: "Status" },
      { key: "dagen", header: "Dagen actief", format: "int", align: "right" },
      COL_BEHANDELAAR,
      COL_LOC,
    ],
    reconcile: { kind: "count" },
  },

  // -- Planning --
  {
    id: "afspraken",
    title: "Afspraken deze maand",
    sub: "Eén rij per geplande afspraak in juli — inclusief no-shows en annuleringen.",
    f: "int",
    value: 1842,
    prev: 1789,
    page: "planning",
    provenance: { page: "planning", widget: "Afspraken deze maand" },
    category: "events",
    trend: buildTrend("afspraken", 1842, 1789),
    trendLabel: "Afspraken per maand",
    columns: [
      { key: "datum", header: "Datum" },
      { key: "tijd", header: "Tijd", align: "right" },
      { key: "naam", header: "Cliënt" },
      COL_BEHANDELAAR,
      { key: "type", header: "Type", hideOnMobile: true },
      { key: "status", header: "Status" },
      { key: "loc", header: "Locatie", hideOnMobile: true },
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "geannuleerd",
    title: "Geannuleerd",
    sub: "Eén rij per geannuleerde afspraak in juli.",
    f: "int",
    value: 118,
    prev: 131,
    betterLow: true,
    page: "planning",
    provenance: { page: "planning", widget: "Geannuleerd" },
    category: "events",
    trend: buildTrend("geannuleerd", 118, 131),
    trendLabel: "Annuleringen per maand",
    columns: [
      COL_CLIENT,
      { key: "datum", header: "Datum" },
      { key: "reden", header: "Reden" },
      COL_BEHANDELAAR,
      COL_LOC,
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "bezetting",
    title: "Agenda-bezetting",
    sub: "Bezetting per locatie — gewogen naar beschikbare uren komt dit uit op 87%.",
    f: "pct0",
    value: 87,
    prev: 84,
    page: "planning",
    provenance: { page: "planning", widget: "Agenda-bezetting" },
    category: "verdeling",
    trend: buildTrend("bezetting", 87, 84),
    trendLabel: "Agenda-bezetting per maand (%)",
    columns: [
      { key: "key", header: "Locatie" },
      { key: "uren", header: "Beschikbare uren", format: "int", align: "right" },
      { key: "pct", header: "Bezetting", format: "pct0", align: "right" },
    ],
    reconcile: { kind: "weightedMean", nField: "uren", vField: "pct" },
  },
  {
    id: "uren-beschikbaar",
    title: "Beschikbare uren",
    sub: "Beschikbare uren per medewerker in juli — samen 4.520 uur.",
    f: "int",
    value: 4520,
    prev: 4480,
    page: "planning",
    provenance: { page: "planning", widget: "Beschikbare uren" },
    category: "uren",
    trend: buildTrend("uren-beschikbaar", 4520, 4480),
    trendLabel: "Beschikbare uren per maand",
    columns: [COL_PERSON, { key: "uren", header: "Uren", format: "int", align: "right" }],
    reconcile: { kind: "sum", field: "uren" },
  },
  {
    id: "uren-productief",
    title: "Productieve uren",
    sub: "Productieve uren per medewerker in juli — samen 3.610 uur.",
    f: "int",
    value: 3610,
    prev: 3495,
    page: "planning",
    provenance: { page: "planning", widget: "Productieve uren" },
    category: "uren",
    trend: buildTrend("uren-productief", 3610, 3495),
    trendLabel: "Productieve uren per maand",
    columns: [COL_PERSON, { key: "uren", header: "Uren", format: "int", align: "right" }],
    reconcile: { kind: "sum", field: "uren" },
  },
  {
    id: "uren-behandel",
    title: "Behandeluren",
    sub: "Behandeluren per medewerker in juli — samen 2.930 uur.",
    f: "int",
    value: 2930,
    prev: 2860,
    page: "planning",
    provenance: { page: "planning", widget: "Behandeluren" },
    category: "uren",
    trend: buildTrend("uren-behandel", 2930, 2860),
    trendLabel: "Behandeluren per maand",
    columns: [COL_PERSON, { key: "uren", header: "Uren", format: "int", align: "right" }],
    reconcile: { kind: "sum", field: "uren" },
  },
  {
    id: "uren-indirect",
    title: "Indirecte uren",
    sub: "Indirecte uren per medewerker in juli — samen 680 uur.",
    f: "int",
    value: 680,
    prev: 635,
    betterLow: true,
    page: "planning",
    provenance: { page: "planning", widget: "Indirecte uren" },
    category: "uren",
    trend: buildTrend("uren-indirect", 680, 635),
    trendLabel: "Indirecte uren per maand",
    columns: [COL_PERSON, { key: "uren", header: "Uren", format: "int", align: "right" }],
    reconcile: { kind: "sum", field: "uren" },
  },
  {
    id: "wachttijd",
    title: "Gem. wachttijd (wkn)",
    sub: "Eén rij per gestarte cliënt dit kwartaal — gemiddelde wachttijd 5,2 weken.",
    f: "dec1",
    value: 5.2,
    prev: 6,
    betterLow: true,
    page: "planning",
    provenance: { page: "planning", widget: "Gem. wachttijd (wkn)" },
    category: "events",
    trend: buildTrend("wachttijd", 5.2, 6, 1),
    trendLabel: "Gemiddelde wachttijd per maand (wkn)",
    columns: [
      COL_CLIENT,
      COL_TEAM,
      { key: "start", header: "Gestart" },
      { key: "wkn", header: "Wachttijd (wkn)", format: "dec1", align: "right", tone: { warn: 6, bad: 10 } },
      COL_LOC,
    ],
    reconcile: { kind: "mean", field: "wkn" },
  },

  // -- Financieel --
  {
    id: "ohw",
    title: "Onderhanden werk",
    sub: "Eén rij per lopend traject met nog niet gedeclareerde zorg.",
    f: "eurK",
    value: 182000,
    prev: 174000,
    neutralDown: true,
    page: "financieel",
    provenance: { page: "financieel", widget: "Onderhanden werk" },
    category: "eur",
    trend: buildTrend("ohw", 182, 174),
    trendLabel: "Onderhanden werk per maand (× € 1.000)",
    columns: [
      { key: "key", header: "Traject" },
      { key: "naam", header: "Cliënt" },
      { key: "fase", header: "Fase", hideOnMobile: true },
      COL_LOC,
      COL_BEDRAG,
    ],
    reconcile: { kind: "sum", field: "bedrag" },
  },
  {
    id: "openstaand",
    title: "Openstaande declaraties",
    sub: "Eén rij per openstaande declaratie.",
    f: "eurK",
    value: 96400,
    prev: 104800,
    betterLow: true,
    page: "financieel",
    provenance: { page: "financieel", widget: "Openstaande declaraties" },
    category: "eur",
    trend: buildTrend("openstaand", 96.4, 104.8, 1),
    trendLabel: "Openstaand per maand (× € 1.000)",
    columns: [
      { key: "key", header: "Declaratie" },
      { key: "verzekeraar", header: "Verzekeraar" },
      { key: "dagenOpen", header: "Dagen open", format: "int", align: "right", tone: { warn: 61, bad: 91 } },
      COL_LOC,
      COL_BEDRAG,
    ],
    reconcile: { kind: "sum", field: "bedrag" },
  },
  {
    id: "afgekeurd",
    title: "Afgekeurde declaraties",
    sub: "Eén rij per afgekeurde declaratie, met afkeurreden.",
    f: "eurK",
    value: 12300,
    prev: 15100,
    betterLow: true,
    page: "financieel",
    provenance: { page: "financieel", widget: "Afgekeurde declaraties" },
    category: "eur",
    trend: buildTrend("afgekeurd", 12.3, 15.1, 1),
    trendLabel: "Afgekeurd per maand (× € 1.000)",
    columns: [
      { key: "key", header: "Declaratie" },
      { key: "verzekeraar", header: "Verzekeraar" },
      { key: "reden", header: "Reden" },
      COL_LOC,
      COL_BEDRAG,
    ],
    reconcile: { kind: "sum", field: "bedrag" },
  },
  {
    id: "omzet-client",
    title: "Gem. omzet / cliënt",
    sub: "Omzet en gemiddelde per locatie — gewogen gemiddelde € 2.140.",
    f: "eur",
    value: 2140,
    prev: 2075,
    page: "financieel",
    provenance: { page: "financieel", widget: "Gem. omzet / cliënt" },
    category: "verdeling",
    trend: buildTrend("omzet-client", 2140, 2075),
    trendLabel: "Gem. omzet per cliënt per maand (€)",
    columns: [
      { key: "key", header: "Locatie" },
      { key: "n", header: "Cliënten", format: "int", align: "right" },
      { key: "omzet", header: "Omzet", format: "eur", align: "right" },
      { key: "gem", header: "Gemiddeld", format: "eur", align: "right" },
    ],
    reconcile: { kind: "weightedMean", nField: "n", vField: "gem" },
  },
  {
    id: "omzet-traject",
    title: "Gem. omzet / traject",
    sub: "Omzet en gemiddelde per locatie — gewogen gemiddelde € 3.680.",
    f: "eur",
    value: 3680,
    prev: 3590,
    page: "financieel",
    provenance: { page: "financieel", widget: "Gem. omzet / traject" },
    category: "verdeling",
    trend: buildTrend("omzet-traject", 3680, 3590),
    trendLabel: "Gem. omzet per traject per maand (€)",
    columns: [
      { key: "key", header: "Locatie" },
      { key: "n", header: "Trajecten", format: "int", align: "right" },
      { key: "omzet", header: "Omzet", format: "eur", align: "right" },
      { key: "gem", header: "Gemiddeld", format: "eur", align: "right" },
    ],
    reconcile: { kind: "weightedMean", nField: "n", vField: "gem" },
  },
  {
    id: "declaraties90",
    title: "Declaraties >90 dgn",
    sub: "Eén rij per declaratie die langer dan 90 dagen openstaat — gebundeld bij 3 verzekeraars.",
    f: "eurK",
    value: 21300,
    prev: 26800,
    betterLow: true,
    page: "financieel",
    provenance: { page: "financieel", widget: "Declaraties >90 dgn" },
    category: "eur",
    trend: buildTrend("declaraties90", 21.3, 26.8, 1),
    trendLabel: ">90 dagen open per maand (× € 1.000)",
    columns: [
      { key: "key", header: "Declaratie" },
      { key: "verzekeraar", header: "Verzekeraar" },
      { key: "dagenOpen", header: "Dagen open", format: "int", align: "right", tone: { warn: 91, bad: 120 } },
      COL_LOC,
      COL_BEDRAG,
    ],
    reconcile: { kind: "sum", field: "bedrag" },
  },

  // -- HR --
  {
    id: "verzuim",
    title: "Ziekteverzuim",
    sub: "Verzuim per team — gewogen naar FTE komt dit uit op 5,8%.",
    f: "pct",
    value: 5.8,
    prev: 6.4,
    betterLow: true,
    page: "hr",
    provenance: { page: "hr", widget: "Ziekteverzuim" },
    category: "verdeling",
    trend: VERZUIM_TREND,
    trendLabel: "Ziekteverzuim per maand (%)",
    columns: [
      { key: "key", header: "Team" },
      { key: "fte", header: "FTE", format: "int", align: "right" },
      { key: "pct", header: "Verzuim", format: "pct", align: "right" },
    ],
    reconcile: { kind: "weightedMean", nField: "fte", vField: "pct" },
  },
  {
    id: "verloop",
    title: "Verloop (12m)",
    sub: "Vertrokken medewerkers per team over de laatste 12 maanden — gewogen 11%.",
    f: "pct0",
    value: 11,
    prev: 14,
    betterLow: true,
    page: "hr",
    provenance: { page: "hr", widget: "Verloop (12m)" },
    category: "verdeling",
    trend: buildTrend("verloop", 11, 14),
    trendLabel: "Verloop per maand (%, voortschrijdend)",
    columns: [
      { key: "key", header: "Team" },
      { key: "mw", header: "Medewerkers", format: "int", align: "right" },
      { key: "vertrokken", header: "Vertrokken (12m)", format: "int", align: "right" },
      { key: "pct", header: "Verloop", format: "pct0", align: "right" },
    ],
    reconcile: { kind: "weightedMean", nField: "mw", vField: "pct" },
  },
  {
    id: "vacatures",
    title: "Openstaande vacatures",
    sub: "Eén rij per openstaande vacature.",
    f: "int",
    value: 4,
    prev: 6,
    betterLow: true,
    page: "hr",
    provenance: { page: "hr", widget: "Openstaande vacatures" },
    category: "events",
    trend: buildTrend("vacatures", 4, 6),
    trendLabel: "Openstaande vacatures per maand",
    columns: [
      { key: "functie", header: "Functie" },
      { key: "team", header: "Team" },
      COL_LOC,
      { key: "dagen", header: "Dagen open", format: "int", align: "right", tone: { warn: 45, bad: 75 } },
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "opleidingen",
    title: "Lopende opleidingen",
    sub: "Eén rij per lopende opleiding of nascholing.",
    f: "int",
    value: 12,
    prev: 9,
    page: "hr",
    provenance: { page: "hr", widget: "Lopende opleidingen" },
    category: "events",
    trend: buildTrend("opleidingen", 12, 9),
    trendLabel: "Lopende opleidingen per maand",
    columns: [
      { key: "opleiding", header: "Opleiding" },
      { key: "naam", header: "Medewerker" },
      COL_TEAM,
      COL_LOC,
      { key: "start", header: "Gestart", align: "right" },
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "intervisie",
    title: "Intervisie-deelname",
    sub: "Deelname per team — gewogen naar teamgrootte komt dit uit op 92%.",
    f: "pct0",
    value: 92,
    prev: 88,
    page: "hr",
    provenance: { page: "hr", widget: "Intervisie-deelname" },
    category: "verdeling",
    trend: buildTrend("intervisie", 92, 88),
    trendLabel: "Intervisie-deelname per maand (%)",
    columns: TEAM_STAT_COLUMNS("Medewerkers", "pct", "Deelname", "pct0"),
    reconcile: { kind: "weightedMean", nField: "mw", vField: "pct" },
  },
  {
    id: "werkdruk",
    title: "Werkdrukscore",
    sub: "Werkdrukscore per team uit de kwartaalmeting — gewogen 6,9.",
    f: "dec1",
    value: 6.9,
    prev: 7.3,
    betterLow: true,
    page: "hr",
    provenance: { page: "hr", widget: "Werkdrukscore" },
    category: "verdeling",
    trend: buildTrend("werkdruk", 6.9, 7.3, 1),
    trendLabel: "Werkdrukscore per kwartaalmeting",
    columns: TEAM_STAT_COLUMNS("Medewerkers", "score", "Score", "dec1"),
    reconcile: { kind: "weightedMean", nField: "mw", vField: "score" },
  },

  // -- Kwaliteit --
  {
    id: "incidenten",
    title: "Incidenten (MIC)",
    sub: "Eén rij per MIC-melding in juli.",
    f: "int",
    value: 6,
    prev: 9,
    betterLow: true,
    page: "kwaliteit",
    provenance: { page: "kwaliteit", widget: "Incidenten (MIC)" },
    category: "events",
    trend: buildTrend("incidenten", 6, 9),
    trendLabel: "MIC-meldingen per maand",
    columns: [
      { key: "key", header: "Melding" },
      { key: "datum", header: "Datum" },
      { key: "type", header: "Type" },
      COL_LOC,
      { key: "ernst", header: "Ernst" },
      { key: "status", header: "Status", hideOnMobile: true },
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "klachten",
    title: "Klachten",
    sub: "Eén rij per formele klacht in juli.",
    f: "int",
    value: 2,
    prev: 3,
    betterLow: true,
    page: "kwaliteit",
    provenance: { page: "kwaliteit", widget: "Klachten" },
    category: "events",
    trend: buildTrend("klachten", 2, 3),
    trendLabel: "Klachten per maand",
    columns: [
      { key: "key", header: "Klacht" },
      { key: "datum", header: "Datum" },
      { key: "onderwerp", header: "Onderwerp" },
      COL_LOC,
      { key: "status", header: "Status" },
    ],
    reconcile: { kind: "count" },
  },
  {
    id: "dossierkwaliteit",
    title: "Dossierkwaliteit",
    sub: "Auditscore per categorie — gemiddeld 8,1.",
    f: "dec1",
    value: 8.1,
    prev: 7.8,
    page: "kwaliteit",
    provenance: { page: "kwaliteit", widget: "Dossierkwaliteit" },
    category: "verdeling",
    trend: buildTrend("dossierkwaliteit", 8.1, 7.8, 1),
    trendLabel: "Dossierkwaliteit per audit",
    columns: [
      { key: "categorie", header: "Categorie" },
      { key: "score", header: "Score", format: "dec1", align: "right" },
    ],
    reconcile: { kind: "mean", field: "score" },
  },

  // -- Dossiers & productie --
  {
    id: "productie-uren",
    title: "Productie-uren",
    sub: "Productie-uren per medewerker (declarabel + indirect) — samen 1.329 uur.",
    f: "int",
    value: 1329,
    prev: 1287,
    page: "dossiersProductie",
    provenance: { page: "dossiersProductie", widget: "Productie-uren" },
    category: "uren",
    trend: buildTrend("productie-uren", 1329, 1287),
    trendLabel: "Productie-uren per maand",
    columns: [
      COL_PERSON,
      { key: "uren", header: "Uren", format: "int", align: "right" },
      { key: "afsluitingen", header: "Afsluitingen", format: "int", align: "right" },
    ],
    reconcile: { kind: "sum", field: "uren" },
  },
  {
    id: "productiviteit",
    title: "Productiviteit",
    sub: "Productiviteit per behandelaar — gemiddeld 85%.",
    f: "pct0",
    value: 85,
    prev: 84,
    page: "dossiersProductie",
    provenance: { page: "dossiersProductie", widget: "Productiviteit" },
    category: "verdeling",
    trend: buildTrend("productiviteit", 85, 84),
    trendLabel: "Productiviteit per maand (%)",
    columns: [
      COL_PERSON,
      { key: "consulten", header: "Consulten", format: "int", align: "right" },
      { key: "pct", header: "Productiviteit", format: "pct0", align: "right" },
    ],
    reconcile: { kind: "mean", field: "pct" },
  },
  {
    id: "wachtlijst-totaal",
    title: "Wachtlijst totaal",
    sub: "Eén rij per wachtende cliënt (intake + behandeling).",
    f: "int",
    value: 70,
    prev: 82,
    betterLow: true,
    page: "dossiersProductie",
    provenance: { page: "dossiersProductie", widget: "Wachtlijst totaal" },
    category: "clienten",
    trend: buildTrend("wachtlijst-totaal", 70, 82),
    trendLabel: "Wachtenden per maand",
    columns: WACHTLIJST_COLUMNS,
    reconcile: { kind: "count" },
  },
  {
    id: "wachtlijst-urgent",
    title: "Urgent op wachtlijst",
    sub: "Eén rij per wachtende cliënt met urgentievlag (>60 dagen).",
    f: "int",
    value: 6,
    prev: 8,
    betterLow: true,
    page: "dossiersProductie",
    provenance: { page: "dossiersProductie", widget: "Urgent op wachtlijst" },
    category: "clienten",
    trend: buildTrend("wachtlijst-urgent", 6, 8),
    trendLabel: "Urgente wachtenden per maand",
    columns: WACHTLIJST_COLUMNS,
    reconcile: { kind: "count" },
  },

  // -- Dossiercontrole --
  {
    id: "dossier-compliance",
    title: "Dossier-compliance",
    sub: "De twaalf automatische controles achter de compliance-score van 98,6%.",
    f: "pct",
    value: 98.6,
    prev: null,
    page: "dossiers",
    provenance: { page: "dossiers", widget: "Dossier-compliance" },
    category: "verdeling",
    trend: buildTrend("dossier-compliance", 98.6, 98.2, 1),
    trendLabel: "Dossier-compliance per maand (%)",
    columns: [
      { key: "check", header: "Controle" },
      { key: "sev", header: "Ernst" },
      { key: "n", header: "Dossiers", format: "int", align: "right" },
    ],
    reconcile: { kind: "none" },
  },
];

export const KPI_DETAIL_BY_ID = new Map(KPI_DETAILS.map((d) => [d.id, d]));
