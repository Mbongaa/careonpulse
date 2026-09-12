// Careon Scribe — gedeeld API-contract (handoff 20 §5.3).
//
// Eén bron van waarheid voor de vorm van elk verzoek en antwoord onder
// /api/careon/scribe/**: de route handlers valideren hiertegen, de
// client-laag (remote.client.ts) leest hiertegen. Bewust vrij van
// server-imports zodat client-componenten het mogen importeren.
//
// Foutcontract (gelijk aan facturatie): JSON `{ error }` met 400, 401, 403,
// 404, 409, 413, 415, 429 (met `Retry-After`), 502 of 503. In expliciete
// demo-modus antwoordt elke route 501 `{ configured: false, demo: true }` en
// valt de client terug op de lokale opslag (B12).

import type {
  AllergieAard,
  AnalyseBron,
  ConsultType,
  GeannuleerdGrond,
  KlinischeStaat,
  MedicatieGebruik,
  ScribeGemachtigde,
  ScribeInstellingen,
  ScribeNotitie,
  ScribeSegment,
  ScribeSessie,
  ScribeTaak,
  ScribeTaal,
  ScribeVrijgave,
  SectieStatus,
  SegmentBron,
  SessieStatus,
  Spreker,
  StaatCategorie,
  TaakSoort,
  TaakStatus,
} from "./types";

// ── Gedeelde antwoordvormen ─────────────────────────────────────────────────

/** Elke foutrespons draagt minimaal `error`; sommige routes vullen aan. */
export interface ScribeFoutResponse {
  error: string;
  /** 503 op de audioroute: geen transcriptieprovider geconfigureerd. */
  provider?: null;
  /** 409 op instellingen: de centrale revisie die intussen geldt. */
  revision?: number;
}

/** 501 in expliciete demo-modus — de client schakelt over op localStorage. */
export interface ScribeDemoResponse {
  configured: false;
  demo: true;
}

/** Paginering van de consultlijst. */
export const SCRIBE_PAGINA_GROOTTE = 25;

/** `verlooptBinnenkort` in de lijst: sessie_verwijder_na < 7 dagen. */
export const SCRIBE_VERLOOPT_BINNENKORT_DAGEN = 7;

/** Maximaal aantal segmenten dat één analyseronde meeneemt (§5.3). */
export const SCRIBE_MAX_ANALYSE_SEGMENTEN = 40;

/**
 * Bodygrenzen per route (§2.3). `readJsonBodyLimited<T>(request, max)`
 * beantwoordt overschrijding met 413.
 */
export const SCRIBE_BODY_LIMIETEN = {
  segmenten: 16 * 1_024,
  notitie: 320 * 1_024,
  instellingen: 8 * 1_024,
  standaard: 8 * 1_024,
} as const;

// ── GET /api/careon/scribe/sessies ──────────────────────────────────────────

export type SessieLijstFilter = "alle" | SessieStatus;

export interface SessiesLijstQuery {
  status?: SessieLijstFilter;
  /**
   * 1-gebaseerd (C31): pagina 1 = de eerste SCRIBE_PAGINA_GROOTTE rijen, dus
   * `offset = (pagina - 1) * SCRIBE_PAGINA_GROOTTE`. Client, demo-pad en route
   * rekenen met dezelfde basis; een ontbrekende waarde betekent pagina 1.
   */
  pagina?: number;
  /**
   * Zoekterm op dossierreferentie (N16), gevalideerd met `isScribeZoekterm`:
   * dezelfde allowlist als de invoer, ten hoogste SCRIBE_LIMITS.zoekterm
   * tekens en nooit een BSN- of datumvorm. Collega-rijen van een beheerder
   * dragen geen referentie en vallen dus automatisch buiten de treffers.
   */
  zoek?: string;
  /** Periodefilter op `created_at`, `JJJJ-MM-DD` (isIsoDatum), inclusief. */
  van?: string;
  tot?: string;
}

/** Metadata-vorm van een consult: zonder dossierreferentie en consulttype (S12/V3). */
export type ScribeSessieMetadata = Omit<ScribeSessie, "patientReferentie" | "consultType">;

/** Lijstrij: eigen consulten, vrijgegeven consulten en (beheerder) collega's. */
export interface SessieLijstRij extends ScribeSessieMetadata {
  /** Alleen aanwezig op eigen en vrijgegeven consulten; de serializer laat het veld voor collega-rijen WEG (S12/V3). */
  patientReferentie?: string;
  /** Idem: zorginhoudelijke metadata, weggelaten voor collega-rijen van een beheerder. */
  consultType?: ConsultType;
  /** sessie_verwijder_na binnen SCRIBE_VERLOOPT_BINNENKORT_DAGEN, status ≠ overgenomen. */
  verlooptBinnenkort: boolean;
  /** Hele dagen tot sessie_verwijder_na; null zonder termijn. */
  verlooptOverDagen: number | null;
}

export interface SessiesLijstResponse {
  configured: true;
  sessies: SessieLijstRij[];
  /** 1-gebaseerd, gelijk aan `SessiesLijstQuery.pagina` (C31). */
  pagina: number;
  /** Er is nog een volgende pagina. */
  meer: boolean;
  /** Is de module ingeschakeld voor deze organisatie (§7.2 meldingen). */
  ingeschakeld: boolean;
  /** Mag de aanvrager consulten voeren (gemachtigd of beheerder). */
  gemachtigd: boolean;
  /** Mag de aanvrager instellingen en gemachtigden beheren. */
  beheerder: boolean;
}

// ── POST /api/careon/scribe/sessies ─────────────────────────────────────────

export interface SessieAanmakenBody {
  patientReferentie: string;
  consultType: ConsultType;
  taal: ScribeTaal;
  /** Moet exact `true` zijn — zonder toestemming geen consult (S13). */
  consentBevestigd: true;
  /** Revisie van de instellingen waaruit de getoonde consenttekst kwam; ≠ laatste → 409. */
  consentRevisie: number;
}

export interface SessieAanmakenResponse {
  configured: true;
  sessie: ScribeSessie;
}

// ── GET /api/careon/scribe/sessies/[id] ─────────────────────────────────────

/** Staat plus haar metadata; `verouderd` dwingt een heranalyse af (S8). */
export interface StaatEnvelop {
  staat: KlinischeStaat;
  versie: number;
  /** Expliciete controle van de volledige EPD-lijst, onafhankelijk van losse feiten. */
  epdLijstBeoordeeld: boolean;
  laatsteSegment: number;
  verouderd: boolean;
  bron: AnalyseBron;
  model: string | null;
  updatedAt: string;
}

/**
 * Detailantwoord (C33). De vorm hangt af van de rol: alleen de eigenaar en een
 * vrijgave-ontvanger krijgen de dossierreferentie en het consulttype te zien,
 * een beheerder ziet uitsluitend metadata — precies zoals de lijst dat al doet.
 * Daarom is dit een unie op `rol`, en niet één type dat de smallere werkelijkheid
 * verzwijgt.
 */
export interface SessieDetailBasis {
  configured: true;
  /** Leeg voor een vrijgave-ontvanger: die krijgt nooit het transcript (S12). */
  segmenten: ScribeSegment[];
  staat: StaatEnvelop | null;
  /** Hoogste notitieversie; voor de vrijgave-ontvanger alleen een goedgekeurde. */
  notitie: ScribeNotitie | null;
  taken: ScribeTaak[];
  instellingen: ScribeInstellingen;
}

export interface SessieDetailEigenResponse extends SessieDetailBasis {
  /** Leesrechten van de aanvrager op dit consult. */
  rol: "eigenaar" | "vrijgave";
  sessie: ScribeSessie;
  /** Reden van de vrijgave; alleen gevuld voor `rol === "vrijgave"` (C15/C27, §7.4). */
  vrijgaveReden: string | null;
}

export interface SessieDetailBeheerResponse extends SessieDetailBasis {
  rol: "beheerder";
  /** Metadata-only: géén dossierreferentie, géén consulttype (S12/V3). */
  sessie: ScribeSessieMetadata;
  vrijgaveReden: null;
}

export type SessieDetailResponse = SessieDetailEigenResponse | SessieDetailBeheerResponse;

/**
 * Dezelfde unie zonder `configured`, voor de clientlaag. `Omit<>` over een unie
 * platst haar tot de gedeelde sleutels en verliest de discriminant; deze vorm
 * blijft wél te versmallen op `rol`.
 */
export type SessieDetailBody =
  | Omit<SessieDetailEigenResponse, "configured">
  | Omit<SessieDetailBeheerResponse, "configured">;

// ── PATCH /api/careon/scribe/sessies/[id] ───────────────────────────────────

export interface SessiePatchBody {
  /** Statusovergang; de RPC valideert welke overgangen zijn toegestaan. */
  status?: SessieStatus;
  /** Los te corrigeren dossierreferentie (validator S3). */
  patientReferentie?: string;
  /**
   * Verplicht bij `status: "geannuleerd"` (N11): waarom de werkkopie verdwijnt.
   * Gaat metadata-only mee in `scribe.sessie.verwijderd` — nooit een vrije
   * toelichting.
   */
  grond?: GeannuleerdGrond;
}

export interface SessiePatchResponse {
  configured: true;
  sessie: ScribeSessie;
  /** Aantal analyserondes dat vóór het afronden nog is gedraaid. */
  analyseRondes?: number;
}

// ── DELETE /api/careon/scribe/sessies/[id] ──────────────────────────────────

export interface SessieVerwijderBody {
  /** Nodig zolang er een goedgekeurd, nog niet overgenomen verslag ligt (409). */
  forceer?: boolean;
  reden?: string;
  /** Verplichte grond bij een beheerdersverwijdering (N11); metadata-only in de audit. */
  grond?: GeannuleerdGrond;
}

export interface SessieVerwijderResponse {
  configured: true;
  verwijderd: true;
  /** Metadata-only tellingen; ook zo geauditeerd. */
  segmenten: number;
  notities: number;
  rol: "eigenaar" | "beheerder";
}

// ── POST /api/careon/scribe/sessies/[id]/audio ──────────────────────────────

/** Fragmentheaders van de opnamehook (§7.6). Kleine letters: header-namen. */
export const SCRIBE_FRAGMENT_ID_HEADER = "x-careon-fragment-id";
export const SCRIBE_FRAGMENT_OFFSET_HEADER = "x-careon-fragment-offset-ms";
export const SCRIBE_FRAGMENT_DUUR_HEADER = "x-careon-fragment-duur-ms";
export const SCRIBE_FRAGMENT_OVERLAP_HEADER = "x-careon-fragment-overlap-ms";

/** Waarden worden geklemd, niet geweigerd — een scheve klok mag niets breken. */
export const SCRIBE_FRAGMENT_GRENZEN = {
  offsetMs: { min: 0, max: 3_600_000 },
  duurMs: { min: 1, max: 45_000 },
  overlapMs: { min: 0, max: 2_000 },
} as const;

/** Content-Type ná het strippen van parameters; alles daarbuiten → 415. */
export const SCRIBE_AUDIO_MIMES = ["audio/wav", "audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg"] as const;
export type ScribeAudioMime = (typeof SCRIBE_AUDIO_MIMES)[number];

/** Harde bovengrens op de fragmentbytes (Content-Length-voorcheck → 413). */
export const SCRIBE_MAX_AUDIO_BYTES = 2 * 1_024 * 1_024;

export interface AudioFragmentHeaders {
  fragmentId: string;
  offsetMs: number;
  duurMs: number;
  overlapMs: number;
}

export interface AudioUploadResponse {
  configured: true;
  /** De nieuw ingevoegde segmenten (idempotent op fragment-id). */
  segmenten: ScribeSegment[];
  provider: "openai" | "gemini" | "demo" | null;
  model: string | null;
  /** true wanneer dit fragment als plaatshouder is vastgelegd (502-pad). */
  ontbrekend: boolean;
  /** Nieuwe stand van de sessieteller, zodat de client niet hoeft te pollen. */
  segmentTeller: number;
}

/**
 * DEELSUCCES op 502 (C32). Mislukt de transcriptie, dan legt de route zélf al
 * een `bron: "systeem"`-plaatshouder vast en verhoogt zij `ontbrekende_fragmenten`
 * met precies één. Het antwoord draagt daarom de volledige AudioUploadResponse
 * mét `ontbrekend: true` en de ingevoegde rijen, náást `error`.
 *
 * De client MOET dit herkennen: een 502 met `ontbrekend === true` betekent
 * "het gat staat al in het transcript" — er mag dan géén tweede gatsegment
 * worden gepost, anders verschijnen er twee plaatshouders en telt de
 * exportkop ("Let op: n fragment(en) …") het verlies dubbel. Een 502 ZONDER
 * deze velden (de RPC zelf faalde) blijft een gewone fout waarbij de client
 * het gat wél zelf meldt.
 */
export interface AudioUploadPlaatshouderResponse extends AudioUploadResponse {
  ontbrekend: true;
  error: string;
}

// ── POST /api/careon/scribe/sessies/[id]/segmenten ──────────────────────────

export interface SegmentBody {
  tekst: string;
  /** UUID voor idempotente herhaling, ook wanneer een gatmelding opnieuw wordt verstuurd. */
  fragmentId?: string;
  spreker?: Spreker;
  /** `handmatig` (invoer) of `systeem` (gatsegment van de client). */
  bron?: Extract<SegmentBron, "handmatig" | "systeem">;
  /** Alleen bij een gatsegment: geschatte lengte van het gat. */
  duurMs?: number;
}

export interface SegmentResponse {
  configured: true;
  segmenten: ScribeSegment[];
  segmentTeller: number;
  /** Werkelijke DB-teller na idempotente verwerking (ook na een onzekere upload). */
  ontbrekendeFragmenten: number;
}

// ── PATCH /api/careon/scribe/sessies/[id]/segmenten/[volgnummer] ────────────

export interface SegmentPatchBody {
  spreker?: Spreker;
  /** `null` herstelt de oorspronkelijk herkende tekst (S9). */
  tekstGecorrigeerd?: string | null;
}

export interface SegmentPatchResponse {
  configured: true;
  segment: ScribeSegment;
  /** Raakte de correctie een al geanalyseerd segment? Dan heranalyse vereist. */
  verouderd: boolean;
  laatsteSegment: number;
}

// ── POST /api/careon/scribe/sessies/[id]/analyse ────────────────────────────

export interface SprekerToewijzing {
  volgnummer: number;
  spreker: Spreker;
}

export interface TranscriptCorrectie {
  volgnummer: number;
  tekstGecorrigeerd: string;
}

export interface AnalyseResponse {
  configured: true;
  staat: KlinischeStaat;
  bron: AnalyseBron;
  versie: number;
  epdLijstBeoordeeld: boolean;
  laatsteSegment: number;
  verouderd: false;
  sprekers: SprekerToewijzing[];
  /** Altijd `correctie_bron: "ai"`; nooit over een behandelaarscorrectie heen. */
  correcties: TranscriptCorrectie[];
  taken: ScribeTaak[];
}

// ── PATCH /api/careon/scribe/sessies/[id]/staat ─────────────────────────────

export const STAAT_MUTATIE_ACTIES = ["toevoegen", "intrekken"] as const;
export type StaatMutatieActie = (typeof STAAT_MUTATIE_ACTIES)[number];

/**
 * Eén feit zoals de behandelaar het invoert of aanwijst (N6/S7). `tekst` is de
 * weergaveregel én de sleutel waarop `intrekken` matcht; binnen `medicatie`
 * matcht de route op `naam`. De overige velden gelden per categorie en worden
 * genegeerd waar ze niet horen.
 */
export interface StaatFeitInvoer {
  tekst: string;
  /** Alleen `medicatie`. */
  naam?: string;
  dosering?: string | null;
  gebruik?: MedicatieGebruik;
  /** Alleen `allergieen`. */
  aard?: AllergieAard;
  /** Alleen `leefstijl` en `psychisch`. */
  categorie?: string;
  /** Alleen `acties`. */
  omschrijving?: string;
  soort?: TaakSoort;
}

/**
 * Correctie van de klinische staat door de behandelaar (N6). De route zet
 * `doorBehandelaar: true` op de geraakte rij; `mergeKlinischeStaat` mag zo'n rij
 * daarna nooit meer terugdraaien. `versie` is de optimistische versie uit
 * `StaatEnvelop`: loopt zij achter, dan antwoordt de route 409.
 */
export interface StaatFeitPatchBody {
  versie: number;
  categorie: StaatCategorie;
  actie: StaatMutatieActie;
  feit: StaatFeitInvoer;
}

export type StaatPatchBody = StaatFeitPatchBody | { versie: number; epdLijstBeoordeeld: true };

export interface StaatPatchResponse {
  configured: true;
  staat: KlinischeStaat;
  versie: number;
  epdLijstBeoordeeld: boolean;
  laatsteSegment: number;
  verouderd: boolean;
}

// ── POST /api/careon/scribe/sessies/[id]/notitie ────────────────────────────

export interface NotitieGenereerBody {
  /** Afwijkend formaat voor deze versie; standaard het consulttype. */
  formaat?: ConsultType;
}

export interface NotitieResponse {
  configured: true;
  notitie: ScribeNotitie;
  bron: AnalyseBron;
}

// ── PATCH /api/careon/scribe/sessies/[id]/notitie/[notitieId] ───────────────

export interface SectiePatch {
  id: string;
  tekst?: string;
  status?: SectieStatus;
}

export interface NotitiePatchBody {
  /** Vereiste huidige bewerkrevisie; een verouderde revisie levert 409. */
  bewerkRevisie: number;
  secties?: SectiePatch[];
  /** Keurt alle NIET-★-secties goed; ★-secties blijven expliciet over (S10). */
  alleGoedkeuren?: true;
  /**
   * N22: verplicht `true` bij de laatste goedkeuring wanneer de sessie
   * ontbrekende fragmenten kent (409 anders); wordt met het aantal gaten in het
   * auditdetail van `scribe.notitie.goedgekeurd` vastgelegd.
   */
  ontbrekendeFragmentenBeoordeeld?: boolean;
}

export interface NotitiePatchResponse {
  configured: true;
  notitie: ScribeNotitie;
  /** Sectie-id's die "Alles goedkeuren" bewust heeft overgeslagen. */
  overgeslagen: string[];
  /** true zodra de RPC de notitie op `goedgekeurd` heeft gezet. */
  goedgekeurd: boolean;
}

// ── PATCH /api/careon/scribe/sessies/[id]/taken/[taakId] ────────────────────

export interface TaakPatchBody {
  status: TaakStatus;
}

export interface TaakPatchResponse {
  configured: true;
  taak: ScribeTaak;
}

// ── GET /api/careon/scribe/sessies/[id]/export ──────────────────────────────

export const SCRIBE_EXPORT_FORMATEN = ["txt", "md"] as const;
export type ScribeExportFormaat = (typeof SCRIBE_EXPORT_FORMATEN)[number];

export interface ScribeExportQuery {
  formaat: ScribeExportFormaat;
  preview?: boolean;
}

/** Registratie nadat kopiëren of het starten van een download is gelukt. */
export interface ScribeExportBevestigingBody {
  kanaal: "klembord" | "bestand";
  notitieId: string;
  bewerkRevisie: number;
  sectieId?: string;
}

// ── POST /api/careon/scribe/sessies/[id]/vrijgave ───────────────────────────

export interface VrijgaveBody {
  aanUserId: string;
  reden: string;
}

export interface VrijgaveResponse {
  configured: true;
  vrijgave: ScribeVrijgave;
}

// ── DELETE /api/careon/scribe/sessies/[id]/vrijgave ─────────────────────────

/**
 * Vrijgave intrekken (N11, beheerder). Een vrijgave is nu onherroepelijk: wie
 * hem per ongeluk aan de verkeerde collega gaf, kan hem niet meer weghalen.
 * Zonder `aanUserId` vervallen álle vrijgaven van dit consult.
 * Audit: `scribe.sessie.vrijgave.ingetrokken`, metadata-only.
 */
export interface VrijgaveIntrekkenBody {
  aanUserId?: string;
  grond?: GeannuleerdGrond;
}

export interface VrijgaveIntrekkenResponse {
  configured: true;
  ingetrokken: true;
  /** Aantal verwijderde vrijgaverijen. */
  aantal: number;
}

// ── GET/PUT /api/careon/scribe/instellingen ─────────────────────────────────

/** Read-only providerbeeld voor de beheerder — nooit sleutels (§7.5). */
export interface ScribeProviderStatus {
  /** CAREON_SCRIBE_LIVE === "1"; anders draait alles deterministisch. */
  live: boolean;
  transcriptieProvider: "openai" | "gemini" | null;
  transcriptieModel: string | null;
  notitieModel: string | null;
  promptVersie: string;
  /** Draait de AI-analyse (live én assistent-regime geconfigureerd)? */
  analyseLive: boolean;
}

export interface InstellingenResponse {
  configured: true;
  instellingen: ScribeInstellingen;
  revision: number;
  providerStatus: ScribeProviderStatus;
}

export interface InstellingenOpslaanBody {
  state: ScribeInstellingen;
  /** Append-only snapshot: ≠ huidige revisie → 409. */
  baseRevision: number;
  /** Uuid; dezelfde operatie nogmaals levert de bestaande revisie terug. */
  operationId: string;
}

export interface InstellingenOpslaanResponse {
  configured: true;
  revision: number;
  idempotent?: true;
}

// ── GET/PUT /api/careon/scribe/gemachtigden ─────────────────────────────────

export interface GemachtigdenResponse {
  configured: true;
  gemachtigden: ScribeGemachtigde[];
}

export interface GemachtigdenBody {
  /** Vervangende lijst van user-id's; org_admins zijn altijd gemachtigd. */
  userIds: string[];
}

export interface GemachtigdenOpslaanResponse {
  configured: true;
  gemachtigden: ScribeGemachtigde[];
  toegevoegd: number;
  verwijderd: number;
}

// ── GET /api/careon/scribe/logboek ──────────────────────────────────────────

/**
 * Eigen scribe-logboek voor de verwerkingsverantwoordelijke (N20). `audit_events`
 * is vandaag alleen leesbaar achter `requireSuperadmin` — de Careon-superadmin,
 * niet de FG van de klant. Deze route geeft een org_admin dezelfde regels voor
 * de éigen organisatie: wie opende een consult, hoe vaak is een verslag
 * geëxporteerd, wat verwijderde een beheerder (NEN 7513, art. 15 AVG).
 *
 * Het antwoord blijft metadata: nooit transcripttekst, nooit verslaginhoud, en
 * de actor is een naam uit `organization_members` — nooit uit consultinhoud.
 */
export const SCRIBE_LOGBOEK_PAGINA_GROOTTE = 50;

/** Bekende scribe-handelingen; voedt het filter en de kolomlabels. */
export const SCRIBE_HANDELINGEN = [
  "scribe.sessie.start",
  "scribe.sessie.afgerond",
  "scribe.sessie.goedgekeurd",
  "scribe.sessie.overgenomen",
  "scribe.sessie.geannuleerd",
  "scribe.transcript.read",
  "scribe.staat.gewijzigd",
  "scribe.notitie.goedgekeurd",
  "scribe.export",
  "scribe.sessie.vrijgegeven",
  "scribe.sessie.vrijgave.ingetrokken",
  "scribe.sessie.verwijderd",
  "scribe.instellingen.gewijzigd",
  "scribe.gemachtigden.gewijzigd",
] as const;
export type ScribeHandeling = (typeof SCRIBE_HANDELINGEN)[number];

/**
 * Filterwaarde voor `handeling`. De route filtert altijd op `action=like.scribe.%`;
 * deze validator laat daarbovenop alleen een `scribe.`-slug door, zodat een
 * latere handeling filterbaar blijft zonder dat er ooit een vrije string in het
 * PostgREST-filter belandt.
 */
export function isScribeHandelingFilter(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && /^scribe\.[a-z][a-z.]*[a-z]$/.test(value);
}

export interface LogboekQuery {
  handeling?: string;
  /** `JJJJ-MM-DD`, inclusief (isIsoDatum). */
  van?: string;
  tot?: string;
  /** 1-gebaseerd, SCRIBE_LOGBOEK_PAGINA_GROOTTE per pagina. */
  pagina?: number;
}

export interface LogboekRegel {
  tijdstip: string;
  handeling: string;
  /** Naam uit organization_members; null wanneer het lidmaatschap weg is. */
  actorNaam: string | null;
  sessieId: string | null;
  /** Metadata-only: tellingen, rollen, formaten — nooit consultinhoud. */
  detail: Record<string, string | number | boolean | null>;
}

export interface LogboekResponse {
  configured: true;
  regels: LogboekRegel[];
  pagina: number;
  meer: boolean;
  /** De handelingen die in deze organisatie voorkomen, voor het filter. */
  handelingen: string[];
}
