/** Actual route/helper execution with synthetic records and intercepted I/O.
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
const stubs = new Map([
  ["next/server", { NextResponse: { json: (body, options) => Response.json(body, options) } }],
  [
    "@/lib/supabase/postgrest.server",
    { POSTGREST_URL: "https://offline.invalid/rest/v1", userRestHeaders: () => ({}) },
  ],
  ["@/lib/supabase/session.server", { requireOrgAdmin: async () => ({ session: actor }) }],
  ["@/lib/careon-audit/audit.server", { scheduleAuditEvent: () => undefined }],
  ["@/lib/careon-facturatie/pdf-archief.server", { genereerEnArchiveerPdf: async () => ({ ok: false }) }],
]);

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

const data = load("src/data/careon/careon-facturatie.ts");
const storage = load("src/lib/careon-facturatie/facturatie.server.ts");
const readInvoiceRow = storage.haalFactuurRij;
const { berekenTotalen } = load("src/lib/careon-facturatie/totalen.ts");
const db = new Map();
let afterSettings = () => undefined;
let calls = [];
storage.storageBeschikbaar = () => true;
storage.haalFactuurRij = async (_session, id) => structuredClone(db.get(id) ?? null);
storage.haalInstellingen = async () => {
  afterSettings();
  return { instellingen: structuredClone(data.DEMO_FACTURATIE_INSTELLINGEN), revision: 1 };
};

function row(status = "concept") {
  const invoice = structuredClone(data.DEMO_FACTUREN[0]);
  invoice.afzender.templateId = "careongroup";
  return {
    ...storage.conceptRijVanFactuur(invoice),
    id: "33333333-3333-4333-8333-333333333333",
    org_id: actor.orgId,
    revision: 1,
    status,
    soort: "factuur",
    reeks: "F",
    jaar: 2026,
    volgnummer: status === "concept" ? null : 1,
    nummer: status === "concept" ? null : "F2026-0001",
    gecrediteerde_factuur_id: null,
    valuta: "EUR",
    betaald_op: null,
    pdf_pad: null,
    mail_status: "niet_verzonden",
    mail_verzonden_op: null,
    created_at: "2026-09-05T00:00:00Z",
    updated_at: "2026-09-05T00:00:00Z",
  };
}

const issue = load("src/app/api/careon/facturatie/facturen/[factuurId]/definitief/route.ts");
const credit = load("src/app/api/careon/facturatie/facturen/[factuurId]/credit/route.ts");
function request() {
  return new Request("https://offline.invalid", {
    method: "POST",
    body: JSON.stringify({ factuurdatum: "2026-09-05" }),
  });
}
const params = { params: Promise.resolve({ factuurId: row().id }) };
const originalFetch = globalThis.fetch;
let checks = 0;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://offline.invalid/rest/v1/rpc/careon_factuur_uitreiken_atomic");
    assert.equal(options.method, "POST");
    const payload = JSON.parse(options.body);
    calls.push(payload);
    const current = db.get(payload.p_factuur);
    assert.equal(payload.p_actor, actor.userId);
    assert.equal(payload.p_org, actor.orgId);
    if (payload.p_expected_revision !== current.revision) return Response.json({ code: "40001" }, { status: 409 });
    Object.assign(current, payload.p_snapshot, { status: "definitief", nummer: "F2026-0001", volgnummer: 1 });
    return Response.json({ factuur_id: current.id, already_issued: false });
  };
  const initial = row();
  db.set(initial.id, initial);
  afterSettings = () => {
    initial.regels[0].stukprijsCent += 1000;
    initial.revision += 1;
  };
  const conflicted = await issue.POST(request(), params);
  assert.equal(conflicted.status, 409);
  assert.equal(initial.status, "concept");
  assert.equal(calls.length, 1);
  checks += 3;

  afterSettings = () => undefined;
  calls = [];
  db.set(initial.id, row());
  const issued = await issue.POST(request(), params);
  assert.equal(issued.status, 200);
  assert.equal(calls.length, 1);
  const stored = db.get(initial.id);
  assert.deepEqual(berekenTotalen(stored.regels), {
    subtotaalCent: stored.subtotaal_cent,
    btwCent: stored.btw_cent,
    totaalCent: stored.totaal_cent,
    btwTotalen: stored.btw_totalen,
  });
  assert.ok(calls[0].p_snapshot.afnemer && calls[0].p_snapshot.afzender && calls[0].p_snapshot.prestatie_van);
  const retried = await issue.POST(request(), params);
  assert.equal(retried.status, 200);
  assert.equal(calls.length, 1);
  checks += 6;

  let transactionCount = 0;
  const credited = row("definitief");
  db.set(credited.id, credited);
  const creditId = "44444444-4444-4444-8444-444444444444";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://offline.invalid/rest/v1/rpc/careon_factuur_uitreiken_atomic");
    const payload = JSON.parse(options.body);
    assert.equal(payload.p_credit, true);
    if (db.has(creditId)) return Response.json({ factuur_id: creditId, already_issued: true });
    transactionCount += 1;
    db.set(creditId, {
      ...credited,
      ...payload.p_snapshot,
      id: creditId,
      soort: "creditfactuur",
      nummer: "C2026-0001",
    });
    credited.status = "gecrediteerd";
    return Response.json({ factuur_id: creditId, already_issued: false });
  };
  const responses = await Promise.all([credit.POST(request(), params), credit.POST(request(), params)]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200],
  );
  assert.equal(transactionCount, 1);
  assert.equal((await responses[0].json()).factuur.id, creditId);
  assert.equal((await responses[1].json()).factuur.id, creditId);
  storage.haalInstellingen = async () => {
    throw new Error("Retry must not require current template settings");
  };
  assert.equal((await credit.POST(request(), params)).status, 200);
  checks += 5;

  // Follow the editor's actual client -> GET route -> storage helper path.
  // A healthy PostgREST UUID column rejects malformed values with HTTP 400;
  // that must never be presented to the user as a database outage.
  storage.haalFactuurRij = readInvoiceRow;
  const detail = load("src/app/api/careon/facturatie/facturen/[factuurId]/route.ts");
  const remote = load("src/lib/careon-facturatie/remote.client.ts");
  const invoiceReads = [];
  let invoiceRowsResponse = (id) => Response.json(db.has(id) ? [db.get(id)] : []);
  const missingId = "00000000-0000-4000-8000-000000000001";
  const notFound = "Deze factuur bestaat niet (meer) voor deze organisatie.";
  globalThis.fetch = async (input) => {
    if (input.startsWith("/api/careon/facturatie/facturen/")) {
      return detail.GET(new Request(`https://offline.invalid${input}`), {
        params: Promise.resolve({ factuurId: input.slice(input.lastIndexOf("/") + 1) }),
      });
    }
    const query = new URL(input);
    assert.equal(query.origin + query.pathname, "https://offline.invalid/rest/v1/careon_facturatie_facturen");
    assert.equal(query.searchParams.get("org_id"), `eq.${actor.orgId}`);
    assert.equal(query.searchParams.get("limit"), "1");
    invoiceReads.push(query);
    const id = query.searchParams.get("id").slice(3);
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      return Response.json({ code: "22P02" }, { status: 400 });
    }
    return invoiceRowsResponse(id);
  };
  for (const malformedId of ["verification-invalid-invoice", "not-a-uuid", "g".repeat(36)]) {
    const result = await remote.haalFactuur(malformedId);
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.fout, notFound);
    assert.equal(invoiceReads.length, 0, "Malformed invoice IDs must not reach PostgREST");
    checks += 1;
  }
  const missing = await remote.haalFactuur(missingId);
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);
  assert.equal(missing.fout, notFound);
  assert.equal(invoiceReads.length, 1);
  checks += 1;
  const existing = await remote.haalFactuur(row().id);
  assert.equal(existing.ok, true);
  assert.equal(existing.factuur.id, row().id);
  assert.equal(invoiceReads.length, 2);
  checks += 1;
  invoiceRowsResponse = () => Response.json({ error: "unavailable" }, { status: 503 });
  const outage = await remote.haalFactuur(missingId);
  assert.equal(outage.ok, false);
  assert.equal(outage.status, 502);
  assert.equal(outage.fout, "Supabase niet bereikbaar.");
  assert.equal(invoiceReads.length, 3);
  checks += 1;
  stubs.get("@/lib/supabase/session.server").requireOrgAdmin = async () => ({
    denied: Response.json({ error: "Niet toegestaan." }, { status: 403 }),
  });
  const denied = await remote.haalFactuur("verification-invalid-invoice");
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.equal(invoiceReads.length, 3, "The original authorization gate still precedes invoice lookup");
  checks += 1;
  console.log(`verify-facturatie-atomic: ${checks} route/helper checks passed (synthetic, no network)`);
} finally {
  globalThis.fetch = originalFetch;
}
