/** Contact creation/editing routes with synthetic records and intercepted I/O.
 * No .env file, provider, Storage, network connection or database is used. */

import ts from "typescript";

import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const actor = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222" };
const modules = new Map();
const audits = [];
let denial = null;
const stubs = new Map([
  ["next/server", { NextResponse: { json: (body, options) => Response.json(body, options) } }],
  [
    "@/lib/supabase/postgrest.server",
    {
      POSTGREST_URL: "https://offline.invalid/rest/v1",
      userRestHeaders: (session, extra) => {
        assert.equal(session, actor);
        return { Authorization: "Bearer synthetic-contact-actor", ...extra };
      },
    },
  ],
  [
    "@/lib/supabase/session.server",
    {
      requireOrgAdmin: async () =>
        denial ? { denied: Response.json({ error: "Niet toegestaan." }, { status: denial }) } : { session: actor },
    },
  ],
  ["@/lib/careon-audit/audit.server", { scheduleAuditEvent: (event) => audits.push(event) }],
]);

// Keep the route module cache private: other offline verification suites load
// these helpers with their own auth/storage stubs in the same Node process.
function load(file) {
  const filename = path.resolve(root, file);
  if (modules.has(filename)) return modules.get(filename).exports;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (name) => {
    if (stubs.has(name)) return stubs.get(name);
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/")
        ? path.resolve(root, "src", name.slice(2))
        : path.resolve(path.dirname(filename), name);
      const target = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => fs.existsSync(candidate));
      if (target) return load(target);
    }
    return require(name);
  };
  modules.set(filename, loaded);
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText,
    filename,
  );
  return loaded.exports;
}

const collection = load("src/app/api/careon/facturatie/contacten/route.ts");
const detail = load("src/app/api/careon/facturatie/contacten/[contactId]/route.ts");
const { CONTACT_SELECT } = load("src/lib/careon-facturatie/facturatie.server.ts");
const { FACTURATIE_LIMITS, isFacturatieContact } = load("src/lib/careon-facturatie/types.ts");
const endpoint = "https://offline.invalid/api/careon/facturatie/contacten";
const databaseTime = "2026-09-12T12:00:00.000Z";
const db = new Map();
const calls = [];
let storageMode = "healthy";
let checks = 0;

// Same payload as the new-contact UI after entering TGC and pressing Add.
function contact(overrides = {}) {
  return {
    id: "",
    soort: "organisatie",
    bron: "handmatig",
    naam: "TGC",
    land: "NL",
    archief: false,
    updatedAt: "2000-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function request(value, method = "POST") {
  return new Request(endpoint, { method, body: JSON.stringify({ contact: value }) });
}

function context(contactId) {
  return { params: Promise.resolve({ contactId }) };
}

async function succeeds(value) {
  const before = calls.length;
  const response = await collection.POST(request(value));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.configured, true);
  assert.equal(calls.length, before + 1);
  assert.equal(isFacturatieContact(result.contact), true, "Created contacts must satisfy the persisted model");
  assert.equal(result.contact.updatedAt, databaseTime);
  assert.equal(audits.at(-1).action, "facturatie.contact.toevoegen");
  assert.equal(audits.at(-1).resourceId, result.contact.id);
  assert.equal(audits.at(-1).orgId, actor.orgId);
  checks += 1;
  return result.contact;
}

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input, options = {}) => {
    const query = new URL(input);
    assert.equal(query.origin + query.pathname, "https://offline.invalid/rest/v1/careon_facturatie_contacten");
    assert.equal(query.searchParams.get("select"), CONTACT_SELECT);
    assert.equal(options.headers.Authorization, "Bearer synthetic-contact-actor");
    const method = options.method ?? "GET";
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, payload, query });
    if (storageMode === "unavailable") return Response.json({ error: "unavailable" }, { status: 503 });
    if (storageMode === "empty-write") return Response.json([]);
    if (method === "POST") {
      assert.equal(options.headers.Prefer, "return=representation");
      assert.equal(payload.org_id, actor.orgId);
      assert.equal(payload.created_by, actor.userId);
      assert.equal(Object.hasOwn(payload, "id"), false, "Only the database allocates contact IDs");
      assert.equal(Object.hasOwn(payload, "created_at"), false);
      assert.equal(Object.hasOwn(payload, "updatedAt"), false);
      assert.ok(!Number.isNaN(Date.parse(payload.updated_at)));
      assert.notEqual(payload.updated_at, contact().updatedAt, "Client timestamps must not control the row");
      const id = `33333333-3333-4333-8333-${String(db.size + 1).padStart(12, "0")}`;
      const row = { ...payload, id, updated_at: databaseTime };
      db.set(id, row);
      return Response.json([row]);
    }
    assert.equal(query.searchParams.get("org_id"), `eq.${actor.orgId}`);
    if (method === "GET") {
      assert.equal(query.searchParams.get("order"), "naam.asc");
      assert.equal(query.searchParams.get("limit"), String(FACTURATIE_LIMITS.contacten));
      assert.equal(options.cache, "no-store");
      return Response.json([...db.values()].sort((a, b) => a.naam.localeCompare(b.naam)));
    }
    assert.equal(method, "PATCH");
    assert.equal(options.headers.Prefer, "return=representation");
    for (const key of ["id", "org_id", "created_by"]) assert.equal(Object.hasOwn(payload, key), false);
    const row = db.get(query.searchParams.get("id")?.slice(3));
    if (!row) return Response.json([]);
    Object.assign(row, payload, { updated_at: databaseTime });
    return Response.json([row]);
  };

  const tgc = await succeeds(contact());
  assert.equal(tgc.naam, "TGC");
  assert.notEqual(tgc.id, "");
  assert.equal(db.get(tgc.id).naam, "TGC");

  const { id: _id, updatedAt: _updatedAt, ...withoutMetadata } = contact({ naam: "  Nieuwe organisatie  " });
  const created = await succeeds(withoutMetadata);
  assert.equal(created.naam, "Nieuwe organisatie");
  assert.notEqual(created.id, tgc.id);

  const malicious = await succeeds(
    contact({
      id: "44444444-4444-4444-8444-444444444444",
      org_id: "55555555-5555-4555-8555-555555555555",
      created_by: "66666666-6666-4666-8666-666666666666",
      updated_at: "1900-01-01T00:00:00.000Z",
      created_at: "1900-01-01T00:00:00.000Z",
    }),
  );
  assert.notEqual(malicious.id, "44444444-4444-4444-8444-444444444444");
  assert.equal(db.get(malicious.id).org_id, actor.orgId);
  assert.equal(db.get(malicious.id).created_by, actor.userId);

  const medewerker = await succeeds(
    contact({
      soort: "medewerker",
      bron: "medewerker",
      naam: "Synthetische medewerker",
      email: "medewerker@example.invalid",
      notitie: "Administratie",
      medewerkerNaam: "Synthetische medewerker",
      medewerkerUserId: "77777777-7777-4777-8777-777777777777",
    }),
  );
  assert.equal(medewerker.medewerkerNaam, "Synthetische medewerker");
  assert.equal(db.get(medewerker.id).medewerker_user_id, medewerker.medewerkerUserId);
  assert.equal(medewerker.soort, "medewerker");
  assert.equal(medewerker.bron, "medewerker");

  const listed = await collection.GET();
  assert.equal(listed.status, 200);
  const contacten = (await listed.json()).contacten;
  assert.equal(contacten.length, 4);
  assert.deepEqual(
    contacten.find((entry) => entry.id === tgc.id),
    tgc,
  );
  assert.equal(contacten.every(isFacturatieContact), true);
  checks += 1;

  for (const malformed of [
    null,
    [],
    contact({ naam: "   " }),
    contact({ naam: "x".repeat(FACTURATIE_LIMITS.naam + 1) }),
    contact({ soort: "onbekend" }),
    contact({ bron: "onbekend" }),
    contact({ land: "NLD" }),
    contact({ email: 123 }),
    contact({ email: "x".repeat(FACTURATIE_LIMITS.email + 1) }),
    contact({ kvkNummer: "abc" }),
    contact({ uzovi: "123" }),
    contact({ betaaltermijnDagen: -1 }),
    contact({ betaaltermijnDagen: 1.5 }),
    contact({ betaaltermijnDagen: FACTURATIE_LIMITS.betaaltermijnDagen + 1 }),
    contact({ notitie: "x".repeat(FACTURATIE_LIMITS.notitie + 1) }),
    contact({ archief: "false" }),
    contact({ medewerkerUserId: 123 }),
  ]) {
    const before = { writes: calls.length, audits: audits.length, rows: db.size };
    const response = await collection.POST(request(malformed));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Ongeldig contact." });
    assert.deepEqual({ writes: calls.length, audits: audits.length, rows: db.size }, before);
    checks += 1;
  }

  for (const [body, status, error] of [
    ["{", 400, "Ongeldige JSON."],
    ["x".repeat(50_001), 413, "Payload te groot."],
  ]) {
    const before = calls.length;
    const response = await collection.POST(new Request(endpoint, { method: "POST", body }));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
    assert.equal(calls.length, before);
    checks += 1;
  }

  const patched = await detail.PATCH(
    request({ ...tgc, naam: "TGC bijgewerkt", archief: true }, "PATCH"),
    context(tgc.id),
  );
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).contact.naam, "TGC bijgewerkt");
  assert.equal(db.get(tgc.id).archief, true);
  assert.equal(audits.at(-1).action, "facturatie.contact.wijzig");
  checks += 1;
  for (const incomplete of [withoutMetadata, contact(), { ...tgc, updatedAt: undefined }]) {
    const before = calls.length;
    const response = await detail.PATCH(request(incomplete, "PATCH"), context(tgc.id));
    assert.equal(response.status, 400, "PATCH still requires a complete persisted contact");
    assert.equal(calls.length, before);
    checks += 1;
  }

  for (const status of [401, 403]) {
    denial = status;
    const before = { writes: calls.length, audits: audits.length };
    for (const response of [
      await collection.POST(request(contact())),
      await collection.GET(),
      await detail.PATCH(request(tgc, "PATCH"), context(tgc.id)),
    ]) {
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: "Niet toegestaan." });
      checks += 1;
    }
    assert.deepEqual({ writes: calls.length, audits: audits.length }, before);
  }
  denial = null;

  for (const mode of ["unavailable", "empty-write"]) {
    storageMode = mode;
    const before = { rows: db.size, audits: audits.length };
    const response = await collection.POST(request(contact()));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Supabase niet bereikbaar." });
    assert.deepEqual({ rows: db.size, audits: audits.length }, before);
    checks += 1;
  }
  storageMode = "unavailable";
  const outage = await collection.GET();
  assert.equal(outage.status, 502);
  assert.deepEqual(await outage.json(), { error: "Supabase niet bereikbaar." });
  checks += 1;
  console.log(`verify-facturatie-contacten: ${checks} route/helper scenarios passed (synthetic, no network)`);
} finally {
  globalThis.fetch = originalFetch;
}
