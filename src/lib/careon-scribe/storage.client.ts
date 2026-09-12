"use client";

import {
  buildDemoConsult2,
  DEMO_CONSULT_SCRIPT,
  DEMO_SCRIBE_INSTELLINGEN,
  DEMO_SCRIBE_SESSIES,
  demoConsult3Notitie,
} from "@/data/careon/careon-scribe";

import type {
  LogboekRegel,
  ScribeExportFormaat,
  StaatEnvelop,
  StaatFeitPatchBody,
  StaatPatchBody,
} from "./api-contract";
import {
  bouwVerslagDeterministisch,
  deterministischeRonde,
  extraheerDeterministisch,
  extraheerTaken,
  rondStaatAf,
} from "./deterministisch";
import { clearScribeDrafts } from "./drafts.client";
import { bouwExportTekst as bouwExportTekstGedeeld, type ExportTekstOpties } from "./export-tekst";
import { isBeoordelingsSectie } from "./formaten";
import { onbewerkteGesprekscontext } from "./gesprekscontext";
import { heranalyseStartStaat, isKlinischeStaat, legeKlinischeStaat } from "./klinische-staat";
import { berekenRetentie } from "./retentie";
import {
  type Actie,
  type Allergiefeit,
  type Categoriefeit,
  type ConsultType,
  type Feit,
  type GeannuleerdGrond,
  isScribeInstellingen,
  isScribeNotitie,
  isScribeSegment,
  isScribeSessie,
  isScribeTaak,
  type KlinischeStaat,
  type Medicatie,
  SCRIBE_LIMITS,
  type ScribeGemachtigde,
  type ScribeInstellingen,
  type ScribeNotitie,
  type ScribeSegment,
  type ScribeSessie,
  type ScribeTaak,
  type ScribeVrijgave,
  type SegmentBron,
  type SessieStatus,
  type Spreker,
  type StaatCategorie,
  type VerslagSectie,
} from "./types";

// Demo-pad van Careon Scribe (handoff 20 §7.7, B12-regel): de e2e-suite draait
// uitsluitend in demo-modus (élke dataroute antwoordt 501) en de sales-demo
// moet de volledige werkstroom tonen — opnemen, analyseren, verslag, review en
// overname in het EPD. Deze localStorage-store is dan de opslag.
//
// Drie harde regels leven ook hier:
//   * S5 — er wordt NOOIT audio bewaard. De demo speelt een gescript consult
//     (DEMO_CONSULT_SCRIPT) af; er komt geen microfoon aan te pas.
//   * S10/S11 — analyse en verslag draaien op exact dezelfde deterministische
//     functies als de productieterugval: `deterministischeRonde` en
//     `rondStaatAf` uit deterministisch.ts, dezelfde twee die agent.server.ts
//     draait (C21). De demo laat dus geen gedrag zien dat de module zonder
//     AI-provider niet kan waarmaken — en ook geen gedrag dat zij wél kan maar
//     hier ontbrak (sprekerheuristiek, ASR-woordenlijst).
//   * S7 — een behandelaarsmutatie op de klinische staat (`doorBehandelaar`)
//     wordt door een latere analyseronde nooit teruggedraaid.
//
// De sleutel staat onvoorwaardelijk in wisCareonCaches() én in de uitlogflow
// van careon-auth.ts: een consulttranscript is bijzondere-categoriedata en mag
// geen enkele browsersessie overleven.

export const SCRIBE_CACHE_KEY = "careon-scribe-v1";

/** Hoeveel logboekregels het demo-pad bewaart; genoeg voor een demo, niet meer. */
const MAX_LOKALE_LOGREGELS = 200;

/** Gefingeerde actor van het demo-pad; nooit een echte naam. */
export const DEMO_ACTOR_ID = "demo-user-1";
const DEMO_ACTOR_NAAM = "Demo Behandelaar";

/** Lokale bron van waarheid in demo: één object per browser. */
export interface ScribeLocalState {
  sessies: ScribeSessie[];
  /** Transcript per sessie-id; een gewist transcript is een lege lijst. */
  segmenten: Record<string, ScribeSegment[]>;
  staat: Record<string, StaatEnvelop>;
  /** Alle notitieversies per sessie, oplopend op `versie`. */
  notities: Record<string, ScribeNotitie[]>;
  /** Source versions bind a reviewed note to the exact transcript and state. */
  transcriptRevisies?: Record<string, number>;
  notitieBronnen?: Record<string, { staatVersie: number; transcriptRevisie: number }>;
  fragmenten?: Record<string, Record<string, string[]>>;
  taken: Record<string, ScribeTaak[]>;
  instellingen: ScribeInstellingen;
  revision: number;
  gemachtigden: ScribeGemachtigde[];
  vrijgaven: ScribeVrijgave[];
  /** Hoe ver DEMO_CONSULT_SCRIPT per sessie is afgespeeld. */
  scriptPositie: Record<string, number>;
  /**
   * Lokaal afgeleid scribe-logboek (N20). Centraal komt dit uit `audit_events`;
   * in demo schrijft deze store dezelfde negen handelingen zelf mee, zodat de
   * logboekpagina ook op het demo-pad iets te tonen heeft. Metadata-only:
   * nooit transcripttekst of verslaginhoud.
   */
  logboek: LogboekRegel[];
}

/** Simulatieduur van één gesproken fragment — gelijk aan de seed-tijdlijn. */
const DEMO_FRAGMENT_MS = 8_000;

// ── Guards ──────────────────────────────────────────────────────────────────

function isLijstMap<T>(value: unknown, guard: (item: unknown) => item is T): value is Record<string, T[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (lijst) => Array.isArray(lijst) && lijst.every((item) => guard(item)),
  );
}

function isStaatEnvelop(value: unknown): value is StaatEnvelop {
  if (!value || typeof value !== "object") return false;
  const envelop = value as Record<string, unknown>;
  return (
    isKlinischeStaat(envelop.staat) &&
    typeof envelop.versie === "number" &&
    typeof envelop.laatsteSegment === "number" &&
    typeof envelop.verouderd === "boolean" &&
    typeof envelop.updatedAt === "string" &&
    (envelop.model === null || typeof envelop.model === "string")
  );
}

function isStaatMap(value: unknown): value is Record<string, StaatEnvelop> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((item) => isStaatEnvelop(item));
}

function isTellerMap(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (teller) => typeof teller === "number" && Number.isInteger(teller) && teller >= 0,
  );
}

function isGemachtigde(value: unknown): value is ScribeGemachtigde {
  if (!value || typeof value !== "object") return false;
  const rij = value as Record<string, unknown>;
  return (
    typeof rij.userId === "string" &&
    typeof rij.email === "string" &&
    typeof rij.naam === "string" &&
    typeof rij.gemachtigd === "boolean"
  );
}

function isVrijgave(value: unknown): value is ScribeVrijgave {
  if (!value || typeof value !== "object") return false;
  const rij = value as Record<string, unknown>;
  return (
    typeof rij.id === "string" &&
    typeof rij.sessieId === "string" &&
    typeof rij.aanUserId === "string" &&
    typeof rij.doorUserId === "string" &&
    typeof rij.reden === "string" &&
    typeof rij.createdAt === "string"
  );
}

function isLogregel(value: unknown): value is LogboekRegel {
  if (!value || typeof value !== "object") return false;
  const rij = value as Record<string, unknown>;
  return (
    typeof rij.tijdstip === "string" &&
    typeof rij.handeling === "string" &&
    (rij.actorNaam === null || typeof rij.actorNaam === "string") &&
    (rij.sessieId === null || typeof rij.sessieId === "string") &&
    typeof rij.detail === "object" &&
    rij.detail !== null
  );
}

function isLocalState(value: unknown): value is ScribeLocalState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    Array.isArray(state.sessies) &&
    state.sessies.every((sessie) => isScribeSessie(sessie)) &&
    isLijstMap(state.segmenten, isScribeSegment) &&
    isStaatMap(state.staat) &&
    isLijstMap(state.notities, isScribeNotitie) &&
    isLijstMap(state.taken, isScribeTaak) &&
    isScribeInstellingen(state.instellingen) &&
    typeof state.revision === "number" &&
    Array.isArray(state.gemachtigden) &&
    state.gemachtigden.every((rij) => isGemachtigde(rij)) &&
    Array.isArray(state.vrijgaven) &&
    state.vrijgaven.every((rij) => isVrijgave(rij)) &&
    isTellerMap(state.scriptPositie) &&
    // Snapshots van vóór N20 dragen geen logboek; die worden bij het lezen
    // aangevuld in plaats van weggegooid.
    (state.logboek === undefined || (Array.isArray(state.logboek) && state.logboek.every((rij) => isLogregel(rij))))
  );
}

// ── Startstand ──────────────────────────────────────────────────────────────

/** Gefingeerde demo-collega's voor het machtigingenscherm (§7.5). */
const DEMO_GEMACHTIGDEN: readonly ScribeGemachtigde[] = [
  {
    userId: DEMO_ACTOR_ID,
    email: "user1@careon-demo.nl",
    naam: DEMO_ACTOR_NAAM,
    gemachtigd: true,
    orgRole: "org_admin",
  },
  { userId: "demo-user-2", email: "s.dewit@careon-demo.nl", naam: "S. de Wit", gemachtigd: true, orgRole: "member" },
  { userId: "demo-user-3", email: "j.bakker@careon-demo.nl", naam: "J. Bakker", gemachtigd: false, orgRole: "member" },
];

function staatEnvelop(staat: StaatEnvelop["staat"], laatsteSegment: number, updatedAt: string): StaatEnvelop {
  return {
    staat,
    versie: 1,
    epdLijstBeoordeeld: false,
    laatsteSegment,
    verouderd: false,
    bron: "demo",
    model: null,
    updatedAt,
  };
}

/**
 * Deterministische demo-startstand: het actieve consult is leeg (de bezoeker
 * speelt het zelf af), het afgeronde consult draagt transcript, staat, taken en
 * een conceptverslag, en het overgenomen consult heeft alleen nog het
 * goedgekeurde verslag — het transcript is bij de overname gewist (S15).
 */
export function demoScribeState(): ScribeLocalState {
  const consult2 = buildDemoConsult2();
  const consult3Notitie = demoConsult3Notitie();
  const [consult1, sessie2, sessie3] = DEMO_SCRIBE_SESSIES;
  return {
    sessies: DEMO_SCRIBE_SESSIES.map((sessie) => ({ ...sessie })),
    segmenten: {
      [consult1.id]: [],
      [sessie2.id]: consult2.segmenten.map((segment) => ({ ...segment })),
      [sessie3.id]: [],
    },
    staat: {
      [consult1.id]: staatEnvelop(legeKlinischeStaat(), 0, consult1.updatedAt),
      [sessie2.id]: staatEnvelop(consult2.staat, consult2.segmenten.length, sessie2.updatedAt),
    },
    notities: {
      [sessie2.id]: [consult2.notitie],
      [sessie3.id]: [consult3Notitie],
    },
    transcriptRevisies: {},
    notitieBronnen: { [consult2.notitie.id]: { staatVersie: 1, transcriptRevisie: 0 } },
    fragmenten: {},
    taken: { [sessie2.id]: consult2.taken.map((taak) => ({ ...taak })) },
    instellingen: { ...DEMO_SCRIBE_INSTELLINGEN },
    revision: 1,
    gemachtigden: DEMO_GEMACHTIGDEN.map((rij) => ({ ...rij })),
    vrijgaven: [],
    scriptPositie: { [sessie2.id]: DEMO_CONSULT_SCRIPT.length },
    logboek: [
      {
        tijdstip: sessie2.createdAt,
        handeling: "scribe.sessie.start",
        actorNaam: DEMO_ACTOR_NAAM,
        sessieId: sessie2.id,
        detail: { consultType: sessie2.consultType, taal: sessie2.taal },
      },
      {
        tijdstip: sessie3.goedgekeurdOp ?? sessie3.updatedAt,
        handeling: "scribe.notitie.goedgekeurd",
        actorNaam: DEMO_ACTOR_NAAM,
        sessieId: sessie3.id,
        detail: { secties: 5, versie: 1 },
      },
    ],
  };
}

export function loadScribeState(): ScribeLocalState | null {
  try {
    const raw = window.localStorage.getItem(SCRIBE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (record.notities && typeof record.notities === "object") {
        for (const lijst of Object.values(record.notities)) {
          if (!Array.isArray(lijst)) continue;
          for (const notitie of lijst)
            if (notitie && typeof notitie === "object" && notitie.bewerkRevisie === undefined)
              notitie.bewerkRevisie = 1;
        }
      }
      if (record.staat && typeof record.staat === "object") {
        for (const envelop of Object.values(record.staat)) {
          if (envelop && typeof envelop === "object" && !("epdLijstBeoordeeld" in envelop))
            Object.assign(envelop, { epdLijstBeoordeeld: false });
        }
      }
    }
    if (!isLocalState(parsed)) return null;
    // Migratie bij lezen: het logboek is van na de eerste release.
    return parsed.logboek === undefined ? { ...parsed, logboek: [] } : parsed;
  } catch {
    return null;
  }
}

/** `false` bij quota-overschrijding of ontbrekende localStorage. */
export function saveScribeState(state: ScribeLocalState): boolean {
  try {
    window.localStorage.setItem(SCRIBE_CACHE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearScribeState(): void {
  clearScribeDrafts();
  try {
    window.localStorage.removeItem(SCRIBE_CACHE_KEY);
  } catch {
    // Zonder localStorage is er ook geen blijvende consultstaat om te wissen.
  }
}

// ── Kleine hulpjes ──────────────────────────────────────────────────────────

function nu(): string {
  return new Date().toISOString();
}

function lokaalId(voorvoegsel: string): string {
  return `${voorvoegsel}-${crypto.randomUUID()}`;
}

/**
 * Eén metadata-only logregel (N20). Nooit transcripttekst, nooit verslaginhoud
 * — precies dezelfde grens als het centrale auditdetail.
 */
export function logLokaal(
  state: ScribeLocalState,
  handeling: string,
  sessieId: string | null,
  detail: LogboekRegel["detail"] = {},
): void {
  const regels = state.logboek;
  state.logboek = [{ tijdstip: nu(), handeling, actorNaam: DEMO_ACTOR_NAAM, sessieId, detail }, ...regels].slice(
    0,
    MAX_LOKALE_LOGREGELS,
  );
}

export function vindSessie(state: ScribeLocalState, sessieId: string): ScribeSessie | null {
  return state.sessies.find((sessie) => sessie.id === sessieId) ?? null;
}

export function segmentenVan(state: ScribeLocalState, sessieId: string): ScribeSegment[] {
  return state.segmenten[sessieId] ?? [];
}

export function laatsteNotitie(state: ScribeLocalState, sessieId: string): ScribeNotitie | null {
  const versies = state.notities[sessieId] ?? [];
  return versies.length > 0 ? versies[versies.length - 1] : null;
}

export function takenVan(state: ScribeLocalState, sessieId: string): ScribeTaak[] {
  return state.taken[sessieId] ?? [];
}

function werkSessieBij(state: ScribeLocalState, sessieId: string, patch: Partial<ScribeSessie>): ScribeSessie | null {
  const index = state.sessies.findIndex((sessie) => sessie.id === sessieId);
  if (index < 0) return null;
  const bijgewerkt: ScribeSessie = { ...state.sessies[index], ...patch, updatedAt: nu() };
  state.sessies[index] = bijgewerkt;
  return bijgewerkt;
}

// ── Sessies ─────────────────────────────────────────────────────────────────

export interface NieuweSessieInvoer {
  patientReferentie: string;
  consultType: ConsultType;
  taal: "nl" | "en";
  /** Ingevulde toestemmingstekst zoals voorgelezen (N10); valt terug op de instelling. */
  consentTekst?: string;
}

/** Maakt een lokaal consult met bevroren toestemmingstekst en revisie (S13). */
export function maakSessieLokaal(state: ScribeLocalState, invoer: NieuweSessieInvoer): ScribeSessie {
  const tijdstip = nu();
  const retentie = berekenRetentie("actief", state.instellingen, new Date(tijdstip));
  const sessie: ScribeSessie = {
    id: lokaalId("lokaal"),
    status: "actief",
    patientReferentie: invoer.patientReferentie.trim(),
    consultType: invoer.consultType,
    taal: invoer.taal,
    consentBevestigdOp: tijdstip,
    consentRevisie: state.revision,
    consentTekst: invoer.consentTekst ?? state.instellingen.consenttekst,
    gestartOp: tijdstip,
    beeindigdOp: null,
    goedgekeurdOp: null,
    overgenomenOp: null,
    duurMs: 0,
    segmentTeller: 0,
    ontbrekendeFragmenten: 0,
    transcriptieProvider: "demo",
    transcriptieModel: null,
    notitieModel: null,
    transcriptVerwijderNa: retentie.transcriptVerwijderNa,
    sessieVerwijderNa: retentie.sessieVerwijderNa,
    createdAt: tijdstip,
    updatedAt: tijdstip,
    eigen: true,
    vrijgegeven: false,
  };
  state.sessies.unshift(sessie);
  state.segmenten[sessie.id] = [];
  state.staat[sessie.id] = staatEnvelop(legeKlinischeStaat(), 0, tijdstip);
  state.scriptPositie[sessie.id] = 0;
  logLokaal(state, "scribe.sessie.start", sessie.id, { consultType: sessie.consultType, taal: sessie.taal });
  return sessie;
}

/** Verwijdert een consult met alles eraan — cascade, net als de DB. */
export function verwijderSessieLokaal(
  state: ScribeLocalState,
  sessieId: string,
  grond?: GeannuleerdGrond,
): { segmenten: number; notities: number } {
  const aantallen = {
    segmenten: segmentenVan(state, sessieId).length,
    notities: (state.notities[sessieId] ?? []).length,
  };
  state.sessies = state.sessies.filter((sessie) => sessie.id !== sessieId);
  for (const notitie of state.notities[sessieId] ?? []) delete state.notitieBronnen?.[notitie.id];
  delete state.transcriptRevisies?.[sessieId];
  delete state.fragmenten?.[sessieId];
  delete state.segmenten[sessieId];
  delete state.staat[sessieId];
  delete state.notities[sessieId];
  delete state.taken[sessieId];
  delete state.scriptPositie[sessieId];
  state.vrijgaven = state.vrijgaven.filter((rij) => rij.sessieId !== sessieId);
  logLokaal(state, "scribe.sessie.verwijderd", sessieId, {
    segmenten: aantallen.segmenten,
    notities: aantallen.notities,
    grond: grond ?? null,
  });
  return aantallen;
}

/** Toegestane overgangen — spiegel van careon_scribe_status_zetten (§3). */
const OVERGANGEN: Record<SessieStatus, SessieStatus[]> = {
  actief: ["afgerond", "geannuleerd"],
  afgerond: ["goedgekeurd", "geannuleerd"],
  goedgekeurd: ["overgenomen", "geannuleerd"],
  overgenomen: [],
  geannuleerd: [],
};

export interface StatusUitkomst {
  ok: boolean;
  fout?: string;
  status?: number;
  sessie?: ScribeSessie;
}

/**
 * Statusovergang in het demo-pad, inclusief de synchrone wissingen van S15:
 * annuleren wist transcript en staat direct, overname wist het transcript
 * wanneer de instelling dat voorschrijft en wist het verslag direct bij een
 * notitieretentie van nul dagen. `grond` is verplicht bij annuleren (N11) en
 * gaat metadata-only mee in het lokale logboek.
 */
export function zetStatusLokaal(
  state: ScribeLocalState,
  sessieId: string,
  status: SessieStatus,
  grond?: GeannuleerdGrond,
): StatusUitkomst {
  const sessie = vindSessie(state, sessieId);
  if (!sessie) return { ok: false, fout: "Dit consult bestaat niet (meer).", status: 404 };
  if (!OVERGANGEN[sessie.status].includes(status)) {
    return { ok: false, fout: `Een consult kan vanuit "${sessie.status}" niet naar "${status}".`, status: 409 };
  }
  if (status === "geannuleerd" && !grond) {
    return { ok: false, fout: "Kies een grond voordat u de werkkopie wist.", status: 400 };
  }
  if (status === "goedgekeurd") {
    const notitie = laatsteNotitie(state, sessieId);
    if (notitie?.status !== "goedgekeurd") {
      return { ok: false, fout: "Keur eerst elke sectie van het verslag goed.", status: 409 };
    }
  }
  const tijdstip = nu();
  const retentie = berekenRetentie(status, state.instellingen, new Date(tijdstip));
  const patch: Partial<ScribeSessie> = {
    status,
    transcriptVerwijderNa: retentie.transcriptVerwijderNa,
    sessieVerwijderNa: retentie.sessieVerwijderNa,
  };
  if (status === "afgerond") patch.beeindigdOp = tijdstip;
  if (status === "goedgekeurd") patch.goedgekeurdOp = tijdstip;
  if (status === "overgenomen") patch.overgenomenOp = tijdstip;

  if (status === "geannuleerd" || (status === "overgenomen" && state.instellingen.transcriptWissenBijOvername)) {
    state.segmenten[sessieId] = [];
    delete state.staat[sessieId];
    delete state.fragmenten?.[sessieId];
  }
  if (status === "geannuleerd") {
    for (const notitie of state.notities[sessieId] ?? []) delete state.notitieBronnen?.[notitie.id];
    delete state.transcriptRevisies?.[sessieId];
    delete state.notities[sessieId];
    delete state.taken[sessieId];
  }
  if (status === "overgenomen" && state.instellingen.notitieRetentieDagen === 0) {
    for (const notitie of state.notities[sessieId] ?? []) delete state.notitieBronnen?.[notitie.id];
    delete state.notities[sessieId];
    delete state.taken[sessieId];
  }
  const bijgewerkt = werkSessieBij(state, sessieId, patch);
  if (!bijgewerkt) return { ok: false, fout: "Dit consult bestaat niet (meer).", status: 404 };
  if (status === "geannuleerd") logLokaal(state, "scribe.sessie.verwijderd", sessieId, { grond: grond ?? null });
  return { ok: true, sessie: bijgewerkt };
}

// ── Vrijgave ────────────────────────────────────────────────────────────────

/** Markeert de lijstvlag `vrijgegeven` naar de werkelijke stand van de vrijgaven. */
export function werkVrijgaveVlagBij(state: ScribeLocalState, sessieId: string): void {
  werkSessieBij(state, sessieId, {
    vrijgegeven: state.vrijgaven.some((rij) => rij.sessieId === sessieId),
  });
}

/** Vrijgave intrekken (N11). Zonder `aanUserId` vervallen álle vrijgaven. */
export function trekVrijgaveInLokaal(
  state: ScribeLocalState,
  sessieId: string,
  aanUserId?: string,
  grond?: GeannuleerdGrond,
): number {
  const voor = state.vrijgaven.length;
  state.vrijgaven = state.vrijgaven.filter(
    (rij) => rij.sessieId !== sessieId || (aanUserId !== undefined && rij.aanUserId !== aanUserId),
  );
  const aantal = voor - state.vrijgaven.length;
  werkVrijgaveVlagBij(state, sessieId);
  if (aantal > 0) {
    logLokaal(state, "scribe.sessie.vrijgave.ingetrokken", sessieId, { aantal, grond: grond ?? null });
  }
  return aantal;
}

// ── Segmenten ───────────────────────────────────────────────────────────────

function voegSegmentenToe(
  state: ScribeLocalState,
  sessie: ScribeSessie,
  regels: { spreker: Spreker; tekst: string }[],
  bron: SegmentBron,
  duurPerRegelMs: number,
): ScribeSegment[] {
  const bestaand = segmentenVan(state, sessie.id);
  const nieuw: ScribeSegment[] = [];
  let teller = sessie.segmentTeller;
  let tijdlijnMs = Math.max(sessie.duurMs, ...bestaand.map((segment) => segment.eindMs ?? 0));
  for (const regel of regels) {
    if (teller >= SCRIBE_LIMITS.segmentenPerSessie) break;
    teller += 1;
    const beginMs = tijdlijnMs;
    tijdlijnMs += duurPerRegelMs;
    nieuw.push({
      id: `${sessie.id}-seg-${teller}`,
      volgnummer: teller,
      spreker: regel.spreker,
      tekst: regel.tekst.slice(0, SCRIBE_LIMITS.segmentTekst),
      tekstGecorrigeerd: null,
      correctieBron: null,
      beginMs,
      eindMs: beginMs + Math.max(1, duurPerRegelMs - 400),
      bron,
      createdAt: nu(),
    });
  }
  state.segmenten[sessie.id] = [...bestaand, ...nieuw];
  state.transcriptRevisies ??= {};
  state.transcriptRevisies[sessie.id] = (state.transcriptRevisies[sessie.id] ?? 0) + 1;
  werkSessieBij(state, sessie.id, {
    segmentTeller: teller,
    duurMs: tijdlijnMs,
    ontbrekendeFragmenten: sessie.ontbrekendeFragmenten + (bron === "systeem" ? nieuw.length : 0),
  });
  return nieuw;
}

/** Handmatige invoerregel of gatsegment (§5.3 POST /segmenten). */
export function voegHandmatigSegmentToe(
  state: ScribeLocalState,
  sessieId: string,
  tekst: string,
  spreker: Spreker,
  bron: Extract<SegmentBron, "handmatig" | "systeem"> = "handmatig",
  duurMs = DEMO_FRAGMENT_MS,
  fragmentId?: string,
): ScribeSegment[] {
  const sessie = vindSessie(state, sessieId);
  if (!sessie) return [];
  const bestaandeIds = fragmentId ? state.fragmenten?.[sessieId]?.[fragmentId] : undefined;
  if (bestaandeIds) return segmentenVan(state, sessieId).filter((rij) => bestaandeIds.includes(rij.id));
  if (!["actief", "gepauzeerd"].includes(sessie.status)) return [];
  const segmenten = voegSegmentenToe(state, sessie, [{ spreker, tekst }], bron, duurMs);
  if (fragmentId && segmenten.length > 0) {
    state.fragmenten ??= {};
    state.fragmenten[sessieId] ??= {};
    state.fragmenten[sessieId][fragmentId] = segmenten.map((rij) => rij.id);
  }
  return segmenten;
}

/** Volgende regel(s) van DEMO_CONSULT_SCRIPT — de motor achter "Demo-opname". */
export function speelDemoScript(state: ScribeLocalState, sessieId: string, aantal: number): ScribeSegment[] {
  const sessie = vindSessie(state, sessieId);
  if (sessie?.status !== "actief") return [];
  const positie = state.scriptPositie[sessieId] ?? 0;
  const regels = DEMO_CONSULT_SCRIPT.slice(positie, positie + Math.max(1, aantal));
  if (regels.length === 0) return [];
  state.scriptPositie[sessieId] = positie + regels.length;
  return voegSegmentenToe(
    state,
    sessie,
    regels.map((regel) => ({ spreker: regel.spreker, tekst: regel.tekst })),
    "demo",
    DEMO_FRAGMENT_MS,
  );
}

/** Resteert er nog script? Voedt de knoppen "Demo-opname"/"Volledig afspelen". */
export function demoScriptRest(state: ScribeLocalState, sessieId: string): number {
  return Math.max(0, DEMO_CONSULT_SCRIPT.length - (state.scriptPositie[sessieId] ?? 0));
}

export interface SegmentPatchUitkomst {
  ok: boolean;
  fout?: string;
  status?: number;
  segment?: ScribeSegment;
  verouderd?: boolean;
  laatsteSegment?: number;
}

/**
 * Sprekercorrectie of tekstcorrectie door de behandelaar (S8/S9). Raakt de
 * correctie een al geanalyseerd segment, dan wordt de staat als verouderd
 * gemarkeerd en schuift `laatsteSegment` terug — precies zoals de route doet.
 */
export function wijzigSegmentLokaal(
  state: ScribeLocalState,
  sessieId: string,
  volgnummer: number,
  patch: { spreker?: Spreker; tekstGecorrigeerd?: string | null },
): SegmentPatchUitkomst {
  const segmenten = segmentenVan(state, sessieId);
  const index = segmenten.findIndex((segment) => segment.volgnummer === volgnummer);
  if (index < 0) return { ok: false, fout: "Deze transcriptregel bestaat niet (meer).", status: 404 };
  const huidig = segmenten[index];
  const bijgewerkt: ScribeSegment = { ...huidig };
  if (patch.spreker) {
    bijgewerkt.spreker = patch.spreker;
    bijgewerkt.sprekerBron = "behandelaar";
  }
  if (patch.tekstGecorrigeerd !== undefined) {
    if (patch.tekstGecorrigeerd === null) {
      bijgewerkt.tekstGecorrigeerd = null;
      bijgewerkt.correctieBron = null;
    } else {
      bijgewerkt.tekstGecorrigeerd = patch.tekstGecorrigeerd.slice(0, SCRIBE_LIMITS.segmentTekst);
      bijgewerkt.correctieBron = "behandelaar";
    }
  }
  segmenten[index] = bijgewerkt;
  state.segmenten[sessieId] = [...segmenten];
  state.transcriptRevisies ??= {};
  state.transcriptRevisies[sessieId] = (state.transcriptRevisies[sessieId] ?? 0) + 1;
  // Proposals depend on the old source. Preserve decisions already made by the clinician.
  state.taken[sessieId] = takenVan(state, sessieId).filter((taak) => taak.status !== "voorgesteld");

  const envelop = state.staat[sessieId];
  let verouderd = false;
  let laatsteSegment = envelop?.laatsteSegment ?? 0;
  if (envelop && volgnummer <= envelop.laatsteSegment) {
    verouderd = true;
    laatsteSegment = 0;
    const { gesprekscontext: _verouderdeContext, ...staatZonderContext } = envelop.staat;
    state.staat[sessieId] = {
      ...envelop,
      staat: staatZonderContext,
      verouderd,
      laatsteSegment,
      epdLijstBeoordeeld: false,
      updatedAt: nu(),
    };
  }
  return { ok: true, segment: bijgewerkt, verouderd, laatsteSegment };
}

// ── Analyse ─────────────────────────────────────────────────────────────────

export interface AnalyseUitkomst {
  envelop: StaatEnvelop;
  taken: ScribeTaak[];
  /** Segmenten die deze ronde een spreker of ASR-correctie kregen (C21/S8/S9). */
  segmenten: ScribeSegment[];
}

/**
 * Deterministische analyse over het volledige transcript (C21): exact dezelfde
 * `deterministischeRonde` als de serverterugval, inclusief sprekerheuristiek en
 * ASR-woordenlijst. De uitkomsten worden met dezelfde twee guards als de route
 * teruggeschreven: een spreker alleen op een nog `onbekend` segment, een
 * correctie nooit over een behandelaarscorrectie heen (S9).
 */
export function analyseerLokaal(state: ScribeLocalState, sessieId: string): AnalyseUitkomst | null {
  const sessie = vindSessie(state, sessieId);
  if (!sessie) return null;
  const segmenten = segmentenVan(state, sessieId);
  const laatste = state.staat[sessieId]?.laatsteSegment ?? 0;
  const nieuweSegmenten = segmenten
    .filter((segment) => segment.volgnummer > laatste)
    .slice(0, SCRIBE_LIMITS.analyseSegmenten);
  const eerdere = state.staat[sessieId];
  const heranalyse = eerdere?.verouderd === true && laatste === 0;
  const vorige = heranalyse ? heranalyseStartStaat(eerdere.staat) : (eerdere?.staat ?? legeKlinischeStaat());
  const verwerktTot = nieuweSegmenten.at(-1)?.volgnummer ?? laatste;
  const verwerkteContext = segmenten.filter((segment) => segment.volgnummer <= verwerktTot);
  const ronde = deterministischeRonde(verwerkteContext, nieuweSegmenten, sessie.consultType, vorige, sessie.taal);

  const sprekerPer = new Map(ronde.sprekers.map((rij) => [rij.volgnummer, rij.spreker]));
  const correctiePer = new Map(ronde.correcties.map((rij) => [rij.volgnummer, rij.tekstGecorrigeerd]));
  const aangeraakt: ScribeSegment[] = [];
  const bijgewerkteSegmenten = segmenten.map((rij) => {
    // Spiegelt het routefilter `spreker=eq.onbekend`.
    const spreker =
      rij.spreker === "onbekend" && rij.sprekerBron !== "behandelaar" ? sprekerPer.get(rij.volgnummer) : undefined;
    // Spiegelt S9: nooit over een behandelaarscorrectie heen.
    const correctie = rij.correctieBron === "behandelaar" ? undefined : correctiePer.get(rij.volgnummer);
    if (spreker === undefined && correctie === undefined) return rij;
    const nieuw: ScribeSegment = {
      ...rij,
      spreker: spreker ?? rij.spreker,
      sprekerBron: spreker !== undefined ? "ai" : (rij.sprekerBron ?? null),
      tekstGecorrigeerd: correctie ?? rij.tekstGecorrigeerd,
      correctieBron: correctie !== undefined ? "ai" : rij.correctieBron,
    };
    aangeraakt.push(nieuw);
    return nieuw;
  });
  if (aangeraakt.length > 0) state.segmenten[sessieId] = bijgewerkteSegmenten;

  const envelop: StaatEnvelop = {
    staat: ronde.staat,
    versie: (state.staat[sessieId]?.versie ?? 0) + 1,
    epdLijstBeoordeeld: nieuweSegmenten.length === 0 && state.staat[sessieId]?.epdLijstBeoordeeld === true,
    laatsteSegment: verwerktTot,
    verouderd: false,
    bron: "demo",
    model: null,
    updatedAt: nu(),
  };
  state.staat[sessieId] = envelop;

  const bestaande = takenVan(state, sessieId);
  const taken = [...bestaande];
  for (const actie of extraheerTaken(ronde.staat)) {
    const sleutel = actie.omschrijving.trim().toLowerCase();
    if (taken.some((taak) => taak.omschrijving.trim().toLowerCase() === sleutel && taak.soort === actie.soort)) {
      continue;
    }
    taken.push({
      id: lokaalId("taak"),
      sessieId,
      omschrijving: actie.omschrijving,
      soort: actie.soort,
      status: "voorgesteld",
      bronSegmenten: [...actie.bron],
      createdAt: nu(),
      updatedAt: nu(),
    });
  }
  state.taken[sessieId] = taken;
  return { envelop, taken, segmenten: aangeraakt };
}

// ── Klinische staat corrigeren (N6/S7) ──────────────────────────────────────

export interface StaatPatchUitkomst {
  ok: boolean;
  fout?: string;
  status?: number;
  envelop?: StaatEnvelop;
}

function gelijkeTekst(links: string, rechts: string): boolean {
  return links.trim().toLowerCase() === rechts.trim().toLowerCase();
}

function nieuwFeit(tekst: string): Feit {
  return { tekst: tekst.trim(), bron: [], ingetrokken: false, doorBehandelaar: true };
}

/**
 * Eén behandelaarsmutatie op de klinische staat — spiegel van PATCH
 * …/staat. `doorBehandelaar: true` is het merk dat `mergeKlinischeStaat`
 * nooit meer terugdraait (S7): een latere analysepas laat de rij staan zoals
 * de behandelaar haar achterliet.
 */
export function pasStaatMutatieToe(
  staat: KlinischeStaat,
  categorie: StaatCategorie,
  patch: StaatFeitPatchBody["feit"],
  actie: "toevoegen" | "intrekken",
): KlinischeStaat {
  const volgend: KlinischeStaat = { ...staat };
  const sleutel = categorie === "medicatie" ? (patch.naam ?? patch.tekst) : patch.tekst;

  if (categorie === "medicatie") {
    const rijen = staat.medicatie.map((rij) => ({ ...rij }));
    const index = rijen.findIndex((rij) => gelijkeTekst(rij.naam, sleutel));
    if (actie === "intrekken") {
      if (index >= 0) rijen[index] = { ...rijen[index], ingetrokken: true, doorBehandelaar: true };
    } else {
      const rij: Medicatie = {
        ...nieuwFeit(patch.naam ?? patch.tekst),
        naam: (patch.naam ?? patch.tekst).trim(),
        dosering: patch.dosering ?? null,
        doseringen: patch.dosering ? [{ waarde: patch.dosering, bron: [] }] : [],
        gebruik: patch.gebruik ?? "huidig",
      };
      if (index >= 0) rijen[index] = { ...rij, bron: rijen[index].bron };
      else rijen.push(rij);
    }
    volgend.medicatie = rijen;
    return rondStaatAf(volgend);
  }

  if (categorie === "allergieen") {
    const rijen = staat.allergieen.map((rij) => ({ ...rij }));
    const index = rijen.findIndex((rij) => gelijkeTekst(rij.tekst, sleutel));
    if (actie === "intrekken") {
      if (index >= 0) rijen[index] = { ...rijen[index], ingetrokken: true, doorBehandelaar: true };
    } else {
      const rij: Allergiefeit = { ...nieuwFeit(patch.tekst), aard: patch.aard ?? "allergie" };
      if (index >= 0) rijen[index] = { ...rij, bron: rijen[index].bron };
      else rijen.push(rij);
    }
    volgend.allergieen = rijen;
    return rondStaatAf(volgend);
  }

  if (categorie === "acties") {
    const rijen = staat.acties.map((rij) => ({ ...rij }));
    const index = rijen.findIndex((rij) => gelijkeTekst(rij.omschrijving, patch.omschrijving ?? patch.tekst));
    if (actie === "intrekken") {
      if (index >= 0) rijen[index] = { ...rijen[index], ingetrokken: true, doorBehandelaar: true };
    } else {
      const rij: Actie = {
        ...nieuwFeit(patch.omschrijving ?? patch.tekst),
        omschrijving: (patch.omschrijving ?? patch.tekst).trim(),
        soort: patch.soort ?? "overig",
      };
      if (index >= 0) rijen[index] = { ...rij, bron: rijen[index].bron };
      else rijen.push(rij);
    }
    volgend.acties = rijen;
    return rondStaatAf(volgend);
  }

  if (categorie === "leefstijl" || categorie === "psychisch") {
    const rijen = staat[categorie].map((rij) => ({ ...rij }));
    const index = rijen.findIndex((rij) => gelijkeTekst(rij.tekst, patch.tekst));
    if (actie === "intrekken") {
      if (index >= 0) rijen[index] = { ...rijen[index], ingetrokken: true, doorBehandelaar: true };
    } else {
      const rij: Categoriefeit = { ...nieuwFeit(patch.tekst), categorie: patch.categorie ?? "overig" };
      if (index >= 0) rijen[index] = { ...rij, bron: rijen[index].bron };
      else rijen.push(rij);
    }
    volgend[categorie] = rijen;
    return rondStaatAf(volgend);
  }

  const rijen = (staat[categorie] as unknown as Feit[]).map((rij) => ({ ...rij }));
  const index = rijen.findIndex((rij) => gelijkeTekst(rij.tekst, patch.tekst));
  if (actie === "intrekken") {
    if (index >= 0) rijen[index] = { ...rijen[index], ingetrokken: true, doorBehandelaar: true };
  } else if (index >= 0) {
    rijen[index] = { ...rijen[index], tekst: patch.tekst.trim(), ingetrokken: false, doorBehandelaar: true };
  } else {
    rijen.push(nieuwFeit(patch.tekst));
  }
  (volgend as unknown as Record<string, Feit[]>)[categorie] = rijen;
  return rondStaatAf(volgend);
}

export function wijzigStaatLokaal(state: ScribeLocalState, sessieId: string, body: StaatPatchBody): StaatPatchUitkomst {
  const envelop = state.staat[sessieId];
  if (!envelop) return { ok: false, fout: "Er is nog geen consultstaat om te corrigeren.", status: 404 };
  if (body.versie !== envelop.versie) {
    return {
      ok: false,
      fout: "De consultstaat is intussen bijgewerkt. Bekijk de nieuwe stand en probeer opnieuw.",
      status: 409,
    };
  }
  const beoordeling = "epdLijstBeoordeeld" in body;
  const staat = beoordeling ? envelop.staat : pasStaatMutatieToe(envelop.staat, body.categorie, body.feit, body.actie);
  const beoordeeld =
    beoordeling || (!["medicatie", "allergieen"].includes(body.categorie) && envelop.epdLijstBeoordeeld);
  const bijgewerkt: StaatEnvelop = {
    ...envelop,
    staat,
    versie: envelop.versie + 1,
    updatedAt: nu(),
    epdLijstBeoordeeld: beoordeeld,
  };
  state.staat[sessieId] = bijgewerkt;
  return { ok: true, envelop: bijgewerkt };
}

// ── Notitie ─────────────────────────────────────────────────────────────────

/** Nieuwe conceptversie van het verslag uit de huidige staat (§4.5). */
export function genereerNotitieLokaal(
  state: ScribeLocalState,
  sessieId: string,
  formaat?: ConsultType,
): ScribeNotitie | null {
  const sessie = vindSessie(state, sessieId);
  if (!sessie) return null;
  const consultType = formaat ?? sessie.consultType;
  const staat = state.staat[sessieId]?.staat ?? legeKlinischeStaat();
  const secties = bouwVerslagDeterministisch(staat, segmentenVan(state, sessieId), consultType, sessie.taal);
  const versies = state.notities[sessieId] ?? [];
  const notitie: ScribeNotitie = {
    id: lokaalId("notitie"),
    sessieId,
    versie: versies.length + 1,
    bewerkRevisie: 1,
    formaat: consultType,
    secties,
    status: "concept",
    model: null,
    bron: "demo",
    goedgekeurdOp: null,
    createdAt: nu(),
    updatedAt: nu(),
  };
  state.notities[sessieId] = [...versies, notitie];
  state.notitieBronnen ??= {};
  state.notitieBronnen[notitie.id] = {
    staatVersie: state.staat[sessieId]?.versie ?? 0,
    transcriptRevisie: state.transcriptRevisies?.[sessieId] ?? 0,
  };
  return notitie;
}

export interface NotitiePatchUitkomst {
  ok: boolean;
  fout?: string;
  status?: number;
  notitie?: ScribeNotitie;
  overgeslagen?: string[];
  goedgekeurd?: boolean;
}

/**
 * Sectiebewerking, "Alles goedkeuren" en de eindgoedkeuring in één functie —
 * spiegel van PATCH …/notitie/[notitieId]. ★-secties (`vereistBehandelaar`)
 * blijven bewust buiten "Alles goedkeuren" en moeten een niet-lege, door de
 * behandelaar geschreven tekst dragen (S10).
 */
export function wijzigNotitieLokaal(
  state: ScribeLocalState,
  sessieId: string,
  notitieId: string,
  patch: {
    bewerkRevisie: number;
    secties?: { id: string; tekst?: string; status?: VerslagSectie["status"] }[];
    alleGoedkeuren?: true;
    ontbrekendeFragmentenBeoordeeld?: boolean;
  },
): NotitiePatchUitkomst {
  const versies = state.notities[sessieId] ?? [];
  const index = versies.findIndex((notitie) => notitie.id === notitieId);
  if (index < 0) return { ok: false, fout: "Deze verslagversie bestaat niet (meer).", status: 404 };
  const huidig = versies[index];
  if (patch.bewerkRevisie !== huidig.bewerkRevisie)
    return { ok: false, fout: "Het verslag is intussen gewijzigd. Laad het opnieuw.", status: 409 };
  if (huidig.status === "goedgekeurd") {
    return { ok: false, fout: "Dit verslag is goedgekeurd. Maak een nieuwe versie.", status: 409 };
  }
  const goedkeuring = patch.alleGoedkeuren ?? patch.secties?.some((sectie) => sectie.status === "goedgekeurd");
  const bron = state.notitieBronnen?.[notitieId];
  const envelop = state.staat[sessieId];
  if (
    goedkeuring &&
    (!bron ||
      bron.staatVersie !== (envelop?.versie ?? 0) ||
      bron.transcriptRevisie !== (state.transcriptRevisies?.[sessieId] ?? 0) ||
      envelop?.verouderd ||
      (envelop?.laatsteSegment ?? 0) < (vindSessie(state, sessieId)?.segmentTeller ?? 0))
  ) {
    return {
      ok: false,
      fout: "De brongegevens zijn gewijzigd. Analyseer het transcript en genereer een nieuw verslag voordat u goedkeurt.",
      status: 409,
    };
  }

  const overgeslagen: string[] = [];
  let secties = huidig.secties.map((sectie) => ({ ...sectie }));
  if (patch.alleGoedkeuren) {
    secties = secties.map((sectie) => {
      if (sectie.vereistBehandelaar) {
        if (sectie.status !== "goedgekeurd") overgeslagen.push(sectie.id);
        return sectie;
      }
      const tekst = sectie.tekst.trim().length > 0 ? sectie.tekst : sectie.conceptTekst;
      return tekst.trim().length > 0 ? { ...sectie, tekst, status: "goedgekeurd" as const } : sectie;
    });
  }
  for (const wijziging of patch.secties ?? []) {
    const positie = secties.findIndex((sectie) => sectie.id === wijziging.id);
    if (positie < 0) continue;
    const sectie = { ...secties[positie] };
    if (wijziging.tekst !== undefined) {
      sectie.tekst = wijziging.tekst.slice(0, SCRIBE_LIMITS.sectieTekst);
      sectie.status = sectie.tekst.trim().length > 0 ? "bewerkt" : "leeg";
    }
    if (wijziging.status) {
      if (
        wijziging.status === "goedgekeurd" &&
        !isBeoordelingsSectie(huidig.formaat, sectie.id) &&
        onbewerkteGesprekscontext(sectie)
      ) {
        return {
          ok: false,
          fout: "Werk deze broncitaten uit tot een gecontroleerde notitie voordat u goedkeurt.",
          status: 400,
        };
      }
      if (wijziging.status === "goedgekeurd" && sectie.tekst.trim().length === 0) {
        return {
          ok: false,
          fout: "Een beoordelingssectie moet u eerst zelf invullen; die wordt niet machinaal geschreven.",
          status: 400,
        };
      }
      sectie.status = wijziging.status;
    }
    secties[positie] = sectie;
  }

  const allesGoed = secties.every((sectie) => sectie.status === "goedgekeurd");
  const beoordelingLeeg = secties.some((sectie) => sectie.vereistBehandelaar && sectie.tekst.trim().length === 0);
  const goedgekeurd = allesGoed && !beoordelingLeeg;
  if (
    goedgekeurd &&
    (vindSessie(state, sessieId)?.ontbrekendeFragmenten ?? 0) > 0 &&
    !patch.ontbrekendeFragmentenBeoordeeld
  )
    return { ok: false, fout: "Beoordeel eerst de ontbrekende fragmenten.", status: 409 };
  const bijgewerkt: ScribeNotitie = {
    ...huidig,
    bewerkRevisie: huidig.bewerkRevisie + 1,
    secties,
    status: goedgekeurd ? "goedgekeurd" : "concept",
    goedgekeurdOp: goedgekeurd ? nu() : null,
    updatedAt: nu(),
  };
  versies[index] = bijgewerkt;
  state.notities[sessieId] = [...versies];
  if (goedgekeurd) {
    zetStatusLokaal(state, sessieId, "goedgekeurd");
    logLokaal(state, "scribe.notitie.goedgekeurd", sessieId, {
      secties: secties.length,
      versie: bijgewerkt.versie,
      ontbrekendeFragmenten: vindSessie(state, sessieId)?.ontbrekendeFragmenten ?? 0,
      ontbrekendeFragmentenBeoordeeld: patch.ontbrekendeFragmentenBeoordeeld === true,
    });
  }
  return { ok: true, notitie: bijgewerkt, overgeslagen, goedgekeurd };
}

export function wijzigTaakLokaal(
  state: ScribeLocalState,
  sessieId: string,
  taakId: string,
  status: ScribeTaak["status"],
): ScribeTaak | null {
  const taken = takenVan(state, sessieId);
  const index = taken.findIndex((taak) => taak.id === taakId);
  if (index < 0) return null;
  const bijgewerkt: ScribeTaak = { ...taken[index], status, updatedAt: nu() };
  taken[index] = bijgewerkt;
  state.taken[sessieId] = [...taken];
  return bijgewerkt;
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Verslagtekst voor het EPD (§5.3 export) — het demo-pad gebruikt exact dezelfde
 * pure opbouw als de centrale exportroute (`export-tekst.ts`), zodat kop, secties
 * en vervolgacties in beide paden letterlijk gelijk zijn.
 */
export function bouwExportTekst(
  sessie: ScribeSessie,
  notitie: ScribeNotitie,
  taken: ScribeTaak[],
  formaat: ScribeExportFormaat = "txt",
  opties: ExportTekstOpties = {},
): string {
  return bouwExportTekstGedeeld({ sessie, notitie, taken, formaat, ...opties });
}

/** Deterministische extractie van medicatie en allergieën uit geplakte EPD-tekst (N6). */
export function extraheerEpdLijst(
  tekst: string,
  consultType: ConsultType,
): { medicatie: Medicatie[]; allergieen: Allergiefeit[] } {
  const regels = tekst
    .split(/\r?\n|;/)
    .map((regel) => regel.trim())
    .filter((regel) => regel.length > 0)
    .slice(0, SCRIBE_LIMITS.staatArray);
  const pseudo: ScribeSegment[] = regels.map((regel, index) => ({
    id: `epd-${index + 1}`,
    volgnummer: index + 1,
    spreker: "patient",
    tekst: regel.slice(0, SCRIBE_LIMITS.segmentTekst),
    tekstGecorrigeerd: null,
    correctieBron: null,
    beginMs: null,
    eindMs: null,
    bron: "handmatig",
    createdAt: nu(),
  }));
  const staat = extraheerDeterministisch(pseudo, consultType);
  return { medicatie: staat.medicatie, allergieen: staat.allergieen };
}
