// Careon Scribe — domeintypen, grenzen en typeguards (handoff 20 §4.1/§4.3/§4.6).
//
// Dit bestand is de enige bron van waarheid voor de vorm van een consult:
// de client-componenten, de API-routes en het demo-pad lezen hier dezelfde
// definities. Bewust vrij van server-imports zodat client-componenten het
// mogen importeren; de PostgREST-helpers staan in scribe.server.ts.
//
// Twee regels uit de specificatie leven hier hard:
//   * S3 — metadata draagt NOOIT een naam, geboortedatum of BSN. De enige
//     patiëntsleutel is een korte dossierreferentie; isPatientReferentie()
//     weigert BSN- en datumvormen.
//   * S10 — het model kent geen `diagnose`. Die sleutel bestaat nergens in
//     deze typen; isKlinischeStaat() (klinische-staat.ts) weigert hem actief.

export const CONSULT_TYPES = [
  "soap",
  "aobp",
  "soep",
  "psychiatrie",
  "verpleegkundig",
  "seh",
  "vervolg",
  "ontslag",
] as const;
export type ConsultType = (typeof CONSULT_TYPES)[number];

export const SESSIE_STATUSSEN = ["actief", "afgerond", "goedgekeurd", "overgenomen", "geannuleerd"] as const;
export type SessieStatus = (typeof SESSIE_STATUSSEN)[number];

export const SPREKERS = ["arts", "patient", "overig", "onbekend"] as const;
export type Spreker = (typeof SPREKERS)[number];

/** `systeem` = plaatshouder voor een fragment dat niet getranscribeerd is. */
export const SEGMENT_BRONNEN = ["live", "handmatig", "demo", "systeem"] as const;
export type SegmentBron = (typeof SEGMENT_BRONNEN)[number];

export const ANALYSE_BRONNEN = ["ai", "deterministisch", "demo"] as const;
export type AnalyseBron = (typeof ANALYSE_BRONNEN)[number];

export const SCRIBE_TALEN = ["nl", "en"] as const;
export type ScribeTaal = (typeof SCRIBE_TALEN)[number];

export const CORRECTIE_BRONNEN = ["ai", "behandelaar"] as const;
export type CorrectieBron = (typeof CORRECTIE_BRONNEN)[number];

export const TRANSCRIPTIE_PROVIDERS = ["openai", "gemini", "handmatig", "demo"] as const;
export type TranscriptieProviderNaam = (typeof TRANSCRIPTIE_PROVIDERS)[number];

export const TAAK_SOORTEN = [
  "lab",
  "beeldvorming",
  "medicatie",
  "verwijzing",
  "vervolgafspraak",
  "communicatie",
  "overig",
] as const;
export type TaakSoort = (typeof TAAK_SOORTEN)[number];

export const TAAK_STATUSSEN = ["voorgesteld", "goedgekeurd", "afgewezen", "afgerond"] as const;
export type TaakStatus = (typeof TAAK_STATUSSEN)[number];

export const NOTITIE_STATUSSEN = ["concept", "goedgekeurd"] as const;
export type NotitieStatus = (typeof NOTITIE_STATUSSEN)[number];

export const SECTIE_STATUSSEN = ["leeg", "concept", "bewerkt", "goedgekeurd"] as const;
export type SectieStatus = (typeof SECTIE_STATUSSEN)[number];

export const MEDICATIE_GEBRUIK = ["huidig", "gestopt", "voorgesteld", "onbekend"] as const;
export type MedicatieGebruik = (typeof MEDICATIE_GEBRUIK)[number];

export const ALLERGIE_AARD = ["allergie", "intolerantie", "onbekend"] as const;
export type AllergieAard = (typeof ALLERGIE_AARD)[number];

export const WAARSCHUWING_TYPES = ["allergie", "interactie", "dubbel", "dosering"] as const;
export type WaarschuwingType = (typeof WAARSCHUWING_TYPES)[number];

/** `regel` = gecureerde tabel in code, `model` = AI-signaal (§4.4/S10). */
export const WAARSCHUWING_HERKOMSTEN = ["regel", "model"] as const;
export type WaarschuwingHerkomst = (typeof WAARSCHUWING_HERKOMSTEN)[number];

export const ONTBREKEND_STATUSSEN = ["open", "besproken"] as const;
export type OntbrekendStatus = (typeof ONTBREKEND_STATUSSEN)[number];

/**
 * Grond voor het annuleren of verwijderen van een consult (N11). De grond is
 * verplicht bij elke overgang naar `geannuleerd` en bij een verwijdering, en
 * gaat metadata-only mee in het auditdetail — nooit een vrije toelichting met
 * consultinhoud.
 */
export const GEANNULEERD_GRONDEN = [
  "toestemming_ingetrokken",
  "verkeerd_dossier",
  "technisch_onbruikbaar",
  "overig",
] as const;
export type GeannuleerdGrond = (typeof GEANNULEERD_GRONDEN)[number];

// Grenzen — gespiegeld aan de CHECK-constraints van de migratie (§3). De
// routes gebruiken ze in hun body-validatie, de UI voor tellers en maxLength.
export const SCRIBE_LIMITS = {
  patientReferentieMin: 3,
  patientReferentieMax: 40,
  consentTekst: 1_000,
  segmentTekst: 4_000,
  sectieTekst: 20_000,
  secties: 12,
  sectieTitel: 120,
  taakOmschrijving: 300,
  vrijgaveReden: 300,
  segmentenPerSessie: 900,
  analyseSegmenten: 40,
  staatArray: 200,
  feitTekst: 600,
  retentieDagenMax: 365,
  bestandsnaam: 40,
  id: 64,
  /** Functie of afdeling die de DPIA beheert (N21) — nooit een cliëntgegeven. */
  dpiaEigenaar: 120,
  /** Zoekterm op dossierreferentie in de consultlijst (N16). */
  zoekterm: 40,
  /** Minimale lengte van een vastgestelde toestemmingstekst (N10). */
  consentTekstMin: 120,
} as const;

// ── Sessie & segment (§4.1) ─────────────────────────────────────────────────

export interface ScribeSessie {
  id: string;
  status: SessieStatus;
  patientReferentie: string;
  consultType: ConsultType;
  taal: ScribeTaal;
  consentBevestigdOp: string;
  consentRevisie: number;
  consentTekst: string;
  gestartOp: string | null;
  beeindigdOp: string | null;
  goedgekeurdOp: string | null;
  overgenomenOp: string | null;
  duurMs: number;
  segmentTeller: number;
  ontbrekendeFragmenten: number;
  transcriptieProvider: TranscriptieProviderNaam | null;
  transcriptieModel: string | null;
  notitieModel: string | null;
  transcriptVerwijderNa: string | null;
  sessieVerwijderNa: string | null;
  createdAt: string;
  updatedAt: string;
  /** Beheerderslijst: collega-consulten dragen géén referentie/type (serializer laat ze weg) en `eigen: false`. */
  eigen: boolean;
  vrijgegeven: boolean;
}

export interface ScribeSegment {
  id: string;
  volgnummer: number;
  spreker: Spreker;
  /** Missing/null is legacy or unverified; only a deliberate clinician role edit confirms it. */
  sprekerBron?: "behandelaar" | "ai" | null;
  tekst: string;
  tekstGecorrigeerd: string | null;
  correctieBron: CorrectieBron | null;
  beginMs: number | null;
  eindMs: number | null;
  bron: SegmentBron;
  createdAt: string;
}

// ── Klinische staat (§4.3) ──────────────────────────────────────────────────
// De shapes staan hier zodat zowel klinische-staat.ts (lege staat, merge,
// schema's) als deterministisch.ts en de UI ze kunnen gebruiken zonder
// importcyclus.

export interface Feit {
  tekst: string;
  bron: number[];
  ingetrokken: boolean;
  /**
   * Door de behandelaar zelf toegevoegd of ingetrokken (N6, S7). Een latere
   * analysepas mag zo'n mutatie NOOIT ongedaan maken: `mergeKlinischeStaat`
   * laat een rij met `doorBehandelaar: true` staan zoals de behandelaar haar
   * achterliet — niet opnieuw op `ingetrokken: false` zetten, niet vervangen
   * door een modelvariant, niet ontdubbelen weg. Optioneel zodat oudere
   * snapshots en modelantwoorden (het strikte JSON-schema kent het veld niet)
   * blijven valideren; lees het als `feit.doorBehandelaar === true`.
   */
  doorBehandelaar?: boolean;
}

/** Eén genoemde dosering met de segmenten waarin zij viel (C43). */
export interface MedicatieDosering {
  waarde: string;
  bron: number[];
}

export interface Medicatie extends Feit {
  naam: string;
  /** Weergavedosering: de eerste genoemde waarde; blijft de tekst in het verslag. */
  dosering: string | null;
  /**
   * Álle genoemde doseringen van dit middel met hun herkomst (C43). De
   * extractie en de merge vullen dit veld; het is de bron van de "Dosering
   * inconsistent genoemd"-waarschuwing, die zonder deze lijst nooit kan vuren
   * omdat de merge op `naam|gebruik` de tweede dosering weggooit.
   *
   * Optioneel — en dus ALTIJD als `medicatie.doseringen ?? []` te lezen —
   * omdat het strikte modelschema het veld niet kent (het blijft serverzijdig
   * afgeleid) en oudere staat-snapshots het missen.
   */
  doseringen?: MedicatieDosering[];
  gebruik: MedicatieGebruik;
}

export interface Allergiefeit extends Feit {
  aard: AllergieAard;
}

export interface Categoriefeit extends Feit {
  categorie: string;
}

export interface Actie extends Feit {
  omschrijving: string;
  soort: TaakSoort;
}

export interface Waarschuwing {
  type: WaarschuwingType;
  herkomst: WaarschuwingHerkomst;
  tekst: string;
  bron: number[];
}

export interface OntbrekendItem {
  tekst: string;
  status: OntbrekendStatus;
  bron: number[];
}

/** Exact conversation excerpts for review; never accepted clinical facts or roles. */
export interface GespreksContext {
  sectieId: string;
  bron: number[];
  citaten: { segmentId: string; volgnummer: number; tekst: string }[];
  status: "te_controleren";
}

export const GESPREKSCONTEXT_GRENZEN = { vermeldingen: 600, citaten: 3, tekstTotaal: 256_000 } as const;

export interface KlinischeStaat {
  samenvatting: string;
  hoofdklacht: string | null;
  duur: string | null;
  beloop: string | null;
  ernst: string | null;
  symptomen: Feit[];
  begeleidendeSymptomen: Feit[];
  uitlokkendeFactoren: Feit[];
  verlichtendeFactoren: Feit[];
  medicatie: Medicatie[];
  allergieen: Allergiefeit[];
  voorgeschiedenis: Feit[];
  familieanamnese: Feit[];
  /** roken, alcohol, drugs, slaap, beweging, voeding, werk */
  leefstijl: Categoriefeit[];
  /** stemming, angst, suicidaliteit, psychose, trauma, middelengebruik, cognitie, veiligheid */
  psychisch: Categoriefeit[];
  metingen: Feit[];
  onderzoek: Feit[];
  /** Uitsluitend door de behandelaar uitgesproken overwegingen — NOOIT diagnose. */
  overwegingen: Feit[];
  plan: Feit[];
  acties: Actie[];
  ontbrekend: OntbrekendItem[];
  waarschuwingen: Waarschuwing[];
  /** Optional for legacy snapshots; resolved from source by the server, outside the model state schema. */
  gesprekscontext?: GespreksContext[];
}

/**
 * De feitcategorieën die een behandelaar handmatig mag corrigeren (N6/S7):
 * alle Feit-lijsten van de klinische staat. `ontbrekend` en `waarschuwingen`
 * staan er bewust NIET in — die worden afgeleid, niet ingevoerd.
 */
export const STAAT_CATEGORIEEN = [
  "symptomen",
  "begeleidendeSymptomen",
  "uitlokkendeFactoren",
  "verlichtendeFactoren",
  "medicatie",
  "allergieen",
  "voorgeschiedenis",
  "familieanamnese",
  "leefstijl",
  "psychisch",
  "metingen",
  "onderzoek",
  "overwegingen",
  "plan",
  "acties",
] as const satisfies readonly (keyof KlinischeStaat)[];
export type StaatCategorie = (typeof STAAT_CATEGORIEEN)[number];

export function isStaatCategorie(value: unknown): value is StaatCategorie {
  return typeof value === "string" && (STAAT_CATEGORIEEN as readonly string[]).includes(value);
}

// ── Verslag, taken, vrijgave (§3/§4.2) ──────────────────────────────────────

export interface VerslagSectie {
  id: string;
  titel: string;
  /** Machinale opzet (deterministisch of AI) — blijft staan als referentie. */
  conceptTekst: string;
  /** Wat de behandelaar vaststelt; leeg zolang een ★-sectie niet bewerkt is. */
  tekst: string;
  status: SectieStatus;
  bron: number[];
  vereistBehandelaar: boolean;
}

export interface ScribeNotitie {
  id: string;
  sessieId: string;
  versie: number;
  /** Optimistische revisie van tekst en goedkeuring binnen één verslagversie. */
  bewerkRevisie: number;
  formaat: ConsultType;
  secties: VerslagSectie[];
  status: NotitieStatus;
  model: string | null;
  bron: AnalyseBron;
  goedgekeurdOp: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScribeTaak {
  id: string;
  sessieId: string;
  omschrijving: string;
  soort: TaakSoort;
  status: TaakStatus;
  bronSegmenten: number[];
  createdAt: string;
  updatedAt: string;
}

export interface ScribeVrijgave {
  id: string;
  sessieId: string;
  aanUserId: string;
  doorUserId: string;
  reden: string;
  createdAt: string;
}

export interface ScribeGemachtigde {
  userId: string;
  email: string;
  naam: string;
  gemachtigd: boolean;
  /** org_admins zijn altijd gemachtigd (§7.5) en daarom niet uitvinkbaar. */
  orgRole: "org_admin" | "member" | null;
}

// ── Instellingen (§4.6) ─────────────────────────────────────────────────────

export interface ScribeInstellingen {
  ingeschakeld: boolean;
  standaardFormaat: ConsultType;
  consenttekst: string;
  /** 1–365, default 30. */
  transcriptRetentieDagen: number;
  /** 0–365, default 30 (na overname). */
  notitieRetentieDagen: number;
  /** default true. */
  transcriptWissenBijOvername: boolean;
  /** Weergave: toont het aanwijzingenpaneel. Raakt geen enkele verwerking. */
  klinischeAanwijzingenAan: boolean;
  /** Weergave: toont de medicatiesignalen. Raakt geen enkele verwerking. */
  medicatiecheckAan: boolean;
  /**
   * Externe verwerking (N19) — de twee schakelaars die wél een verwerking
   * aan- of uitzetten. Beide default `false`: een organisatie waarvan de DPIA
   * alleen de deterministische laag dekt, draait de module zonder dat er ook
   * maar één fragment het platform verlaat. `aiAnalyseAan` is naast
   * `scribeLive()` en het assistent-regime een noodzakelijke voorwaarde voor
   * agent.server.ts; `transcriptieAan` is dat voor de transcriptieprovider.
   */
  aiAnalyseAan: boolean;
  transcriptieAan: boolean;
  /**
   * Activatievoorwaarden (N21) — het bewijs dat vóór `ingeschakeld: true` moet
   * liggen. `dpiaVastgesteldOp` en `consenttekstGoedgekeurdOp` zijn een
   * ISO-datum (`2026-08-15`) of een volledig ISO-tijdstip; `dpiaEigenaar` is een
   * functie of afdeling, nooit een cliëntgegeven.
   */
  dpiaVastgesteldOp: string | null;
  dpiaEigenaar: string | null;
  verwerkersovereenkomstBevestigd: boolean;
  consenttekstGoedgekeurdOp: string | null;
}

// ── Validatie ───────────────────────────────────────────────────────────────

const PATIENT_REFERENTIE_PATROON = /^[A-Za-z0-9 ._\-/]+$/;
/** 8–9 aaneengesloten cijfers — BSN-vermoeden. */
const BSN_PATROON = /\d{8,9}/;
/** dd-mm-jjjj (of met . of /) — geboortedatumvermoeden. */
const DATUM_PATROON = /\b\d{1,2}[-./]\d{1,2}[-./]\d{4}\b/;

export const PATIENT_REFERENTIE_MELDING =
  "Gebruik het dossiernummer uit het EPD (letters, cijfers, - _ . /), nooit een BSN of geboortedatum.";

/**
 * Dossierreferentie (S3): 3–40 tekens uit een smalle allowlist, zonder
 * BSN-vormige cijferreeks en zonder datumpatroon. Stuurtekens en
 * aanhalingstekens vallen buiten de allowlist en worden dus geweigerd.
 */
export function isPatientReferentie(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const waarde = value.trim();
  if (waarde.length < SCRIBE_LIMITS.patientReferentieMin) return false;
  if (waarde.length > SCRIBE_LIMITS.patientReferentieMax) return false;
  if (!PATIENT_REFERENTIE_PATROON.test(waarde)) return false;
  if (BSN_PATROON.test(waarde)) return false;
  if (DATUM_PATROON.test(waarde)) return false;
  return true;
}

/**
 * Bestandsnaamdeel voor de export (§5.3): NFC, alles buiten [A-Za-z0-9._-]
 * wordt een koppelteken, herhalingen worden samengevouwen, maximaal 40 tekens.
 * Blijft er niets over, dan valt de naam terug op `terugval` (de sessie-id).
 */
export function veiligeBestandsnaam(input: string, terugval = "consult"): string {
  const genormaliseerd = input.normalize("NFC");
  const vervangen = genormaliseerd
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, SCRIBE_LIMITS.bestandsnaam);
  if (vervangen.length > 0) return vervangen;
  const terug = terugval
    .normalize("NFC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, SCRIBE_LIMITS.bestandsnaam);
  return terug.length > 0 ? terug : "consult";
}

function isTekst(value: unknown, max: number, verplicht = false): boolean {
  if (typeof value !== "string") return false;
  if (verplicht && value.trim().length === 0) return false;
  return value.length <= max;
}

function isIsoTijdstip(value: unknown): boolean {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isIsoTijdstipOfNull(value: unknown): boolean {
  return value === null || isIsoTijdstip(value);
}

function isTeller(value: unknown, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/** Bronverwijzingen zijn segmentvolgnummers: positieve gehele getallen. */
export function isBronLijst(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= SCRIBE_LIMITS.staatArray &&
    value.every((nummer) => typeof nummer === "number" && Number.isInteger(nummer) && nummer >= 0)
  );
}

function inLijst<T extends string>(lijst: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (lijst as readonly string[]).includes(value);
}

export function isSessieStatus(value: unknown): value is SessieStatus {
  return inLijst(SESSIE_STATUSSEN, value);
}

export function isConsultType(value: unknown): value is ConsultType {
  return inLijst(CONSULT_TYPES, value);
}

export function isSpreker(value: unknown): value is Spreker {
  return inLijst(SPREKERS, value);
}

export function isScribeTaal(value: unknown): value is ScribeTaal {
  return inLijst(SCRIBE_TALEN, value);
}

export function isSegmentBron(value: unknown): value is SegmentBron {
  return inLijst(SEGMENT_BRONNEN, value);
}

export function isAnalyseBron(value: unknown): value is AnalyseBron {
  return inLijst(ANALYSE_BRONNEN, value);
}

export function isTaakSoort(value: unknown): value is TaakSoort {
  return inLijst(TAAK_SOORTEN, value);
}

export function isTaakStatus(value: unknown): value is TaakStatus {
  return inLijst(TAAK_STATUSSEN, value);
}

export function isSectieStatus(value: unknown): value is SectieStatus {
  return inLijst(SECTIE_STATUSSEN, value);
}

export function isScribeSessie(value: unknown): value is ScribeSessie {
  if (typeof value !== "object" || value === null) return false;
  const sessie = value as Record<string, unknown>;
  return (
    isTekst(sessie.id, SCRIBE_LIMITS.id, true) &&
    isSessieStatus(sessie.status) &&
    isPatientReferentie(sessie.patientReferentie) &&
    isConsultType(sessie.consultType) &&
    isScribeTaal(sessie.taal) &&
    isIsoTijdstip(sessie.consentBevestigdOp) &&
    isTeller(sessie.consentRevisie) &&
    isTekst(sessie.consentTekst, SCRIBE_LIMITS.consentTekst, true) &&
    isIsoTijdstipOfNull(sessie.gestartOp) &&
    isIsoTijdstipOfNull(sessie.beeindigdOp) &&
    isIsoTijdstipOfNull(sessie.goedgekeurdOp) &&
    isIsoTijdstipOfNull(sessie.overgenomenOp) &&
    isTeller(sessie.duurMs) &&
    isTeller(sessie.segmentTeller, SCRIBE_LIMITS.segmentenPerSessie) &&
    isTeller(sessie.ontbrekendeFragmenten) &&
    (sessie.transcriptieProvider === null || inLijst(TRANSCRIPTIE_PROVIDERS, sessie.transcriptieProvider)) &&
    (sessie.transcriptieModel === null || isTekst(sessie.transcriptieModel, 120)) &&
    (sessie.notitieModel === null || isTekst(sessie.notitieModel, 120)) &&
    isIsoTijdstipOfNull(sessie.transcriptVerwijderNa) &&
    isIsoTijdstipOfNull(sessie.sessieVerwijderNa) &&
    isIsoTijdstip(sessie.createdAt) &&
    isIsoTijdstip(sessie.updatedAt) &&
    typeof sessie.eigen === "boolean" &&
    typeof sessie.vrijgegeven === "boolean"
  );
}

export function isScribeSegment(value: unknown): value is ScribeSegment {
  if (typeof value !== "object" || value === null) return false;
  const segment = value as Record<string, unknown>;
  return (
    isTekst(segment.id, SCRIBE_LIMITS.id, true) &&
    typeof segment.volgnummer === "number" &&
    Number.isInteger(segment.volgnummer) &&
    segment.volgnummer >= 1 &&
    segment.volgnummer <= SCRIBE_LIMITS.segmentenPerSessie &&
    isSpreker(segment.spreker) &&
    (segment.sprekerBron === undefined ||
      segment.sprekerBron === null ||
      segment.sprekerBron === "behandelaar" ||
      segment.sprekerBron === "ai") &&
    isTekst(segment.tekst, SCRIBE_LIMITS.segmentTekst) &&
    (segment.tekstGecorrigeerd === null || isTekst(segment.tekstGecorrigeerd, SCRIBE_LIMITS.segmentTekst)) &&
    (segment.correctieBron === null || inLijst(CORRECTIE_BRONNEN, segment.correctieBron)) &&
    (segment.beginMs === null || isTeller(segment.beginMs)) &&
    (segment.eindMs === null || isTeller(segment.eindMs)) &&
    isSegmentBron(segment.bron) &&
    isIsoTijdstip(segment.createdAt)
  );
}

export function isVerslagSectie(value: unknown): value is VerslagSectie {
  if (typeof value !== "object" || value === null) return false;
  const sectie = value as Record<string, unknown>;
  return (
    isTekst(sectie.id, SCRIBE_LIMITS.id, true) &&
    isTekst(sectie.titel, SCRIBE_LIMITS.sectieTitel, true) &&
    isTekst(sectie.conceptTekst, SCRIBE_LIMITS.sectieTekst) &&
    isTekst(sectie.tekst, SCRIBE_LIMITS.sectieTekst) &&
    isSectieStatus(sectie.status) &&
    isBronLijst(sectie.bron) &&
    typeof sectie.vereistBehandelaar === "boolean"
  );
}

export function isScribeNotitie(value: unknown): value is ScribeNotitie {
  if (typeof value !== "object" || value === null) return false;
  const notitie = value as Record<string, unknown>;
  return (
    isTekst(notitie.id, SCRIBE_LIMITS.id, true) &&
    isTekst(notitie.sessieId, SCRIBE_LIMITS.id, true) &&
    typeof notitie.versie === "number" &&
    Number.isInteger(notitie.versie) &&
    notitie.versie >= 1 &&
    typeof notitie.bewerkRevisie === "number" &&
    Number.isSafeInteger(notitie.bewerkRevisie) &&
    notitie.bewerkRevisie >= 1 &&
    isConsultType(notitie.formaat) &&
    Array.isArray(notitie.secties) &&
    notitie.secties.length >= 1 &&
    notitie.secties.length <= SCRIBE_LIMITS.secties &&
    notitie.secties.every(isVerslagSectie) &&
    inLijst(NOTITIE_STATUSSEN, notitie.status) &&
    (notitie.model === null || isTekst(notitie.model, 120)) &&
    isAnalyseBron(notitie.bron) &&
    isIsoTijdstipOfNull(notitie.goedgekeurdOp) &&
    isIsoTijdstip(notitie.createdAt) &&
    isIsoTijdstip(notitie.updatedAt)
  );
}

export function isScribeTaak(value: unknown): value is ScribeTaak {
  if (typeof value !== "object" || value === null) return false;
  const taak = value as Record<string, unknown>;
  return (
    isTekst(taak.id, SCRIBE_LIMITS.id, true) &&
    isTekst(taak.sessieId, SCRIBE_LIMITS.id, true) &&
    isTekst(taak.omschrijving, SCRIBE_LIMITS.taakOmschrijving, true) &&
    isTaakSoort(taak.soort) &&
    isTaakStatus(taak.status) &&
    isBronLijst(taak.bronSegmenten) &&
    isIsoTijdstip(taak.createdAt) &&
    isIsoTijdstip(taak.updatedAt)
  );
}

function isRetentieDagen(value: unknown, min: number): boolean {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= SCRIBE_LIMITS.retentieDagenMax
  );
}

export function isScribeInstellingen(value: unknown): value is ScribeInstellingen {
  if (typeof value !== "object" || value === null) return false;
  const instellingen = value as Record<string, unknown>;
  return (
    typeof instellingen.ingeschakeld === "boolean" &&
    isConsultType(instellingen.standaardFormaat) &&
    isTekst(instellingen.consenttekst, SCRIBE_LIMITS.consentTekst, true) &&
    isRetentieDagen(instellingen.transcriptRetentieDagen, 1) &&
    isRetentieDagen(instellingen.notitieRetentieDagen, 0) &&
    typeof instellingen.transcriptWissenBijOvername === "boolean" &&
    typeof instellingen.klinischeAanwijzingenAan === "boolean" &&
    typeof instellingen.medicatiecheckAan === "boolean" &&
    typeof instellingen.aiAnalyseAan === "boolean" &&
    typeof instellingen.transcriptieAan === "boolean" &&
    isIsoTijdstipOfNull(instellingen.dpiaVastgesteldOp) &&
    (instellingen.dpiaEigenaar === null || isTekst(instellingen.dpiaEigenaar, SCRIBE_LIMITS.dpiaEigenaar, true)) &&
    typeof instellingen.verwerkersovereenkomstBevestigd === "boolean" &&
    isIsoTijdstipOfNull(instellingen.consenttekstGoedgekeurdOp)
  );
}

/**
 * Activatievoorwaarden (N21): wat er nog ontbreekt vóór `ingeschakeld: true`
 * mag. Leeg = alles vastgelegd. De PUT-route weigert de overgang naar
 * ingeschakeld zolang deze lijst niet leeg is (400 met de punten erin); de
 * beheerderskaart toont dezelfde regels read-only.
 */
export function activatieVoorwaardenOntbrekend(instellingen: ScribeInstellingen): string[] {
  const ontbrekend: string[] = [];
  if (!instellingen.dpiaVastgesteldOp) ontbrekend.push("Datum waarop de DPIA is vastgesteld");
  if (!instellingen.dpiaEigenaar || instellingen.dpiaEigenaar.trim().length === 0) {
    ontbrekend.push("Eigenaar van de DPIA");
  }
  if (!instellingen.verwerkersovereenkomstBevestigd) {
    ontbrekend.push("Bevestigde verwerkersovereenkomst met de transcriptiedienst");
  }
  if (!instellingen.consenttekstGoedgekeurdOp) ontbrekend.push("Datum waarop de toestemmingstekst is goedgekeurd");
  return ontbrekend;
}

// ── Toestemmingstekst (N10) ─────────────────────────────────────────────────

/** Wordt bij het voorlezen vervangen door de ingestelde transcripttermijn. */
export const CONSENT_PLACEHOLDER_TRANSCRIPT = "{transcriptRetentieDagen}";
/** Idem voor de termijn waarop het verslag na overname verdwijnt. */
export const CONSENT_PLACEHOLDER_NOTITIE = "{notitieRetentieDagen}";

/**
 * Vult de retentieplaatshouders in de toestemmingstekst (N10). De organisatie
 * bewaart de tekst MET plaatshouder, zodat een gewijzigde retentie-instelling
 * nooit uit de pas kan lopen met wat de cliënt te horen krijgt; het consult
 * bevriest vervolgens de ingevulde tekst (S13).
 */
export function vulConsenttekstIn(
  tekst: string,
  instellingen: Pick<ScribeInstellingen, "transcriptRetentieDagen" | "notitieRetentieDagen">,
): string {
  return tekst
    .split(CONSENT_PLACEHOLDER_TRANSCRIPT)
    .join(String(instellingen.transcriptRetentieDagen))
    .split(CONSENT_PLACEHOLDER_NOTITIE)
    .join(String(instellingen.notitieRetentieDagen));
}

interface ConsentElement {
  label: string;
  aanwezig: (tekst: string) => boolean;
}

/**
 * De vier elementen die art. 13 AVG / WGBO 7:448 hier vragen. Getoetst op
 * trefwoorden in kleine letters — een organisatie mag haar eigen formulering
 * kiezen, maar niet een van deze vier weglaten.
 */
const CONSENT_ELEMENTEN: readonly ConsentElement[] = [
  {
    label: "hoe lang de transcripttekst bewaard blijft",
    aanwezig: (tekst) =>
      tekst.includes("transcript") &&
      (tekst.includes(CONSENT_PLACEHOLDER_TRANSCRIPT.toLowerCase()) || /\b\d{1,3}\s*dagen\b/.test(tekst)),
  },
  {
    label: "dat het verslag na overname zichtbaar blijft tot de ingestelde termijn",
    aanwezig: (tekst) => tekst.includes("verslag") && /overname|overgenomen/.test(tekst),
  },
  {
    label: "het recht om te weigeren of de toestemming in te trekken, zonder gevolgen voor de zorg",
    aanwezig: (tekst) => /weiger/.test(tekst) && /intrekk|ingetrokken/.test(tekst) && tekst.includes("zorg"),
  },
  {
    label: "dat het EPD het dossier blijft",
    aanwezig: (tekst) => /\bepd\b/.test(tekst) && tekst.includes("dossier"),
  },
];

/**
 * Toestemmingstekst-validator (N10): minimale lengte plus de vier verplichte
 * elementen. `ontbrekend` benoemt precies wat mist, zodat PUT /instellingen
 * een bruikbare 400 kan geven in plaats van "ongeldig".
 */
export function isConsenttekst(tekst: unknown): { ok: boolean; ontbrekend: string[] } {
  if (typeof tekst !== "string") return { ok: false, ontbrekend: ["een toestemmingstekst"] };
  const ontbrekend: string[] = [];
  const genormaliseerd = tekst.trim().toLowerCase();
  if (genormaliseerd.length < SCRIBE_LIMITS.consentTekstMin) {
    ontbrekend.push(`ten minste ${SCRIBE_LIMITS.consentTekstMin} tekens`);
  }
  if (tekst.length > SCRIBE_LIMITS.consentTekst) {
    ontbrekend.push(`ten hoogste ${SCRIBE_LIMITS.consentTekst} tekens`);
  }
  for (const element of CONSENT_ELEMENTEN) {
    if (!element.aanwezig(genormaliseerd)) ontbrekend.push(element.label);
  }
  return { ok: ontbrekend.length === 0, ontbrekend };
}

// ── Lijstfilters (N16) ──────────────────────────────────────────────────────

/**
 * Zoekterm op dossierreferentie: dezelfde allowlist als de invoer (S3), maar
 * vanaf één teken zodat een deelreferentie werkt. Weigert BSN- en datumvormen,
 * zodat zo'n term nooit in een querylog of PostgREST-filter belandt.
 */
export function isScribeZoekterm(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const waarde = value.trim();
  if (waarde.length < 1 || waarde.length > SCRIBE_LIMITS.zoekterm) return false;
  if (!PATIENT_REFERENTIE_PATROON.test(waarde)) return false;
  if (BSN_PATROON.test(waarde)) return false;
  if (DATUM_PATROON.test(waarde)) return false;
  return true;
}

/** Periodefilter: strikt `JJJJ-MM-DD`, zodat het rechtstreeks in een filter mag. */
export function isIsoDatum(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Migratie-bij-lezen voor instellingen-snapshots (patroon
 * migreerInstellingen() van facturatie): een geldige stand komt ongewijzigd
 * terug; een oudere of onvolledige snapshot wordt veld voor veld aangevuld
 * vanuit `standaard` (EMPTY_SCRIBE_INSTELLINGEN uit data/careon). De
 * standaard komt als parameter binnen zodat dit bestand vrij blijft van
 * data-imports (geen importcyclus).
 */
export function normaliseerScribeInstellingen(value: unknown, standaard: ScribeInstellingen): ScribeInstellingen {
  if (isScribeInstellingen(value)) return value;
  if (typeof value !== "object" || value === null) return { ...standaard };
  const oud = value as Record<string, unknown>;
  const kandidaat: ScribeInstellingen = {
    ingeschakeld: typeof oud.ingeschakeld === "boolean" ? oud.ingeschakeld : standaard.ingeschakeld,
    standaardFormaat: isConsultType(oud.standaardFormaat) ? oud.standaardFormaat : standaard.standaardFormaat,
    consenttekst: isTekst(oud.consenttekst, SCRIBE_LIMITS.consentTekst, true)
      ? (oud.consenttekst as string)
      : standaard.consenttekst,
    transcriptRetentieDagen: isRetentieDagen(oud.transcriptRetentieDagen, 1)
      ? (oud.transcriptRetentieDagen as number)
      : standaard.transcriptRetentieDagen,
    notitieRetentieDagen: isRetentieDagen(oud.notitieRetentieDagen, 0)
      ? (oud.notitieRetentieDagen as number)
      : standaard.notitieRetentieDagen,
    transcriptWissenBijOvername:
      typeof oud.transcriptWissenBijOvername === "boolean"
        ? oud.transcriptWissenBijOvername
        : standaard.transcriptWissenBijOvername,
    klinischeAanwijzingenAan:
      typeof oud.klinischeAanwijzingenAan === "boolean"
        ? oud.klinischeAanwijzingenAan
        : standaard.klinischeAanwijzingenAan,
    medicatiecheckAan: typeof oud.medicatiecheckAan === "boolean" ? oud.medicatiecheckAan : standaard.medicatiecheckAan,
    // N19/N21 — velden van na de eerste release. Een oudere snapshot mist ze;
    // die valt dan terug op de standaard (externe verwerking uit,
    // activatievoorwaarden leeg), nooit op "aan".
    aiAnalyseAan: typeof oud.aiAnalyseAan === "boolean" ? oud.aiAnalyseAan : standaard.aiAnalyseAan,
    transcriptieAan: typeof oud.transcriptieAan === "boolean" ? oud.transcriptieAan : standaard.transcriptieAan,
    dpiaVastgesteldOp: isIsoTijdstipOfNull(oud.dpiaVastgesteldOp)
      ? (oud.dpiaVastgesteldOp as string | null)
      : standaard.dpiaVastgesteldOp,
    dpiaEigenaar: isTekst(oud.dpiaEigenaar, SCRIBE_LIMITS.dpiaEigenaar, true)
      ? (oud.dpiaEigenaar as string)
      : standaard.dpiaEigenaar,
    verwerkersovereenkomstBevestigd:
      typeof oud.verwerkersovereenkomstBevestigd === "boolean"
        ? oud.verwerkersovereenkomstBevestigd
        : standaard.verwerkersovereenkomstBevestigd,
    consenttekstGoedgekeurdOp: isIsoTijdstipOfNull(oud.consenttekstGoedgekeurdOp)
      ? (oud.consenttekstGoedgekeurdOp as string | null)
      : standaard.consenttekstGoedgekeurdOp,
  };
  return isScribeInstellingen(kandidaat) ? kandidaat : { ...standaard };
}
