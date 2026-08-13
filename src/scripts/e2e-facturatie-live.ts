/**
 * Script: e2e-facturatie-live.ts
 *
 * Live smoke-suite voor het ÉCHTE serverpad van de facturatiemodule
 * (handoff 15 §8.1): de atomaire nummer-RPC, de onveranderlijkheidstriggers,
 * het Storage-archief met de download- en herstelroute, de statusovergangen,
 * crediteren en de RLS-grens. Playwright dekt dit bewust niet — die suite
 * draait demo-only (B12) en raakt Supabase nooit aan.
 *
 * Naar het model van handoff 13: draait tegen de ECHTE careon-zsg-database via
 * een lokale productieserver, met een eigen smoke-organisatie waarin alles wat
 * dit script schrijft ook weer wordt opgeruimd.
 *
 * Vooraf:
 *   npm run build && PORT=3210 npm run start      (of zet CAREON_E2E_BASE)
 * Draaien:
 *   npm run verify:facturatie:live
 *
 * Bewust NIET in `verify:ci` — net als `verify:assistant:live` is dit een
 * handmatige poort: hij vereist een draaiende server én echte productie-
 * credentials, en hij schrijft in de echte database.
 *
 * Vereiste omgeving (.env.local of process.env):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN (Management API).
 * Ontbreekt er iets, dan stopt het script direct — nooit een stille terugval
 * op demo-data.
 *
 * PRODUCTIEVEILIGHEID
 *   * Alle schrijfacties zitten in één vaste smoke-organisatie (slug
 *     `smoke-facturatie-live`) met één vaste smoke-gebruiker. Beide worden
 *     hergebruikt over runs en alleen aangemaakt als ze ontbreken.
 *   * Elke rij die dit script maakt draagt het merkteken SMOKE-FACTURATIE-LIVE
 *     (opmerking/notitie) én een vaste afnemer-/contactnaam. Vóór élke
 *     opruiming wordt geverifieerd dat álle rijen in die organisatie dat
 *     merkteken dragen; zo niet, dan stopt het script zonder iets te wissen.
 *   * Uitgereikte facturen zijn via de app onverwijderbaar (geen_delete-
 *     trigger). Opruimen gebeurt daarom via de Management API in één DO-blok
 *     dat eerst `session_replication_role = replica` probeert en anders díe ene
 *     trigger uitzet en aan het eind weer aanzet (op careon-zsg mag de
 *     postgres-rol de parameter niet zetten, dus dat is het feitelijke pad).
 *     Het DO-blok is één transactie: de ALTER TABLE houdt tot commit een
 *     ACCESS EXCLUSIVE lock, dus geen andere sessie kan in dat venster een
 *     uitgereikte factuur wissen. In élke delete staat een org_id-filter op de
 *     gevalideerde smoke-org-uuid. Nooit een kale delete.
 *   * Storage-objecten worden opgesomd uit storage.objects met een
 *     `{smokeOrgId}/%`-filter en per exact pad verwijderd.
 *   * Nummers die binnen de smoke-organisatie worden verbruikt zijn ongevaarlijk:
 *     de teller staat per (org_id, reeks, jaar).
 */

import { berekenTotalen } from "../lib/careon-facturatie/totalen";
import type { FacturatieInstellingen, Factuur, FactuurRegel, FactuurTemplate } from "../lib/careon-facturatie/types";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "../..");
const BASE = process.env.CAREON_E2E_BASE ?? "http://localhost:3210";

const SMOKE_ORG_SLUG = "smoke-facturatie-live";
const SMOKE_ORG_NAAM = "SMOKE — facturatie live-gate — niet gebruiken";
const SMOKE_EMAIL = "facturatie-smoke@careon-smoke.example.com";
const SMOKE_NAAM = "SMOKE facturatie live-gate";
const MARKER = "SMOKE-FACTURATIE-LIVE";
const SMOKE_AFNEMER_NAAM = `${MARKER} — testafnemer`;
const SMOKE_CONTACT_NAAM = `${MARKER} — testcontact`;
const FACTUREN_BUCKET = "facturen";
const UUID_VORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Omgeving ────────────────────────────────────────────────────────────────

function leesEnvLocal(): Record<string, string> {
  const envPath = path.join(ROOT, ".env.local");
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;
  for (const regel of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(regel.trim());
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const envLocal = leesEnvLocal();
function envWaarde(sleutel: string): string {
  return (process.env[sleutel] ?? envLocal[sleutel] ?? "").trim();
}

const SUPABASE_URL = envWaarde("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envWaarde("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envWaarde("SUPABASE_SERVICE_ROLE_KEY");
const ACCESS_TOKEN = envWaarde("SUPABASE_ACCESS_TOKEN");

function eisOmgeving(): void {
  const ontbreekt = [
    ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
    ["SUPABASE_ACCESS_TOKEN", ACCESS_TOKEN],
  ]
    .filter(([, waarde]) => waarde.length === 0)
    .map(([naam]) => naam);
  if (ontbreekt.length > 0) {
    console.error(
      `FATAAL: ontbrekende omgeving (${ontbreekt.join(", ")}). Deze suite draait uitsluitend tegen de echte ` +
        "careon-zsg-database; zet de sleutels in .env.local of in de omgeving. Er is bewust geen demo-terugval.",
    );
    process.exit(1);
  }
  if (envWaarde("CAREON_DEMO_MODE") === "1") {
    console.error("FATAAL: CAREON_DEMO_MODE=1 — de facturatieroutes antwoorden dan 501. Start de server zonder demo.");
    process.exit(1);
  }
}

const PROJECT_REF = SUPABASE_URL ? new URL(SUPABASE_URL).hostname.split(".")[0] : "";

// ── Telling ─────────────────────────────────────────────────────────────────

let geslaagd = 0;
let gefaald = 0;

function check(naam: string, voorwaarde: boolean, detail?: string): boolean {
  if (voorwaarde) {
    geslaagd += 1;
    console.log(`OK   ${naam}`);
  } else {
    gefaald += 1;
    console.error(`FAIL ${naam}${detail ? ` — ${detail}` : ""}`);
  }
  return voorwaarde;
}

// ── Supabase-toegang ────────────────────────────────────────────────────────

/** Management API (SUPABASE_ACCESS_TOKEN): SQL die PostgREST niet kan. */
async function mgmtSql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const tekst = await response.text();
  if (!response.ok) throw new Error(`Management API ${response.status}: ${tekst.slice(0, 400)}`);
  if (tekst.trim().length === 0) return [];
  const rows = JSON.parse(tekst) as unknown;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function serviceHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function serviceRest(pad: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${pad}`, {
    ...init,
    headers: { ...serviceHeaders(), ...((init.headers as Record<string, string> | undefined) ?? {}) },
    cache: "no-store",
  });
}

/** PostgREST namens een gewone `authenticated`-gebruiker (RLS-controles). */
async function callerRest(token: string, pad: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${pad}`, {
    ...init,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
    cache: "no-store",
  });
}

// ── Sessie tegen de lokale productieserver ──────────────────────────────────

const cookieJar = new Map<string, string>();

function cookieKop(): string {
  return [...cookieJar.entries()].map(([naam, waarde]) => `${naam}=${waarde}`).join("; ");
}

function onthoudCookies(response: Response): void {
  const kopjes = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const rij of kopjes) {
    const paar = rij.split(";")[0] ?? "";
    const index = paar.indexOf("=");
    if (index < 0) continue;
    const naam = paar.slice(0, index).trim();
    const waarde = paar.slice(index + 1).trim();
    if (waarde === "") cookieJar.delete(naam);
    else cookieJar.set(naam, waarde);
  }
}

async function app(pad: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookies = cookieKop();
  if (cookies.length > 0) headers.set("cookie", cookies);
  const response = await fetch(`${BASE}${pad}`, { ...init, headers, redirect: "manual", cache: "no-store" });
  onthoudCookies(response);
  return response;
}

async function appJson<T>(pad: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await app(pad, init);
  const tekst = await response.text();
  let body: unknown = null;
  try {
    body = tekst.length > 0 ? JSON.parse(tekst) : null;
  } catch {
    body = { error: tekst.slice(0, 200) };
  }
  return { status: response.status, body: body as T };
}

// ── Smoke-organisatie, -gebruiker en lidmaatschap ───────────────────────────

interface OrgRij {
  id: string;
  name: string;
}

async function zorgVoorOrganisatie(): Promise<string> {
  const bestaand = await serviceRest(`organizations?slug=eq.${SMOKE_ORG_SLUG}&select=id,name&limit=1`);
  if (!bestaand.ok) throw new Error(`Organisatie opzoeken faalde: ${bestaand.status} ${await bestaand.text()}`);
  const rijen = (await bestaand.json()) as OrgRij[];
  if (rijen.length > 0) {
    if (rijen[0].name !== SMOKE_ORG_NAAM) {
      throw new Error(
        `De organisatie met slug "${SMOKE_ORG_SLUG}" heet "${rijen[0].name}" in plaats van "${SMOKE_ORG_NAAM}" — ` +
          "dat kan geen door dit script aangemaakte smoke-organisatie zijn. Gestopt zonder te schrijven.",
      );
    }
    return rijen[0].id;
  }
  const aangemaakt = await serviceRest("organizations?select=id,name", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: SMOKE_ORG_NAAM, slug: SMOKE_ORG_SLUG }),
  });
  if (!aangemaakt.ok) throw new Error(`Smoke-organisatie aanmaken faalde: ${aangemaakt.status}`);
  const nieuw = (await aangemaakt.json()) as OrgRij[];
  console.log(`Smoke-organisatie aangemaakt: ${nieuw[0].id}`);
  return nieuw[0].id;
}

/** Vaste smoke-gebruiker met een per-run vers, willekeurig wachtwoord. */
async function zorgVoorGebruiker(): Promise<{ userId: string; wachtwoord: string }> {
  const wachtwoord = `Sm0ke!${randomBytes(24).toString("base64url")}`;
  const bestaande = await mgmtSql<{ id: string }>(
    `select id::text from auth.users where lower(email) = lower('${SMOKE_EMAIL}') limit 1`,
  );
  if (bestaande.length > 0) {
    const userId = bestaande[0].id;
    const update = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: serviceHeaders(),
      body: JSON.stringify({ password: wachtwoord, email_confirm: true }),
    });
    if (!update.ok) throw new Error(`Wachtwoord smoke-gebruiker resetten faalde: ${update.status}`);
    return { userId, wachtwoord };
  }
  const aangemaakt = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      email: SMOKE_EMAIL,
      password: wachtwoord,
      email_confirm: true,
      user_metadata: { full_name: SMOKE_NAAM },
    }),
  });
  if (!aangemaakt.ok) {
    throw new Error(`Smoke-gebruiker aanmaken faalde: ${aangemaakt.status} ${(await aangemaakt.text()).slice(0, 200)}`);
  }
  const gebruiker = (await aangemaakt.json()) as { id: string };
  console.log(`Smoke-gebruiker aangemaakt: ${gebruiker.id}`);
  return { userId: gebruiker.id, wachtwoord };
}

async function zorgVoorLidmaatschap(orgId: string, userId: string): Promise<void> {
  const response = await serviceRest("organization_members", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ org_id: orgId, user_id: userId, role: "org_admin" }),
  });
  if (!response.ok) throw new Error(`Lidmaatschap smoke-gebruiker faalde: ${response.status}`);
}

// ── Bewaking + opruiming ────────────────────────────────────────────────────

function eisSmokeUuid(orgId: string): string {
  if (!UUID_VORM.test(orgId)) throw new Error(`Onveilig org-id voor opruiming: ${orgId}`);
  return orgId;
}

interface FactuurControleRij {
  id: string;
  status: string;
  opmerking: string | null;
  afnemer: { naam?: string } | null;
  regels: unknown[];
}

/**
 * Weiger te werken (en dus te wissen) in een organisatie die rijen bevat die
 * dit script niet zelf getagd heeft. Een leeg concept zonder afnemer telt als
 * eigen restant: dat is exact wat een crash tussen POST en PATCH achterlaat.
 */
async function bewaakSmokeOrganisatie(orgId: string, smokeUserId: string): Promise<void> {
  const leden = await serviceRest(`organization_members?org_id=eq.${orgId}&select=user_id`);
  if (!leden.ok) throw new Error(`Lidmaatschappen lezen faalde: ${leden.status}`);
  const vreemdeLeden = ((await leden.json()) as { user_id: string }[])
    .map((rij) => rij.user_id)
    .filter((id) => id !== smokeUserId);
  if (vreemdeLeden.length > 0) {
    throw new Error(
      `De smoke-organisatie heeft ${vreemdeLeden.length} lid/leden buiten de smoke-gebruiker (${vreemdeLeden.join(", ")}) — ` +
        "dit is kennelijk geen wegwerporganisatie. Gestopt zonder te schrijven of te wissen.",
    );
  }

  const facturen = await serviceRest(
    `careon_facturatie_facturen?org_id=eq.${orgId}&select=id,status,opmerking,afnemer,regels`,
  );
  if (!facturen.ok) throw new Error(`Facturen lezen faalde: ${facturen.status}`);
  const ongetagd = ((await facturen.json()) as FactuurControleRij[]).filter((rij) => {
    if ((rij.opmerking ?? "").includes(MARKER)) return false;
    if (rij.afnemer?.naam === SMOKE_AFNEMER_NAAM) return false;
    return !(rij.status === "concept" && rij.afnemer === null && (rij.regels ?? []).length === 0);
  });
  if (ongetagd.length > 0) {
    throw new Error(
      `De smoke-organisatie bevat ${ongetagd.length} factuurrij(en) zonder merkteken ${MARKER} ` +
        `(${ongetagd.map((rij) => rij.id).join(", ")}). Gestopt zonder te wissen.`,
    );
  }

  const contacten = await serviceRest(`careon_facturatie_contacten?org_id=eq.${orgId}&select=id,naam,notitie`);
  if (!contacten.ok) throw new Error(`Contacten lezen faalde: ${contacten.status}`);
  const vreemdeContacten = ((await contacten.json()) as { id: string; naam: string; notitie: string | null }[]).filter(
    (rij) => rij.naam !== SMOKE_CONTACT_NAAM && !(rij.notitie ?? "").includes(MARKER),
  );
  if (vreemdeContacten.length > 0) {
    throw new Error(
      `De smoke-organisatie bevat ${vreemdeContacten.length} contact(en) zonder merkteken ${MARKER}. Gestopt zonder te wissen.`,
    );
  }
}

async function storagePaden(orgId: string): Promise<string[]> {
  const rijen = await mgmtSql<{ name: string }>(
    `select name from storage.objects where bucket_id = '${FACTUREN_BUCKET}' and name like '${eisSmokeUuid(orgId)}/%'`,
  );
  return rijen.map((rij) => rij.name).filter((naam) => naam.startsWith(`${orgId}/`));
}

async function verwijderStorage(orgId: string): Promise<number> {
  const paden = await storagePaden(orgId);
  if (paden.length === 0) return 0;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${FACTUREN_BUCKET}`, {
    method: "DELETE",
    headers: serviceHeaders(),
    body: JSON.stringify({ prefixes: paden }),
  });
  if (!response.ok)
    throw new Error(`Storage opruimen faalde: ${response.status} ${(await response.text()).slice(0, 200)}`);
  return paden.length;
}

/**
 * Alle facturatierijen van ÉÉN organisatie wissen. De geen-delete-trigger
 * blokkeert uitgereikte facturen, dus dit draait in één DO-blok met
 * `session_replication_role = replica`; op careon-zsg mag de postgres-rol die
 * parameter niet zetten, dus in de praktijk loopt de terugval: díe ene trigger
 * gericht uit en aan het eind van dezelfde transactie weer aan (de ALTER TABLE
 * houdt tot commit een ACCESS EXCLUSIVE lock, dus er glipt niets doorheen).
 * Elke delete draagt het org_id-filter; creditrijen gaan eerst vanwege de
 * restrictieve FK.
 */
async function verwijderRijen(orgId: string): Promise<void> {
  const org = eisSmokeUuid(orgId);
  await mgmtSql(`
    do $smoke$
    declare
      v_replica boolean := true;
    begin
      begin
        perform set_config('session_replication_role', 'replica', true);
      exception
        when others then
          v_replica := false;
          execute 'alter table public.careon_facturatie_facturen disable trigger careon_facturatie_facturen_geen_delete';
      end;

      -- Maillog eerst: factuur_id verwijst met ON DELETE RESTRICT naar
      -- facturen, dus achtergebleven logregels zouden de factuurdelete blokkeren.
      delete from public.careon_facturatie_maillog where org_id = '${org}'::uuid;
      delete from public.careon_facturatie_facturen
        where org_id = '${org}'::uuid and gecrediteerde_factuur_id is not null;
      delete from public.careon_facturatie_facturen where org_id = '${org}'::uuid;
      delete from public.careon_facturatie_contacten where org_id = '${org}'::uuid;
      delete from public.careon_facturatie_nummers where org_id = '${org}'::uuid;
      delete from public.careon_facturatie_instellingen where org_id = '${org}'::uuid;
      delete from public.audit_events where org_id = '${org}'::uuid;

      if not v_replica then
        execute 'alter table public.careon_facturatie_facturen enable trigger careon_facturatie_facturen_geen_delete';
      end if;
    end
    $smoke$;
  `);
}

async function ruimOp(orgId: string, fase: string): Promise<{ objecten: number }> {
  const objecten = await verwijderStorage(orgId);
  await verwijderRijen(orgId);
  console.log(`Opruiming ${fase}: ${objecten} storage-object(en) en alle facturatierijen van de smoke-organisatie.`);
  return { objecten };
}

// ── Testgegevens ────────────────────────────────────────────────────────────

const SMOKE_TEMPLATE: FactuurTemplate = {
  id: "smoke",
  naam: "SMOKE live-gate",
  tagline: "Testsjabloon — niet gebruiken",
  afzender: {
    statutaireNaam: "SMOKE Facturatie Live-gate B.V.",
    adresRegel1: "Teststraat 1",
    postcode: "1000 AA",
    plaats: "Testdam",
    land: "NL",
    kvkNummer: "87654321",
    btwId: "NL123456789B01",
    email: "smoke@example.com",
  },
  bank: { iban: "NL91ABNA0417164300", tenaamstelling: "SMOKE Facturatie Live-gate B.V." },
  nummering: { reeksFactuur: "F", reeksCredit: "C", formaat: "{reeks}{jaar}-{nummer:4}", startVolgnummer: 1 },
  betaling: { standaardTermijnDagen: 30, betaalinstructie: "Testfactuur — niet betalen." },
  btw: { standaardTarief: "21", vrijstellingTekst: "" },
  presentatie: { toonLogo: false, voettekst: `${MARKER} — automatische testfactuur` },
};

const SMOKE_INSTELLINGEN: FacturatieInstellingen = {
  templates: [SMOKE_TEMPLATE],
  standaardTemplateId: SMOKE_TEMPLATE.id,
  updatedAt: new Date().toISOString(),
};

function smokeRegels(): FactuurRegel[] {
  return [
    {
      id: randomUUID(),
      omschrijving: `${MARKER} — consult`,
      aantal: 2,
      eenheid: "uur",
      stukprijsCent: 12_345,
      btwTarief: "21",
      btwCategorie: "S",
    },
    {
      id: randomUUID(),
      omschrijving: `${MARKER} — rapportage`,
      aantal: 1,
      eenheid: "stuk",
      stukprijsCent: 5_000,
      kortingPct: 10,
      btwTarief: "21",
      btwCategorie: "S",
    },
  ];
}

const VANDAAG = new Date();
const JAAR = VANDAAG.getUTCFullYear();
const PRESTATIE_VAN = `${JAAR}-01-01`;
const PRESTATIE_TOT = `${JAAR}-01-31`;

interface FactuurAntwoord {
  configured?: boolean;
  factuur?: Factuur;
  error?: string;
  ontbrekend?: string[];
  pdfOntbreekt?: boolean;
}

/** Nieuw concept met volledige, getagde inhoud — klaar om uit te reiken. */
async function nieuwGevuldConcept(contactId: string): Promise<Factuur> {
  const gemaakt = await appJson<FactuurAntwoord>("/api/careon/facturatie/facturen", { method: "POST" });
  if (gemaakt.status !== 200 || !gemaakt.body.factuur) {
    throw new Error(`Concept aanmaken faalde: ${gemaakt.status} ${JSON.stringify(gemaakt.body).slice(0, 200)}`);
  }
  const concept = gemaakt.body.factuur;
  const regels = smokeRegels();
  const gevuld: Factuur = {
    ...concept,
    contactId,
    afnemer: {
      naam: SMOKE_AFNEMER_NAAM,
      adresRegel1: "Testlaan 2",
      postcode: "2000 BB",
      plaats: "Testdorp",
      land: "NL",
    },
    prestatieVan: PRESTATIE_VAN,
    prestatieTot: PRESTATIE_TOT,
    regels,
    opmerking: `${MARKER} — automatische live-gate`,
    uwKenmerk: MARKER,
  };
  const bewaard = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${concept.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ factuur: gevuld, baseUpdatedAt: concept.updatedAt }),
  });
  if (bewaard.status !== 200 || !bewaard.body.factuur) {
    throw new Error(`Concept vullen faalde: ${bewaard.status} ${JSON.stringify(bewaard.body).slice(0, 300)}`);
  }
  return bewaard.body.factuur;
}

async function reikUit(factuurId: string): Promise<{ status: number; body: FactuurAntwoord }> {
  return appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurId}/definitief`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

interface PdfMeta {
  pdf_pad: string | null;
  pdf_sha256: string | null;
  pdf_bytes: number | null;
  pdf_gegenereerd_op: string | null;
  status: string;
  nummer: string | null;
  volgnummer: number | null;
  prestatie_van: string | null;
  prestatie_tot: string | null;
  gecrediteerde_factuur_id: string | null;
}

async function leesRij(orgId: string, factuurId: string): Promise<PdfMeta> {
  const response = await serviceRest(
    `careon_facturatie_facturen?org_id=eq.${orgId}&id=eq.${factuurId}` +
      "&select=pdf_pad,pdf_sha256,pdf_bytes,pdf_gegenereerd_op,status,nummer,volgnummer,prestatie_van,prestatie_tot,gecrediteerde_factuur_id",
  );
  if (!response.ok) throw new Error(`Factuurrij lezen faalde: ${response.status}`);
  const rijen = (await response.json()) as PdfMeta[];
  if (rijen.length === 0) throw new Error(`Factuurrij ${factuurId} niet gevonden`);
  return rijen[0];
}

async function bucketBytes(pad: string): Promise<Buffer | null> {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${FACTUREN_BUCKET}/${pad}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

// ── De suite ────────────────────────────────────────────────────────────────

async function draaiTests(orgId: string, wachtwoord: string): Promise<void> {
  // 1. Inloggen via de echte serverroute — die zet de sessiecookies waarmee
  //    requireOrgAdmin() in elke facturatieroute werkt.
  const login = await app("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: SMOKE_EMAIL, password: wachtwoord }),
  });
  if (login.status !== 200) {
    throw new Error(`Inloggen als smoke-beheerder faalde: ${login.status} ${(await login.text()).slice(0, 200)}`);
  }
  const sessie = await appJson<{ orgId?: string; orgRole?: string; facturatieZichtbaar?: boolean }>(
    "/api/auth/session",
  );
  // HARDE poort, geen zachte check: elke volgende schrijfactie gaat naar de
  // organisatie die de sérver resolvet (oudste lidmaatschap), terwijl guard
  // en opruiming alleen de smoke-organisatie raken. Wijken die twee af, dan
  // zouden we buiten de bewaakte organisatie schrijven — direct stoppen.
  if (sessie.status !== 200 || sessie.body.orgId !== orgId) {
    throw new Error(
      `FATAAL: de serversessie wijst naar organisatie ${sessie.body.orgId ?? "(geen)"} in plaats van de ` +
        `smoke-organisatie ${orgId}. Gestopt vóór enige schrijfactie buiten de bewaakte organisatie.`,
    );
  }
  check(
    "sessie is org_admin van de smoke-organisatie met facturatietoegang",
    sessie.body.orgRole === "org_admin" && sessie.body.facturatieZichtbaar === true,
    JSON.stringify(sessie.body).slice(0, 200),
  );

  // 2. Instellingen seeden: zonder volledige afzender weigert de art. 35a-
  //    validator elke uitreiking.
  const instellingen = await appJson<{ revision?: number; error?: string }>("/api/careon/facturatie/instellingen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: SMOKE_INSTELLINGEN, baseRevision: 0, operationId: randomUUID() }),
  });
  check(
    "instellingen-snapshot opgeslagen als revisie 1",
    instellingen.status === 200 && instellingen.body.revision === 1,
    JSON.stringify(instellingen.body).slice(0, 200),
  );

  const contactAntwoord = await appJson<{ contact?: { id: string }; error?: string }>(
    "/api/careon/facturatie/contacten",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact: {
          id: randomUUID(),
          soort: "organisatie",
          bron: "handmatig",
          naam: SMOKE_CONTACT_NAAM,
          land: "NL",
          notitie: `${MARKER} — automatische live-gate`,
          archief: false,
          updatedAt: new Date().toISOString(),
        },
      }),
    },
  );
  if (contactAntwoord.status !== 200 || !contactAntwoord.body.contact) {
    throw new Error(`Smoke-contact aanmaken faalde: ${contactAntwoord.status}`);
  }
  const contactId = contactAntwoord.body.contact.id;

  // ── RPC-nummering ─────────────────────────────────────────────────────────
  const conceptA = await nieuwGevuldConcept(contactId);
  const conceptB = await nieuwGevuldConcept(contactId);
  const uitgereiktA = await reikUit(conceptA.id);
  const uitgereiktB = await reikUit(conceptB.id);
  const factuurA = uitgereiktA.body.factuur;
  const factuurB = uitgereiktB.body.factuur;
  if (!factuurA || !factuurB) {
    throw new Error(
      `Uitreiken faalde: A=${uitgereiktA.status} ${JSON.stringify(uitgereiktA.body).slice(0, 300)} / ` +
        `B=${uitgereiktB.status} ${JSON.stringify(uitgereiktB.body).slice(0, 300)}`,
    );
  }

  check(
    "eerste uitreiking krijgt het sjabloonformaat F<jaar>-0001",
    factuurA.nummer === `F${JAAR}-0001` && factuurA.status === "definitief" && factuurA.volgnummer === 1,
    `nummer=${factuurA.nummer} status=${factuurA.status} volgnummer=${factuurA.volgnummer}`,
  );
  check(
    "tweede uitreiking is opeenvolgend binnen (reeks F, jaar)",
    factuurB.nummer === `F${JAAR}-0002` && factuurB.volgnummer === 2,
    `nummer=${factuurB.nummer} volgnummer=${factuurB.volgnummer}`,
  );

  const verwachteTotalen = berekenTotalen(conceptA.regels);
  check(
    "server herberekent de totalen bij uitreiking",
    factuurA.subtotaalCent === verwachteTotalen.subtotaalCent &&
      factuurA.btwCent === verwachteTotalen.btwCent &&
      factuurA.totaalCent === verwachteTotalen.totaalCent,
    `server=${factuurA.subtotaalCent}/${factuurA.btwCent}/${factuurA.totaalCent} verwacht=${verwachteTotalen.subtotaalCent}/${verwachteTotalen.btwCent}/${verwachteTotalen.totaalCent}`,
  );

  const nogmaals = await reikUit(conceptA.id);
  check(
    "tweede definitief-aanroep op dezelfde factuur geeft 409",
    nogmaals.status === 409 && (nogmaals.body.error ?? "").includes("al uitgereikt"),
    `status=${nogmaals.status} body=${JSON.stringify(nogmaals.body).slice(0, 160)}`,
  );

  const tellerResponse = await serviceRest(
    `careon_facturatie_nummers?org_id=eq.${orgId}&reeks=eq.F&jaar=eq.${JAAR}&select=laatste`,
  );
  const tellerRijen = (await tellerResponse.json()) as { laatste: number }[];
  check(
    "teller careon_facturatie_nummers staat op 2 voor (org, F, jaar)",
    tellerRijen.length === 1 && tellerRijen[0].laatste === 2,
    JSON.stringify(tellerRijen),
  );

  // ── Onveranderlijkheid ────────────────────────────────────────────────────
  const patchNaUitreiking = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurA.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      factuur: { ...factuurA, opmerking: `${MARKER} — poging tot wijziging` },
      baseUpdatedAt: factuurA.updatedAt,
    }),
  });
  check(
    "PATCH op een uitgereikte factuur geeft 409",
    patchNaUitreiking.status === 409,
    `status=${patchNaUitreiking.status} body=${JSON.stringify(patchNaUitreiking.body).slice(0, 160)}`,
  );

  const triggerPatch = await serviceRest(`careon_facturatie_facturen?org_id=eq.${orgId}&id=eq.${factuurA.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ regels: smokeRegels() }),
  });
  const triggerTekst = await triggerPatch.text();
  check(
    "bevries-trigger weigert ook een service-role wijziging van de regels",
    !triggerPatch.ok && triggerTekst.includes("kan niet meer worden gewijzigd"),
    `status=${triggerPatch.status} body=${triggerTekst.slice(0, 160)}`,
  );

  const verwijderRoute = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurA.id}`, {
    method: "DELETE",
  });
  check(
    "DELETE op een uitgereikte factuur geeft 409",
    verwijderRoute.status === 409 && (verwijderRoute.body.error ?? "").includes("niet worden verwijderd"),
    `status=${verwijderRoute.status} body=${JSON.stringify(verwijderRoute.body).slice(0, 160)}`,
  );

  const triggerDelete = await serviceRest(`careon_facturatie_facturen?org_id=eq.${orgId}&id=eq.${factuurA.id}`, {
    method: "DELETE",
  });
  const triggerDeleteTekst = await triggerDelete.text();
  check(
    "geen-delete-trigger weigert ook een service-role delete",
    !triggerDelete.ok && triggerDeleteTekst.includes("niet worden verwijderd"),
    `status=${triggerDelete.status} body=${triggerDeleteTekst.slice(0, 160)}`,
  );

  // ── Storage-archief, download en herstel ──────────────────────────────────
  const rijA = await leesRij(orgId, factuurA.id);
  check(
    "definitief maken archiveert de pdf op {org}/{jaar}/{nummer}.pdf",
    rijA.pdf_pad === `${orgId}/${JAAR}/${encodeURIComponent(factuurA.nummer ?? "")}.pdf` &&
      (rijA.pdf_bytes ?? 0) > 0 &&
      (rijA.pdf_sha256 ?? "").length === 64,
    `pdf_pad=${rijA.pdf_pad} bytes=${rijA.pdf_bytes} sha=${rijA.pdf_sha256}`,
  );

  const download = await app(`/api/careon/facturatie/facturen/${factuurA.id}/pdf`);
  const downloadBytes = Buffer.from(await download.arrayBuffer());
  check(
    "download-route streamt de gearchiveerde pdf (%PDF-header)",
    download.status === 200 &&
      (download.headers.get("content-type") ?? "").includes("application/pdf") &&
      downloadBytes.subarray(0, 5).toString("latin1") === "%PDF-",
    `status=${download.status} type=${download.headers.get("content-type")} kop=${downloadBytes.subarray(0, 8).toString("latin1")}`,
  );
  check(
    "pdf_sha256 komt overeen met de gearchiveerde bytes",
    createHash("sha256").update(downloadBytes).digest("hex") === rijA.pdf_sha256,
    `db=${rijA.pdf_sha256}`,
  );

  // Herstelroute, tak 1: het Storage-object bestaat nog, alleen de metadata is
  // weg (upload geslaagd, metadata-update mislukt).
  const conceptC = await nieuwGevuldConcept(contactId);
  const uitgereiktC = await reikUit(conceptC.id);
  const factuurC = uitgereiktC.body.factuur;
  if (!factuurC) throw new Error(`Uitreiken C faalde: ${uitgereiktC.status}`);
  await serviceRest(`careon_facturatie_facturen?org_id=eq.${orgId}&id=eq.${factuurC.id}`, {
    method: "PATCH",
    body: JSON.stringify({ pdf_pad: null, pdf_sha256: null, pdf_bytes: null, pdf_gegenereerd_op: null }),
  });
  const zonderPdf = await appJson<{ error?: string }>(`/api/careon/facturatie/facturen/${factuurC.id}/pdf`);
  check(
    'download zonder pdf-metadata geeft 409 "Pdf ontbreekt — genereer opnieuw."',
    zonderPdf.status === 409 && zonderPdf.body.error === "Pdf ontbreekt — genereer opnieuw.",
    `status=${zonderPdf.status} body=${JSON.stringify(zonderPdf.body).slice(0, 160)}`,
  );

  const herstelBestaand = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurC.id}/pdf`, {
    method: "POST",
  });
  const rijCNaHerstel = await leesRij(orgId, factuurC.id);
  check(
    "herstelroute (object bestaat) herstelt pdf_pad en pdf_bytes",
    herstelBestaand.status === 200 &&
      rijCNaHerstel.pdf_pad === `${orgId}/${JAAR}/${encodeURIComponent(factuurC.nummer ?? "")}.pdf` &&
      (rijCNaHerstel.pdf_bytes ?? 0) > 0,
    `status=${herstelBestaand.status} pdf_pad=${rijCNaHerstel.pdf_pad} bytes=${rijCNaHerstel.pdf_bytes}`,
  );
  check(
    "herstelroute (object bestaat) berekent een ONTBREKENDE pdf_sha256 alsnog (handoff 15 §5.5: pad/bytes/sha256)",
    (rijCNaHerstel.pdf_sha256 ?? "").length === 64,
    `pdf_sha256=${rijCNaHerstel.pdf_sha256}`,
  );
  const herstelBytes = rijCNaHerstel.pdf_pad ? await bucketBytes(rijCNaHerstel.pdf_pad) : null;
  check(
    "na herstel is de pdf weer downloadbaar en past de herberekende hash op de bytes",
    herstelBytes !== null &&
      herstelBytes.subarray(0, 5).toString("latin1") === "%PDF-" &&
      createHash("sha256").update(herstelBytes).digest("hex") === rijCNaHerstel.pdf_sha256,
    `bytes=${herstelBytes?.byteLength ?? 0} db=${rijCNaHerstel.pdf_sha256}`,
  );

  // Zelfde tak, andere beginstand: er staat al een integriteitsanker. Dat mag
  // NOOIT worden overschreven met een verse hash van hetzelfde object — dan
  // bevestigt de controle zichzelf en blijft juist corruptie onzichtbaar. Het
  // anker hieronder is bewust een hash die niet bij de bytes hoort: alleen zo
  // is "bewaard" te onderscheiden van "toevallig opnieuw dezelfde uitkomst".
  const anker = "0".repeat(64);
  await serviceRest(`careon_facturatie_facturen?org_id=eq.${orgId}&id=eq.${factuurC.id}`, {
    method: "PATCH",
    body: JSON.stringify({ pdf_pad: null, pdf_bytes: null, pdf_sha256: anker }),
  });
  const herstelMetAnker = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurC.id}/pdf`, {
    method: "POST",
  });
  const rijCNaAnker = await leesRij(orgId, factuurC.id);
  check(
    "herstelroute laat een BESTAANDE pdf_sha256 ongemoeid (integriteitsanker, geen tautologie)",
    herstelMetAnker.status === 200 && rijCNaAnker.pdf_pad !== null && rijCNaAnker.pdf_sha256 === anker,
    `status=${herstelMetAnker.status} pdf_pad=${rijCNaAnker.pdf_pad} pdf_sha256=${rijCNaAnker.pdf_sha256}`,
  );

  // Herstelroute, tak 2: het Storage-object is óók weg → volledige rerender.
  const conceptD = await nieuwGevuldConcept(contactId);
  const uitgereiktD = await reikUit(conceptD.id);
  const factuurD = uitgereiktD.body.factuur;
  if (!factuurD) throw new Error(`Uitreiken D faalde: ${uitgereiktD.status}`);
  const padD = `${orgId}/${JAAR}/${encodeURIComponent(factuurD.nummer ?? "")}.pdf`;
  const gewist = await fetch(`${SUPABASE_URL}/storage/v1/object/${FACTUREN_BUCKET}`, {
    method: "DELETE",
    headers: serviceHeaders(),
    body: JSON.stringify({ prefixes: [padD] }),
  });
  if (!gewist.ok) throw new Error(`Testobject wissen faalde: ${gewist.status}`);
  await serviceRest(`careon_facturatie_facturen?org_id=eq.${orgId}&id=eq.${factuurD.id}`, {
    method: "PATCH",
    body: JSON.stringify({ pdf_pad: null, pdf_sha256: null, pdf_bytes: null, pdf_gegenereerd_op: null }),
  });
  const herstelRerender = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurD.id}/pdf`, {
    method: "POST",
  });
  const rijDNaHerstel = await leesRij(orgId, factuurD.id);
  const bytesD = rijDNaHerstel.pdf_pad ? await bucketBytes(rijDNaHerstel.pdf_pad) : null;
  check(
    "herstelroute (object weg) rendert opnieuw en schrijft pdf_sha256",
    herstelRerender.status === 200 && rijDNaHerstel.pdf_pad === padD && (rijDNaHerstel.pdf_sha256 ?? "").length === 64,
    `status=${herstelRerender.status} pdf_pad=${rijDNaHerstel.pdf_pad} sha=${rijDNaHerstel.pdf_sha256}`,
  );
  check(
    "de opnieuw gerenderde pdf in de bucket hoort bij die hash",
    bytesD !== null && createHash("sha256").update(bytesD).digest("hex") === rijDNaHerstel.pdf_sha256,
    `bytes=${bytesD?.byteLength ?? 0}`,
  );

  // ── Statusovergangen ──────────────────────────────────────────────────────
  const naarVerzonden = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurA.id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "verzonden" }),
  });
  check(
    "statusovergang definitief → verzonden",
    naarVerzonden.status === 200 && naarVerzonden.body.factuur?.status === "verzonden",
    `status=${naarVerzonden.status} body=${JSON.stringify(naarVerzonden.body).slice(0, 160)}`,
  );

  const betaaldOp = `${JAAR}-02-15`;
  const naarBetaald = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurA.id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "betaald", betaaldOp }),
  });
  check(
    "statusovergang verzonden → betaald met betaaldOp",
    naarBetaald.status === 200 &&
      naarBetaald.body.factuur?.status === "betaald" &&
      naarBetaald.body.factuur?.betaaldOp === betaaldOp,
    `status=${naarBetaald.status} body=${JSON.stringify(naarBetaald.body).slice(0, 160)}`,
  );

  const ongeldigeOvergang = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurA.id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "verzonden" }),
  });
  check(
    "statusovergang betaald → verzonden wordt geweigerd (409)",
    ongeldigeOvergang.status === 409,
    `status=${ongeldigeOvergang.status} body=${JSON.stringify(ongeldigeOvergang.body).slice(0, 160)}`,
  );

  const conceptE = await nieuwGevuldConcept(contactId);
  const conceptOvergang = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${conceptE.id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "verzonden" }),
  });
  check(
    "statusovergang concept → verzonden wordt geweigerd (409)",
    conceptOvergang.status === 409,
    `status=${conceptOvergang.status} body=${JSON.stringify(conceptOvergang.body).slice(0, 160)}`,
  );

  // ── Crediteren ────────────────────────────────────────────────────────────
  const credit = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurB.id}/credit`, {
    method: "POST",
  });
  const creditFactuur = credit.body.factuur;
  check(
    "crediteren levert een uitgereikte creditfactuur in de C-reeks",
    credit.status === 200 &&
      creditFactuur?.soort === "creditfactuur" &&
      creditFactuur?.status === "definitief" &&
      creditFactuur?.nummer === `C${JAAR}-0001`,
    `status=${credit.status} nummer=${creditFactuur?.nummer} soort=${creditFactuur?.soort}`,
  );
  check(
    "de creditreeks heeft een eigen teller naast de factuurreeks",
    creditFactuur?.volgnummer === 1 && creditFactuur?.reeks === "C",
    `volgnummer=${creditFactuur?.volgnummer} reeks=${creditFactuur?.reeks}`,
  );
  check(
    "de creditfactuur verwijst naar het origineel en spiegelt de bedragen",
    creditFactuur?.gecrediteerdeFactuurId === factuurB.id && creditFactuur?.totaalCent === -factuurB.totaalCent,
    `verwijzing=${creditFactuur?.gecrediteerdeFactuurId} totaal=${creditFactuur?.totaalCent} origineel=${factuurB.totaalCent}`,
  );
  check(
    "de creditfactuur neemt de prestatieperiode over van het origineel (art. 35a sub g)",
    creditFactuur?.prestatieVan === PRESTATIE_VAN && creditFactuur?.prestatieTot === PRESTATIE_TOT,
    `van=${creditFactuur?.prestatieVan} tot=${creditFactuur?.prestatieTot} verwacht=${PRESTATIE_VAN}..${PRESTATIE_TOT}`,
  );
  const origineelNaCredit = await leesRij(orgId, factuurB.id);
  check(
    "het origineel krijgt status gecrediteerd",
    origineelNaCredit.status === "gecrediteerd",
    `status=${origineelNaCredit.status}`,
  );
  const dubbeleCredit = await appJson<FactuurAntwoord>(`/api/careon/facturatie/facturen/${factuurB.id}/credit`, {
    method: "POST",
  });
  check(
    "een reeds gecrediteerde factuur nogmaals crediteren geeft 409",
    dubbeleCredit.status === 409,
    `status=${dubbeleCredit.status} body=${JSON.stringify(dubbeleCredit.body).slice(0, 160)}`,
  );
  if (creditFactuur?.pdfPad) {
    const creditBytes = await bucketBytes(creditFactuur.pdfPad);
    check(
      "de creditfactuur is eveneens gearchiveerd als pdf",
      creditBytes !== null && creditBytes.subarray(0, 5).toString("latin1") === "%PDF-",
      `pad=${creditFactuur.pdfPad}`,
    );
  } else {
    check("de creditfactuur is eveneens gearchiveerd als pdf", false, "pdfPad ontbreekt op de creditfactuur");
  }

  // ── RLS-steekproef met een gewoon `authenticated`-JWT ─────────────────────
  const tokenResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: SMOKE_EMAIL, password: wachtwoord }),
  });
  if (!tokenResponse.ok) throw new Error(`Caller-JWT ophalen faalde: ${tokenResponse.status}`);
  const callerToken = ((await tokenResponse.json()) as { access_token: string }).access_token;

  const basisRij = {
    org_id: orgId,
    jaar: JAAR,
    reeks: "F",
    afnemer: { naam: SMOKE_AFNEMER_NAAM, land: "NL" },
    regels: smokeRegels(),
    opmerking: `${MARKER} — RLS-steekproef`,
  };

  const conceptInsert = await callerRest(callerToken, "careon_facturatie_facturen?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...basisRij, status: "concept" }),
  });
  check(
    "controle: met het eigen JWT mag een CONCEPT worden ingevoegd",
    conceptInsert.ok,
    `status=${conceptInsert.status} body=${(await conceptInsert.clone().text()).slice(0, 160)}`,
  );

  const definitiefInsert = await callerRest(callerToken, "careon_facturatie_facturen?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      ...basisRij,
      status: "definitief",
      nummer: `F${JAAR}-9999`,
      volgnummer: 9999,
      factuurdatum: `${JAAR}-06-01`,
      definitief_op: new Date().toISOString(),
    }),
  });
  const definitiefTekst = await definitiefInsert.text();
  check(
    "with-check-policy weigert een zelfgekozen DEFINITIEVE rij via het eigen JWT",
    !definitiefInsert.ok && definitiefTekst.includes("42501"),
    `status=${definitiefInsert.status} body=${definitiefTekst.slice(0, 200)}`,
  );

  const conceptMetNummer = await callerRest(callerToken, "careon_facturatie_facturen?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...basisRij, status: "concept", nummer: `F${JAAR}-9998` }),
  });
  const conceptMetNummerTekst = await conceptMetNummer.text();
  check(
    "with-check-policy weigert een concept mét zelfgekozen nummer",
    !conceptMetNummer.ok && conceptMetNummerTekst.includes("42501"),
    `status=${conceptMetNummer.status} body=${conceptMetNummerTekst.slice(0, 200)}`,
  );

  const jwtUpdate = await callerRest(
    callerToken,
    `careon_facturatie_facturen?org_id=eq.${orgId}&id=eq.${factuurA.id}&select=id`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ opmerking: `${MARKER} — poging` }),
    },
  );
  const jwtUpdateRijen = jwtUpdate.ok ? ((await jwtUpdate.json()) as unknown[]) : null;
  check(
    "met het eigen JWT raakt een update op een uitgereikte factuur 0 rijen (RLS)",
    jwtUpdate.ok && jwtUpdateRijen !== null && jwtUpdateRijen.length === 0,
    `status=${jwtUpdate.status}`,
  );

  const tellerLezen = await callerRest(
    callerToken,
    `careon_facturatie_nummers?org_id=eq.${orgId}&select=reeks,laatste`,
  );
  const tellerSchrijven = await callerRest(callerToken, "careon_facturatie_nummers", {
    method: "POST",
    body: JSON.stringify({ org_id: orgId, reeks: "Z", jaar: JAAR, laatste: 4242 }),
  });
  check(
    "de nummerteller is voor clients lees-only",
    tellerLezen.ok && !tellerSchrijven.ok,
    `lezen=${tellerLezen.status} schrijven=${tellerSchrijven.status}`,
  );

  // ── Fase B: mailpad — DPA-poort + maillog-RLS ─────────────────────────────
  // De poging gebruikt bewust een ONGELDIG ontvangeradres: de route valideert
  // dat vóór elke stateful stap, dus zelfs als de sérver (anders dan dit
  // scriptproces) wél providerconfiguratie draagt, kan deze check nooit een
  // echte e-mail veroorzaken. Zonder configuratie wint de DPA-poort (503);
  // mét configuratie antwoordt de validatie 400 — nooit 200.
  const mailGeconfigureerd =
    envWaarde("CAREON_MAIL_RESEND_API_KEY").length > 0 &&
    envWaarde("CAREON_MAIL_AFZENDER_EMAIL").length > 0 &&
    envWaarde("CAREON_MAIL_AFZENDER_NAAM").length > 0;
  const mailPoging = await appJson<{ error?: string }>(`/api/careon/facturatie/facturen/${factuurA.id}/mail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ontvanger: "geen-geldig-adres" }),
  });
  check(
    mailGeconfigureerd
      ? "mailroute weigert een ongeldige ontvanger vóór elke stateful stap (400)"
      : "mailroute is fail-closed zonder providerconfiguratie (503, DPA-poort)",
    mailPoging.status === (mailGeconfigureerd ? 400 : 503),
    `status=${mailPoging.status}`,
  );
  const logNaPoging = await serviceRest(`careon_facturatie_maillog?org_id=eq.${orgId}&select=id`);
  const logRijen = logNaPoging.ok ? ((await logNaPoging.json()) as unknown[]) : null;
  check(
    "de geweigerde verzendpoging laat geen maillogregel achter",
    logNaPoging.ok && logRijen !== null && logRijen.length === 0,
    `status=${logNaPoging.status} rijen=${logRijen?.length ?? "?"}`,
  );
  const maillogLezen = await callerRest(callerToken, `careon_facturatie_maillog?org_id=eq.${orgId}&select=id`);
  const maillogSchrijven = await callerRest(callerToken, "careon_facturatie_maillog", {
    method: "POST",
    body: JSON.stringify({
      org_id: orgId,
      factuur_id: factuurA.id,
      ontvanger: "vervalst@voorbeeld.nl",
      onderwerp: "vervalste verzendregistratie",
      status: "verzonden",
      poging: 1,
    }),
  });
  check(
    "maillog: lezen mag, een verzendregistratie vervalsen met het caller-JWT niet (RLS)",
    maillogLezen.ok && !maillogSchrijven.ok,
    `lezen=${maillogLezen.status} schrijven=${maillogSchrijven.status}`,
  );
}

// ── Hoofdprogramma ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  eisOmgeving();

  // Draait er een server, en draait die in Supabase-modus (niet demo)?
  let probe: Response;
  try {
    probe = await fetch(`${BASE}/api/auth/session`, { cache: "no-store" });
  } catch (error) {
    console.error(
      `FATAAL: geen server op ${BASE}. Start hem eerst: npm run build && PORT=3210 npm run start ` +
        `(of zet CAREON_E2E_BASE). Details: ${String(error)}`,
    );
    process.exit(1);
  }
  if (probe.status === 501) {
    console.error("FATAAL: de server draait in demo-modus (501 op /api/auth/session). Start zonder CAREON_DEMO_MODE.");
    process.exit(1);
  }
  if (probe.status === 503) {
    console.error("FATAAL: de server mist zijn Supabase-configuratie (503 op /api/auth/session).");
    process.exit(1);
  }
  if (probe.status !== 401) {
    console.error(`FATAAL: onverwacht antwoord van /api/auth/session zonder sessie: ${probe.status}.`);
    process.exit(1);
  }
  console.log(`Live facturatie-gate tegen ${BASE} en Supabase-project ${PROJECT_REF}.`);

  const orgId = await zorgVoorOrganisatie();
  const { userId, wachtwoord } = await zorgVoorGebruiker();
  await bewaakSmokeOrganisatie(orgId, userId);
  await ruimOp(orgId, "vooraf");
  await zorgVoorLidmaatschap(orgId, userId);

  let uitvoeringsFout: unknown = null;
  try {
    await draaiTests(orgId, wachtwoord);
  } catch (error) {
    uitvoeringsFout = error;
    gefaald += 1;
    console.error(`FAIL suite afgebroken — ${String(error)}`);
  } finally {
    // Opruimen gebeurt ALTIJD, ook na een afgebroken run.
    try {
      await bewaakSmokeOrganisatie(orgId, userId);
      await ruimOp(orgId, "achteraf");
      const restPaden = await storagePaden(orgId);
      const restRijen = await serviceRest(`careon_facturatie_facturen?org_id=eq.${orgId}&select=id`);
      const restRijenAantal = restRijen.ok ? ((await restRijen.json()) as unknown[]).length : -1;
      check(
        "opruiming laat geen facturatierijen of storage-objecten achter",
        restPaden.length === 0 && restRijenAantal === 0,
        `objecten=${restPaden.length} rijen=${restRijenAantal}`,
      );
    } catch (error) {
      gefaald += 1;
      console.error(`FAIL opruiming mislukt — ${String(error)}`);
    }
  }

  console.log(`\nFacturatie live-gate: ${geslaagd} geslaagd / ${gefaald} gefaald.`);
  if (uitvoeringsFout && process.env.CAREON_E2E_TRACE === "1") console.error(uitvoeringsFout);
  process.exit(gefaald === 0 ? 0 : 1);
}

// Opzetfouten (ontbrekende server, een organisatie die de bewaking afkeurt)
// zijn geen assertiefouten maar afbreekredenen: één duidelijke regel, en met
// CAREON_E2E_TRACE=1 de volledige stack.
main().catch((error: unknown) => {
  console.error(`FATAAL: ${error instanceof Error ? error.message : String(error)}`);
  if (process.env.CAREON_E2E_TRACE === "1") console.error(error);
  process.exit(1);
});
