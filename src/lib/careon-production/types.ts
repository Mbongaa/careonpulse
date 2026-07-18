import type { CareonKpiFormat, CareonSeverity } from "@/data/careon/careon-types";

// ---- Pseudonymized client record ----
// Built from the ZSG "Cliëntendata" export. Direct identifiers (naam,
// geboortedatum, verzekeringsnummer, postcode) are dropped at parse time and
// never stored; alleen dashboard-relevante attributen blijven over.
export interface ClientRecord {
  /** Cliënt ID uit het EPD — het enige identificerende veld dat bewaard blijft. */
  id: string;
  geslacht: "Vrouw" | "Man" | "Anders";
  leeftijd: number | null;
  plaats: string | null;
  /** Genormaliseerde vestiging: "Tilburg" | "Breda" | "Roermond" | overig. */
  vestiging: string | null;
  zpmLabel: string | null;
  setting: string | null;
  regiebehandelaar: string | null;
  behandelaar: string | null;
  verwijzer: string | null;
  verzekeraar: string | null;
  /** ISO-datums (yyyy-mm-dd) of null. */
  episodeStart: string | null;
  episodeEind: string | null;
  verwijsdatum: string | null;
  /** Cumulatieve minuten over de looptijd van het dossier (geen datumdimensie). */
  directeTijdMin: number;
  indirecteTijdMin: number;
  totaleTijdMin: number;
  diagnoseCode: string | null;
  diagnoseGroep: string | null;
  /**
   * Later toegevoegde velden zijn optioneel (`?`): records uit een oudere
   * opgeslagen state missen ze; de parser vult ze altijd. Consumenten
   * behandelen undefined als null/false.
   */
  /** Menselijk leesbare naam van de primaire diagnose (1-op-1 met de code). */
  diagnoseOmschrijving?: string | null;
  /** Er is een secundaire diagnose geregistreerd (comorbiditeit) — alleen ja/nee. */
  heeftSecundaireDiagnose?: boolean;
  zorgvraagtype: string | null;
  /** Omschrijving achter de ZT-code, bijv. "Psychische aandoening - matige problematiek". */
  zorgvraagtypeOmschrijving?: string | null;
  /** HoNOS-voorgestelde typering (ZT-code) — vergelijking met de geselecteerde. */
  voorgesteldZorgvraagtype?: string | null;
  /** AGB-code van de verwijzer: authoritatieve groepering van praktijkvarianten. */
  verwijzerAgb?: string | null;
  /** COV-verzekeringscheck (Uzovi-code) — aanwezigheid = check uitgevoerd. */
  covUzovi?: string | null;
  /** Einddatum van de gecontroleerde polis (ISO) — verlopen = declaratierisico. */
  polisEinde?: string | null;
  wachtlijst: boolean;
  wachtlijstLabels: string[];
  preWachtlijst: boolean;
  dossierUrl: string | null;
}

export interface ImportWarning {
  row: number;
  message: string;
}

export interface ParseExportResult {
  ok: boolean;
  error?: string;
  records: ClientRecord[];
  totalRows: number;
  skippedRows: number;
  warnings: ImportWarning[];
}

// ---- Live metrics ----
// prev === null betekent: geen historische meting beschikbaar (snapshot-veld
// zonder reconstrueerbare historie). De UI verbergt dan de delta-badge.
export interface LiveMetric {
  label: string;
  value: number;
  prev: number | null;
  f: CareonKpiFormat;
  betterLow?: boolean;
  neutralDown?: boolean;
  /** Venster van de meting, getoond in de subtekst (bijv. "juni"). */
  windowLabel?: string;
  /** Vervangt "vorige maand" wanneer de vergelijking een ander venster heeft. */
  prevLabel?: string;
  /** Geen meetwaarde in dit venster: toon "—" i.p.v. een misleidende 0. */
  noData?: boolean;
}

export interface AantalGroep {
  label: string;
  aantal: number;
}

export interface ProductionMonthPoint {
  /** Nederlandse maandafkorting, bijv. "aug". */
  m: string;
  /** Sorteerbare sleutel "2025-08". */
  key: string;
  aanmeldingen: number;
  uitstroom: number;
  caseload: number;
  /** Binnengekomen verwijzingen (vraagkant) — recente maanden mogelijk onvolledig. */
  verwijzingen: number;
}

export interface ProductionAlert {
  sev: CareonSeverity;
  titel: string;
  unit: string;
  detail: string;
  n: number;
  page: "patienten" | "behandelaren" | "dossiers" | "dossiersProductie";
}

export interface RisicoRij {
  id: string;
  naam: string;
  team: string;
  loc: string;
  signaal: string;
  dagen: number;
  dossierUrl: string | null;
}

export interface ProductionSnapshot {
  meta: {
    fileName: string;
    importedAt: string;
    referenceDate: string;
    totalRows: number;
    activeClients: number;
    /** Actieve cliënten zonder (bekende) vestiging — vallen buiten elk locatiefilter. */
    zonderVestiging: number;
  };
  /** De (op vestiging gefilterde) records — bron voor de KPI-drilldown-tabellen. */
  records: ClientRecord[];
  monthly: ProductionMonthPoint[];
  /** Per cockpit-KPI-id (alleen live/proxy ids aanwezig). */
  cockpitKpis: Record<string, { value: number; prev: number | null; spark: number[]; windowLabel?: string }>;
  cockpitSummary: { label: string; value: string }[];
  cockpitInsights: string[];
  patientenMetrics: Record<string, LiveMetric>;
  /** Setting-verdeling (S03 ambulant / S04 outreachend) als eerlijke zorgvorm-weergave. */
  zorgvorm: { name: string; value: number; color: string }[];
  /** Gerealiseerde wachttijd (verwijzing → start) per startmaand — de trend die
   * het kwartaalgemiddelde verbergt. */
  wachttijdTrend: { m: string; key: string; n: number; mediaanDagen: number | null; overTreek: number }[];
  treekLocaties: {
    loc: string;
    intake: number | null;
    behandeling: number | null;
    /** Venster van de intake-meting: kwartaal, of 12 maanden bij te weinig starts. */
    intakeVenster: "kwartaal" | "12mnd";
  }[];
  risicoLijst: RisicoRij[];
  gemWachttijdWkn: LiveMetric;
  behandelaren: {
    naam: string;
    loc: string;
    caseload: number;
    nc: number;
    directeTijdUren: number;
    totaleTijdUren: number;
  }[];
  regiebehandelaren: { naam: string; loc: string; clienten: number }[];
  dossiersProductie: {
    metrics: Record<string, LiveMetric>;
    medewerkers: { naam: string; loc: string; caseload: number; afsluitingen: number; nc: number }[];
    diagnoseGroepen: AantalGroep[];
    /** Actieve cliënten met een secundaire diagnose (comorbiditeit); pct over actief. */
    comorbiditeit: { aantal: number; pct: number };
    /** Verdeling van het geselecteerde zorgvraagtype (ZPM) onder actieve cliënten. */
    zorgvraagtypes: AantalGroep[];
    /** Duur van afgesloten episodes (start → eind), binnen het locatiefilter. */
    behandelduur: {
      afgesloten: number;
      gemDagen: number | null;
      mediaanDagen: number | null;
      buckets: AantalGroep[];
      /** Mediaanduur per afgerond kwartaal (laatste vier volledige kwartalen). */
      perKwartaal: { label: string; n: number; mediaanDagen: number | null }[];
      /** Afsluitingen zonder één minuut geregistreerde tijd (stille uitval). */
      zonderRegistratie: number;
      /** Afsluitingen binnen 14 dagen (intake-uitval / verkeerde verwijzing). */
      churn14: number;
    };
    geslacht: { name: string; value: number; color: string }[];
    leeftijdGroepen: AantalGroep[];
    verwijzers: AantalGroep[];
    plaatsen: AantalGroep[];
    verzekeraars: AantalGroep[];
    wachtlijst: {
      totaal: number;
      urgent: number;
      gemWachttijdWkn: number | null;
      buckets: AantalGroep[];
      perLocatie: AantalGroep[];
      /** Meest gevorderde wachtlijstfase per wachtende (uit de wachtlijstlabels). */
      fases: AantalGroep[];
      /** Taal-tags uit de wachtlijstlabels (alleen wanneer geregistreerd). */
      talen: AantalGroep[];
    };
    insights: string[];
  };
  signaleringen: ProductionAlert[];
  /** Registratie-compleetheid als score op 10 (kwaliteit-pagina "Dossierkwaliteit"). */
  kwaliteitDossierscore: LiveMetric;
  /** Vulgraad per veld over de hele export — de registratiediscipline zelf. */
  datakwaliteit: { veld: string; gevuld: number; totaal: number }[];
  dossiercontrole: {
    compliancePct: number;
    gecontroleerd: number;
    nietCompleet: number;
    checks: { check: string; n: number; sev: CareonSeverity }[];
  };
}

export interface ProductionState {
  fileName: string;
  importedAt: string;
  records: ClientRecord[];
}

// Gedeelde runtime-guards voor alle persistentiepaden (localStorage, Supabase
// route, remote client). Streng genoeg dat compute-snapshot nooit crasht op
// een oud/gemanipuleerd record: array- en getalvelden worden echt gecontroleerd.
function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

// Later toegevoegde velden: oudere opgeslagen states (localStorage/Supabase)
// missen ze — undefined is daar geldig en compute-snapshot behandelt het als
// null/false, zodat een bestaande import de schema-uitbreiding overleeft.
function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || isNullableString(value);
}

export function isClientRecord(value: unknown): value is ClientRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.geslacht === "string" &&
    isNullableString(record.episodeStart) &&
    isNullableString(record.episodeEind) &&
    isNullableString(record.verwijsdatum) &&
    isNullableString(record.behandelaar) &&
    isNullableString(record.regiebehandelaar) &&
    (record.leeftijd === null || typeof record.leeftijd === "number") &&
    isOptionalNullableString(record.diagnoseOmschrijving) &&
    isOptionalNullableString(record.zorgvraagtypeOmschrijving) &&
    isOptionalNullableString(record.voorgesteldZorgvraagtype) &&
    isOptionalNullableString(record.verwijzerAgb) &&
    isOptionalNullableString(record.covUzovi) &&
    isOptionalNullableString(record.polisEinde) &&
    (record.heeftSecundaireDiagnose === undefined || typeof record.heeftSecundaireDiagnose === "boolean") &&
    Array.isArray(record.wachtlijstLabels) &&
    record.wachtlijstLabels.every((label) => typeof label === "string") &&
    typeof record.wachtlijst === "boolean" &&
    typeof record.preWachtlijst === "boolean" &&
    typeof record.directeTijdMin === "number" &&
    typeof record.indirecteTijdMin === "number" &&
    typeof record.totaleTijdMin === "number"
  );
}

export function isProductionState(value: unknown): value is ProductionState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.fileName === "string" &&
    typeof state.importedAt === "string" &&
    // Ongeldige importedAt zou de referentiedatum (en dus alle maandvensters)
    // corrumperen tot NaN-sleutels — weiger de state dan als geheel.
    Number.isFinite(Date.parse(state.importedAt)) &&
    Array.isArray(state.records) &&
    state.records.length > 0 &&
    state.records.every(isClientRecord)
  );
}
