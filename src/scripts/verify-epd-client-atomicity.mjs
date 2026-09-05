// Executes the real manifest, publisher, client and provider with synthetic
// exports and isolated React/browser/network dependencies. Never reads .env.

import ts from "typescript";

import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const nativeRequire = createRequire(import.meta.url);
const root = path.resolve("src");
function loader(stubs = {}) {
  const cache = new Map();
  function load(requestedFile, exposeMain = false) {
    let filename = path.resolve(requestedFile);
    if (!/\.tsx?$/.test(filename)) filename += fs.existsSync(`${filename}.ts`) ? ".ts" : ".tsx";
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = new Module(filename);
    cache.set(filename, loaded);
    loaded.require = (name) => {
      if (name in stubs) return stubs[name];
      if (name.startsWith("@/")) return load(path.join(root, name.slice(2)));
      if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name));
      return nativeRequire(name);
    };
    let source = fs.readFileSync(filename, "utf8");
    if (exposeMain) source = `${source.slice(0, source.lastIndexOf("main().catch"))}\nexport { main };`;
    loaded._compile(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      filename,
    );
    return loaded.exports;
  }
  return load;
}
const load = loader();
const generation = load("src/lib/careon-production/epd-generation.ts");
const { isEpdSnapshot } = load("src/lib/careon-production/epd-snapshot.ts");
const storage = load("src/lib/careon-production/storage.client.ts");
const remote = load("src/lib/careon-production/remote.client.ts");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "careon-epd-offline-"));
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const values = new Map();
let failWrite = false;
let writes = [];
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrite) throw new Error("Synthetic quota");
      writes.push(key);
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  },
};
let checks = 0;
async function check(name, run) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}
const sourceTime = "2026-09-05T01:00:00.000Z";
const csv = {
  client:
    "Cliënt ID;Client geslacht;Client leeftijd;Vestigingsnaam;Episode startdatum;Episode einddatum;Verwijsdatum;Wachtlijst Status\n1;Man;30;TGC Tilburg;01-06-2026;;;Nee",
  agenda:
    "Soort;Behandelaar;Sessie_Naam;Afspraak_lokatie;Datum;Directe_tijd_minute(n);Indirecte_tijd_minute(n);Reistijd_minute(n);Totale_tijd_minute(n);Prijs;Client_ID;No_Show;Tijdig_afgezegd;Verzekeringskoepel;Uzovi;Factuurnummer;Factuurdatum\nSessie;Fixture;Behandeling;TGC Tilburg;10-06-2026;60;0;0;60;100;1;n;n;VGZ;7095;F1;12-06-2026",
  referrers: "Cliënt ID;Naam;Rol;AGB Code;Zorgmail;Plaats\n1;Fixture;Huisarts;01000001;Nee;Tilburg",
  surcharges:
    "Cliënt;Verzekeringskoepel;Uzovi;Afspraakdatum;Code;Omschrijving;Prijs;Factuurnummer;Factuurdatum\nFixture;VGZ;7095;10-06-2026;TC0010;Fixture;93,85;F1;12-06-2026",
  declarations:
    "Regelnummer;Factuurnummer;Factuurdatum;Debiteurennaam;Totaal bedrag;Toegekend totaalbedrag;Debet / credit;Credit voor\n1;F1;12-06-2026;VGZ;193,85;193,85;D;",
};
function stage(prefix) {
  const stageDir = path.join(directory, prefix);
  fs.mkdirSync(stageDir);
  return Object.fromEntries(
    generation.EPD_KEYS.map((key) => {
      const file = path.join(stageDir, `${prefix}-${key}.csv`);
      fs.writeFileSync(file, csv[key]);
      return [key, file];
    }),
  );
}
function bundle(id = "11111111-1111-4111-8111-111111111111", importedAt = sourceTime) {
  const parse = (file, fn, key) => {
    const result = load(`src/lib/careon-production/${file}.ts`)[fn](`${key}.csv`, csv[key], importedAt);
    assert.equal(result.ok, true, `${key} synthetic fixture must parse: ${result.error}`);
    return result;
  };
  return {
    generationId: id,
    production: {
      fileName: "client.csv",
      importedAt,
      records: parse("parse-export", "parseClientExport", "client").records,
    },
    agenda: parse("parse-agenda", "parseAgendaExport", "agenda").facts,
    verwijzers: parse("parse-verwijzers", "parseVerwijzersExport", "referrers").facts,
    toeslagen: parse("parse-toeslagen", "parseToeslagenExport", "surcharges").facts,
    declaraties: parse("parse-declaraties", "parseDeclaratiesExport", "declarations").facts,
  };
}

// A tiny hook runner executes the actual provider callback; every state update
// is recorded, without relying on a source-string assertion or React batching.
function providerHarness(financieelZichtbaar = true) {
  let cursor = 0;
  const hooks = [];
  const effects = [];
  const updates = [];
  const session = { financieelZichtbaar, authed: true, orgId: "offline-org", email: "fixture@example.invalid" };
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [
        hooks[index],
        (value) => {
          hooks[index] = typeof value === "function" ? value(hooks[index]) : value;
          updates.push(hooks[index]);
        },
      ];
    },
    useRef: (initial) => {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect: (fn, deps) => {
      const index = cursor++;
      if (!hooks[index] || deps.some((value, i) => value !== hooks[index].deps[i])) {
        hooks[index]?.cleanup?.();
        hooks[index] = { deps };
        effects.push(() => {
          hooks[index].cleanup = fn();
        });
      }
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useContext: () => null,
  };
  const stubs = {
    react,
    "react/jsx-runtime": { jsx: (_type, props) => props.value },
    "./careon-session-provider": { useCareonSessionInfo: () => session },
    "@/data/careon/careon-alerts": { CRITICAL_ALERT_COUNT: 3 },
    "@/data/careon/careon-filters": { CAREON_LOCATION_SCALE: {}, CAREON_LOCATIONS: ["Alle locaties"] },
    "@/data/careon/careon-kpis": { COCKPIT_KPIS: [] },
    "@/lib/careon-financieel-rol": { filterFinancieleAlerts: () => [] },
    "@/lib/careon-production/compute-snapshot": {
      aanwezigeVestigingen: () => [],
      computeProductionSnapshot: (production, _filters, _time, aux) => ({ production, ...aux, signaleringen: [] }),
    },
    "@/lib/careon-tenant/cache-owner.client": {
      careonCacheEigenaar: () => session.orgId,
      bewaakCacheEigenaar: () => false,
    },
  };
  const provider = loader(stubs)("src/app/(main)/dashboard/_components/careon/careon-provider.tsx").CareonProvider;
  return {
    session,
    updates,
    render: () => {
      cursor = 0;
      return provider({ children: null });
    },
    hydrate: () => {
      for (const effect of effects.splice(0)) effect();
    },
    close: () => {
      for (const hook of hooks) hook?.cleanup?.();
    },
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

try {
  const old = bundle();
  const next = bundle("33333333-3333-4333-8333-333333333333", "2026-09-05T02:00:00.000Z");
  let first;
  await check("five finalized files commit one exact-name manifest", () => {
    generation.publishStagedEpdGeneration(directory, stage("first"), sourceTime);
    first = generation.readEpdGeneration(directory);
    assert.deepEqual(first.texts, csv);
    assert.equal(first.manifest.sourceTime, sourceTime);
  });
  await check("partial local publication retains preceding complete manifest", () => {
    const partial = stage("partial");
    fs.unlinkSync(partial.declarations);
    assert.throws(() => generation.publishStagedEpdGeneration(directory, partial, sourceTime));
    assert.deepEqual(generation.readEpdGeneration(directory), first);
  });
  await check("same-name retry cannot overwrite a published file", () => {
    const collision = stage("collision");
    const sameName = path.join(path.dirname(collision.client), first.manifest.files.client.name);
    fs.renameSync(collision.client, sameName);
    collision.client = sameName;
    fs.writeFileSync(sameName, "interrupted replacement");
    assert.throws(() => generation.publishStagedEpdGeneration(directory, collision, sourceTime));
    assert.deepEqual(generation.readEpdGeneration(directory), first);
  });
  await check("hash mismatch and malformed/partial manifests fail closed", () => {
    const file = path.join(directory, first.manifest.files.agenda.name);
    fs.appendFileSync(file, "mutation");
    assert.throws(() => generation.readEpdGeneration(directory), /gewijzigd/);
    fs.writeFileSync(file, csv.agenda);
    for (const invalid of [
      null,
      {},
      { ...first.manifest, files: { client: first.manifest.files.client } },
      { ...first.manifest, files: { ...first.manifest.files, agenda: { name: "../escape", sha256: "a".repeat(64) } } },
    ]) {
      fs.writeFileSync(path.join(directory, generation.EPD_MANIFEST), JSON.stringify(invalid));
      assert.throws(() => generation.readEpdGeneration(directory), /manifest/);
    }
    fs.writeFileSync(path.join(directory, generation.EPD_MANIFEST), JSON.stringify(first.manifest));
  });
  await check("publisher uses one write RPC and stable replay payload", async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.includes("organizations?")) return Response.json([{ id: "22222222-2222-4222-8222-222222222222" }]);
      if (url.includes("careon_epd_generations?")) return Response.json([]);
      assert.ok(url.endsWith("/rpc/careon_publish_epd_generation"));
      return Response.json(first.manifest.id);
    };
    const publisher = loader({
      "../lib/careon-production/epd-generation": { readEpdGeneration: () => generation.readEpdGeneration(directory) },
      "node:fs": {
        readFileSync: (filename) => {
          assert.ok(filename.endsWith(".env.local"));
          return "NEXT_PUBLIC_SUPABASE_URL=https://offline.invalid\nSUPABASE_SERVICE_ROLE_KEY=synthetic";
        },
      },
    })("src/scripts/push-production.ts", true);
    await publisher.main();
    await publisher.main();
    const posts = calls.filter(({ options }) => options.method === "POST");
    assert.equal(calls.length, 6);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].options.body, posts[1].options.body);
    assert.equal(JSON.parse(posts[0].options.body).p_generation, first.manifest.id);
    fs.appendFileSync(path.join(directory, first.manifest.files.agenda.name), "mutation");
    calls.length = 0;
    await assert.rejects(publisher.main(), /gewijzigd/);
    assert.equal(calls.length, 0);
    fs.writeFileSync(path.join(directory, first.manifest.files.agenda.name), csv.agenda);
  });
  await check("next successful local generation replaces manifest without changing prior files", () => {
    generation.publishStagedEpdGeneration(directory, stage("complete-next"), "2026-09-05T02:00:00.000Z");
    const current = generation.readEpdGeneration(directory);
    assert.notEqual(current.manifest.id, first.manifest.id);
    assert.equal(current.manifest.sourceTime, "2026-09-05T02:00:00.000Z");
    assert.deepEqual(current.texts, csv);
    for (const key of generation.EPD_KEYS) {
      assert.equal(fs.readFileSync(path.join(directory, first.manifest.files[key].name), "utf8"), csv[key]);
    }
  });

  await check("real guards accept complete synthetic five-slice generation", () =>
    assert.equal(isEpdSnapshot(next, true), true),
  );
  await check("invalid or missing financial slice rejects whole managed snapshot", async () => {
    for (const invalid of [
      { ...next, toeslagen: undefined },
      { ...next, declaraties: {} },
      { ...next, agenda: null },
      { ...next, generationId: "invalid" },
      { ...next, toeslagen: null, declaraties: null },
    ]) {
      globalThis.fetch = async () => Response.json({ snapshot: invalid });
      assert.equal(await remote.fetchRemoteEpdSnapshot(true), null);
    }
  });
  await check("explicit role-redacted null finance remains a valid member snapshot", async () => {
    const member = { ...next, toeslagen: null, declaraties: null };
    globalThis.fetch = async () => Response.json({ snapshot: member });
    assert.deepEqual(await remote.fetchRemoteEpdSnapshot(false), member);
  });
  await check("one atomic cache write replaces all slices and removes legacy caches", () => {
    values.clear();
    writes = [];
    storage.saveProductionState(old.production);
    storage.saveAgendaFacts(old.agenda);
    writes = [];
    assert.equal(storage.saveEpdSnapshot(next, true), true);
    assert.deepEqual(writes, ["careon-epd-generation-v1"]);
    assert.deepEqual(storage.loadEpdSnapshot(true).snapshot, next);
    assert.equal(storage.loadProductionState(), null);
    assert.equal(storage.loadAgendaFacts(), null);
  });
  await check("quota interruption retains previous entire generation", () => {
    failWrite = true;
    assert.equal(storage.saveEpdSnapshot(old, true), false);
    failWrite = false;
    assert.deepEqual(storage.loadEpdSnapshot(true).snapshot, next);
  });
  await check("corrupt cache and changed financial role prohibit legacy fallback", () => {
    assert.deepEqual(storage.loadEpdSnapshot(false), { present: true, snapshot: null });
    values.set("careon-epd-generation-v1", "{broken");
    assert.deepEqual(storage.loadEpdSnapshot(true), { present: true, snapshot: null });
  });
  await check("each logout/aux/financial clear removes atomic generation cache", () => {
    for (const clear of [storage.clearProductionState, storage.clearAuxFacts, storage.clearFinancieleAuxFacts]) {
      storage.saveEpdSnapshot(next, true);
      clear();
      assert.deepEqual(storage.loadEpdSnapshot(true), { present: false, snapshot: null });
    }
  });
  await check("actual account owner guard removes generation on organization switch", () => {
    const noop = () => undefined;
    const owner = loader({
      "@/lib/careon-assistant/session.client": { clearCareonAssistantSession: noop },
      "@/lib/careon-assistant/storage.client": { clearCareonAssistantHistory: noop },
      "@/lib/careon-facturatie/storage.client": { clearFacturatieState: noop },
      "@/lib/careon-hr/storage.client": { clearHrState: noop },
      "@/lib/careon-middelen/storage.client": { clearMiddelenState: noop },
      "@/lib/supabase/config": { isSupabaseAuthConfigured: () => true },
    })("src/lib/careon-tenant/cache-owner.client.ts");
    owner.bewaakCacheEigenaar("org:first");
    storage.saveEpdSnapshot(next, true);
    assert.equal(owner.bewaakCacheEigenaar("org:second"), true);
    assert.equal(storage.loadEpdSnapshot(true).present, false);
  });
  await check("provider performs one read and one complete state/cache transition", async () => {
    values.clear();
    storage.saveEpdSnapshot(old, true);
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      return Response.json({ snapshot: next });
    };
    const harness = providerHarness();
    harness.render();
    harness.hydrate();
    harness.updates.length = 0;
    writes = [];
    await flush();
    assert.deepEqual(calls, ["/api/careon/production/snapshot"]);
    assert.deepEqual(
      harness.updates.filter((value) => value?.generationId),
      [next],
    );
    assert.deepEqual(writes, ["careon-epd-generation-v1"]);
    assert.deepEqual(storage.loadEpdSnapshot(true).snapshot, next);
    const view = harness.render();
    assert.deepEqual(view.production.production, next.production);
    assert.deepEqual(view.production.declaraties, next.declaraties);
    // Independent imports cannot silently replace one managed slice.
    assert.deepEqual(await view.activateAgenda(old.agenda), { persisted: false, sync: "failed" });
    assert.deepEqual(await view.activateProduction(old.production), { persisted: false, sync: "failed" });
    assert.equal(calls.length, 1);
    harness.close();
  });
  await check("provider replaces newer local per-slice caches with complete generation", async () => {
    values.clear();
    const later = bundle(old.generationId, "2026-09-06T01:00:00.000Z");
    storage.saveProductionState(later.production);
    storage.saveAgendaFacts(later.agenda);
    globalThis.fetch = async () => Response.json({ snapshot: next });
    const harness = providerHarness();
    harness.render();
    harness.hydrate();
    await flush();
    const view = harness.render();
    assert.deepEqual(view.production.production, next.production);
    assert.deepEqual(view.production.agenda, next.agenda);
    harness.close();
  });
  await check("provider malformed bundle preserves previous complete cached generation", async () => {
    values.clear();
    storage.saveEpdSnapshot(old, true);
    globalThis.fetch = async () => Response.json({ snapshot: { ...next, declaraties: null } });
    const harness = providerHarness();
    harness.render();
    harness.hydrate();
    await flush();
    assert.deepEqual(harness.render().production.declaraties, old.declaraties);
    assert.deepEqual(storage.loadEpdSnapshot(true).snapshot, old);
    harness.close();
  });
  await check("member adoption redacts agenda and clears older financial slices", async () => {
    values.clear();
    storage.saveEpdSnapshot(old, true);
    globalThis.fetch = async () => Response.json({ snapshot: { ...next, toeslagen: null, declaraties: null } });
    const harness = providerHarness(false);
    harness.render();
    harness.hydrate();
    await flush();
    const view = harness.render();
    assert.equal(view.production.toeslagen, null);
    assert.equal(view.production.declaraties, null);
    assert.equal(view.production.agenda.cellen[0].omzetGerealiseerd, 0);
    assert.deepEqual(view.production.agenda.facturatie, []);
    assert.equal(storage.loadEpdSnapshot(false).snapshot.toeslagen, null);
    assert.equal(storage.loadEpdSnapshot(true).snapshot, null);
    harness.close();
  });
  await check("unmount and explicit demo choice invalidate pending snapshot adoption", async () => {
    for (const cancel of ["unmount", "demo"]) {
      values.clear();
      let resolve;
      globalThis.fetch = () =>
        new Promise((done) => {
          resolve = done;
        });
      const harness = providerHarness();
      const view = harness.render();
      harness.hydrate();
      if (cancel === "unmount") harness.close();
      else view.restoreDemo();
      harness.updates.length = 0;
      resolve(Response.json({ snapshot: next }));
      await flush();
      assert.equal(harness.updates.length, 0);
      assert.equal(storage.loadEpdSnapshot(true).present, false);
      harness.close();
    }
  });
  console.log(`EPD client atomicity: ${checks}/${checks} checks passed (offline synthetic data only).`);
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  // The sole recursive removal is this newly-created, verified temporary directory.
  assert.equal(path.dirname(directory), os.tmpdir());
  assert.ok(path.basename(directory).startsWith("careon-epd-offline-"));
  fs.rmSync(directory, { recursive: true, force: true });
}
