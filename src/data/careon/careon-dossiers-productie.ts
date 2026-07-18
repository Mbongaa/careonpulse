import { BEHANDELAREN, type Behandelaar } from "./careon-behandelaren";
import type { CareonMetric } from "./careon-types";

// Dossiers & productie — client-requested analytics page (handoff 07).
// This page is NOT part of the original audit; its mock constants are chosen
// to reconcile with the audited values they overlap with:
// - actieve cliënten 1.248 (cockpit/Patiënten) — every population breakdown sums to 1.248
// - afsluitingen 74 (cockpit "Gesloten dossiers" / Patiënten "Uitstroom")
// - wachtlijst 70 = intake 43 + behandeling 27 (Patiënten)
// - gem. wachttijd 5,2 wkn (Planning)
// - medewerkers = de 10 geauditeerde behandelaren (careon-behandelaren.ts)
// - verzekeraars = de set uit Financieel (VGZ, CZ, Zilveren Kruis, Menzis, DSW, Overig)

export const ACTIEVE_CLIENTEN = 1248;

// ---- KPI strip ----

export const DOSSIERS_PRODUCTIE_METRICS: CareonMetric[] = [
  { label: "Actieve cliënten", value: 1248, prev: 1215, f: "int", detailId: "actief" },
  { label: "Afsluitingen", value: 74, prev: 82, f: "int", neutralDown: true, detailId: "gesloten" },
  { label: "Productie-uren", value: 1329, prev: 1287, f: "int", detailId: "productie-uren" },
  { label: "Productiviteit", value: 85, prev: 84, f: "pct0", detailId: "productiviteit" },
  { label: "Wachtlijst totaal", value: 70, prev: 82, f: "int", betterLow: true, detailId: "wachtlijst-totaal" },
  { label: "Urgent op wachtlijst", value: 6, prev: 8, f: "int", betterLow: true, detailId: "wachtlijst-urgent" },
];

// ---- Dossiers, afsluitingen en productie per medewerker ----

export interface MedewerkerProductie extends Behandelaar {
  afsluitingen: number;
  productieUren: number;
}

// Afsluitingen per medewerker; the sum equals the audited monthly total (74).
const AFSLUITINGEN_PER_MEDEWERKER: Record<string, number> = {
  "Drs. E. van Dijk": 9,
  "S. Yılmaz": 7,
  "M. Janssen": 9,
  "A. de Boer": 8,
  "Dr. R. Chen": 5,
  "L. Vermeer": 6,
  "K. Aydın": 6,
  "J. Willems": 9,
  "F. el Amrani": 7,
  "T. Bakker": 8,
};

export const MEDEWERKER_PRODUCTIE: MedewerkerProductie[] = BEHANDELAREN.map((behandelaar) => ({
  ...behandelaar,
  afsluitingen: AFSLUITINGEN_PER_MEDEWERKER[behandelaar.naam] ?? 0,
  productieUren: behandelaar.declU + behandelaar.indirU,
}));

// ---- Diagnoses binnen de instelling (actieve cliënten, som = 1.248) ----

export interface AantalGroep {
  label: string;
  aantal: number;
}

export const DIAGNOSE_GROEPEN: AantalGroep[] = [
  { label: "Depressieve stoornissen", aantal: 312 },
  { label: "Angststoornissen", aantal: 236 },
  { label: "PTSS / trauma", aantal: 187 },
  { label: "ADHD", aantal: 156 },
  { label: "Autismespectrum", aantal: 118 },
  { label: "Persoonlijkheidsproblematiek", aantal: 94 },
  { label: "Bipolaire stoornis", aantal: 52 },
  { label: "Overige diagnoses", aantal: 93 },
];

// ---- Geslacht (som = 1.248) ----

export const GESLACHT_VERDELING = [
  { name: "Vrouw", value: 686, color: "var(--chart-1)" },
  { name: "Man", value: 524, color: "var(--chart-2)" },
  { name: "Anders / onbekend", value: 38, color: "var(--chart-4)" },
];

// ---- Leeftijdsgroepen (som = 1.248) ----

export const LEEFTIJD_GROEPEN: AantalGroep[] = [
  { label: "0–17 jaar", aantal: 87 },
  { label: "18–25 jaar", aantal: 274 },
  { label: "26–40 jaar", aantal: 411 },
  { label: "41–65 jaar", aantal: 356 },
  { label: "65+ jaar", aantal: 108 },
  { label: "Onbekend", aantal: 12 },
];

// ---- Verwijzers (verwijzingen, laatste 12 maanden) ----

export const VERWIJZERS: AantalGroep[] = [
  { label: "Huisartsen (ZorgDomein)", aantal: 486 },
  { label: "POH-GGZ", aantal: 172 },
  { label: "Medisch specialist", aantal: 98 },
  { label: "Gemeente / WMO", aantal: 84 },
  { label: "Andere GGZ-instelling", aantal: 66 },
  { label: "Overig / zelfverwijzer", aantal: 42 },
];

// ---- Plaats / woonplaats (actieve cliënten, som = 1.248) ----

export const PLAATS_VERDELING: AantalGroep[] = [
  { label: "Tilburg", aantal: 428 },
  { label: "Breda", aantal: 342 },
  { label: "Roermond", aantal: 208 },
  { label: "Eindhoven", aantal: 84 },
  { label: "Waalwijk", aantal: 52 },
  { label: "Oosterhout", aantal: 44 },
  { label: "Weert", aantal: 38 },
  { label: "Overige plaatsen", aantal: 52 },
];

// ---- Regiebehandelaar (actieve cliënten per regiebehandelaar, som = 1.248) ----

export const REGIE_NORM = 220;

export interface RegiebehandelaarRow {
  naam: string;
  team: string;
  loc: string;
  clienten: number;
}

export const REGIEBEHANDELAREN: RegiebehandelaarRow[] = [
  { naam: "Drs. E. van Dijk", team: "SGGZ", loc: "Tilburg", clienten: 236 },
  { naam: "Dr. R. Chen", team: "SGGZ", loc: "Tilburg", clienten: 214 },
  { naam: "A. de Boer", team: "SGGZ", loc: "Breda", clienten: 198 },
  { naam: "M. Janssen", team: "BGGZ", loc: "Breda", clienten: 187 },
  { naam: "F. el Amrani", team: "SGGZ", loc: "Roermond", clienten: 168 },
  { naam: "L. Vermeer", team: "Ouderen", loc: "Roermond", clienten: 152 },
  { naam: "S. Yılmaz", team: "FACT", loc: "Tilburg", clienten: 93 },
];

export type RegieTone = "bad" | "warn" | "none";

export function regieTone(clienten: number): RegieTone {
  if (clienten > REGIE_NORM) return "bad";
  if (clienten > REGIE_NORM - 25) return "warn";
  return "none";
}

// ---- Verzekeringskoepel (actieve cliënten, som = 1.248; zelfde koepels als Financieel) ----

export const VERZEKERAAR_VERDELING: AantalGroep[] = [
  { label: "VGZ", aantal: 374 },
  { label: "CZ", aantal: 312 },
  { label: "Zilveren Kruis", aantal: 268 },
  { label: "Menzis", aantal: 162 },
  { label: "DSW", aantal: 78 },
  { label: "Overig", aantal: 54 },
];

// ---- Wachtlijst (totaal 70 = 43 intake + 27 behandeling) ----

export const WACHTLIJST_SUMMARY = {
  totaal: 70,
  totaalPrev: 82,
  urgent: 6,
  urgentPrev: 8,
  gemWachttijdWkn: 5.2,
  gemWachttijdPrev: 6,
};

export const WACHTLIJST_BUCKETS: AantalGroep[] = [
  { label: "0–14 dagen", aantal: 22 },
  { label: "15–30 dagen", aantal: 19 },
  { label: "31–60 dagen", aantal: 17 },
  { label: "60+ dagen", aantal: 12 },
];

export const WACHTLIJST_PER_LOCATIE: AantalGroep[] = [
  { label: "Tilburg", aantal: 21 },
  { label: "Breda", aantal: 18 },
  { label: "Roermond", aantal: 31 },
];

// ---- Careon Insights ----

export const DOSSIERS_PRODUCTIE_INSIGHTS = [
  "Depressieve stoornissen zijn met 312 cliënten (25%) de grootste diagnosegroep; angststoornissen en PTSS volgen.",
  "Roermond draagt 31 van de 70 wachtenden — herverdeling naar Tilburg (3,1 wkn intake) blijft het advies.",
  "Drs. E. van Dijk begeleidt als regiebehandelaar 236 cliënten — boven de norm van 220. Overweeg herverdeling.",
];

// ---- Directiecockpit-samenvatting ----

export const COCKPIT_DOSSIERS_SUMMARY = [
  { label: "Afsluitingen", value: "74" },
  { label: "Productie-uren", value: "1.329" },
  { label: "Wachtlijst", value: "70" },
  { label: "Top diagnose", value: "Depressief" },
  { label: "Grootste verwijzer", value: "Huisartsen" },
];
