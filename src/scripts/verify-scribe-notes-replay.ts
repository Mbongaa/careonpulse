/** Synthetic CLI safety checks. No teaching content, credentials, or provider calls. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const root = resolve(".next-e2e", `scribe-replay-check-${Date.now()}-${process.pid}`);
mkdirSync(join(root, "cache", "provider"), { recursive: true });
const input = join(root, "input.json");
const cache = join(root, "cache", "notes.json");
const trap = join(root, "network-trap.cjs");
const calls = join(root, "network-attempted.txt");
writeFileSync(
  trap,
  `globalThis.fetch = async () => { require("node:fs").writeFileSync(${JSON.stringify(calls)}, "blocked"); throw new Error("Network forbidden in replay test"); };`,
);
const source = {
  label: "SYNTHETIC replay test, no recording or real patient",
  schemaVersion: 1,
  runId: "synthetic",
  completedAt: "2026-09-11T00:00:00.000Z",
  recording: { sha256: "synthetic-no-audio" },
  segmenten: [
    {
      id: "synthetic-replay-source-1",
      volgnummer: 1,
      spreker: "onbekend",
      sprekerBron: null as string | null,
      tekst: "This synthetic sentence is provided only to test offline source rendering.",
      tekstGecorrigeerd: null,
      correctieBron: null,
      beginMs: 0,
      eindMs: 1000,
      bron: "live",
      createdAt: "2026-09-11T00:00:00.000Z",
    },
  ],
};
const rawInput = JSON.stringify(source);
writeFileSync(input, rawInput);
const saved = {
  index: 1,
  stage: "analysis-1",
  status: 200,
  endpoint: "/v1/responses",
  request: { text: { format: { name: "careon_scribe_gesprekscontext" } } },
  rawResponse: JSON.stringify({
    output: [
      {
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ fragmenten: [{ sectieId: "speciele-anamnese", van: 1, tot: 1 }] }),
          },
        ],
      },
    ],
  }),
};
const manifest = {
  schemaVersion: 1,
  input: { sha256: createHash("sha256").update(rawInput).digest("hex") },
  parameters: { batch: 3 },
  apiMode: "responses",
  model: "synthetic-model-no-provider",
  requests: [{ index: 1, stage: "analysis-1", status: 200, file: "provider/001.json" }],
};
const save = () => {
  writeFileSync(cache, JSON.stringify(manifest));
  writeFileSync(join(root, "cache/provider/001.json"), JSON.stringify(saved));
};
save();
let passed = 0;
function run(name: string, expected: string | null, overrides: Record<string, string | null> = {}) {
  const options: Record<string, string | null> = {
    input,
    run: name,
    batch: "3",
    replay: cache,
    output: join(root, name),
    ...overrides,
  };
  const args = Object.entries(options).flatMap(([key, value]) => (value === null ? [] : [`--${key}`, value]));
  const result = spawnSync(
    process.execPath,
    [
      "--require",
      trap,
      "--require",
      "ts-node/register",
      "--require",
      "tsconfig-paths/register",
      "src/scripts/verify-scribe-recording-notes.ts",
      ...args,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
      env: {
        ...process.env,
        TS_NODE_PROJECT: "tsconfig.scripts.json",
        OPENAI_API_KEY: "synthetic-canary-not-a-credential",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
        SUPABASE_SERVICE_ROLE_KEY: "synthetic-canary-not-a-credential",
      },
    },
  );
  assert.equal(existsSync(calls), false, "Replay reached the network fallback");
  if (expected) {
    assert.equal(result.status, 1, `${name} must fail closed`);
    assert.ok(result.stderr.includes(expected), `${name} returned the wrong rejection`);
  } else {
    assert.equal(result.status, 0, "Synthetic replay failed");
    const report = JSON.parse(readFileSync(join(options.output as string, "notes.json"), "utf8"));
    assert.equal(report.execution, "offline-replay");
    assert.equal(report.replay.realProviderRequests, 0);
    assert.equal(report.replay.consumedResponses, 1);
    assert.equal(report.finalCounts.realProviderRequests, 0);
    assert.equal(report.finalCounts.activeFacts, 0);
    assert.ok(report.completedAt && report.report);
  }
  passed += 1;
  console.log(`PASS ${name}`);
}

try {
  run("success", null);
  run("no-output", "Replay requires an explicit --output", { output: null });
  run("outside-output", "Input and output must be local ignored", { output: join(repoRoot, "outside-replay") });
  run("batch-mismatch", "Replay requires matching input hash", { batch: "12" });
  manifest.input.sha256 = "incorrect";
  save();
  run("hash-mismatch", "Replay requires matching input hash");
  manifest.input.sha256 = createHash("sha256").update(rawInput).digest("hex");
  manifest.requests[0].file = "../provider/001.json";
  save();
  run("path-traversal", "Replay contains an invalid provider evidence path");
  manifest.requests[0].file = "provider/001.json";
  saved.request.text.format.name = "wrong-schema";
  save();
  run("schema-mismatch", "Replay exhausted or request stage");
  saved.request.text.format.name = "careon_scribe_gesprekscontext";
  saved.stage = "analysis-2";
  manifest.requests[0].stage = "analysis-2";
  save();
  run("stage-mismatch", "Replay exhausted or request stage");
  saved.stage = "analysis-1";
  manifest.requests[0].stage = "analysis-1";
  saved.endpoint = "/v1/other";
  save();
  run("endpoint-mismatch", "Replay requires complete successful saved JSON");
  saved.endpoint = "/v1/responses";
  manifest.requests.push({ index: 2, stage: "analysis-2", status: 200, file: "provider/002.json" });
  writeFileSync(join(root, "cache/provider/002.json"), JSON.stringify({ ...saved, index: 2, stage: "analysis-2" }));
  save();
  run("unused-response", "Replay left unused responses");
  manifest.requests.pop();
  source.segmenten[0].spreker = "patient";
  source.segmenten[0].sprekerBron = "behandelaar";
  const changedInput = JSON.stringify(source);
  writeFileSync(input, changedInput);
  manifest.input.sha256 = createHash("sha256").update(changedInput).digest("hex");
  save();
  run("missing-response", "Replay exhausted or request stage");
  console.log(`${passed} offline replay checks passed; zero provider/network requests.`);
} catch (error) {
  // Test metadata only; assertion payloads and synthetic source text stay local.
  console.error(
    `Offline replay checks failed after ${passed} passes (${error instanceof Error ? error.name : "error"}).`,
  );
  process.exitCode = 1;
}
