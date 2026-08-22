import { isFacturatieInstellingen } from "@/lib/careon-facturatie/types";
import { isHrState } from "@/lib/careon-hr/types";
import { isMiddelenState } from "@/lib/careon-middelen/types";

// Datalaag voor het beheerdashboard (handoff 13, fase 4). Uitsluitend
// aangeroepen vanuit (admin)-servercomponenten en /api/admin-routes NADAT de
// superadmin-check is gedaan — hier wordt met de service-role gelezen (RLS
// geldt niet), want beheer is per definitie cross-org.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Geen HTTP-status beschikbaar: time-out, DNS- of verbindingsfout. */
const NETWERKFOUT = 0;
/** Supabase kapt PostgREST-antwoorden af op max-rows (standaard 1.000). */
const PAGINA_GROOTTE = 1000;
/** Bovengrens tegen runaway-loops bij platformbrede lijsten. */
const MAX_PAGINAS = 25;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function adminConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

function headers(extra?: HeadersInit): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * Elke lees-actie zegt expliciet of ze gelukt is. Een mislukte read gaf hier
 * vroeger `null` terug en werd door elke pagina als "geen data" gerenderd —
 * een Supabase-storing was dan niet te onderscheiden van een leeg platform,
 * juist op het scherm dat tijdens zo'n storing telt.
 */
export type AdminResult<T> = { ok: true; data: T } | { ok: false; status: number };

/** True zodra één van de meegegeven reads mislukte (voor één foutmelding per kaart). */
export function adminReadFailed(...results: AdminResult<unknown>[]): boolean {
  return results.some((result) => !result.ok);
}

/** Status van de eerste mislukte read, of undefined als alles lukte. */
export function adminFailureStatus(...results: AdminResult<unknown>[]): number | undefined {
  for (const result of results) {
    if (!result.ok) return result.status;
  }
  return undefined;
}

/** Data of een lege fallback — voor secundaire reads die een pagina niet mogen blokkeren. */
export function adminDataOr<T>(result: AdminResult<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}

export function isAdminUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** `YYYY-MM-DD` uit een filterveld; alles anders wordt genegeerd i.p.v. als 400 te eindigen. */
export function adminDateFilter(value: string | undefined | null): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? undefined : value;
}

/** Amsterdams UTC-offset in uren op het gegeven instant (+1 CET / +2 CEST). */
function amsterdamOffsetUren(op: Date): number {
  const uurInAmsterdam = Number(
    new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", hour12: false }).format(op),
  );
  return (uurInAmsterdam - op.getUTCHours() + 24) % 24;
}

/**
 * UTC-instant van middernacht Europe/Amsterdam op deze kalenderdag (plus
 * optioneel dagen erbij). De datumfilters sneden eerder op UTC-dagen, waardoor
 * "alles van 29-07" de eerste twee Nederlandse uren van die dag miste en de
 * eerste twee van de dag erna meenam — de beheerder leest Amsterdamse dagen.
 *
 * Tweepassig vast punt: de eerste gok leest het offset af op 12:00 UTC, maar
 * op de twee DST-overgangsdagen verschilt het offset van 12:00 UTC met dat van
 * middernacht zelf — de tweede pas leest het offset opnieuw af op de gok en
 * corrigeert precies dat uur. Buiten die twee dagen convergeert pas 1 al.
 */
export function amsterdamDagGrens(datum: string, dagenErbij = 0): string {
  const utcMiddernacht = new Date(`${datum}T00:00:00Z`);
  utcMiddernacht.setUTCDate(utcMiddernacht.getUTCDate() + dagenErbij);
  const eersteGok =
    utcMiddernacht.getTime() - amsterdamOffsetUren(new Date(utcMiddernacht.getTime() + 12 * 3_600_000)) * 3_600_000;
  const grens = utcMiddernacht.getTime() - amsterdamOffsetUren(new Date(eersteGok)) * 3_600_000;
  return new Date(grens).toISOString();
}

async function restGet<T>(path: string): Promise<AdminResult<T>> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, status: NETWERKFOUT };
  }
}

/**
 * Volledige lijst in pagina's: platformbrede lijsten (profielen, lidmaatschappen)
 * groeien voorbij max-rows en een half antwoord is hier een fout antwoord —
 * ontbrekende rijen renderen als "—" of als een verkeerde rol. Vereist een
 * `order` die tot op de rij uniek is: rijen uit dezelfde transactie delen hun
 * `created_at`, en bij gelijke sorteersleutels mag Postgres per query een
 * andere volgorde kiezen — dan verschuift een rij tussen twee pagina's door en
 * verdwijnt hij uit het resultaat.
 */
async function restGetAll<T>(path: string): Promise<AdminResult<T[]>> {
  const rows: T[] = [];
  const scheiding = path.includes("?") ? "&" : "?";
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const result = await restGet<T[]>(`${path}${scheiding}limit=${PAGINA_GROOTTE}&offset=${pagina * PAGINA_GROOTTE}`);
    if (!result.ok) return result;
    rows.push(...result.data);
    if (result.data.length < PAGINA_GROOTTE) break;
  }
  return { ok: true, data: rows };
}

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface AdminMembership {
  org_id: string;
  user_id: string;
  role: "org_admin" | "member";
  created_at?: string;
}

export interface AdminProfile {
  id: string;
  full_name: string;
  created_at: string;
}

export interface AdminAuthUser {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
}

export interface AdminAuditEvent {
  id: number;
  org_id: string | null;
  user_id: string | null;
  action: string;
  resource: string | null;
  resource_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface AdminAssistantEvent {
  id: number;
  event_type: string;
  status_code: number | null;
  tool_names: string[];
  org_id: string | null;
  user_id: string | null;
  created_at: string;
}

export interface AdminThread {
  user_id: string;
  id: string;
  org_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AdminImportRun {
  id: string;
  file_name: string;
  imported_at: string;
  created_at: string;
  total_rows: number;
}

export function listOrganizations(): Promise<AdminResult<AdminOrganization[]>> {
  return restGetAll<AdminOrganization>("organizations?select=id,name,slug,created_at&order=created_at.asc,id.asc");
}

export function organizationById(orgId: string): Promise<AdminResult<AdminOrganization[]>> {
  return restGet<AdminOrganization[]>(
    `organizations?select=id,name,slug,created_at&id=eq.${encodeURIComponent(orgId)}&limit=1`,
  );
}

export function listMemberships(orgId?: string): Promise<AdminResult<AdminMembership[]>> {
  const scope = orgId ? `&org_id=eq.${encodeURIComponent(orgId)}` : "";
  return restGetAll<AdminMembership>(
    `organization_members?select=org_id,user_id,role,created_at&order=created_at.asc,org_id.asc,user_id.asc${scope}`,
  );
}

export function listProfiles(): Promise<AdminResult<AdminProfile[]>> {
  return restGetAll<AdminProfile>("profiles?select=id,full_name,created_at&order=created_at.asc,id.asc");
}

export function listPlatformAdmins(): Promise<AdminResult<{ user_id: string }[]>> {
  return restGetAll<{ user_id: string }>("platform_admins?select=user_id&order=created_at.asc,user_id.asc");
}

/**
 * Alle auth-accounts, gepagineerd — dezelfde correctie als in
 * /api/org/members: één pagina van 200 laat accounts stilzwijgend verdwijnen
 * uit de gebruikerslijst en toont hun audit-rijen en gesprekken als een kale
 * UUID. Cap van 25 pagina's (5.000 accounts) tegen runaway-loops.
 */
export async function listAuthUsers(): Promise<AdminResult<AdminAuthUser[]>> {
  const users: AdminAuthUser[] = [];
  const gezien = new Set<string>();
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
    let batch: AdminAuthUser[];
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${pagina}&per_page=200`, {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return { ok: false, status: response.status };
      const payload = (await response.json()) as { users?: AdminAuthUser[] };
      batch = payload.users ?? [];
    } catch {
      return { ok: false, status: NETWERKFOUT };
    }
    for (const user of batch) {
      if (gezien.has(user.id)) continue;
      gezien.add(user.id);
      users.push(user);
    }
    // Pas stoppen bij een lége pagina: GoTrue mag per_page stilzwijgend
    // clampen, dus "minder dan gevraagd" is geen betrouwbaar eindsignaal.
    if (batch.length === 0) break;
  }
  return { ok: true, data: users };
}

export interface AdminAuditFilters {
  orgId?: string;
  userId?: string;
  action?: string;
  /** Inclusief, `YYYY-MM-DD` — begrensd op Amsterdamse kalenderdagen. */
  vanaf?: string;
  tot?: string;
  limit?: number;
  offset?: number;
}

export function recentAuditEvents(filters?: AdminAuditFilters): Promise<AdminResult<AdminAuditEvent[]>> {
  const params = new URLSearchParams({
    select: "id,org_id,user_id,action,resource,resource_id,detail,created_at",
    // `id` als tweede sleutel: audit-rijen uit één aanvraag delen hun
    // `created_at` tot op de microseconde, en met offset-paginering mag
    // Postgres die gelijke rijen per query anders ordenen — een rij schuift dan
    // over de paginagrens en verdwijnt (of verschijnt twee keer) in het logboek.
    order: "created_at.desc,id.desc",
    limit: String(Math.min(200, filters?.limit ?? 100)),
  });
  if (filters?.offset) params.set("offset", String(Math.max(0, filters.offset)));
  if (filters?.orgId) params.set("org_id", `eq.${filters.orgId}`);
  if (filters?.userId) params.set("user_id", `eq.${filters.userId}`);
  if (filters?.action) params.set("action", `eq.${filters.action}`);
  // Herhaalde kolomfilters combineert PostgREST met AND, dus append i.p.v. set.
  if (filters?.vanaf) params.append("created_at", `gte.${amsterdamDagGrens(filters.vanaf)}`);
  if (filters?.tot) params.append("created_at", `lt.${amsterdamDagGrens(filters.tot, 1)}`);
  return restGet<AdminAuditEvent[]>(`audit_events?${params}`);
}

/**
 * Alle acties die de applicatie zelf wegschrijft (letterlijk of via een
 * template als `admin.user.${action}` / `org.user.${action}`). De filterlijst
 * hing eerder volledig aan een venster van de nieuwste 1.000 rijen, waardoor
 * zeldzame of oudere acties — precies die waarnaar een onderzoek zoekt — niet
 * meer selecteerbaar waren zodra ze uit dat venster vielen.
 */
const BEKENDE_AUDIT_ACTIES: readonly string[] = [
  "admin.chat.view",
  "admin.rate_limit.clear",
  "admin.registratie.restore",
  "admin.user.set_email",
  "admin.user.set_name",
  "admin.user.set_name_partial",
  "maintenance.prune",
  "maintenance.prune_failed",
  "tgc_worker.available",
  "tgc_worker.offline",
  "tgc_worker.unknown",
  "admin.org.create",
  "admin.org.delete",
  "admin.org.rename",
  "admin.platform_admin.grant",
  "admin.platform_admin.revoke",
  "admin.user.add_membership",
  "admin.user.ban",
  "admin.user.create",
  "admin.user.delete",
  "admin.user.remove_membership",
  "admin.user.reset_password",
  "admin.user.rollback_failed",
  "admin.user.set_role",
  "admin.user.unban",
  "assistant.thread.create",
  "assistant.thread.delete",
  "assistant.thread.update",
  "auth.login",
  "auth.login_blocked",
  "auth.login_failed",
  "auth.logout",
  "auth.logout_failed",
  "auth.password.set_via_link",
  "auth.set_password_blocked",
  "org.user.ban",
  "org.user.create",
  "org.user.invite_link",
  "org.user.reset_password",
  "org.user.rollback_failed",
  "org.user.unban",
  "production.import",
  "state.append",
  "state.append_denied",
];

/**
 * Actielijst voor het filter: de vaste enumeratie hierboven als ruggengraat,
 * aangevuld met wat een venster van de nieuwste rijen nog kent (acties van een
 * oudere codeversie) én met de actie die de beheerder al in de URL heeft staan
 * — anders toont het formulier "Alle acties" terwijl de tabel gefilterd is, en
 * laat de volgende submit dat filter stilzwijgend vallen. Faalt nooit hard:
 * zonder venster is de vaste lijst nog steeds een werkend filter.
 */
export async function auditActions(huidige?: string): Promise<AdminResult<string[]>> {
  const acties = new Set<string>(BEKENDE_AUDIT_ACTIES);
  if (huidige) acties.add(huidige);
  const venster = await restGet<{ action: string }[]>("audit_events?select=action&order=created_at.desc&limit=1000");
  if (venster.ok) {
    for (const row of venster.data) acties.add(row.action);
  }
  return { ok: true, data: [...acties].sort() };
}

export function recentAssistantEvents(limit = 50): Promise<AdminResult<AdminAssistantEvent[]>> {
  return restGet<AdminAssistantEvent[]>(
    `careon_assistant_events?select=id,event_type,status_code,tool_names,org_id,user_id,created_at&order=created_at.desc&limit=${Math.min(200, limit)}`,
  );
}

export function listAllThreads(filters?: {
  orgId?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminResult<AdminThread[]>> {
  const params = new URLSearchParams({
    select: "user_id,id,org_id,title,status,created_at,updated_at",
    // Aangevuld met de volledige primaire sleutel (user_id, id): gesprekken die
    // in dezelfde seconde zijn bijgewerkt hebben anders geen vaste volgorde en
    // wisselen bij offset-paginering van pagina.
    order: "updated_at.desc,user_id.desc,id.desc",
    limit: String(Math.min(200, filters?.limit ?? 50)),
  });
  if (filters?.offset) params.set("offset", String(Math.max(0, filters.offset)));
  if (filters?.orgId) params.set("org_id", `eq.${filters.orgId}`);
  if (filters?.userId) params.set("user_id", `eq.${filters.userId}`);
  return restGet<AdminThread[]>(`assistant_threads?${params}`);
}

/**
 * Org/gebruiker-combinaties met gesprekken — de filterniveaus mogen niet uit
 * de zichtbare pagina komen, anders verdwijnt een gebruiker uit het filter
 * zodra zijn gesprekken buiten de eerste pagina vallen.
 */
export function threadFacets(): Promise<AdminResult<{ user_id: string; org_id: string }[]>> {
  return restGet<{ user_id: string; org_id: string }[]>(
    "assistant_threads?select=user_id,org_id&order=updated_at.desc&limit=1000",
  );
}

export function threadById(userId: string, threadId: string): Promise<AdminResult<AdminThread[]>> {
  const params = new URLSearchParams({
    select: "user_id,id,org_id,title,status,created_at,updated_at",
    user_id: `eq.${userId}`,
    id: `eq.${threadId}`,
    limit: "1",
  });
  return restGet<AdminThread[]>(`assistant_threads?${params}`);
}

/** Bovengrens per gesprek; de lezer krijgt te zien wanneer hij geraakt is. */
export const ADMIN_BERICHT_LIMIET = 500;

/**
 * De nieuwste berichten, in leesvolgorde teruggedraaid. Aflopend ophalen en
 * omdraaien is niet hetzelfde als oplopend afkappen: bij een lang gesprek is
 * juist het recente deel het antwoord waarop de gebruiker handelde.
 */
export async function threadMessages(userId: string, threadId: string): Promise<AdminResult<{ payload: unknown }[]>> {
  const params = new URLSearchParams({
    select: "payload,created_at",
    user_id: `eq.${userId}`,
    thread_id: `eq.${threadId}`,
    order: "id.desc",
    limit: String(ADMIN_BERICHT_LIMIET),
  });
  const result = await restGet<{ payload: unknown }[]>(`assistant_messages?${params}`);
  if (!result.ok) return result;
  return { ok: true, data: [...result.data].reverse() };
}

export interface AdminRegistratie {
  table: string;
  label: string;
  tijdKolom: "saved_at" | "created_at";
  heeftRevisie: boolean;
}

/**
 * De zes registraties uit spec §8 plus de facturatie-instellingen (handoff
 * 15). `revision` bestaat alléén op middelen (migratie 0006), HR (0007) en
 * facturatie-instellingen (0020) — het onvoorwaardelijk meeselecteren gaf
 * PostgREST-400 en dus permanent "—" voor agenda/toeslagen/declaraties/
 * verwijzers.
 */
export const ADMIN_REGISTRATIES: readonly AdminRegistratie[] = [
  { table: "careon_middelen_state", label: "Middelen", tijdKolom: "saved_at", heeftRevisie: true },
  { table: "careon_hr_state", label: "HR", tijdKolom: "saved_at", heeftRevisie: true },
  { table: "careon_agenda_state", label: "Agenda", tijdKolom: "saved_at", heeftRevisie: false },
  { table: "careon_toeslagen_state", label: "Toeslagen", tijdKolom: "saved_at", heeftRevisie: false },
  { table: "careon_declaraties_state", label: "Declaraties", tijdKolom: "saved_at", heeftRevisie: false },
  { table: "careon_verwijzers_state", label: "Verwijzers", tijdKolom: "saved_at", heeftRevisie: false },
  {
    table: "careon_facturatie_instellingen",
    label: "Facturatie-instellingen",
    tijdKolom: "saved_at",
    heeftRevisie: true,
  },
];

/**
 * EPD-imports staan naast de registraties. Bewust `created_at` (servertijd,
 * migratie 0017) en niet `imported_at`: dat laatste is de klok van de
 * importerende browser, en één werkstation met een scheve klok zette de
 * nieuwste import onder oudere runs — precies op de plek waar support "is de
 * nieuwste export binnen?" beantwoordt.
 */
export const ADMIN_IMPORT_RUNS: AdminRegistratie = {
  table: "careon_import_runs",
  label: "EPD-import",
  tijdKolom: "created_at",
  heeftRevisie: false,
};

export interface AdminStand {
  savedAt: string;
  revision: number | null;
}

function standKolommen(bron: AdminRegistratie): string {
  return ["org_id", bron.tijdKolom, ...(bron.heeftRevisie ? ["revision"] : [])].join(",");
}

function leesStand(bron: AdminRegistratie, row: Record<string, unknown>): AdminStand {
  const revision = bron.heeftRevisie && typeof row.revision === "number" ? row.revision : null;
  return { savedAt: String(row[bron.tijdKolom] ?? ""), revision };
}

/**
 * Nieuwste revisie + tijdstip per registratietabel, per organisatie: één
 * limit-1-query per organisatie, parallel. De eerdere aanpak — één globaal
 * venster van de nieuwste 1.000 rijen — liet een rustige organisatie uit beeld
 * vallen zodra een drukke tenant dat venster vulde: haar kolom toonde dan "—"
 * (nooit opgeslagen) terwijl de detailpagina een echte datum liet zien. Bij N
 * organisaties is dit N kleine reads per tabel; dat blijft ruim binnen de maat
 * tot ver voorbij het verwachte aantal tenants.
 */
export async function latestStatePerOrg(
  bron: AdminRegistratie,
  orgIds: readonly string[],
): Promise<AdminResult<Map<string, AdminStand>>> {
  const map = new Map<string, AdminStand>();
  // In plukken van 8: de lijstpagina roept dit voor 7 bronnen tegelijk aan, en
  // ongelimiteerd zou dat bij veel tenants tientallen gelijktijdige reads per
  // render worden. Eén mislukte read faalt bewust de hele kolom: "—" voor een
  // organisatie waarvan de read faalde zou als "nooit opgeslagen" lezen.
  for (let start = 0; start < orgIds.length; start += 8) {
    const pluk = orgIds.slice(start, start + 8);
    const resultaten = await Promise.all(pluk.map((orgId) => latestStateForOrg(bron, orgId)));
    for (const [index, resultaat] of resultaten.entries()) {
      if (!resultaat.ok) return resultaat;
      if (resultaat.data) map.set(pluk[index], resultaat.data);
    }
  }
  return { ok: true, data: map };
}

/** Nieuwste stand van één registratie binnen één organisatie. */
export async function latestStateForOrg(
  bron: AdminRegistratie,
  orgId: string,
): Promise<AdminResult<AdminStand | null>> {
  const result = await restGet<Record<string, unknown>[]>(
    `${bron.table}?select=${standKolommen(bron)}&org_id=eq.${encodeURIComponent(orgId)}&order=${bron.tijdKolom}.desc&limit=1`,
  );
  if (!result.ok) return result;
  const row = result.data[0];
  return { ok: true, data: row ? leesStand(bron, row) : null };
}

export function importRunsForOrg(orgId: string, limit = 10): Promise<AdminResult<AdminImportRun[]>> {
  // Gesorteerd op servertijd (created_at, 0017) — imported_at is de klok van
  // de importerende browser en is als sorteersleutel onbetrouwbaar.
  return restGet<AdminImportRun[]>(
    `careon_import_runs?select=id,file_name,imported_at,created_at,total_rows&org_id=eq.${encodeURIComponent(orgId)}&order=created_at.desc&limit=${Math.min(50, limit)}`,
  );
}

/**
 * Werkelijk aantal opgeslagen records per import-run. Een run waarvan de
 * upload halverwege afbrak staat wél in careon_import_runs maar wordt door de
 * productie-GET genegeerd (volledigheidscontrole) — zonder deze telling toonde
 * beheer zo'n mislukte import als de nieuwste geslaagde.
 */
export async function importRunRecordCounts(
  runIds: readonly string[],
): Promise<AdminResult<Map<string, number | null>>> {
  const tellingen = await Promise.all(
    runIds.map((runId) => countRows(`careon_import_records?run_id=eq.${encodeURIComponent(runId)}&select=id`)),
  );
  const map = new Map<string, number | null>();
  for (const [index, telling] of tellingen.entries()) {
    if (!telling.ok) return telling;
    // null = de Content-Range-header gaf geen telling; dat mag niet als "0
    // rijen" (en dus als vals "onvolledig"-label) doorgaan.
    map.set(runIds[index], telling.data);
  }
  return { ok: true, data: map };
}

/**
 * Alles wat een organisatie vasthoudt. Verwijderen mag alleen als ze leeg is.
 * De registraties, imports en gesprekken verwijzen zónder cascade naar
 * organizations (0010/0011), dus daar eindigt een DELETE op een gevulde
 * organisatie hoe dan ook in een sleutelconflict. Lidmaatschappen zijn de
 * uitzondering: `organization_members.org_id` cascadeert wél (0009), dus juist
 * daarvoor is deze controle het enige vangnet — zonder haar zou het verwijderen
 * van een organisatie stilzwijgend alle leden loskoppelen, en een gebruiker
 * zonder lidmaatschap komt nergens meer binnen.
 */
const ORG_AFHANKELIJKHEDEN: readonly { table: string; label: string }[] = [
  { table: "organization_members", label: "leden" },
  { table: "assistant_threads", label: "AI-gesprekken" },
  // Beide verwijzen óók zonder cascade naar organizations (0010/0011): zonder
  // deze twee passeerde een organisatie die ooit de assistent gebruikte de
  // leegte-controle en strandde de DELETE alsnog op een sleutelconflict — als
  // kale 502 zonder oorzaak.
  { table: "assistant_messages", label: "AI-berichten" },
  { table: "careon_assistant_events", label: "assistent-telemetrie" },
  { table: ADMIN_IMPORT_RUNS.table, label: ADMIN_IMPORT_RUNS.label },
  // Facturatie (handoff 15): de instellingen komen al mee via
  // ADMIN_REGISTRATIES hieronder; deze drie tabellen verwijzen zonder cascade
  // naar organizations, dus een organisatie met facturen kan niet weg.
  { table: "careon_facturatie_contacten", label: "facturatie-contacten" },
  { table: "careon_facturatie_facturen", label: "facturen" },
  { table: "careon_facturatie_nummers", label: "factuurnummers" },
  { table: "careon_facturatie_maillog", label: "factuur-maillog" },
  ...ADMIN_REGISTRATIES.map((bron) => ({ table: bron.table, label: bron.label })),
];

/** Label van de eerste registratie die nog rijen heeft, of null als de organisatie leeg is. */
export async function eersteOrgAfhankelijkheid(orgId: string): Promise<AdminResult<string | null>> {
  const scope = `org_id=eq.${encodeURIComponent(orgId)}&select=org_id&limit=1`;
  const resultaten = await Promise.all(
    ORG_AFHANKELIJKHEDEN.map((afhankelijkheid) => restGet<unknown[]>(`${afhankelijkheid.table}?${scope}`)),
  );
  for (const [index, resultaat] of resultaten.entries()) {
    if (!resultaat.ok) return resultaat;
    if (resultaat.data.length > 0) return { ok: true, data: ORG_AFHANKELIJKHEDEN[index].label };
  }
  return { ok: true, data: null };
}

export interface AdminRevisie {
  id: string;
  saved_at: string;
  revision: number;
  change_source: string | null;
  change_summary: Record<string, unknown> | null;
}

/**
 * Registraties die te herstellen zijn: ze hebben een revisiekolom én een
 * typeguard. Die guard is niet optioneel — elke normale schrijver valideert de
 * stand vóór opslag, en een herstel dat dat overslaat zou een revisie kunnen
 * terugzetten die niet meer aan het huidige schema voldoet; de dataroute
 * verwerpt hem dan bij het lezen en de organisatie valt terug op de demoset.
 */
const HERSTEL_GUARDS: Record<string, (state: unknown) => boolean> = {
  careon_hr_state: isHrState,
  careon_middelen_state: isMiddelenState,
  // Handoff 15: zonder eigen guard zou herstel hier met isMiddelenState
  // valideren en elke echte facturatie-revisie met 422 weigeren.
  careon_facturatie_instellingen: isFacturatieInstellingen,
};

export const ADMIN_HERSTELBAAR: readonly (AdminRegistratie & { geldig: (state: unknown) => boolean })[] =
  ADMIN_REGISTRATIES.filter((bron) => bron.heeftRevisie).map((bron) => ({
    ...bron,
    geldig: HERSTEL_GUARDS[bron.table] ?? isMiddelenState,
  }));

/**
 * Recente revisies van één registratie binnen één organisatie. De tabellen zijn
 * append-only, dus de vorige stand staat er nog — alleen was hij tot nu toe
 * uitsluitend met SQL te bereiken nadat iemand de registratie had leeggegooid.
 */
export function revisiesVoorOrg(
  bron: AdminRegistratie,
  orgId: string,
  limit = 10,
): Promise<AdminResult<AdminRevisie[]>> {
  if (!bron.heeftRevisie) return Promise.resolve({ ok: true, data: [] });
  return restGet<AdminRevisie[]>(
    `${bron.table}?select=id,saved_at,revision,change_source,change_summary&org_id=eq.${encodeURIComponent(orgId)}&order=revision.desc&limit=${Math.min(50, limit)}`,
  );
}

/**
 * Eén revisie terugzetten: de opgeslagen momentopname wordt als NIEUWE revisie
 * bovenop de reeks geschreven. Append-only blijft daarmee intact — er wordt
 * niets overschreven of verwijderd, en de foute stand blijft in de historie
 * zichtbaar.
 */
export async function herstelRevisie(
  bron: (typeof ADMIN_HERSTELBAAR)[number],
  orgId: string,
  revisieId: string,
  actorUserId: string,
): Promise<AdminResult<number>> {
  const bestaand = await restGet<{ state: unknown; revision: number }[]>(
    `${bron.table}?select=state,revision&id=eq.${encodeURIComponent(revisieId)}&org_id=eq.${encodeURIComponent(orgId)}&limit=1`,
  );
  if (!bestaand.ok) return bestaand;
  const bron_rij = bestaand.data[0];
  if (!bron_rij) return { ok: false, status: 404 };
  // Dezelfde poort als de gewone schrijfroute: een revisie van vóór een
  // schemawijziging mag niet als geldige stand terugkomen. 422 = wel gevonden,
  // niet meer bruikbaar.
  if (!bron.geldig(bron_rij.state)) return { ok: false, status: 422 };

  const nieuwste = await restGet<{ revision: number }[]>(
    `${bron.table}?select=revision&org_id=eq.${encodeURIComponent(orgId)}&order=revision.desc&limit=1`,
  );
  if (!nieuwste.ok) return nieuwste;
  const huidigeRevisie = nieuwste.data[0]?.revision ?? 0;

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${bron.table}`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        org_id: orgId,
        state: bron_rij.state,
        revision: huidigeRevisie + 1,
        base_revision: huidigeRevisie,
        change_source: "manual",
        change_summary: { hersteld_van_revisie: bron_rij.revision, door: actorUserId },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, data: huidigeRevisie + 1 };
  } catch {
    return { ok: false, status: NETWERKFOUT };
  }
}

export interface AdminQuotaRij {
  scope: string;
  actor_hash: string;
  minute_bucket: string;
  minute_count: number;
  day_bucket: string;
  day_count: number;
  updated_at: string;
}

/**
 * Actieve rate-limit-emmers. De dagbucket per gehasht bezoekers-IP loopt tot
 * middernacht UTC door, dus een praktijk achter één NAT die het dagplafond
 * raakt was zonder deze weergave alleen met SQL te helpen — de beheerder kon
 * niet eens zien dát dat de oorzaak was.
 */
export function actieveQuota(limit = 50): Promise<AdminResult<AdminQuotaRij[]>> {
  return restGet<AdminQuotaRij[]>(
    `careon_assistant_rate_limits?select=scope,actor_hash,minute_bucket,minute_count,day_bucket,day_count,updated_at&order=updated_at.desc&limit=${Math.min(200, limit)}`,
  );
}

/** Eén emmer leegmaken: de blokkade van die actor vervalt onmiddellijk. */
export async function wisQuota(scope: string, actorHash: string): Promise<AdminResult<boolean>> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/careon_assistant_rate_limits?scope=eq.${encodeURIComponent(scope)}&actor_hash=eq.${encodeURIComponent(actorHash)}`,
      {
        method: "DELETE",
        headers: headers({ Prefer: "return=representation" }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const rows = (await response.json()) as unknown[];
    return { ok: true, data: rows.length > 0 };
  } catch {
    return { ok: false, status: NETWERKFOUT };
  }
}

/**
 * Laatste onderhoudsrun (de nachtelijke prune-cron). Zonder deze regel is een
 * stil gestopte cron — verlopen CRON_SECRET, RPC-fout — in het product
 * onzichtbaar, terwijl de retentietermijnen eraan hangen.
 */
export async function laatsteOnderhoud(): Promise<AdminResult<AdminAuditEvent | null>> {
  const result = await restGet<AdminAuditEvent[]>(
    "audit_events?select=id,org_id,user_id,action,resource,resource_id,detail,created_at&action=in.(maintenance.prune,maintenance.prune_failed)&order=created_at.desc,id.desc&limit=1",
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data[0] ?? null };
}

export async function countRows(path: string): Promise<AdminResult<number | null>> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: "HEAD",
      headers: headers({ Prefer: "count=exact" }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, status: response.status };
    const range = response.headers.get("content-range");
    const total = range?.split("/")[1];
    return { ok: true, data: total && total !== "*" ? Number(total) : null };
  } catch {
    return { ok: false, status: NETWERKFOUT };
  }
}
