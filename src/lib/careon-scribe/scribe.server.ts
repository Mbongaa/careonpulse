import { NextResponse } from "next/server";

import { EMPTY_SCRIBE_INSTELLINGEN, migreerScribeInstellingen } from "@/data/careon/careon-scribe";
import {
  authenticatedActorHash,
  enforceScribeOrgRateLimit,
  enforceScribeRateLimit,
} from "@/lib/careon-assistant/runtime.server";
import { magScribeBeheren } from "@/lib/careon-scribe-rol";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import type { CareonSession } from "@/lib/supabase/session.server";

import type { StaatFeitInvoer } from "./api-contract";
import { heranalyseStartStaat, isGesprekscontext, legeKlinischeStaat } from "./klinische-staat";
import { dagenTot, verlooptBinnenkort } from "./retentie";
import type {
  AnalyseBron,
  ConsultType,
  CorrectieBron,
  KlinischeStaat,
  NotitieStatus,
  ScribeGemachtigde,
  ScribeInstellingen,
  ScribeNotitie,
  ScribeSegment,
  ScribeSessie,
  ScribeTaak,
  ScribeTaal,
  SegmentBron,
  SessieStatus,
  Spreker,
  StaatCategorie,
  TaakSoort,
  TaakStatus,
  TranscriptieProviderNaam,
  VerslagSectie,
} from "./types";
import { SCRIBE_LIMITS, STAAT_CATEGORIEEN } from "./types";

// Serverkant van Careon AI (handoff 20 §2.2/§2.3/§5.3). Deze module bevat
// uitsluitend server-helpers en wordt nooit vanuit een client-component
// geïmporteerd; de client-veilige domeinlogica staat in types.ts,
// klinische-staat.ts, deterministisch.ts, retentie.ts en overlap.ts.
//
// Twee vaste regels voor élke query hieronder:
//   * Inhoud (sessies, segmenten, staat, notities, taken) loopt onder het
//     CALLER-JWT: RLS is de grens, niet de route. De service-role komt alleen
//     voor bij audit, quota, provideraanroepen, het opzoeken van leden en
//     de uitsluitend servertoegankelijke vrijgave/verwijder-RPC's. Die laatste
//     herautoriseren de ingelogde actor onder een parent-rijlock.
//   * Naast RLS staat in élke call een expliciet `org_id=eq.…`-filter. Een
//     platformbeheerder ziet via RLS méér dan één organisatie; zonder dat
//     filter zou een lijstquery stilzwijgend over organisaties heen lopen.

/** Tabelnaam van het machtigingenregister (S12). */
export const SCRIBE_GEMACHTIGDEN_TABEL = "careon_scribe_gemachtigden";

export const SCRIBE_SESSIES_TABEL = "careon_scribe_sessies";
export const SCRIBE_SEGMENTEN_TABEL = "careon_scribe_segmenten";
export const SCRIBE_STAAT_TABEL = "careon_scribe_staat";
export const SCRIBE_NOTITIES_TABEL = "careon_scribe_notities";
export const SCRIBE_TAKEN_TABEL = "careon_scribe_taken";
export const SCRIBE_INSTELLINGEN_TABEL = "careon_scribe_instellingen";
export const SCRIBE_VRIJGAVEN_TABEL = "careon_scribe_vrijgaven";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// ── Rijtypen (snake_case, exact de kolommen van migratie 20260907120000) ────

export interface ScribeSessieRij {
  id: string;
  org_id: string;
  behandelaar_id: string;
  status: SessieStatus;
  patient_referentie: string;
  consult_type: ConsultType;
  taal: ScribeTaal;
  consent_bevestigd_op: string;
  consent_revisie: number;
  consent_tekst: string;
  gestart_op: string | null;
  beeindigd_op: string | null;
  goedgekeurd_op: string | null;
  overgenomen_op: string | null;
  duur_ms: number;
  segment_teller: number;
  transcript_revisie: number;
  ontbrekende_fragmenten: number;
  transcriptie_provider: TranscriptieProviderNaam | null;
  transcriptie_model: string | null;
  notitie_model: string | null;
  prompt_versie: string | null;
  transcript_verwijder_na: string | null;
  sessie_verwijder_na: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScribeSegmentRij {
  id: string;
  volgnummer: number;
  spreker: Spreker;
  spreker_bron?: "behandelaar" | "ai" | null;
  tekst: string;
  tekst_gecorrigeerd: string | null;
  correctie_bron: CorrectieBron | null;
  begin_ms: number | null;
  eind_ms: number | null;
  bron: SegmentBron;
  created_at: string;
}

export interface ScribeStaatRij {
  sessie_id: string;
  staat: unknown;
  versie: number;
  epd_lijst_beoordeeld: boolean;
  laatste_segment: number;
  verouderd: boolean;
  model: string | null;
  bron: AnalyseBron;
  updated_at: string;
}

export interface ScribeNotitieRij {
  id: string;
  bewerk_revisie: number;
  sessie_id: string;
  versie: number;
  formaat: ConsultType;
  secties: unknown;
  status: NotitieStatus;
  model: string | null;
  bron: AnalyseBron;
  goedgekeurd_op: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScribeTaakRij {
  id: string;
  sessie_id: string;
  omschrijving: string;
  soort: TaakSoort;
  status: TaakStatus;
  bron_segmenten: number[] | null;
  created_at: string;
  updated_at: string;
}

export const SESSIE_SELECT =
  "id,org_id,behandelaar_id,status,patient_referentie,consult_type,taal,consent_bevestigd_op,consent_revisie," +
  "consent_tekst,gestart_op,beeindigd_op,goedgekeurd_op,overgenomen_op,duur_ms,segment_teller," +
  "ontbrekende_fragmenten,transcript_revisie,transcriptie_provider,transcriptie_model,notitie_model,prompt_versie," +
  "transcript_verwijder_na,sessie_verwijder_na,created_at,updated_at";

/**
 * Kolomlijst voor de BEHEERDERSLEZING (S12/V3, C3/C10): SESSIE_SELECT zonder
 * `patient_referentie` en `consult_type`. Sinds de select-policy op
 * careon_scribe_sessies geen beheerderstak meer draagt, is dit de enige weg
 * waarlangs een org_admin de consulten van collega's ziet — via de service-role
 * ná zijn beheerdersgate. De twee weggelaten velden staan hier niet, dus ze
 * komen niet in het geheugen, de logs of het antwoord van de route terecht.
 */
export const SESSIE_METADATA_SELECT =
  "id,org_id,behandelaar_id,status,taal,consent_bevestigd_op,consent_revisie,consent_tekst,gestart_op," +
  "beeindigd_op,goedgekeurd_op,overgenomen_op,duur_ms,segment_teller,ontbrekende_fragmenten," +
  "transcriptie_provider,transcriptie_model,notitie_model,prompt_versie,transcript_verwijder_na," +
  "sessie_verwijder_na,created_at,updated_at";

export const SEGMENT_SELECT =
  "id,volgnummer,spreker,spreker_bron,tekst,tekst_gecorrigeerd,correctie_bron,begin_ms,eind_ms,bron,created_at";

export const STAAT_SELECT =
  "sessie_id,staat,versie,epd_lijst_beoordeeld,laatste_segment,verouderd,model,bron,updated_at";

export const NOTITIE_SELECT =
  "id,sessie_id,versie,bewerk_revisie,formaat,secties,status,model,bron,goedgekeurd_op,created_at,updated_at";

export const TAAK_SELECT = "id,sessie_id,omschrijving,soort,status,bron_segmenten,created_at,updated_at";

// ── Rij → DTO ───────────────────────────────────────────────────────────────

/** Volledige sessie: uitsluitend voor de eigen behandelaar (of vrijgave). */
export function sessieVanRij(rij: ScribeSessieRij, eigen: boolean, vrijgegeven: boolean): ScribeSessie {
  return {
    id: rij.id,
    status: rij.status,
    patientReferentie: rij.patient_referentie,
    consultType: rij.consult_type,
    taal: rij.taal,
    consentBevestigdOp: rij.consent_bevestigd_op,
    consentRevisie: rij.consent_revisie,
    consentTekst: rij.consent_tekst,
    gestartOp: rij.gestart_op,
    beeindigdOp: rij.beeindigd_op,
    goedgekeurdOp: rij.goedgekeurd_op,
    overgenomenOp: rij.overgenomen_op,
    duurMs: rij.duur_ms,
    segmentTeller: rij.segment_teller,
    ontbrekendeFragmenten: rij.ontbrekende_fragmenten,
    transcriptieProvider: rij.transcriptie_provider,
    transcriptieModel: rij.transcriptie_model,
    notitieModel: rij.notitie_model,
    transcriptVerwijderNa: rij.transcript_verwijder_na,
    sessieVerwijderNa: rij.sessie_verwijder_na,
    createdAt: rij.created_at,
    updatedAt: rij.updated_at,
    eigen,
    vrijgegeven,
  };
}

/** Lijstrij van een collega: metadata zonder dossierreferentie en type. */
export type SessieLijstMetadata = Omit<ScribeSessie, "patientReferentie" | "consultType"> & {
  verlooptBinnenkort: boolean;
  verlooptOverDagen: number | null;
};

export type SessieLijstEigen = ScribeSessie & {
  verlooptBinnenkort: boolean;
  verlooptOverDagen: number | null;
};

export type SessieLijstItem = SessieLijstEigen | SessieLijstMetadata;

/**
 * Serializer voor de consultlijst (§5.3).
 *
 * `eigen: false` — een consult van een collega dat een `org_admin` beheert —
 * levert BEWUST een object ZONDER `patientReferentie` en `consultType`: dat
 * zijn de zorginhoudelijke, identificerende metadata (S12/V3). Ze worden niet
 * leeggemaakt maar WEGGELATEN, zodat een fout in de UI ze niet alsnog als lege
 * string kan tonen alsof er niets was.
 */
export function sessieVoorLijst(
  rij: ScribeSessieRij,
  eigen: boolean,
  vrijgegeven = false,
  nu: Date = new Date(),
): SessieLijstItem {
  // C37 — één implementatie van de verloopregel voor server en demo-pad.
  const verlooptOverDagen = rij.sessie_verwijder_na ? dagenTot(rij.sessie_verwijder_na, nu) : null;
  const binnenkort = verlooptBinnenkort(rij.sessie_verwijder_na, rij.status, nu);
  const volledig = sessieVanRij(rij, eigen, vrijgegeven);
  if (eigen || vrijgegeven) return { ...volledig, verlooptBinnenkort: binnenkort, verlooptOverDagen };
  const { patientReferentie: _referentie, consultType: _type, ...metadata } = volledig;
  return { ...metadata, verlooptBinnenkort: binnenkort, verlooptOverDagen };
}

/** Rijvorm van SESSIE_METADATA_SELECT — de twee velden ONTBREKEN in het type. */
export type ScribeSessieMetadataRij = Omit<ScribeSessieRij, "patient_referentie" | "consult_type">;

/**
 * Serializer voor een beheerderslezing (C3/C10). Anders dan sessieVoorLijst()
 * hoeft hier niets te worden weggelaten: de dossierreferentie en het
 * consulttype zijn nooit opgehaald. `eigen` en `vrijgegeven` zijn per definitie
 * false — een eigen of vrijgegeven consult leest de aanvrager onder zijn eigen
 * JWT, met de volledige rij.
 */
export function sessieMetadataVoorLijst(rij: ScribeSessieMetadataRij, nu: Date = new Date()): SessieLijstMetadata {
  const verlooptOverDagen = rij.sessie_verwijder_na ? dagenTot(rij.sessie_verwijder_na, nu) : null;
  const binnenkort = verlooptBinnenkort(rij.sessie_verwijder_na, rij.status, nu);
  return {
    id: rij.id,
    status: rij.status,
    taal: rij.taal,
    consentBevestigdOp: rij.consent_bevestigd_op,
    consentRevisie: rij.consent_revisie,
    consentTekst: rij.consent_tekst,
    gestartOp: rij.gestart_op,
    beeindigdOp: rij.beeindigd_op,
    goedgekeurdOp: rij.goedgekeurd_op,
    overgenomenOp: rij.overgenomen_op,
    duurMs: rij.duur_ms,
    segmentTeller: rij.segment_teller,
    ontbrekendeFragmenten: rij.ontbrekende_fragmenten,
    transcriptieProvider: rij.transcriptie_provider,
    transcriptieModel: rij.transcriptie_model,
    notitieModel: rij.notitie_model,
    transcriptVerwijderNa: rij.transcript_verwijder_na,
    sessieVerwijderNa: rij.sessie_verwijder_na,
    createdAt: rij.created_at,
    updatedAt: rij.updated_at,
    eigen: false,
    vrijgegeven: false,
    verlooptBinnenkort: binnenkort,
    verlooptOverDagen,
  };
}

export function segmentVanRij(rij: ScribeSegmentRij): ScribeSegment {
  return {
    id: rij.id,
    volgnummer: rij.volgnummer,
    spreker: rij.spreker,
    sprekerBron: rij.spreker_bron ?? null,
    tekst: rij.tekst,
    tekstGecorrigeerd: rij.tekst_gecorrigeerd,
    correctieBron: rij.correctie_bron,
    beginMs: rij.begin_ms,
    eindMs: rij.eind_ms,
    bron: rij.bron,
    createdAt: rij.created_at,
  };
}

export function staatVanRij(rij: ScribeStaatRij): {
  staat: KlinischeStaat;
  versie: number;
  laatsteSegment: number;
  verouderd: boolean;
  epdLijstBeoordeeld: boolean;
  bron: AnalyseBron;
  model: string | null;
  updatedAt: string;
} {
  // De DB-vormcheck bewaakt de grove vorm; hier telt alleen dat een onleesbare
  // waarde nooit als staat de UI in glipt.
  const waarde = rij.staat;
  const staat = waarde && typeof waarde === "object" ? (waarde as KlinischeStaat) : legeKlinischeStaat();
  if (staat.gesprekscontext !== undefined && !isGesprekscontext(staat.gesprekscontext)) {
    throw new Error("Ongeldige opgeslagen gesprekscontext.");
  }
  return {
    staat,
    versie: rij.versie,
    laatsteSegment: rij.laatste_segment,
    verouderd: rij.verouderd,
    epdLijstBeoordeeld: rij.epd_lijst_beoordeeld,
    bron: rij.bron,
    model: rij.model,
    updatedAt: rij.updated_at,
  };
}

export function notitieVanRij(rij: ScribeNotitieRij): ScribeNotitie {
  return {
    id: rij.id,
    sessieId: rij.sessie_id,
    versie: rij.versie,
    bewerkRevisie: rij.bewerk_revisie,
    formaat: rij.formaat,
    secties: Array.isArray(rij.secties) ? (rij.secties as VerslagSectie[]) : [],
    status: rij.status,
    model: rij.model,
    bron: rij.bron,
    goedgekeurdOp: rij.goedgekeurd_op,
    createdAt: rij.created_at,
    updatedAt: rij.updated_at,
  };
}

export function taakVanRij(rij: ScribeTaakRij): ScribeTaak {
  return {
    id: rij.id,
    sessieId: rij.sessie_id,
    omschrijving: rij.omschrijving,
    soort: rij.soort,
    status: rij.status,
    bronSegmenten: Array.isArray(rij.bron_segmenten) ? rij.bron_segmenten : [],
    createdAt: rij.created_at,
    updatedAt: rij.updated_at,
  };
}

// ── PostgREST onder het caller-JWT ──────────────────────────────────────────

/** Elke helper werpt deze fout bij een onbereikbare of weigerende database. */
export class ScribeOpslagFout extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`scribe-opslag: ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function verwerk<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // Bewust alleen de PostgREST-melding, nooit het verzoeklichaam: dat kan
    // transcripttekst bevatten.
    throw new ScribeOpslagFout(response.status, (await response.text()).slice(0, 300));
  }
  const tekst = await response.text();
  return (tekst.length > 0 ? JSON.parse(tekst) : null) as T;
}

export async function scribeGet<T>(session: CareonSession, tabel: string, params: URLSearchParams): Promise<T> {
  const response = await fetch(`${POSTGREST_URL}/${tabel}?${params}`, {
    headers: userRestHeaders(session),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return verwerk<T>(response);
}

export async function scribePost<T>(
  session: CareonSession,
  tabel: string,
  body: unknown,
  prefer = "return=representation",
): Promise<T> {
  const response = await fetch(`${POSTGREST_URL}/${tabel}`, {
    method: "POST",
    headers: userRestHeaders(session, { Prefer: prefer }),
    body: JSON.stringify(body),
  });
  return verwerk<T>(response);
}

export async function scribePatch<T>(
  session: CareonSession,
  tabel: string,
  params: URLSearchParams,
  body: unknown,
  prefer = "return=representation",
): Promise<T> {
  const response = await fetch(`${POSTGREST_URL}/${tabel}?${params}`, {
    method: "PATCH",
    headers: userRestHeaders(session, { Prefer: prefer }),
    body: JSON.stringify(body),
  });
  return verwerk<T>(response);
}

export async function scribeDelete(session: CareonSession, tabel: string, params: URLSearchParams): Promise<void> {
  const response = await fetch(`${POSTGREST_URL}/${tabel}?${params}`, {
    method: "DELETE",
    headers: userRestHeaders(session, { Prefer: "return=minimal" }),
  });
  await verwerk<null>(response);
}

/** RPC onder het caller-JWT — statusovergangen en segmentinvoer lopen hierlangs. */
export async function scribeRpc<T>(session: CareonSession, naam: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${POSTGREST_URL}/rpc/${naam}`, {
    method: "POST",
    headers: userRestHeaders(session),
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return verwerk<T>(response);
}

/** Server-only metadata mutations; each RPC reauthorizes the actor in the DB. */
export async function scribeServiceRpc<T>(
  naam: "careon_scribe_sessie_verwijderen" | "careon_scribe_vrijgeven",
  args: Record<string, unknown>,
): Promise<T> {
  if (!scribeServiceBeschikbaar()) throw new ScribeOpslagFout(503, "{}");
  const response = await fetch(`${POSTGREST_URL}/rpc/${naam}`, {
    method: "POST",
    headers: scribeServiceHeaders(),
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return verwerk<T>(response);
}

// ── Service-role (vrijgave-insert, ledenlijst, beheerderslezing) ───────────
//
// De service-role slaat RLS over en is daarom tot vier gevallen beperkt, elk
// ná een expliciete beheerdersgate in de route en elk met een vaste,
// metadata-only kolomlijst:
//   * de vrijgave-insert (careon_scribe_vrijgaven heeft bewust geen
//     client-insert-policy);
//   * de ledenlijst voor het machtigingenscherm;
//   * de beheerderslezing van sessies (SESSIE_METADATA_SELECT — nooit
//     patient_referentie of consult_type, C3/C10);
//   * het TELLEN van goedgekeurde verslagen bij een beheerdersverwijdering
//     (`select=id` — nooit `secties`, C12/C34);
//   * het scribe-logboek van de organisatie (audit_events heeft geen
//     client-policies; de route zeeft alles wat geen metadata is, N20).
// Transcript, staat en verslaginhoud komen hier nooit langs.

export function scribeServiceBeschikbaar(): boolean {
  return SUPABASE_URL.length > 0 && SERVICE_KEY.length > 0;
}

export function scribeServiceHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function serviceGet<T>(pad: string): Promise<T | null> {
  if (!scribeServiceBeschikbaar()) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pad}`, {
      headers: scribeServiceHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// ── Machtigingen ────────────────────────────────────────────────────────────

/**
 * Is deze gebruiker gemachtigd voor Careon AI?
 *
 * Beheerders (org_admin, superadmin mét org-lidmaatschap, demo-account) zijn
 * dat per definitie; voor de rest telt één rij in
 * careon_scribe_gemachtigden. De query loopt onder het caller-JWT (RLS als
 * grens: een lid ziet alleen zijn eigen rij) met een expliciet org-filter
 * naast de policy. Fail closed: elke fout of onbereikbare database levert
 * `false`, zodat de gate nooit per ongeluk opengaat.
 */
export async function isScribeGemachtigd(session: CareonSession): Promise<boolean> {
  if (!session.orgId) return false;
  if (magScribeBeheren(session)) return true;
  try {
    const params = new URLSearchParams({
      select: "user_id",
      org_id: `eq.${session.orgId}`,
      user_id: `eq.${session.userId}`,
      limit: "1",
    });
    const response = await fetch(`${POSTGREST_URL}/${SCRIBE_GEMACHTIGDEN_TABEL}?${params}`, {
      headers: userRestHeaders(session),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const rijen = (await response.json()) as { user_id: string }[];
    return Array.isArray(rijen) && rijen.length > 0;
  } catch {
    return false;
  }
}

/**
 * Ledenlijst van de organisatie plus hun machtiging (§5.3, `/gemachtigden`).
 * Zelfde vorm als /api/org/members: lidmaatschappen en profielen via de
 * service-role, e-mailadressen per lid uit GoTrue (dat staat niet in
 * `profiles`). Een lid zonder leesbaar e-mailadres krijgt "—" in plaats van
 * dat de hele lijst faalt; de machtiging zelf komt altijd uit de database.
 */
export async function haalGemachtigden(orgId: string): Promise<ScribeGemachtigde[] | null> {
  const leden = await serviceGet<{ user_id: string; role: "org_admin" | "member" }[]>(
    `organization_members?org_id=eq.${orgId}&select=user_id,role&order=created_at.asc`,
  );
  if (!leden) return null;
  if (leden.length === 0) return [];
  const ids = leden.map((lid) => lid.user_id);
  const filter = `in.(${ids.join(",")})`;
  const [profielen, machtigingen] = await Promise.all([
    serviceGet<{ id: string; full_name: string }[]>(`profiles?select=id,full_name&id=${filter}`),
    serviceGet<{ user_id: string }[]>(
      `${SCRIBE_GEMACHTIGDEN_TABEL}?select=user_id&org_id=eq.${orgId}&user_id=${filter}`,
    ),
  ]);
  if (!machtigingen) return null;
  const naamPerId = new Map((profielen ?? []).map((profiel) => [profiel.id, profiel.full_name]));
  const gemachtigdeIds = new Set(machtigingen.map((rij) => rij.user_id));
  const emails = await haalLedenEmails(ids);
  return leden.map((lid) => ({
    userId: lid.user_id,
    email: emails.get(lid.user_id) ?? "—",
    naam: naamPerId.get(lid.user_id) ?? "",
    // org_admins zijn per definitie gemachtigd (magScribeBeheren) en daarom in
    // de UI niet uitvinkbaar.
    gemachtigd: lid.role === "org_admin" || gemachtigdeIds.has(lid.user_id),
    orgRole: lid.role,
  }));
}

/** E-mailadressen per lid; begrensde gelijktijdigheid, fail-soft per lid. */
async function haalLedenEmails(userIds: string[]): Promise<Map<string, string>> {
  const perId = new Map<string, string>();
  if (!scribeServiceBeschikbaar()) return perId;
  for (let start = 0; start < userIds.length; start += 10) {
    const groep = userIds.slice(start, start + 10);
    const records = await Promise.all(
      groep.map(async (userId) => {
        try {
          const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
            headers: scribeServiceHeaders(),
            cache: "no-store",
            signal: AbortSignal.timeout(8_000),
          });
          if (!response.ok) return null;
          return (await response.json()) as { id?: string; email?: string };
        } catch {
          return null;
        }
      }),
    );
    for (const record of records) {
      if (record?.id && typeof record.email === "string") perId.set(record.id, record.email);
    }
  }
  return perId;
}

// ── Beheerderslezing via de service-role (C3/C10) ──────────────────────────

/**
 * Consulten van de organisatie als METADATA, voor een org_admin (S12/V3).
 * `filters` draagt de lijstparameters (status, periode, paginering); de
 * kolomlijst en het org-filter worden hier gezet en zijn niet te overschrijven.
 * `null` = de service-role is niet beschikbaar of de lezing faalde — de route
 * behandelt dat als een fout, nooit als "geen consulten".
 */
export async function haalBeheerSessieRijen(
  orgId: string,
  filters: URLSearchParams,
): Promise<ScribeSessieMetadataRij[] | null> {
  const params = new URLSearchParams(filters);
  params.set("select", SESSIE_METADATA_SELECT);
  params.set("org_id", `eq.${orgId}`);
  return serviceGet<ScribeSessieMetadataRij[]>(`${SCRIBE_SESSIES_TABEL}?${params}`);
}

/** Eén consult als metadata voor een beheerder; `null` bij fout of onbekend. */
export async function haalBeheerSessieRij(orgId: string, sessieId: string): Promise<ScribeSessieMetadataRij | null> {
  const params = new URLSearchParams({ id: `eq.${sessieId}`, limit: "1" });
  const rijen = await haalBeheerSessieRijen(orgId, params);
  return Array.isArray(rijen) && rijen.length > 0 ? rijen[0] : null;
}

/**
 * Hoeveel GOEDGEKEURDE verslagversies heeft dit consult (C12/C34)? Uitsluitend
 * `select=id`: de beheerder krijgt een telling, nooit een sectie. `null`
 * betekent "onbekend" (geen service-role of een mislukte lezing) — de
 * aanroeper moet dan fail closed beslissen, niet 0 aannemen.
 */
export async function telGoedgekeurdeNotities(orgId: string, sessieId: string): Promise<number | null> {
  const params = new URLSearchParams({
    select: "id",
    sessie_id: `eq.${sessieId}`,
    org_id: `eq.${orgId}`,
    status: "eq.goedgekeurd",
    limit: "50",
  });
  const rijen = await serviceGet<{ id: string }[]>(`${SCRIBE_NOTITIES_TABEL}?${params}`);
  return Array.isArray(rijen) ? rijen.length : null;
}

// ── Instellingen ────────────────────────────────────────────────────────────

export interface ScribeInstellingenStand {
  instellingen: ScribeInstellingen;
  revision: number;
}

/**
 * Laatste instellingen-snapshot van de organisatie. Er is bewust geen
 * revisie 0 met "aan": een organisatie zonder snapshot heeft de module UIT
 * (EMPTY_SCRIBE_INSTELLINGEN) tot een beheerder haar expliciet activeert.
 */
export async function haalScribeInstellingen(session: CareonSession): Promise<ScribeInstellingenStand> {
  const params = new URLSearchParams({
    select: "state,revision",
    org_id: `eq.${session.orgId}`,
    order: "revision.desc",
    limit: "1",
  });
  const rijen = await scribeGet<{ state: unknown; revision: number }[]>(session, SCRIBE_INSTELLINGEN_TABEL, params);
  if (!Array.isArray(rijen) || rijen.length === 0) {
    return { instellingen: { ...EMPTY_SCRIBE_INSTELLINGEN }, revision: 0 };
  }
  return { instellingen: migreerScribeInstellingen(rijen[0].state), revision: rijen[0].revision };
}

// ── Sessies ─────────────────────────────────────────────────────────────────

export async function haalSessieRij(session: CareonSession, sessieId: string): Promise<ScribeSessieRij | null> {
  const params = new URLSearchParams({
    select: SESSIE_SELECT,
    id: `eq.${sessieId}`,
    org_id: `eq.${session.orgId}`,
    limit: "1",
  });
  const rijen = await scribeGet<ScribeSessieRij[]>(session, SCRIBE_SESSIES_TABEL, params);
  return Array.isArray(rijen) && rijen.length > 0 ? rijen[0] : null;
}

export async function haalSegmentRijen(session: CareonSession, sessieId: string): Promise<ScribeSegmentRij[]> {
  const params = new URLSearchParams({
    select: SEGMENT_SELECT,
    sessie_id: `eq.${sessieId}`,
    org_id: `eq.${session.orgId}`,
    order: "volgnummer.asc",
    limit: "900",
  });
  const rijen = await scribeGet<ScribeSegmentRij[]>(session, SCRIBE_SEGMENTEN_TABEL, params);
  return Array.isArray(rijen) ? rijen : [];
}

export async function haalStaatRij(session: CareonSession, sessieId: string): Promise<ScribeStaatRij | null> {
  const params = new URLSearchParams({
    select: STAAT_SELECT,
    sessie_id: `eq.${sessieId}`,
    org_id: `eq.${session.orgId}`,
    limit: "1",
  });
  const rijen = await scribeGet<ScribeStaatRij[]>(session, SCRIBE_STAAT_TABEL, params);
  return Array.isArray(rijen) && rijen.length > 0 ? rijen[0] : null;
}

/** Hoogste notitieversie; optioneel alleen de goedgekeurde (vrijgave). */
export async function haalLaatsteNotitieRij(
  session: CareonSession,
  sessieId: string,
  alleenGoedgekeurd = false,
): Promise<ScribeNotitieRij | null> {
  const params = new URLSearchParams({
    select: NOTITIE_SELECT,
    sessie_id: `eq.${sessieId}`,
    org_id: `eq.${session.orgId}`,
    order: "versie.desc",
    limit: "1",
  });
  if (alleenGoedgekeurd) params.set("status", "eq.goedgekeurd");
  const rijen = await scribeGet<ScribeNotitieRij[]>(session, SCRIBE_NOTITIES_TABEL, params);
  return Array.isArray(rijen) && rijen.length > 0 ? rijen[0] : null;
}

export async function haalTaakRijen(session: CareonSession, sessieId: string): Promise<ScribeTaakRij[]> {
  const params = new URLSearchParams({
    select: TAAK_SELECT,
    sessie_id: `eq.${sessieId}`,
    org_id: `eq.${session.orgId}`,
    order: "created_at.asc",
    limit: "200",
  });
  const rijen = await scribeGet<ScribeTaakRij[]>(session, SCRIBE_TAKEN_TABEL, params);
  return Array.isArray(rijen) ? rijen : [];
}

/** Sessie-id's die aan de aanvrager zijn vrijgegeven (offboarding, S12). */
export async function haalVrijgegevenSessieIds(session: CareonSession): Promise<Set<string>> {
  const params = new URLSearchParams({
    select: "sessie_id",
    org_id: `eq.${session.orgId}`,
    aan_user_id: `eq.${session.userId}`,
    limit: "500",
  });
  try {
    const rijen = await scribeGet<{ sessie_id: string }[]>(session, SCRIBE_VRIJGAVEN_TABEL, params);
    return new Set(Array.isArray(rijen) ? rijen.map((rij) => rij.sessie_id) : []);
  } catch {
    return new Set();
  }
}

/**
 * Filter voor een AI-transcriptcorrectie (C6/C8/C30).
 *
 * `correctie_bron=not.eq.behandelaar` lijkt te kloppen, maar PostgREST maakt
 * daar `NOT (correctie_bron = 'behandelaar')` van en dat is NULL voor een vers
 * segment — juist de rijen die een correctie moeten krijgen vielen dus buiten
 * de filter en de PATCH raakte nul rijen, zonder fout. Expliciet dus: nog niet
 * gecorrigeerd OF al door de AI gecorrigeerd, nooit over een correctie van de
 * behandelaar heen (S9). De bevriestrigger careon_scribe_segment_bevries blijft
 * de tweede verdedigingslinie.
 */
export function bouwCorrectieFilter(sessieId: string, orgId: string, volgnummer: number): URLSearchParams {
  const params = new URLSearchParams({
    sessie_id: `eq.${sessieId}`,
    org_id: `eq.${orgId}`,
    volgnummer: `eq.${volgnummer}`,
  });
  params.set("or", "(correctie_bron.is.null,correctie_bron.eq.ai)");
  return params;
}

/** Leesrol van de aanvrager op één consult (§5.3). */
export type ScribeLeesRol = "eigenaar" | "vrijgave" | "beheerder";

/**
 * Sinds C3/C10 levert een caller-JWT-lezing NOOIT meer de rij van een collega:
 * `haalSessieRij` geeft een beheerder alleen zijn eigen of een aan hem
 * vrijgegeven consult. De tak `beheerder` blijft staan als vangnet en voor de
 * routes die de metadata alsnog via de service-role ophalen.
 */
export function leesRolVoor(
  session: CareonSession,
  rij: ScribeSessieRij,
  vrijgegevenIds: Set<string>,
): ScribeLeesRol | null {
  if (rij.behandelaar_id === session.userId) return "eigenaar";
  if (vrijgegevenIds.has(rij.id)) return "vrijgave";
  if (magScribeBeheren(session)) return "beheerder";
  return null;
}

// ── Gate en foutcontract voor de routes ─────────────────────────────────────

export const SCRIBE_NIET_GEMACHTIGD = "Niet gemachtigd voor Careon AI.";

/**
 * Tweede laag van de API-gate (§2.3): ná requireCareonSession() moet élke
 * scribe-route ook de machtiging controleren. Geeft `null` bij toegang, en
 * anders het kant-en-klare 403-antwoord.
 */
export async function eisScribeMachtiging(session: CareonSession): Promise<NextResponse | null> {
  const gemachtigd = await isScribeGemachtigd(session);
  return gemachtigd ? null : NextResponse.json({ error: SCRIBE_NIET_GEMACHTIGD }, { status: 403 });
}

interface PostgrestFoutLichaam {
  code?: string;
  message?: string;
}

function leesFoutcode(detail: string): PostgrestFoutLichaam {
  try {
    const ontleed = JSON.parse(detail) as PostgrestFoutLichaam;
    return { code: ontleed.code, message: ontleed.message };
  } catch {
    return {};
  }
}

/**
 * Foutcontract gelijk aan facturatie: JSON `{ error }`. De RPC's werpen met
 * eigen SQLSTATE-codes en Nederlandse meldingen zonder consultinhoud; die
 * meldingen mogen dus rechtstreeks naar de behandelaar.
 */
export function scribeFoutAntwoord(error: unknown, standaard = "Supabase niet bereikbaar."): NextResponse {
  if (!(error instanceof ScribeOpslagFout)) {
    return NextResponse.json({ error: standaard }, { status: 502 });
  }
  const { code, message } = leesFoutcode(error.detail);
  if (code === "P0002") return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
  if (error.status === 503)
    return NextResponse.json({ error: "Deze bewerking is tijdelijk niet beschikbaar." }, { status: 503 });
  if (code === "42501" || error.status === 403) {
    return NextResponse.json({ error: message ?? "Geen toegang tot dit consult." }, { status: 403 });
  }
  if (code === "40001" || code === "55000" || code === "54000" || code === "23505" || error.status === 409) {
    return NextResponse.json({ error: message ?? "Deze bewerking kan nu niet." }, { status: 409 });
  }
  if (code === "23514" || code === "22023" || error.status === 400) {
    return NextResponse.json({ error: message ?? "Ongeldige aanvraag." }, { status: 400 });
  }
  return NextResponse.json({ error: standaard }, { status: 502 });
}

/**
 * Quota-scope `scribe` (§8): per behandelaar én per organisatie, beide via het
 * bestaande fail-closed pad van de assistent — nooit een eigen fetch op
 * careon_consume_assistant_quota. Valt de RPC uit, dan weigert de aanvraag.
 */
export async function eisScribeQuota(session: CareonSession): Promise<NextResponse | null> {
  const gebruiker = await enforceScribeRateLimit(authenticatedActorHash(session.userId));
  if (!gebruiker.allowed) {
    return NextResponse.json(
      { error: "Te veel aanvragen. Probeer het zo dadelijk opnieuw." },
      { status: 429, headers: { "Retry-After": String(Math.max(1, gebruiker.retryAfterSeconds)) } },
    );
  }
  const organisatie = await enforceScribeOrgRateLimit(session.orgId ?? "");
  if (!organisatie.allowed) {
    return NextResponse.json(
      { error: "Het dagbudget van uw organisatie voor Careon AI is bereikt." },
      { status: 429, headers: { "Retry-After": String(Math.max(1, organisatie.retryAfterSeconds)) } },
    );
  }
  return null;
}

// ── Analyseronde ────────────────────────────────────────────────────────────

export interface AnalyseRondeUitkomst {
  staat: KlinischeStaat;
  versie: number;
  laatsteSegment: number;
  bron: AnalyseBron;
  model: string | null;
  sprekers: { volgnummer: number; spreker: Spreker }[];
  correcties: { volgnummer: number; tekstGecorrigeerd: string }[];
  taken: ScribeTaak[];
  /** Schreef DEZE ronde de staat, of won een parallelle ronde de botsing (C35)? */
  bewaard: boolean;
  /** Aantal segmenten dat deze ronde daadwerkelijk verwerkte. */
  verwerkt: number;
  epdLijstBeoordeeld: boolean;
}

/**
 * Sleutel waarop een feit in de klinische staat wordt herkend — spiegel van
 * `sleutelVan` in klinische-staat.ts. Bewust hier herhaald en niet
 * geïmporteerd: die functie is privé aan de merge, en deze kopie dient één
 * doel — behandelaarsmutaties terugvinden ná de merge (N6/S7).
 */
function feitSleutel(feit: Record<string, unknown>, categorie: StaatCategorie): string {
  const tekst = (waarde: unknown) =>
    String(waarde ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  if (categorie === "medicatie") return `${tekst(feit.naam)}|${String(feit.gebruik ?? "")}`;
  if (categorie === "psychisch" || categorie === "leefstijl") {
    return `${tekst(feit.categorie)}|${tekst(feit.tekst)}`;
  }
  if (categorie === "acties") return `${tekst(feit.omschrijving)}|${String(feit.soort ?? "")}`;
  return tekst(feit.tekst);
}

/**
 * Bouwt de rij die de behandelaar invoert (N6). Per categorie een andere vorm;
 * velden die niet bij de categorie horen worden genegeerd, zodat een client die
 * te veel meestuurt geen wezensvreemde staat kan schrijven. `bron` blijft leeg:
 * dit feit komt niet uit een segment maar van de behandelaar zelf, en dat is
 * precies wat `doorBehandelaar: true` vastlegt.
 */
export function bouwStaatFeit(categorie: StaatCategorie, invoer: StaatFeitInvoer): Record<string, unknown> {
  const tekst = String(invoer.tekst).trim().slice(0, SCRIBE_LIMITS.feitTekst);
  const basis = { tekst, bron: [] as number[], ingetrokken: false, doorBehandelaar: true };
  if (categorie === "medicatie") {
    const naam = String(invoer.naam ?? invoer.tekst)
      .trim()
      .slice(0, SCRIBE_LIMITS.feitTekst);
    const dosering = typeof invoer.dosering === "string" ? invoer.dosering.trim().slice(0, 120) : null;
    return {
      ...basis,
      tekst: tekst.length > 0 ? tekst : naam,
      naam,
      dosering: dosering && dosering.length > 0 ? dosering : null,
      doseringen: dosering && dosering.length > 0 ? [{ waarde: dosering, bron: [] as number[] }] : [],
      gebruik: invoer.gebruik ?? "onbekend",
    };
  }
  if (categorie === "allergieen") return { ...basis, aard: invoer.aard ?? "onbekend" };
  if (categorie === "leefstijl" || categorie === "psychisch") {
    return {
      ...basis,
      categorie: String(invoer.categorie ?? "overig")
        .trim()
        .slice(0, 120),
    };
  }
  if (categorie === "acties") {
    const omschrijving = String(invoer.omschrijving ?? invoer.tekst)
      .trim()
      .slice(0, SCRIBE_LIMITS.taakOmschrijving);
    return { ...basis, tekst: tekst.length > 0 ? tekst : omschrijving, omschrijving, soort: invoer.soort ?? "overig" };
  }
  return basis;
}

/**
 * Eén correctie van de behandelaar op de klinische staat (N6/S7).
 *
 * `toevoegen` zet een bestaande rij terug op niet-ingetrokken of voegt een
 * nieuwe rij toe; `intrekken` haalt de rij door. Beide markeren de rij met
 * `doorBehandelaar: true`, waarna bewaarBehandelaarsfeiten() haar door elke
 * latere analysepas heen tilt. `null` betekent: dit feit staat niet in de
 * staat, dus er valt niets in te trekken.
 */
export function pasStaatMutatieToe(
  staat: KlinischeStaat,
  categorie: StaatCategorie,
  actie: "toevoegen" | "intrekken",
  invoer: StaatFeitInvoer,
): KlinischeStaat | null {
  const nieuweRij = bouwStaatFeit(categorie, invoer);
  const sleutel = feitSleutel(nieuweRij, categorie);
  const rijen = [...(staat[categorie] as unknown as Record<string, unknown>[])];
  const positie = rijen.findIndex((rij) => feitSleutel(rij, categorie) === sleutel);
  if (actie === "intrekken") {
    if (positie < 0) return null;
    rijen[positie] = { ...rijen[positie], ingetrokken: true, doorBehandelaar: true };
  } else if (positie < 0) {
    rijen.push(nieuweRij);
  } else {
    rijen[positie] = { ...rijen[positie], ingetrokken: false, doorBehandelaar: true };
  }
  const uitkomst: KlinischeStaat = { ...staat };
  (uitkomst[categorie] as unknown[]) = rijen;
  return uitkomst;
}

/**
 * S7/N6 — een analysepas draait NOOIT een mutatie van de behandelaar terug.
 *
 * `mergeKlinischeStaat` is additief voor de veiligheidskritische categorieën,
 * maar vervangt de overige lijsten met de nieuwe extractie: een feit dat de
 * behandelaar zelf toevoegde en dat in dit gesprek niet opnieuw viel, zou dan
 * verdwijnen, en een intrekking zou als "gewoon feit" terugkomen. Deze
 * trechter zet daarom na elke merge de rijen met `doorBehandelaar: true` terug
 * zoals de behandelaar ze achterliet — bestaande rijen worden vervangen,
 * ontbrekende rijen aangevuld.
 *
 * Staat bewust hier en niet in de merge zelf: dit is de enige plek waar de
 * vorige, opgeslagen staat en de uitkomst van een pas samenkomen.
 */
export function bewaarBehandelaarsfeiten(vorige: KlinischeStaat, nieuw: KlinischeStaat): KlinischeStaat {
  const uitkomst: KlinischeStaat = { ...nieuw };
  for (const categorie of STAAT_CATEGORIEEN) {
    const eigen = (vorige[categorie] as { doorBehandelaar?: boolean }[]).filter((rij) => rij.doorBehandelaar === true);
    if (eigen.length === 0) continue;
    const perSleutel = new Map(eigen.map((rij) => [feitSleutel(rij as Record<string, unknown>, categorie), rij]));
    const gezien = new Set<string>();
    const rijen = (nieuw[categorie] as { doorBehandelaar?: boolean }[]).map((rij) => {
      const sleutel = feitSleutel(rij as Record<string, unknown>, categorie);
      const behandelaarsrij = perSleutel.get(sleutel);
      if (!behandelaarsrij) return rij;
      gezien.add(sleutel);
      return behandelaarsrij;
    });
    for (const [sleutel, rij] of perSleutel) {
      if (!gezien.has(sleutel)) rijen.push(rij);
    }
    // De categorieën van STAAT_CATEGORIEEN zijn stuk voor stuk Feit-lijsten;
    // de vorm blijft gelijk, alleen de herkomst van de rijen verschilt.
    (uitkomst[categorie] as unknown[]) = rijen;
  }
  return uitkomst;
}

/** Zorgt dat er een staat-rij is; een consult zonder rij analyseert niet. */
async function zorgVoorStaatRij(session: CareonSession, sessieRij: ScribeSessieRij): Promise<ScribeStaatRij> {
  const bestaand = await haalStaatRij(session, sessieRij.id);
  if (bestaand) return bestaand;
  try {
    return await scribeRpc<ScribeStaatRij>(session, "careon_scribe_staat_bewaren", {
      p_sessie: sessieRij.id,
      p_versie: 0,
      p_staat: legeKlinischeStaat(),
    });
  } catch (error) {
    // Another analysis may have created the empty row first. A terminal
    // session must never recreate it: the RPC checks that under the parent lock.
    const vers = await haalStaatRij(session, sessieRij.id);
    if (vers) return vers;
    throw error;
  }
}

/**
 * Eén analyseronde (§5.3): nieuwe segmenten → staat, sprekers, correcties en
 * taken. Wordt zowel door POST /analyse als door het afronden (PATCH status)
 * gebruikt; het afronden herhaalt haar tot de staat het transcript heeft
 * ingehaald.
 *
 * Vier bewuste keuzes:
 *   * De AI-laag draait alleen wanneer de ORGANISATIE haar heeft aangezet
 *     (N19, `instellingen.aiAnalyseAan`) naast de platformvlag; anders is de
 *     ronde volledig deterministisch en verlaat er geen fragment het platform.
 *   * Een correctie van de behandelaar wordt NOOIT overschreven (S9): de PATCH
 *     filtert expliciet op `correctie_bron=is.null` of `eq.ai`.
 *   * Een mutatie van de behandelaar in de klinische staat overleeft elke
 *     latere pas (N6/S7) — bewaarBehandelaarsfeiten() draait ná de merge.
 *   * De staat-update is optimistisch op `versie`; bij een botsing wordt de
 *     ronde één keer opnieuw gedraaid op de verse staat, en botst het dan nog
 *     steeds, dan wordt de OPGESLAGEN staat teruggelezen — nooit de eigen,
 *     niet-bewaarde uitkomst (C35).
 */
export async function voerScribeAnalyseUit(
  session: CareonSession,
  sessieRij: ScribeSessieRij,
  signal: AbortSignal,
  herhaling = 0,
): Promise<AnalyseRondeUitkomst> {
  const { analyseerSegmenten } = await import("./agent.server");
  const { extraheerTaken } = await import("./deterministisch");
  const { instellingen } = await haalScribeInstellingen(session);

  const staatRij = await zorgVoorStaatRij(session, sessieRij);
  const huidig = staatVanRij(staatRij);
  const segmentRijen = await haalSegmentRijen(session, sessieRij.id);
  const segmenten = segmentRijen.map(segmentVanRij);
  const nieuweSegmenten = segmenten
    .filter((segment) => segment.volgnummer > huidig.laatsteSegment)
    .slice(0, SCRIBE_LIMITS.analyseSegmenten);

  if (nieuweSegmenten.length === 0) {
    return {
      staat: huidig.staat,
      versie: huidig.versie,
      laatsteSegment: huidig.laatsteSegment,
      bron: huidig.bron,
      model: huidig.model,
      sprekers: [],
      correcties: [],
      taken: (await haalTaakRijen(session, sessieRij.id)).map(taakVanRij),
      bewaard: true,
      verwerkt: 0,
      epdLijstBeoordeeld: huidig.epdLijstBeoordeeld,
    };
  }

  // A clinician correction rewinds the database cursor to zero. Rebuild machine
  // facts from that corrected source instead of carrying disproven facts forward.
  const analyseStart =
    huidig.verouderd && huidig.laatsteSegment === 0 ? heranalyseStartStaat(huidig.staat) : huidig.staat;
  const ronde = await analyseerSegmenten({
    staat: analyseStart,
    nieuweSegmenten,
    contextSegmenten: segmenten.filter((segment) => segment.volgnummer <= huidig.laatsteSegment),
    consultType: sessieRij.consult_type,
    taal: sessieRij.taal,
    actorHash: authenticatedActorHash(session.userId),
    orgId: sessieRij.org_id,
    userId: session.userId,
    aiToegestaan: instellingen.aiAnalyseAan,
    signal,
  });
  // N6/S7 — wat de behandelaar zelf vastlegde of introk, blijft staan.
  const uitkomst = { ...ronde, staat: bewaarBehandelaarsfeiten(huidig.staat, ronde.staat) };

  const laatsteSegment = nieuweSegmenten[nieuweSegmenten.length - 1].volgnummer;
  let bijgewerkt: ScribeStaatRij;
  try {
    bijgewerkt = await scribeRpc<ScribeStaatRij>(session, "careon_scribe_analyse_bewaren", {
      p_sessie: sessieRij.id,
      p_versie: huidig.versie,
      p_staat: uitkomst.staat,
      p_laatste: laatsteSegment,
      p_bron: uitkomst.bron,
      p_model: uitkomst.model,
      p_sprekers: uitkomst.sprekers,
      p_correcties: uitkomst.correcties,
      p_taken: extraheerTaken(uitkomst.staat).map((actie) => ({
        ...actie,
        omschrijving: actie.omschrijving.slice(0, SCRIBE_LIMITS.taakOmschrijving),
      })),
    });
  } catch (error) {
    if (
      error instanceof ScribeOpslagFout &&
      (error.status === 409 || error.detail.includes("55000")) &&
      herhaling === 0
    ) {
      const vers = await haalSessieRij(session, sessieRij.id);
      if (vers && (vers.status === "actief" || vers.status === "afgerond")) {
        return voerScribeAnalyseUit(session, vers, signal, 1);
      }
    }
    throw error;
  }
  const definitief = staatVanRij(bijgewerkt);
  return {
    staat: definitief.staat,
    versie: definitief.versie,
    laatsteSegment: definitief.laatsteSegment,
    bron: definitief.bron,
    model: definitief.model,
    sprekers: uitkomst.sprekers,
    correcties: uitkomst.correcties,
    taken: (await haalTaakRijen(session, sessieRij.id)).map(taakVanRij),
    bewaard: true,
    verwerkt: nieuweSegmenten.length,
    epdLijstBeoordeeld: definitief.epdLijstBeoordeeld,
  };
}
