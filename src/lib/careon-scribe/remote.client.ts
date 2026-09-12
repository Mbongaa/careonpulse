"use client";

import {
  type AnalyseResponse,
  type AudioUploadResponse,
  type GemachtigdenOpslaanResponse,
  type GemachtigdenResponse,
  type InstellingenOpslaanResponse,
  type InstellingenResponse,
  type LogboekQuery,
  type LogboekResponse,
  type NotitiePatchBody,
  type NotitieResponse,
  SCRIBE_FRAGMENT_DUUR_HEADER,
  SCRIBE_FRAGMENT_ID_HEADER,
  SCRIBE_FRAGMENT_OFFSET_HEADER,
  SCRIBE_FRAGMENT_OVERLAP_HEADER,
  SCRIBE_LOGBOEK_PAGINA_GROOTTE,
  SCRIBE_PAGINA_GROOTTE,
  type ScribeExportFormaat,
  type ScribeProviderStatus,
  type SegmentPatchBody,
  type SegmentResponse,
  type SessieAanmakenBody,
  type SessieDetailBody,
  type SessieDetailResponse,
  type SessieLijstFilter,
  type SessieLijstRij,
  type SessiePatchBody,
  type SessiePatchResponse,
  type SessiesLijstQuery,
  type SessiesLijstResponse,
  type SessieVerwijderBody,
  type SessieVerwijderResponse,
  type SprekerToewijzing,
  type StaatEnvelop,
  type StaatPatchBody,
  type StaatPatchResponse,
  type TaakPatchResponse,
  type TranscriptCorrectie,
  type VrijgaveIntrekkenResponse,
  type VrijgaveResponse,
} from "./api-contract";
import { clearScribeDraft, scribeDraftGeneration, scribeIdentityCurrent } from "./drafts.client";
import { type ExportTekstOpties, exportBestandsnaam } from "./export-tekst";
import { dagenTot, verlooptBinnenkort } from "./retentie";
import {
  analyseerLokaal,
  bouwExportTekst,
  clearScribeState,
  demoScribeState,
  demoScriptRest,
  genereerNotitieLokaal,
  laatsteNotitie,
  loadScribeState,
  logLokaal,
  maakSessieLokaal,
  type ScribeLocalState,
  saveScribeState,
  segmentenVan,
  speelDemoScript,
  takenVan,
  trekVrijgaveInLokaal,
  verwijderSessieLokaal,
  vindSessie,
  voegHandmatigSegmentToe,
  werkVrijgaveVlagBij,
  wijzigNotitieLokaal,
  wijzigSegmentLokaal,
  wijzigStaatLokaal,
  wijzigTaakLokaal,
  zetStatusLokaal,
} from "./storage.client";
import {
  type ConsultType,
  type GeannuleerdGrond,
  isIsoDatum,
  isScribeZoekterm,
  type ScribeGemachtigde,
  type ScribeInstellingen,
  type ScribeNotitie,
  type ScribeSegment,
  type ScribeSessie,
  type ScribeTaak,
  type ScribeTaal,
  type SegmentBron,
  type Spreker,
  type TaakStatus,
} from "./types";

// Client-datatoegang met demo-terugval (handoff 20 §7.7, B12): elke functie
// probeert eerst de route onder /api/careon/scribe/**; antwoordt die 501
// (expliciete demo-modus), dan draait dezelfde handeling op de localStorage-
// store van storage.client.ts. Elk resultaat draagt zijn bron, zodat de UI
// eerlijk "Lokale demo-opslag" kan tonen.
//
// Eén handeling ontbreekt bewust in het demo-pad: de audio-upload. Careon
// bewaart geen audio (S5) en in demo is er geen transcriptieprovider — de
// demo speelt in plaats daarvan het gescripte consult af (speelDemoOpname /
// speelDemoAlles). Zo blijft het demo-pad volledig zonder microfoon.
//
// Paginering is overal 1-GEBASEERD (C31): pagina 1 is de eerste
// SCRIBE_PAGINA_GROOTTE rijen. De route rekent zo, de UI-state rekent zo en de
// demo-slice rekent zo — anders levert "Volgende" tweemaal dezelfde pagina.

export type ScribeBron = "centraal" | "lokaal";

export interface ScribeFout {
  fout: string;
  status: number;
  code?: string;
  /** 409 op /instellingen: de centrale revisie die intussen geldt. */
  revision?: number;
  /** 429: seconden tot de volgende poging. */
  retryAfter?: number;
}

export type ScribeResultaat<T> = ({ ok: true; bron: ScribeBron } & T) | ({ ok: false } & ScribeFout);

const NIET_BEREIKBAAR = "Careon is niet bereikbaar. Probeer het opnieuw.";

async function api<T>(pad: string, init?: RequestInit): Promise<{ status: number; data: T | null; headers: Headers }> {
  const sessionId = /^sessies\/([^/]+)/.exec(pad)?.[1] ?? "";
  const lifecycle = scribeDraftGeneration(sessionId);
  if (!scribeIdentityCurrent()) return { status: 409, data: null, headers: new Headers() };
  try {
    const response = await fetch(`/api/careon/scribe/${pad}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
      signal: init?.signal ?? AbortSignal.timeout(60_000),
    });
    const data = (await response.json().catch(() => null)) as T | null;
    if (lifecycle !== scribeDraftGeneration(sessionId) || !scribeIdentityCurrent())
      return { status: 409, data: null, headers: response.headers };
    return { status: response.status, data, headers: response.headers };
  } catch {
    return { status: 0, data: null, headers: new Headers() };
  }
}

function foutUit(status: number, data: unknown, standaard: string, headers?: Headers): ScribeFout {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const retry = headers?.get("Retry-After");
  return {
    fout: typeof record.error === "string" ? record.error : standaard,
    status,
    code: typeof record.code === "string" ? record.code : undefined,
    revision: typeof record.revision === "number" ? record.revision : undefined,
    retryAfter: retry ? Number.parseInt(retry, 10) : undefined,
  };
}

function lokaleState(): ScribeLocalState {
  return loadScribeState() ?? demoScribeState();
}

function bewaarLokaal(state: ScribeLocalState): void {
  saveScribeState(state);
}

/**
 * Sessie → lijstrij met de verloopmarkering van §7.2. De markering komt uit
 * dezelfde `verlooptBinnenkort`-helper als de serverserializer (C37); anders
 * toont de demo een badge waar productie er geen laat zien.
 */
function lijstRij(sessie: ScribeSessie): SessieLijstRij {
  return {
    ...sessie,
    verlooptBinnenkort: verlooptBinnenkort(sessie.sessieVerwijderNa, sessie.status),
    verlooptOverDagen: sessie.sessieVerwijderNa ? dagenTot(sessie.sessieVerwijderNa) : null,
  };
}

/** Providerbeeld in demo: alles deterministisch, geen enkele provideraanroep. */
const DEMO_PROVIDER_STATUS: ScribeProviderStatus = {
  live: false,
  transcriptieProvider: null,
  transcriptieModel: null,
  notitieModel: null,
  promptVersie: "demo",
  analyseLive: false,
};

// ── Consulten ───────────────────────────────────────────────────────────────

export type SessiesFilters = Pick<SessiesLijstQuery, "zoek" | "van" | "tot">;

/** Datumdeel van een ISO-tijdstip; `null` wanneer er niets bruikbaars staat. */
function datumVan(iso: string | null): string | null {
  if (!iso) return null;
  const tijdstip = Date.parse(iso);
  return Number.isNaN(tijdstip) ? null : new Date(tijdstip).toISOString().slice(0, 10);
}

function pastBijFilters(sessie: ScribeSessie, filters: SessiesFilters): boolean {
  if (filters.zoek && isScribeZoekterm(filters.zoek)) {
    const term = filters.zoek.trim().toLowerCase();
    if (!sessie.patientReferentie.toLowerCase().includes(term)) return false;
  }
  const datum = datumVan(sessie.gestartOp ?? sessie.createdAt);
  if (filters.van && isIsoDatum(filters.van) && (datum === null || datum < filters.van)) return false;
  if (filters.tot && isIsoDatum(filters.tot) && (datum === null || datum > filters.tot)) return false;
  return true;
}

export async function haalSessies(
  filter: SessieLijstFilter = "alle",
  pagina = 1,
  filters: SessiesFilters = {},
): Promise<ScribeResultaat<Omit<SessiesLijstResponse, "configured">>> {
  const zoekparams = new URLSearchParams();
  if (filter !== "alle") zoekparams.set("status", filter);
  if (pagina > 1) zoekparams.set("pagina", String(pagina));
  if (filters.zoek && isScribeZoekterm(filters.zoek)) zoekparams.set("zoek", filters.zoek.trim());
  if (filters.van && isIsoDatum(filters.van)) zoekparams.set("van", filters.van);
  if (filters.tot && isIsoDatum(filters.tot)) zoekparams.set("tot", filters.tot);
  const { status, data, headers } = await api<SessiesLijstResponse>(`sessies?${zoekparams}`);
  if (status === 200 && data) {
    return {
      ok: true,
      bron: "centraal",
      sessies: data.sessies,
      pagina: data.pagina,
      meer: data.meer,
      ingeschakeld: data.ingeschakeld,
      gemachtigd: data.gemachtigd,
      beheerder: data.beheerder,
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  bewaarLokaal(state);
  const gefilterd = state.sessies.filter(
    (sessie) => (filter === "alle" || sessie.status === filter) && pastBijFilters(sessie, filters),
  );
  const gesorteerd = [...gefilterd].sort((links, rechts) => (rechts.createdAt > links.createdAt ? 1 : -1));
  const begin = (Math.max(1, pagina) - 1) * SCRIBE_PAGINA_GROOTTE;
  return {
    ok: true,
    bron: "lokaal",
    sessies: gesorteerd.slice(begin, begin + SCRIBE_PAGINA_GROOTTE).map(lijstRij),
    pagina: Math.max(1, pagina),
    meer: gesorteerd.length > begin + SCRIBE_PAGINA_GROOTTE,
    ingeschakeld: state.instellingen.ingeschakeld,
    gemachtigd: true,
    beheerder: true,
  };
}

export interface NieuwConsultInvoer {
  patientReferentie: string;
  consultType: ConsultType;
  taal: ScribeTaal;
  consentRevisie: number;
  /** Ingevulde toestemmingstekst zoals voorgelezen (N10) — alleen het demo-pad bevriest hem zelf. */
  consentTekst?: string;
}

export async function maakSessie(invoer: NieuwConsultInvoer): Promise<ScribeResultaat<{ sessie: ScribeSessie }>> {
  const body: SessieAanmakenBody = {
    patientReferentie: invoer.patientReferentie,
    consultType: invoer.consultType,
    taal: invoer.taal,
    consentBevestigd: true,
    consentRevisie: invoer.consentRevisie,
  };
  const { status, data, headers } = await api<{ sessie: ScribeSessie }>("sessies", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", sessie: data.sessie };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  if (!state.instellingen.ingeschakeld) {
    return { ok: false, fout: "Careon AI staat uit voor deze organisatie.", status: 403 };
  }
  if (invoer.consentRevisie !== state.revision) {
    return {
      ok: false,
      fout: "De toestemmingstekst is intussen gewijzigd. Lees de nieuwe tekst voor en probeer opnieuw.",
      status: 409,
      revision: state.revision,
    };
  }
  const sessie = maakSessieLokaal(state, invoer);
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", sessie };
}

export async function haalSessie(sessieId: string): Promise<ScribeResultaat<SessieDetailBody>> {
  const { status, data, headers } = await api<SessieDetailResponse>(`sessies/${sessieId}`);
  if (status === 200 && data) {
    if (data.rol === "beheerder") {
      return {
        ok: true,
        bron: "centraal",
        rol: "beheerder",
        sessie: data.sessie,
        segmenten: data.segmenten,
        staat: data.staat,
        notitie: data.notitie,
        taken: data.taken,
        instellingen: data.instellingen,
        vrijgaveReden: null,
      };
    }
    return {
      ok: true,
      bron: "centraal",
      rol: data.rol,
      sessie: data.sessie,
      segmenten: data.segmenten,
      staat: data.staat,
      notitie: data.notitie,
      taken: data.taken,
      instellingen: data.instellingen,
      vrijgaveReden: data.vrijgaveReden,
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const sessie = vindSessie(state, sessieId);
  if (!sessie) return { ok: false, fout: "Dit consult bestaat niet (meer).", status: 404 };
  const segmenten = segmentenVan(state, sessieId);
  // Eén leesregel per aaneengesloten bezoek: `laad()` draait na elke handeling,
  // en een logboek vol identieke leesregels verbergt de rest.
  const laatsteLog = state.logboek[0];
  const alGelogd = laatsteLog?.handeling === "scribe.transcript.read" && laatsteLog.sessieId === sessieId;
  if (segmenten.length > 0 && !alGelogd) {
    logLokaal(state, "scribe.transcript.read", sessieId, { segmenten: segmenten.length });
  }
  bewaarLokaal(state);
  return {
    ok: true,
    bron: "lokaal",
    rol: "eigenaar",
    sessie,
    segmenten,
    staat: state.staat[sessieId] ?? null,
    notitie: laatsteNotitie(state, sessieId),
    taken: takenVan(state, sessieId),
    instellingen: state.instellingen,
    vrijgaveReden: null,
  };
}

export async function wijzigSessie(
  sessieId: string,
  patch: SessiePatchBody,
): Promise<ScribeResultaat<{ sessie: ScribeSessie }>> {
  const { status, data, headers } = await api<SessiePatchResponse>(`sessies/${sessieId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (status === 200 && data) {
    if (patch.status && ["geannuleerd", "overgenomen"].includes(patch.status)) clearScribeDraft(sessieId);
    return { ok: true, bron: "centraal", sessie: data.sessie };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  if (patch.status) {
    // De client leegt zijn wachtrij vóór het afronden; het demo-pad analyseert
    // hier nog één keer zodat de staat het volledige transcript dekt (§5.3).
    if (patch.status === "afgerond") analyseerLokaal(state, sessieId);
    const uitkomst = zetStatusLokaal(state, sessieId, patch.status, patch.grond);
    if (!uitkomst.ok || !uitkomst.sessie) {
      return { ok: false, fout: uitkomst.fout ?? NIET_BEREIKBAAR, status: uitkomst.status ?? 409 };
    }
    bewaarLokaal(state);
    if (["geannuleerd", "overgenomen"].includes(patch.status)) clearScribeDraft(sessieId);
    return { ok: true, bron: "lokaal", sessie: uitkomst.sessie };
  }
  const sessie = vindSessie(state, sessieId);
  if (!sessie) return { ok: false, fout: "Dit consult bestaat niet (meer).", status: 404 };
  if (patch.patientReferentie) {
    const index = state.sessies.findIndex((rij) => rij.id === sessieId);
    state.sessies[index] = {
      ...sessie,
      patientReferentie: patch.patientReferentie.trim(),
      updatedAt: new Date().toISOString(),
    };
    bewaarLokaal(state);
    return { ok: true, bron: "lokaal", sessie: state.sessies[index] };
  }
  return { ok: true, bron: "lokaal", sessie };
}

export async function verwijderSessie(
  sessieId: string,
  opties: SessieVerwijderBody = {},
): Promise<ScribeResultaat<Omit<SessieVerwijderResponse, "configured">>> {
  const { status, data, headers } = await api<SessieVerwijderResponse>(`sessies/${sessieId}`, {
    method: "DELETE",
    body: JSON.stringify(opties),
  });
  if (status === 200 && data) {
    clearScribeDraft(sessieId);
    return {
      ok: true,
      bron: "centraal",
      verwijderd: true,
      segmenten: data.segmenten,
      notities: data.notities,
      rol: data.rol,
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const sessie = vindSessie(state, sessieId);
  if (!sessie) return { ok: false, fout: "Dit consult bestaat niet (meer).", status: 404 };
  const notitie = laatsteNotitie(state, sessieId);
  if (!opties.forceer && notitie?.status === "goedgekeurd" && sessie.status !== "overgenomen") {
    return {
      ok: false,
      fout: "Er ligt een goedgekeurd verslag dat nog niet in het EPD is overgenomen. Bevestig om alsnog te verwijderen.",
      status: 409,
    };
  }
  const aantallen = verwijderSessieLokaal(state, sessieId, opties.grond);
  bewaarLokaal(state);
  clearScribeDraft(sessieId);
  return { ok: true, bron: "lokaal", verwijderd: true, ...aantallen, rol: "eigenaar" };
}

// ── Transcript ──────────────────────────────────────────────────────────────

export interface AudioFragmentInvoer {
  fragmentId: string;
  offsetMs: number;
  duurMs: number;
  overlapMs: number;
  mime: string;
}

/** Deelsucces op 502: de route legde de plaatshouder al vast (C32). */
export type AudioFragmentUitkomst = Omit<AudioUploadResponse, "configured"> & { fout?: string };

/**
 * Eén WAV-fragment naar de transcriptieroute (§5.3). Careon bewaart de bytes
 * niet: de route stuurt ze door naar de provider en gooit ze weg (S5). In
 * demo-modus antwoordt de route 501 — de opnamehook meldt dat dan als
 * "geen transcriptieprovider" en de bezoeker gebruikt het gescripte consult.
 *
 * Een 502 MÉT plaatshouder (`ontbrekend: true`) is een DEELSUCCES: het
 * gatsegment staat al in het transcript en `ontbrekende_fragmenten` is al met
 * één opgehoogd. De hook mag er dan géén tweede gat bij posten (C32).
 */
export async function stuurAudioFragment(
  sessieId: string,
  audio: Blob,
  invoer: AudioFragmentInvoer,
): Promise<ScribeResultaat<AudioFragmentUitkomst>> {
  const lifecycle = scribeDraftGeneration(sessieId);
  if (!scribeIdentityCurrent()) return { ok: false, status: 409, fout: NIET_BEREIKBAAR };
  let response: Response;
  try {
    response = await fetch(`/api/careon/scribe/sessies/${sessieId}/audio`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": invoer.mime,
        [SCRIBE_FRAGMENT_ID_HEADER]: invoer.fragmentId,
        [SCRIBE_FRAGMENT_OFFSET_HEADER]: String(Math.max(0, Math.round(invoer.offsetMs))),
        [SCRIBE_FRAGMENT_DUUR_HEADER]: String(Math.max(1, Math.round(invoer.duurMs))),
        [SCRIBE_FRAGMENT_OVERLAP_HEADER]: String(Math.max(0, Math.round(invoer.overlapMs))),
      },
      body: audio,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { ok: false, fout: NIET_BEREIKBAAR, status: 0 };
  }
  const data = (await response.json().catch(() => null)) as (AudioUploadResponse & { error?: string }) | null;
  if (lifecycle !== scribeDraftGeneration(sessieId) || !scribeIdentityCurrent())
    return { ok: false, status: 409, fout: NIET_BEREIKBAAR };
  if (response.ok && data) {
    return {
      ok: true,
      bron: "centraal",
      segmenten: data.segmenten,
      provider: data.provider,
      model: data.model,
      ontbrekend: data.ontbrekend,
      segmentTeller: data.segmentTeller,
    };
  }
  if (response.status === 501) {
    return {
      ok: false,
      fout: "In demo-modus is er geen transcriptieprovider. Gebruik Demo-opname of voer tekst handmatig in.",
      status: 501,
    };
  }
  // 502 mét plaatshouder (§5.3, C32): de server legde het gatsegment al vast.
  // Een 502 zónder deze velden (de RPC zelf faalde) blijft een gewone fout.
  if (response.status === 502 && data?.ontbrekend === true && Array.isArray(data.segmenten)) {
    return {
      ok: true,
      bron: "centraal",
      segmenten: data.segmenten,
      provider: data.provider ?? null,
      model: data.model ?? null,
      ontbrekend: true,
      segmentTeller: data.segmentTeller,
      fout: typeof data.error === "string" ? data.error : "Dit fragment kon niet worden getranscribeerd.",
    };
  }
  return { ok: false, ...foutUit(response.status, data, NIET_BEREIKBAAR, response.headers) };
}

export async function voegSegmentToe(
  sessieId: string,
  tekst: string,
  spreker: Spreker = "onbekend",
  bron: Extract<SegmentBron, "handmatig" | "systeem"> = "handmatig",
  duurMs?: number,
  fragmentId?: string,
): Promise<ScribeResultaat<{ segmenten: ScribeSegment[]; segmentTeller: number; ontbrekendeFragmenten: number }>> {
  const { status, data, headers } = await api<SegmentResponse>(`sessies/${sessieId}/segmenten`, {
    method: "POST",
    body: JSON.stringify({ tekst, spreker, bron, duurMs, fragmentId }),
  });
  if (status === 200 && data) {
    return {
      ok: true,
      bron: "centraal",
      segmenten: data.segmenten,
      segmentTeller: data.segmentTeller,
      ontbrekendeFragmenten: data.ontbrekendeFragmenten,
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const segmenten = voegHandmatigSegmentToe(state, sessieId, tekst, spreker, bron, duurMs, fragmentId);
  if (segmenten.length === 0) return { ok: false, fout: "Dit consult bestaat niet (meer).", status: 404 };
  bewaarLokaal(state);
  const sessie = vindSessie(state, sessieId);
  return {
    ok: true,
    bron: "lokaal",
    segmenten,
    segmentTeller: sessie ? sessie.segmentTeller : segmenten.length,
    ontbrekendeFragmenten: sessie ? sessie.ontbrekendeFragmenten : 0,
  };
}

export async function wijzigSegment(
  sessieId: string,
  volgnummer: number,
  patch: SegmentPatchBody,
): Promise<ScribeResultaat<{ segment: ScribeSegment; verouderd: boolean; laatsteSegment: number }>> {
  const { status, data, headers } = await api<{
    segment: ScribeSegment;
    verouderd: boolean;
    laatsteSegment: number;
  }>(`sessies/${sessieId}/segmenten/${volgnummer}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (status === 200 && data) {
    return {
      ok: true,
      bron: "centraal",
      segment: data.segment,
      verouderd: data.verouderd,
      laatsteSegment: data.laatsteSegment,
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const uitkomst = wijzigSegmentLokaal(state, sessieId, volgnummer, patch);
  if (!uitkomst.ok || !uitkomst.segment) {
    return { ok: false, fout: uitkomst.fout ?? NIET_BEREIKBAAR, status: uitkomst.status ?? 404 };
  }
  bewaarLokaal(state);
  return {
    ok: true,
    bron: "lokaal",
    segment: uitkomst.segment,
    verouderd: uitkomst.verouderd === true,
    laatsteSegment: uitkomst.laatsteSegment ?? 0,
  };
}

// ── Demo-motor (alleen het lokale pad) ──────────────────────────────────────

/** Eén gescripte regel; `null` zodra het demo-consult is uitgesproken. */
export function speelDemoOpname(sessieId: string): { segmenten: ScribeSegment[]; rest: number } | null {
  const state = lokaleState();
  const segmenten = speelDemoScript(state, sessieId, 1);
  if (segmenten.length === 0) return null;
  bewaarLokaal(state);
  return { segmenten, rest: demoScriptRest(state, sessieId) };
}

/** Het volledige gescripte consult in één keer (§7.3 "Volledig afspelen"). */
export function speelDemoAlles(sessieId: string): { segmenten: ScribeSegment[]; rest: number } | null {
  const state = lokaleState();
  const segmenten = speelDemoScript(state, sessieId, Number.MAX_SAFE_INTEGER);
  if (segmenten.length === 0) return null;
  bewaarLokaal(state);
  return { segmenten, rest: demoScriptRest(state, sessieId) };
}

export function demoRestSegmenten(sessieId: string): number {
  return demoScriptRest(lokaleState(), sessieId);
}

// ── Analyse, verslag en taken ───────────────────────────────────────────────

export interface AnalyseUitkomst {
  envelop: StaatEnvelop;
  taken: ScribeTaak[];
  /** Sprekertoewijzingen die de ronde schreef (S8) — de UI past ze ter plekke toe. */
  sprekers: SprekerToewijzing[];
  /** ASR-correcties met `correctieBron: "ai"` (S9); nooit over een behandelaarscorrectie. */
  correcties: TranscriptCorrectie[];
}

/**
 * Eén analyseronde. Het antwoord draagt naast de staat ook de sprekers en
 * transcriptcorrecties die de route wegschreef (C17/C54); de werkruimte voegt
 * ze ter plekke in het transcript in plaats van alles opnieuw te laden — een
 * volledige herlaadslag zou racen met de fragmenten die tijdens de analyse
 * binnenkomen.
 */
export async function analyseer(sessieId: string): Promise<ScribeResultaat<AnalyseUitkomst>> {
  const { status, data, headers } = await api<AnalyseResponse>(`sessies/${sessieId}/analyse`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (status === 200 && data) {
    return {
      ok: true,
      bron: "centraal",
      envelop: {
        staat: data.staat,
        versie: data.versie,
        epdLijstBeoordeeld: data.epdLijstBeoordeeld === true,
        laatsteSegment: data.laatsteSegment,
        verouderd: false,
        bron: data.bron,
        model: null,
        updatedAt: new Date().toISOString(),
      },
      taken: data.taken,
      sprekers: data.sprekers ?? [],
      correcties: data.correcties ?? [],
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const uitkomst = analyseerLokaal(state, sessieId);
  if (!uitkomst) return { ok: false, fout: "Dit consult bestaat niet (meer).", status: 404 };
  bewaarLokaal(state);
  return {
    ok: true,
    bron: "lokaal",
    envelop: uitkomst.envelop,
    taken: uitkomst.taken,
    // Het demo-pad past de ronde zelf al toe op de opgeslagen segmenten; de
    // uitkomst wordt hier omgezet naar hetzelfde contract, zodat de werkruimte
    // één codepad houdt.
    sprekers: uitkomst.segmenten.map((segment) => ({ volgnummer: segment.volgnummer, spreker: segment.spreker })),
    correcties: uitkomst.segmenten
      .filter((segment) => segment.correctieBron === "ai" && segment.tekstGecorrigeerd !== null)
      .map((segment) => ({ volgnummer: segment.volgnummer, tekstGecorrigeerd: segment.tekstGecorrigeerd as string })),
  };
}

/** Behandelaarscorrectie op de klinische staat (N6/S7). */
export async function wijzigStaat(
  sessieId: string,
  body: StaatPatchBody,
): Promise<ScribeResultaat<{ envelop: StaatEnvelop }>> {
  const { status, data, headers } = await api<StaatPatchResponse>(`sessies/${sessieId}/staat`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (status === 200 && data) {
    return {
      ok: true,
      bron: "centraal",
      envelop: {
        staat: data.staat,
        versie: data.versie,
        epdLijstBeoordeeld: data.epdLijstBeoordeeld === true,
        laatsteSegment: data.laatsteSegment,
        verouderd: data.verouderd,
        bron: "deterministisch",
        model: null,
        updatedAt: new Date().toISOString(),
      },
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const uitkomst = wijzigStaatLokaal(state, sessieId, body);
  if (!uitkomst.ok || !uitkomst.envelop) {
    return { ok: false, fout: uitkomst.fout ?? NIET_BEREIKBAAR, status: uitkomst.status ?? 409 };
  }
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", envelop: uitkomst.envelop };
}

export async function genereerNotitie(
  sessieId: string,
  formaat?: ConsultType,
): Promise<ScribeResultaat<{ notitie: ScribeNotitie }>> {
  const { status, data, headers } = await api<NotitieResponse>(`sessies/${sessieId}/notitie`, {
    method: "POST",
    body: JSON.stringify(formaat ? { formaat } : {}),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", notitie: data.notitie };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const notitie = genereerNotitieLokaal(state, sessieId, formaat);
  if (!notitie) return { ok: false, fout: "Dit consult bestaat niet (meer).", status: 404 };
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", notitie };
}

/** `ontbrekendeFragmentenBeoordeeld` hoort bij de extra bevestiging van N22. */
export type NotitiePatchInvoer = NotitiePatchBody & { ontbrekendeFragmentenBeoordeeld?: boolean };

export async function wijzigNotitie(
  sessieId: string,
  notitieId: string,
  patch: NotitiePatchInvoer,
): Promise<ScribeResultaat<{ notitie: ScribeNotitie; overgeslagen: string[]; goedgekeurd: boolean }>> {
  const { status, data, headers } = await api<{
    notitie: ScribeNotitie;
    overgeslagen: string[];
    goedgekeurd: boolean;
  }>(`sessies/${sessieId}/notitie/${notitieId}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (status === 200 && data) {
    return {
      ok: true,
      bron: "centraal",
      notitie: data.notitie,
      overgeslagen: data.overgeslagen,
      goedgekeurd: data.goedgekeurd,
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const uitkomst = wijzigNotitieLokaal(state, sessieId, notitieId, patch);
  if (!uitkomst.ok || !uitkomst.notitie) {
    return { ok: false, fout: uitkomst.fout ?? NIET_BEREIKBAAR, status: uitkomst.status ?? 409 };
  }
  bewaarLokaal(state);
  return {
    ok: true,
    bron: "lokaal",
    notitie: uitkomst.notitie,
    overgeslagen: uitkomst.overgeslagen ?? [],
    goedgekeurd: uitkomst.goedgekeurd === true,
  };
}

export async function wijzigTaak(
  sessieId: string,
  taakId: string,
  taakStatus: TaakStatus,
): Promise<ScribeResultaat<{ taak: ScribeTaak }>> {
  const { status, data, headers } = await api<TaakPatchResponse>(`sessies/${sessieId}/taken/${taakId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: taakStatus }),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", taak: data.taak };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const taak = wijzigTaakLokaal(state, sessieId, taakId, taakStatus);
  if (!taak) return { ok: false, fout: "Deze vervolgactie bestaat niet (meer).", status: 404 };
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", taak };
}

// ── Export ──────────────────────────────────────────────────────────────────

export { exportBestandsnaam };

/**
 * Bestandsnaam uit `Content-Disposition`, streng gefilterd: alleen wat er als
 * bestandsnaam uit mag zien komt er doorheen, nooit een pad- of stuurteken.
 */
function bestandsnaamUitHeader(headers: Headers): string | null {
  const dispositie = headers.get("Content-Disposition");
  if (!dispositie) return null;
  const ster = /filename\*=UTF-8''([^;]+)/i.exec(dispositie);
  let ruw: string | undefined;
  if (ster?.[1]) {
    try {
      ruw = decodeURIComponent(ster[1]);
    } catch {
      ruw = undefined;
    }
  }
  ruw ??= /filename="([^"]+)"/i.exec(dispositie)?.[1];
  if (!ruw) return null;
  return /^[A-Za-z0-9._-]{1,64}$/.test(ruw) ? ruw : null;
}

export interface ExportInvoer extends ExportTekstOpties {
  formaat?: ScribeExportFormaat;
  /** Consultdatum voor de bestandsnaam (C28); nooit vandaag. */
  consultTijdstip?: string | null;
  /** N20: welke weg de kopie neemt — bestandsexports zijn de kopieën die Careon niet meer kan opruimen. */
  kanaal?: "klembord" | "bestand";
  preview?: boolean;
}

/**
 * Verslagtekst plus de naam waaronder zij hoort te landen. De datum in de naam
 * is de CONSULTdatum, niet vandaag (C28): route, client en demo-pad rekenen met
 * `exportBestandsnaam` uit export-tekst.ts, en de centrale weg neemt bij
 * voorkeur de naam die de route zelf in `Content-Disposition` zette.
 */
export async function exporteerVerslag(
  sessieId: string,
  invoer: ExportInvoer = {},
): Promise<ScribeResultaat<{ tekst: string; bestandsnaam: string }>> {
  const formaat = invoer.formaat ?? "txt";
  const zoekparams = new URLSearchParams({ formaat });
  if (invoer.preview) zoekparams.set("preview", "1");
  if (invoer.bronverwijzingen !== undefined) zoekparams.set("bronnen", invoer.bronverwijzingen ? "1" : "0");
  if (invoer.legeSectiesWeglaten !== undefined) zoekparams.set("legeSecties", invoer.legeSectiesWeglaten ? "0" : "1");
  if (invoer.kanaal) zoekparams.set("kanaal", invoer.kanaal);
  let response: Response;
  try {
    response = await fetch(`/api/careon/scribe/sessies/${sessieId}/export?${zoekparams}`, { cache: "no-store" });
  } catch {
    return { ok: false, fout: NIET_BEREIKBAAR, status: 0 };
  }
  if (response.ok) {
    return {
      ok: true,
      bron: "centraal",
      tekst: await response.text(),
      bestandsnaam:
        bestandsnaamUitHeader(response.headers) ??
        exportBestandsnaam(sessieId, formaat, invoer.consultTijdstip ?? null),
    };
  }
  if (response.status !== 501) {
    const data = (await response.json().catch(() => null)) as unknown;
    return { ok: false, ...foutUit(response.status, data, NIET_BEREIKBAAR, response.headers) };
  }

  const state = lokaleState();
  const sessie = vindSessie(state, sessieId);
  const notitie = laatsteNotitie(state, sessieId);
  if (!sessie || !notitie) return { ok: false, fout: "Dit consult bestaat niet (meer).", status: 404 };
  if (notitie.status !== "goedgekeurd") {
    return { ok: false, fout: "Keur het verslag eerst goed voordat u het exporteert.", status: 409 };
  }
  if (!invoer.preview)
    logLokaal(state, "scribe.export", sessieId, {
      formaat,
      secties: notitie.secties.length,
      kanaal: invoer.kanaal ?? "bestand",
    });
  bewaarLokaal(state);
  return {
    ok: true,
    bron: "lokaal",
    tekst: bouwExportTekst(sessie, notitie, takenVan(state, sessieId), formaat, {
      bronverwijzingen: invoer.bronverwijzingen,
      legeSectiesWeglaten: invoer.legeSectiesWeglaten,
    }),
    bestandsnaam: exportBestandsnaam(sessieId, formaat, sessie.gestartOp ?? sessie.createdAt),
  };
}

/** Record the actual successful browser/native copy, never the preview request. */
export async function registreerVerslagExport(
  sessieId: string,
  invoer: { kanaal: "klembord" | "bestand"; notitieId: string; bewerkRevisie: number; sectieId?: string },
): Promise<ScribeResultaat<{ geregistreerd: true }>> {
  const { status, data, headers } = await api<{ geregistreerd?: boolean }>(`sessies/${sessieId}/export`, {
    method: "POST",
    body: JSON.stringify(invoer),
  });
  if (status >= 200 && status < 300) return { ok: true, bron: "centraal", geregistreerd: true };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };
  const state = lokaleState();
  const notitie = laatsteNotitie(state, sessieId);
  if (
    !notitie ||
    notitie.id !== invoer.notitieId ||
    notitie.bewerkRevisie !== invoer.bewerkRevisie ||
    notitie.status !== "goedgekeurd"
  ) {
    return { ok: false, status: 409, fout: "Het goedgekeurde verslag is gewijzigd. Laad het opnieuw vóór export." };
  }
  logLokaal(state, "scribe.export", sessieId, {
    kanaal: invoer.kanaal,
    secties: invoer.sectieId ? 1 : notitie.secties.length,
    versie: notitie.versie,
  });
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", geregistreerd: true };
}

// ── Vrijgave (beheerder) ────────────────────────────────────────────────────

export async function maakVrijgave(
  sessieId: string,
  aanUserId: string,
  reden: string,
): Promise<ScribeResultaat<{ aanUserId: string }>> {
  const { status, data, headers } = await api<VrijgaveResponse>(`sessies/${sessieId}/vrijgave`, {
    method: "POST",
    body: JSON.stringify({ aanUserId, reden }),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", aanUserId: data.vrijgave.aanUserId };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const notitie = laatsteNotitie(state, sessieId);
  if (notitie?.status !== "goedgekeurd") {
    return { ok: false, fout: "Alleen een goedgekeurd verslag kan worden vrijgegeven.", status: 409 };
  }
  if (state.vrijgaven.some((rij) => rij.sessieId === sessieId && rij.aanUserId === aanUserId)) {
    return { ok: false, fout: "Dit verslag is al aan deze collega vrijgegeven.", status: 409 };
  }
  state.vrijgaven = [
    ...state.vrijgaven,
    {
      id: `vrijgave-${crypto.randomUUID()}`,
      sessieId,
      aanUserId,
      doorUserId: "demo-user-1",
      reden: reden.slice(0, 300),
      createdAt: new Date().toISOString(),
    },
  ];
  werkVrijgaveVlagBij(state, sessieId);
  logLokaal(state, "scribe.sessie.vrijgegeven", sessieId, { aan: aanUserId });
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", aanUserId };
}

/** Vrijgave intrekken (N11). Zonder `aanUserId` vervallen álle vrijgaven. */
export async function trekVrijgaveIn(
  sessieId: string,
  aanUserId?: string,
  grond?: GeannuleerdGrond,
): Promise<ScribeResultaat<{ aantal: number }>> {
  const { status, data, headers } = await api<VrijgaveIntrekkenResponse>(`sessies/${sessieId}/vrijgave`, {
    method: "DELETE",
    body: JSON.stringify({ aanUserId, grond }),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", aantal: data.aantal };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const aantal = trekVrijgaveInLokaal(state, sessieId, aanUserId, grond);
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", aantal };
}

// ── Logboek (beheerder, N20) ────────────────────────────────────────────────

export async function haalLogboek(
  query: LogboekQuery = {},
): Promise<ScribeResultaat<Omit<LogboekResponse, "configured">>> {
  const zoekparams = new URLSearchParams();
  if (query.handeling) zoekparams.set("handeling", query.handeling);
  if (query.van && isIsoDatum(query.van)) zoekparams.set("van", query.van);
  if (query.tot && isIsoDatum(query.tot)) zoekparams.set("tot", query.tot);
  if (query.pagina && query.pagina > 1) zoekparams.set("pagina", String(query.pagina));
  const { status, data, headers } = await api<LogboekResponse>(`logboek?${zoekparams}`);
  if (status === 200 && data) {
    return {
      ok: true,
      bron: "centraal",
      regels: data.regels,
      pagina: data.pagina,
      meer: data.meer,
      handelingen: data.handelingen,
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const alle = state.logboek;
  const gefilterd = alle.filter((regel) => {
    if (query.handeling && regel.handeling !== query.handeling) return false;
    const datum = datumVan(regel.tijdstip);
    if (query.van && isIsoDatum(query.van) && (datum === null || datum < query.van)) return false;
    if (query.tot && isIsoDatum(query.tot) && (datum === null || datum > query.tot)) return false;
    return true;
  });
  const pagina = Math.max(1, query.pagina ?? 1);
  const begin = (pagina - 1) * SCRIBE_LOGBOEK_PAGINA_GROOTTE;
  return {
    ok: true,
    bron: "lokaal",
    regels: gefilterd.slice(begin, begin + SCRIBE_LOGBOEK_PAGINA_GROOTTE),
    pagina,
    meer: gefilterd.length > begin + SCRIBE_LOGBOEK_PAGINA_GROOTTE,
    handelingen: [...new Set(alle.map((regel) => regel.handeling))].sort(),
  };
}

// ── Instellingen en gemachtigden ────────────────────────────────────────────

export async function haalScribeInstellingen(): Promise<
  ScribeResultaat<{ instellingen: ScribeInstellingen; revision: number; providerStatus: ScribeProviderStatus }>
> {
  const { status, data, headers } = await api<InstellingenResponse>("instellingen");
  if (status === 200 && data) {
    return {
      ok: true,
      bron: "centraal",
      instellingen: data.instellingen,
      revision: data.revision,
      providerStatus: data.providerStatus,
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  bewaarLokaal(state);
  return {
    ok: true,
    bron: "lokaal",
    instellingen: state.instellingen,
    revision: state.revision,
    providerStatus: DEMO_PROVIDER_STATUS,
  };
}

export async function bewaarScribeInstellingen(
  instellingen: ScribeInstellingen,
  baseRevision: number,
): Promise<ScribeResultaat<{ revision: number }>> {
  const { status, data, headers } = await api<InstellingenOpslaanResponse>("instellingen", {
    method: "PUT",
    body: JSON.stringify({ state: instellingen, baseRevision, operationId: crypto.randomUUID() }),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", revision: data.revision };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  if (baseRevision !== state.revision) {
    return {
      ok: false,
      fout: "Iemand anders heeft de instellingen intussen gewijzigd. Laad de pagina opnieuw.",
      status: 409,
      revision: state.revision,
    };
  }
  state.instellingen = { ...instellingen };
  state.revision = baseRevision + 1;
  logLokaal(state, "scribe.instellingen.gewijzigd", null, {
    revisie: state.revision,
    ingeschakeld: instellingen.ingeschakeld,
  });
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", revision: state.revision };
}

export async function haalGemachtigden(): Promise<ScribeResultaat<{ gemachtigden: ScribeGemachtigde[] }>> {
  const { status, data, headers } = await api<GemachtigdenResponse>("gemachtigden");
  if (status === 200 && data) return { ok: true, bron: "centraal", gemachtigden: data.gemachtigden };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };
  const state = lokaleState();
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", gemachtigden: state.gemachtigden };
}

export async function bewaarGemachtigden(
  userIds: string[],
): Promise<ScribeResultaat<{ gemachtigden: ScribeGemachtigde[] }>> {
  const { status, data, headers } = await api<GemachtigdenOpslaanResponse>("gemachtigden", {
    method: "PUT",
    body: JSON.stringify({ userIds }),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", gemachtigden: data.gemachtigden };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR, headers) };

  const state = lokaleState();
  const gekozen = new Set(userIds);
  state.gemachtigden = state.gemachtigden.map((rij) => ({
    ...rij,
    // Beheerders zijn per definitie gemachtigd en blijven dat (§7.5).
    gemachtigd: rij.orgRole === "org_admin" ? true : gekozen.has(rij.userId),
  }));
  logLokaal(state, "scribe.gemachtigden.gewijzigd", null, { gemachtigd: userIds.length });
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", gemachtigden: state.gemachtigden };
}

/**
 * Wie mag dit consult overnemen bij een vrijgave (N11): uitsluitend
 * GEMACHTIGDE collega's, en nooit de gebruiker zelf — een beheerder die het
 * verslag aan zichzelf vrijgeeft, omzeilt precies de grens die S12/V3 stelt.
 * De eigen identiteit komt binnen als user-id (demo-pad) of e-mailadres
 * (/api/auth/session); beide sluiten dezelfde rij uit.
 */
export function vrijgaveKandidaten(
  gemachtigden: ScribeGemachtigde[],
  eigen: { userId?: string | null; email?: string | null },
): ScribeGemachtigde[] {
  const email = eigen.email?.trim().toLowerCase() ?? null;
  return gemachtigden.filter(
    (rij) =>
      rij.gemachtigd &&
      (eigen.userId == null || rij.userId !== eigen.userId) &&
      (email === null || rij.email.trim().toLowerCase() !== email),
  );
}

export { clearScribeState };
