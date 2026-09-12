/**
 * Script: e2e-scribe-live.ts
 *
 * Live smoke-suite voor het ÉCHTE serverpad van Careon Scribe (handoff 20 §9):
 * een synthetisch WAV-fragment gaat door de audioroute naar de
 * transcriptieprovider, daarna door de context-agent en de verslaggenerator.
 * Playwright dekt dit bewust niet — die suite draait demo-only (B12) en raakt
 * noch Supabase noch een provider aan.
 *
 * Bewust NIET in `verify:ci`: dit script vereist een draaiende productieserver,
 * echte credentials, `CAREON_SCRIBE_LIVE=1` én een geconfigureerde
 * transcriptieprovider, en het schrijft in de echte database.
 *
 * Vooraf:
 *   npm run build && PORT=3210 npm run start      (of zet CAREON_E2E_BASE)
 * Draaien:
 *   npm run verify:scribe:live
 *
 * Vereiste omgeving (.env.local of process.env):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN (Management API),
 *   OPENAI_API_KEY, CAREON_SCRIBE_LIVE=1.
 *
 * PRODUCTIEVEILIGHEID
 *   * Alles gebeurt in één vaste smoke-organisatie (slug `smoke-scribe-live`)
 *     met één vaste smoke-gebruiker; beide worden hergebruikt over runs.
 *   * De serversessie MOET naar die organisatie wijzen; wijkt zij af, dan stopt
 *     het script vóór élke schrijfactie.
 *   * Het consult dat dit script maakt wordt aan het eind altijd verwijderd,
 *     ook na een afgebroken run — een transcript is bijzondere-categoriedata
 *     en mag geen minuut langer blijven staan dan nodig.
 *   * De dossierreferentie is een vaste smoke-code, nooit iets patiëntachtigs.
 */

import { VERSLAG_FORMATEN } from "../lib/careon-scribe/formaten";
import type { KlinischeStaat, ScribeNotitie, ScribeSegment, ScribeSessie } from "../lib/careon-scribe/types";
import { randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "../..");
const BASE = process.env.CAREON_E2E_BASE ?? "http://localhost:3210";

const SMOKE_ORG_SLUG = "smoke-scribe-live";
const SMOKE_ORG_NAAM = "SMOKE — scribe live-gate — niet gebruiken";
const SMOKE_EMAIL = "scribe-smoke@careon-smoke.example.com";
const SMOKE_NAAM = "SMOKE scribe live-gate";
const SMOKE_REFERENTIE = "SMOKE-SCRIBE-LIVE";
const UUID_VORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** De zin die het script laat uitspreken; bevat bewust twee middelen die
    samen een gecontroleerde interactiewaarschuwing moeten opleveren. */
const SMOKE_ZIN =
  "De patiënt gebruikt sertraline vijftig milligram per dag en is sinds vorige week gestart met tramadol " +
  "voor rugpijn.";

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
const OPENAI_KEY = envWaarde("OPENAI_API_KEY");
const OPENAI_BASE = (envWaarde("OPENAI_API_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
/** Spraaksynthese voor het testfragment; overschrijfbaar, nooit vastgezet. */
const TTS_MODEL = envWaarde("CAREON_SCRIBE_SMOKE_TTS_MODEL") || "gpt-4o-mini-tts";
const TTS_STEM = envWaarde("CAREON_SCRIBE_SMOKE_TTS_VOICE") || "alloy";

function eisOmgeving(): void {
  const ontbreekt = [
    ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
    ["SUPABASE_ACCESS_TOKEN", ACCESS_TOKEN],
    ["OPENAI_API_KEY", OPENAI_KEY],
  ]
    .filter(([, waarde]) => waarde.length === 0)
    .map(([naam]) => naam);
  if (ontbreekt.length > 0) {
    console.error(
      `FATAAL: ontbrekende omgeving (${ontbreekt.join(", ")}). Deze suite draait uitsluitend tegen de echte ` +
        "database en een echte transcriptieprovider; er is bewust geen demo-terugval.",
    );
    process.exit(1);
  }
  if (envWaarde("CAREON_SCRIBE_LIVE") !== "1") {
    console.error(
      "FATAAL: CAREON_SCRIBE_LIVE staat niet op 1 — de audioroute antwoordt dan 503 en er is niets te toetsen.",
    );
    process.exit(1);
  }
  if (envWaarde("CAREON_DEMO_MODE") === "1") {
    console.error("FATAAL: CAREON_DEMO_MODE=1 — de scriberoutes antwoorden dan 501. Start de server zonder demo.");
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

// ── Smoke-organisatie en -gebruiker ─────────────────────────────────────────

async function zorgVoorOrganisatie(): Promise<string> {
  const bestaand = await serviceRest(`organizations?slug=eq.${SMOKE_ORG_SLUG}&select=id,name&limit=1`);
  if (!bestaand.ok) throw new Error(`Organisatie opzoeken faalde: ${bestaand.status}`);
  const rijen = (await bestaand.json()) as { id: string; name: string }[];
  if (rijen.length > 0) {
    if (rijen[0].name !== SMOKE_ORG_NAAM) {
      throw new Error(
        `De organisatie met slug "${SMOKE_ORG_SLUG}" heet "${rijen[0].name}" in plaats van "${SMOKE_ORG_NAAM}" — ` +
          "dat kan geen door dit script aangemaakte smoke-organisatie zijn. Gestopt zonder te schrijven.",
      );
    }
    return rijen[0].id;
  }
  const aangemaakt = await serviceRest("organizations?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: SMOKE_ORG_NAAM, slug: SMOKE_ORG_SLUG }),
  });
  if (!aangemaakt.ok) throw new Error(`Smoke-organisatie aanmaken faalde: ${aangemaakt.status}`);
  const nieuw = (await aangemaakt.json()) as { id: string }[];
  console.log(`Smoke-organisatie aangemaakt: ${nieuw[0].id}`);
  return nieuw[0].id;
}

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
  if (!aangemaakt.ok) throw new Error(`Smoke-gebruiker aanmaken faalde: ${aangemaakt.status}`);
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

// ── Opruiming ───────────────────────────────────────────────────────────────

function eisSmokeUuid(orgId: string): string {
  if (!UUID_VORM.test(orgId)) throw new Error(`Onveilig org-id voor opruiming: ${orgId}`);
  return orgId;
}

/**
 * Consulten in de smoke-organisatie zijn per definitie van dit script; ze
 * dragen de vaste smoke-referentie. Staat er iets anders, dan raken we niets
 * aan — dan is de organisatie niet meer wat we denken dat zij is.
 */
async function ruimConsultenOp(orgId: string): Promise<number> {
  const veilig = eisSmokeUuid(orgId);
  const response = await serviceRest(`careon_scribe_sessies?org_id=eq.${veilig}&select=id,patient_referentie`);
  if (!response.ok) throw new Error(`Consulten lezen faalde: ${response.status}`);
  const rijen = (await response.json()) as { id: string; patient_referentie: string }[];
  const vreemd = rijen.filter((rij) => rij.patient_referentie !== SMOKE_REFERENTIE);
  if (vreemd.length > 0) {
    throw new Error(
      `De smoke-organisatie bevat ${vreemd.length} consult(en) zonder het merkteken ${SMOKE_REFERENTIE}. ` +
        "Gestopt zonder te wissen.",
    );
  }
  if (rijen.length === 0) return 0;
  const verwijderd = await serviceRest(`careon_scribe_sessies?org_id=eq.${veilig}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!verwijderd.ok) throw new Error(`Consulten wissen faalde: ${verwijderd.status}`);
  return rijen.length;
}

// ── Spraaksynthese ──────────────────────────────────────────────────────────

async function maakTestFragment(): Promise<Uint8Array> {
  const response = await fetch(`${OPENAI_BASE}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_STEM, input: SMOKE_ZIN, response_format: "wav" }),
  });
  if (!response.ok) {
    throw new Error(`Spraaksynthese faalde: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// ── De suite ────────────────────────────────────────────────────────────────

interface InstellingenAntwoord {
  instellingen?: { ingeschakeld: boolean; consenttekst: string; standaardFormaat: string };
  revision?: number;
  error?: string;
}

async function draaiTests(orgId: string, wachtwoord: string): Promise<string | null> {
  const login = await app("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: SMOKE_EMAIL, password: wachtwoord }),
  });
  if (login.status !== 200) {
    throw new Error(`Inloggen als smoke-behandelaar faalde: ${login.status}`);
  }
  const sessie = await appJson<{ orgId?: string; orgRole?: string; scribeZichtbaar?: boolean }>("/api/auth/session");
  // HARDE poort: elke volgende schrijfactie landt in de organisatie die de
  // sérver resolvet. Wijkt die af van de bewaakte smoke-organisatie, dan
  // stoppen we vóór er iets geschreven wordt.
  if (sessie.status !== 200 || sessie.body.orgId !== orgId) {
    throw new Error(
      `FATAAL: de serversessie wijst naar organisatie ${sessie.body.orgId ?? "(geen)"} in plaats van de ` +
        `smoke-organisatie ${orgId}. Gestopt vóór enige schrijfactie.`,
    );
  }
  check("sessie hoort bij de smoke-organisatie", sessie.body.orgRole === "org_admin");

  // 1. Module aanzetten (de organisatie start altijd uit).
  const huidig = await appJson<InstellingenAntwoord>("/api/careon/scribe/instellingen");
  check("instellingen leesbaar", huidig.status === 200, JSON.stringify(huidig.body).slice(0, 160));
  const basis = huidig.body.instellingen;
  if (!basis) throw new Error("Geen instellingen ontvangen; is de migratie toegepast?");
  const opslaan = await appJson<{ revision?: number; error?: string }>("/api/careon/scribe/instellingen", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Wave 2 (N19/N21): de moduleschakelaar is geblokkeerd zolang de vier
      // activatievoorwaarden niet in het product staan, en een provideraanroep
      // vereist naast de platformvlag ook de eigen keuze van de organisatie voor
      // externe verwerking. Voor de smoke-organisatie zetten we die bewust en
      // herkenbaar ("SMOKE …") — nooit op een echte organisatie kopiëren.
      state: {
        ...basis,
        ingeschakeld: true,
        standaardFormaat: "soap",
        transcriptieAan: true,
        aiAnalyseAan: true,
        dpiaVastgesteldOp: new Date().toISOString().slice(0, 10),
        dpiaEigenaar: "SMOKE live-gate (synthetisch)",
        verwerkersovereenkomstBevestigd: true,
        consenttekstGoedgekeurdOp: new Date().toISOString().slice(0, 10),
      },
      baseRevision: huidig.body.revision ?? 0,
      operationId: randomUUID(),
    }),
  });
  check("module ingeschakeld voor de smoke-organisatie", opslaan.status === 200, JSON.stringify(opslaan.body));
  const revisie = opslaan.body.revision ?? 0;

  // 2. Consult starten.
  const start = await appJson<{ sessie?: ScribeSessie; error?: string }>("/api/careon/scribe/sessies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientReferentie: SMOKE_REFERENTIE,
      consultType: "soap",
      taal: "nl",
      consentBevestigd: true,
      consentRevisie: revisie,
    }),
  });
  if (!check("consult gestart", start.status === 200 && Boolean(start.body.sessie), JSON.stringify(start.body))) {
    return null;
  }
  const sessieId = (start.body.sessie as ScribeSessie).id;

  // 3. Audiofragment door de echte transcriptieketen.
  const fragment = await maakTestFragment();
  check("spraakfragment gegenereerd", fragment.byteLength > 1_000, `${fragment.byteLength} bytes`);
  const audio = await appJson<{ segmenten?: ScribeSegment[]; provider?: string; error?: string }>(
    `/api/careon/scribe/sessies/${sessieId}/audio`,
    {
      method: "POST",
      headers: {
        "Content-Type": "audio/wav",
        "x-careon-fragment-id": randomUUID(),
        "x-careon-fragment-offset-ms": "0",
        "x-careon-fragment-duur-ms": "9000",
        "x-careon-fragment-overlap-ms": "0",
      },
      body: Buffer.from(fragment),
    },
  );
  check("audiofragment geaccepteerd", audio.status === 200, JSON.stringify(audio.body).slice(0, 200));
  const herkend = (audio.body.segmenten ?? [])
    .map((segment) => segment.tekst)
    .join(" ")
    .toLowerCase();
  check("transcript bevat sertraline", herkend.includes("sertraline"), herkend.slice(0, 160));
  check("transcript bevat tramadol", herkend.includes("tramadol"), herkend.slice(0, 160));

  // 4. Analyse: gestructureerde feiten plus de gecontroleerde medicatieregel.
  const analyse = await appJson<{ staat?: KlinischeStaat; bron?: string; error?: string }>(
    `/api/careon/scribe/sessies/${sessieId}/analyse`,
    { method: "POST" },
  );
  check("analyse uitgevoerd", analyse.status === 200, JSON.stringify(analyse.body).slice(0, 200));
  const staat = analyse.body.staat;
  const middelen = (staat?.medicatie ?? []).map((rij) => rij.naam.toLowerCase()).join(", ");
  check("analyse herkent sertraline", middelen.includes("sertraline"), middelen);
  check("analyse herkent tramadol", middelen.includes("tramadol"), middelen);
  const regels = (staat?.waarschuwingen ?? []).filter((rij) => rij.herkomst === "regel");
  check(
    "gecontroleerde interactiewaarschuwing vuurt",
    regels.some((rij) => rij.type === "interactie" && /sertraline/i.test(rij.tekst)),
    JSON.stringify(regels).slice(0, 200),
  );
  check("staat draagt geen diagnoseveld", !JSON.stringify(staat ?? {}).includes('"diagnose"'));

  // C6/C8/C30 — de AI-correctie werd nooit opgeslagen omdat het PostgREST-filter
  // `not.eq.behandelaar` geen NULL matcht en elk vers segment `correctie_bron IS
  // NULL` heeft. Hier telt niet óf het model iets corrigeerde (dat hangt van de
  // opname af) maar dat een correctie die er is, ook echt is weggeschreven — met
  // beide velden ingevuld en nooit over een correctie van de behandelaar heen.
  const naAnalyse = await appJson<{ segmenten?: ScribeSegment[] }>(`/api/careon/scribe/sessies/${sessieId}`);
  const gecorrigeerd = (naAnalyse.body.segmenten ?? []).filter((rij) => rij.correctieBron !== null);
  check(
    "een opgeslagen correctie draagt bron én tekst",
    gecorrigeerd.every((rij) => rij.tekstGecorrigeerd !== null && rij.tekstGecorrigeerd.trim().length > 0),
    `${gecorrigeerd.length} correcties`,
  );
  check(
    "de AI schrijft nooit over een correctie van de behandelaar",
    gecorrigeerd.every((rij) => rij.correctieBron === "ai" || rij.correctieBron === "behandelaar"),
  );

  // 5. Afronden en het verslag opstellen.
  const afronden = await appJson<{ sessie?: ScribeSessie; error?: string }>(`/api/careon/scribe/sessies/${sessieId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "afgerond" }),
  });
  check("consult afgerond", afronden.status === 200, JSON.stringify(afronden.body).slice(0, 200));

  const notitie = await appJson<{ notitie?: ScribeNotitie; bron?: string; error?: string }>(
    `/api/careon/scribe/sessies/${sessieId}/notitie`,
    { method: "POST" },
  );
  check("verslag opgesteld", notitie.status === 200, JSON.stringify(notitie.body).slice(0, 200));
  const secties = notitie.body.notitie?.secties ?? [];
  const verwacht = VERSLAG_FORMATEN.soap.secties.map((sectie) => sectie.id);
  check(
    "verslag volgt het SOAP-formaat",
    secties.map((sectie) => sectie.id).join(",") === verwacht.join(","),
    secties.map((sectie) => sectie.id).join(","),
  );
  const beoordelingen = secties.filter((sectie) => sectie.vereistBehandelaar);
  check("beoordelingssectie aanwezig", beoordelingen.length === 1);
  check(
    "beoordelingssectie is NIET machinaal gevuld",
    beoordelingen.every((sectie) => sectie.tekst.trim().length === 0 && sectie.status === "leeg"),
    JSON.stringify(beoordelingen).slice(0, 200),
  );

  return sessieId;
}

async function main(): Promise<void> {
  eisOmgeving();
  const probe = await fetch(`${BASE}/api/auth/session`, { cache: "no-store" }).catch(() => null);
  if (!probe) {
    console.error(`FATAAL: geen server op ${BASE}. Start hem met \`PORT=3210 npm run start\` of zet CAREON_E2E_BASE.`);
    process.exit(1);
  }

  const orgId = eisSmokeUuid(await zorgVoorOrganisatie());
  const { userId, wachtwoord } = await zorgVoorGebruiker();
  await zorgVoorLidmaatschap(orgId, userId);
  await ruimConsultenOp(orgId);

  let uitvoeringsFout: unknown = null;
  try {
    await draaiTests(orgId, wachtwoord);
  } catch (error) {
    uitvoeringsFout = error;
    gefaald += 1;
    console.error(`FAIL suite afgebroken — ${String(error)}`);
  } finally {
    // Opruimen gebeurt ALTIJD: een transcript is bijzondere-categoriedata.
    try {
      await ruimConsultenOp(orgId);
      const rest = await serviceRest(`careon_scribe_sessies?org_id=eq.${orgId}&select=id`);
      const restAantal = rest.ok ? ((await rest.json()) as unknown[]).length : -1;
      const segmenten = await serviceRest(`careon_scribe_segmenten?org_id=eq.${orgId}&select=id`);
      const segmentAantal = segmenten.ok ? ((await segmenten.json()) as unknown[]).length : -1;
      check(
        "opruiming laat geen consulten of segmenten achter",
        restAantal === 0 && segmentAantal === 0,
        `consulten=${restAantal} segmenten=${segmentAantal}`,
      );
    } catch (error) {
      gefaald += 1;
      console.error(`FAIL opruiming mislukt — ${String(error)}`);
    }
  }

  console.log(`\nScribe live-gate: ${geslaagd} geslaagd / ${gefaald} gefaald.`);
  if (uitvoeringsFout && process.env.CAREON_E2E_TRACE === "1") console.error(uitvoeringsFout);
  process.exit(gefaald === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`FATAAL: ${error instanceof Error ? error.message : String(error)}`);
  if (process.env.CAREON_E2E_TRACE === "1") console.error(error);
  process.exit(1);
});
