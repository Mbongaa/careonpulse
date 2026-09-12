/** Execute actual Scribe route handlers with synthetic auth/storage adapters.
 * The PostgreSQL suite separately exercises the real RPC/RLS implementation.
 * No Next server, credentials, network, or clinical/provider calls are used.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const sessionId = "00000000-0000-4000-8000-000000000001";
const noteId = "00000000-0000-4000-8000-000000000002";
let checks = 0;
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}

function environment() {
  const state = {
    auth: { session: { orgId: "synthetic-org", userId: "synthetic-owner", role: "member" } },
    permission: null,
    row: {
      id: sessionId,
      org_id: "synthetic-org",
      behandelaar_id: "synthetic-owner",
      status: "afgerond",
      created_at: "2026-09-10T08:00:00Z",
      segment_teller: 1,
      ontbrekende_fragmenten: 0,
    },
    note: {
      id: noteId,
      sessie_id: sessionId,
      versie: 1,
      bewerk_revisie: 3,
      formaat: "soap",
      status: "goedgekeurd",
      secties: [{ id: "plan", titel: "Plan", tekst: "Synthetic approved text", status: "goedgekeurd", bron: [] }],
    },
    clinical: { staat: {}, versie: 4, laatsteSegment: 1, verouderd: false, epdLijstBeoordeeld: false },
    role: "eigenaar",
    audit: [],
    rpcCalls: [],
    serviceCalls: [],
    analyses: 0,
    rpcReply: undefined,
    rpcError: null,
    serviceReply: { id: sessionId, verwijderd: true, segmenten: 1, notities: 0, rol: "eigenaar" },
    serviceError: null,
    adminDenied: null,
  };
  const server = {
    eisScribeMachtiging: async () => state.permission,
    eisScribeQuota: async () => null,
    haalSessieRij: async () => state.row,
    haalBeheerSessieRij: async () => state.row,
    haalLaatsteNotitieRij: async () => state.note,
    haalStaatRij: async () => state.clinical,
    haalTaakRijen: async () => [],
    haalVrijgegevenSessieIds: async () => [],
    telGoedgekeurdeNotities: async () => 0,
    leesRolVoor: () => state.role,
    staatVanRij: (row) => row,
    notitieVanRij: (row) => ({ ...row, bewerkRevisie: row.bewerk_revisie }),
    segmentVanRij: (row) => row,
    sessieVanRij: (row) => ({ ...row, patientReferentie: "SYN-100", gestartOp: row.created_at }),
    taakVanRij: (row) => row,
    pasStaatMutatieToe: (value) => value,
    SCRIBE_SESSIES_TABEL: "careon_scribe_sessies",
    SCRIBE_NOTITIES_TABEL: "careon_scribe_notities",
    scribeRpc: async (_session, name, body) => {
      state.rpcCalls.push({ name, body });
      // biome-ignore lint/suspicious/noUnnecessaryConditions: Tests mutate this injected failure after construction.
      if (state.rpcError) throw state.rpcError;
      return state.rpcReply;
    },
    scribeServiceRpc: async (name, body) => {
      state.serviceCalls.push({ name, body });
      // biome-ignore lint/suspicious/noUnnecessaryConditions: Tests mutate this injected failure after construction.
      if (state.serviceError) throw state.serviceError;
      return state.serviceReply;
    },
    voerScribeAnalyseUit: async () => {
      state.analyses += 1;
      return { ...state.clinical, bron: "deterministisch", sprekers: [], correcties: [], taken: [] };
    },
    scribeFoutAntwoord: (error) =>
      Response.json({ error: "Synthetic storage rejection" }, { status: error.status ?? 500 }),
  };
  const mocks = {
    "@/lib/careon-scribe/scribe.server": new Proxy(server, {
      get(target, property) {
        if (property in target) return target[property];
        throw new Error(`Unexpected storage dependency ${String(property)}`);
      },
    }),
    "@/lib/careon-audit/audit.server": { scheduleAuditEvent: (event) => state.audit.push(event) },
    "@/lib/supabase/session.server": {
      requireCareonSession: async () => state.auth,
      // biome-ignore lint/suspicious/noUnnecessaryConditions: Tests mutate this authorization result after construction.
      requireOrgAdmin: async () => (state.adminDenied ? { denied: state.adminDenied } : state.auth),
    },
    // biome-ignore lint/suspicious/noUnnecessaryConditions: The unauthenticated fixture replaces session with denied.
    "@/lib/careon-scribe-rol": { magScribeBeheren: () => state.auth.session?.role === "org_admin" },
    "@/lib/careon-scribe/deterministisch": { rondStaatAf: (value) => value },
    "@/lib/careon-scribe/klinische-staat": { isKlinischeStaat: () => true },
  };
  const cache = new Map();
  function load(filename) {
    const absolute = path.resolve(root, filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const compiled = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      fileName: absolute,
    }).outputText;
    const loaded = new Module(absolute, module);
    loaded.filename = absolute;
    loaded.paths = Module._nodeModulePaths(path.dirname(absolute));
    cache.set(absolute, loaded);
    loaded.require = (specifier) => {
      if (specifier in mocks) return mocks[specifier];
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const base = specifier.startsWith("@/")
          ? path.join(root, "src", specifier.slice(2))
          : path.resolve(path.dirname(absolute), specifier);
        for (const suffix of [".ts", ".tsx", "/index.ts"]) {
          if (fs.existsSync(base + suffix)) return load(base + suffix);
        }
      }
      return require(specifier);
    };
    loaded._compile(compiled, absolute);
    return loaded.exports;
  }
  return { state, route: (relative) => load(`src/app/api/careon/scribe/${relative}/route.ts`), load };
}

function context(extra = {}) {
  return { params: Promise.resolve({ sessieId: sessionId, notitieId: noteId, volgnummer: "1", ...extra }) };
}
function request(method, body, query = "") {
  return new Request(`http://synthetic.invalid/api/scribe${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

async function verifyNote() {
  const { state, route } = environment();
  const handler = route("sessies/[sessieId]/notitie/[notitieId]").PATCH;
  const patch = {
    bewerkRevisie: 3,
    secties: [{ id: "plan", tekst: "Changed text", status: "goedgekeurd" }],
    ontbrekendeFragmentenBeoordeeld: true,
  };
  equal(
    (await handler(request("PATCH", { secties: patch.secties }), context())).status,
    409,
    "revisionless update refused",
  );
  equal(state.rpcCalls.length, 0, "revisionless update never reaches database");
  equal(
    (await handler(request("PATCH", { ...patch, secties: [{ id: "plan", tekst: null }] }), context())).status,
    400,
    "null section text refused",
  );
  state.rpcError = { status: 409 };
  equal((await handler(request("PATCH", patch), context())).status, 409, "database CAS conflict remains HTTP409");
  equal(state.audit.length, 0, "failed approval emits no successful audit");
  state.rpcError = null;
  state.rpcReply = { notitie: { ...state.note, bewerk_revisie: 4 }, overgeslagen: [], goedgekeurd: true };
  const accepted = await handler(request("PATCH", patch), context());
  equal(accepted.status, 200, "approved atomic note result returned");
  equal((await accepted.json()).notitie.bewerkRevisie, 4, "new edit revision returned to UI");
  equal(
    state.rpcCalls.at(-1),
    {
      name: "careon_scribe_notitie_bewerken",
      body: {
        p_notitie: noteId,
        p_sessie: sessionId,
        p_revisie: 3,
        p_patches: patch.secties,
        p_alle_goedkeuren: false,
        p_gaten_beoordeeld: true,
      },
    },
    "text and approval share one CAS RPC with session binding",
  );
  equal(
    state.audit.filter((event) => event.action === "scribe.notitie.goedgekeurd").length,
    1,
    "only successful approval audited",
  );
  state.auth = { denied: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const previous = state.rpcCalls.length;
  equal((await handler(request("PATCH", patch), context())).status, 401, "unauthenticated note edit refused");
  equal(state.rpcCalls.length, previous, "unauthenticated request cannot mutate");
}

async function verifyDelete() {
  const { state, route } = environment();
  const handler = route("sessies/[sessieId]").DELETE;
  state.note = null;
  state.serviceReply = { id: sessionId, verwijderd: false, segmenten: 0, notities: 0, rol: "eigenaar" };
  equal((await handler(request("DELETE", {}), context())).status, 502, "empty delete evidence cannot report success");
  equal(state.audit.length, 0, "no false deletion audit");
  state.serviceReply = { id: "wrong-id", verwijderd: true, segmenten: 1, notities: 0, rol: "eigenaar" };
  equal((await handler(request("DELETE", {}), context())).status, 502, "wrong deleted row evidence refused");
  state.serviceError = { status: 404 };
  equal((await handler(request("DELETE", {}), context())).status, 404, "concurrent deletion stays404");
  state.serviceError = null;
  state.serviceReply = { id: sessionId, verwijderd: true, segmenten: 7, notities: 2, rol: "eigenaar" };
  const accepted = await handler(request("DELETE", {}), context());
  equal(accepted.status, 200, "confirmed row deletion succeeds");
  equal((await accepted.json()).segmenten, 7, "returns actual database delete count");
  equal(state.audit[0].detail.notities, 2, "audits actual database count");
  equal(state.serviceCalls.at(-1).body.p_actor, "synthetic-owner", "service RPC receives authenticated actor");
  state.note = { status: "goedgekeurd" };
  equal((await handler(request("DELETE", {}), context())).status, 409, "protected approved copy requires reason");
  state.note = null;
  state.row.behandelaar_id = "another-owner";
  state.adminDenied = Response.json({ error: "Forbidden" }, { status: 403 });
  equal(
    (await handler(request("DELETE", { grond: "overig" }), context())).status,
    403,
    "ordinary nonowner cannot admin-delete",
  );
}

async function verifyStateAndCorrection() {
  const { state, route } = environment();
  const handler = route("sessies/[sessieId]/staat").PATCH;
  for (const payload of [
    null,
    [],
    "scalar",
    { versie: null, epdLijstBeoordeeld: true },
    { versie: 4, epdLijstBeoordeeld: true, categorie: "medicatie" },
  ]) {
    equal((await handler(request("PATCH", payload), context())).status, 400, "malformed state PATCH refused");
  }
  state.rpcReply = { ...state.clinical, versie: 5, epdLijstBeoordeeld: true };
  const reviewed = await handler(request("PATCH", { versie: 4, epdLijstBeoordeeld: true }), context());
  equal(reviewed.status, 200, "explicit EPD review saved");
  equal((await reviewed.json()).epdLijstBeoordeeld, true, "persisted EPD review returned");
  equal(state.rpcCalls.at(-1).body.p_epd_beoordeeld, true, "explicit review flag sent atomically with CAS");
  equal(state.rpcCalls.at(-1).body.p_versie, 4, "EPD review uses expected revision");
  state.rpcError = { status: 409 };
  equal(
    (await handler(request("PATCH", { versie: 4, epdLijstBeoordeeld: true }), context())).status,
    409,
    "review CAS conflict surfaced",
  );
  state.rpcError = null;
  const correction = route("sessies/[sessieId]/segmenten/[volgnummer]").PATCH;
  state.rpcReply = {
    segment: { volgnummer: 1, tekstGecorrigeerd: "Corrected synthetic text" },
    verouderd: true,
    laatsteSegment: 0,
  };
  const corrected = await correction(request("PATCH", { tekstGecorrigeerd: "Corrected synthetic text" }), context());
  equal(corrected.status, 200, "correction succeeds");
  equal((await corrected.json()).laatsteSegment, 0, "atomic rewind result returned");
  equal(state.rpcCalls.at(-1).name, "careon_scribe_segment_corrigeren", "correction and stale mark use single RPC");
  equal(state.rpcCalls.at(-1).body.p_patch.correctie_bron, "behandelaar", "clinician correction provenance passed");
  state.row.status = "geannuleerd";
  const analyse = route("sessies/[sessieId]/analyse").POST;
  equal((await analyse(request("POST"), context())).status, 409, "terminal session cannot trigger analysis");
  equal(state.analyses, 0, "no provider work for terminal session");
  state.row.status = "afgerond";
  equal((await analyse(request("POST"), context())).status, 200, "finished session remains analysable");
  equal(state.analyses, 1, "eligible session triggers exactly one analysis");
}

async function verifyExport() {
  const { state, route } = environment();
  const handlers = route("sessies/[sessieId]/export");
  const preview = await handlers.GET(request("GET", undefined, "?preview=1"), context());
  equal(preview.status, 200, "approved preview available for browser clipboard preparation");
  equal(state.audit.length, 0, "preview produces no export audit");
  equal((await preview.text()).includes("Synthetic approved text"), true, "actual export formatter used");
  const body = { notitieId: noteId, bewerkRevisie: 3, kanaal: "bestand" };
  equal(
    (await handlers.POST(request("POST", body), context())).status,
    200,
    "actual file channel confirmation accepted",
  );
  equal(state.audit[0].detail.kanaal, "bestand", "actual file channel recorded");
  equal(
    (await handlers.POST(request("POST", { ...body, bewerkRevisie: 2 }), context())).status,
    409,
    "stale export version rejected",
  );
  equal(state.audit.length, 1, "stale export creates no audit");
  equal(
    (await handlers.POST(request("POST", { ...body, sectieId: "unknown" }), context())).status,
    400,
    "unknown export section refused",
  );
  state.role = "beheerder";
  equal(
    (await handlers.GET(request("GET", undefined, "?preview=1"), context())).status,
    403,
    "admin metadata role cannot export content",
  );
}

async function verifyMaintenance() {
  const envKeys = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-key";
  process.env.CRON_SECRET = "synthetic-cron";
  const { state, load } = environment();
  const handler = load("src/app/api/internal/maintenance/route.ts").GET;
  const before = globalThis.fetch;
  const originalError = console.error;
  let failed = true;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).includes("careon_prune_scribe")) {
      return Response.json(failed ? { error: "Synthetic retention failure" } : { segmenten: 3 }, {
        status: failed ? 503 : 200,
      });
    }
    if (String(url).includes("careon_facturatie_maillog")) return Response.json([]);
    return Response.json(0);
  };
  console.error = () => {
    /* Expected synthetic provider failures are asserted via HTTP and audit below. */
  };
  try {
    equal((await handler(new Request("https://synthetic.invalid"))).status, 401, "maintenance requires secret");
    equal(calls, 0, "unauthorized maintenance cannot call storage");
    const authorized = () =>
      new Request("https://synthetic.invalid", { headers: { Authorization: "Bearer synthetic-cron" } });
    const partial = await handler(authorized());
    equal(partial.status, 502, "Scribe retention failure fails maintenance visibly");
    equal((await partial.json()).status, "partial_failed", "partial retention failure reported");
    equal(
      state.audit.some(
        (event) => event.action === "maintenance.prune_failed" && event.resource === "careon_prune_scribe",
      ),
      true,
      "Scribe failure has separate audit evidence",
    );
    failed = false;
    const success = await handler(authorized());
    equal(success.status, 200, "successful retention maintenance remains200");
    equal((await success.json()).scribe, { segmenten: 3 }, "successful actual retention counts returned");
  } finally {
    globalThis.fetch = before;
    console.error = originalError;
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

async function main() {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network is forbidden in route regressions");
  };
  try {
    await verifyNote();
    await verifyDelete();
    await verifyStateAndCorrection();
    await verifyExport();
    await verifyMaintenance();
    console.log(`verify-scribe-routes: ${checks} actual handler assertions passed; no network used`);
  } finally {
    globalThis.fetch = previousFetch;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
