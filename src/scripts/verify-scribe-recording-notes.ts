/**
 * Explicit local teaching-recording verification. Uses the real note provider
 * adapters and validators with an in-memory session; never writes to Supabase.
 * Transcript/model content is saved ONLY beneath the ignored .next-e2e tree.
 *
 * npx ts-node -r tsconfig-paths/register -P tsconfig.scripts.json
 *   src/scripts/verify-scribe-recording-notes.ts --input <recording.json>
 *   --run notes-smoke --batch=3 --max-segments=12
 *
 * Offline replay (no credentials loaded and no network fallback):
 *   ... --input <same-recording.json> --run replay-fixed --batch=12
 *   --replay <cached-run/notes.json> --output <new-ignored-directory>
 * Replays exact saved responses against current code. It measures validator /
 * merge behavior, not model accuracy or the current prompt's live response.
 */

import type {
  AnalyseUitkomst,
  CorrectieUitkomst,
  SprekerToewijzingUitkomst,
  VerslagUitkomst,
} from "../lib/careon-scribe/agent.server";
import { type KlinischeStaat, type ScribeSegment, STAAT_CATEGORIEEN } from "../lib/careon-scribe/types";
import { loadTeachingProviderEnvironment, type TeachingRun } from "./lib/scribe-recording-harness";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

interface RequestEvidence {
  index: number;
  stage: string;
  status: number;
  durationMs: number;
  usage: Record<string, unknown> | null;
  file: string;
}

interface AnalysisEvidence {
  firstSegment: number;
  lastSegment: number;
  source: AnalyseUitkomst["bron"];
  model: string | null;
  elapsedMs: number;
  requestIndices: number[];
  state: KlinischeStaat;
  counts: Record<string, number>;
  rawStateCounts: Record<string, number> | null;
  speakers: SprekerToewijzingUitkomst[];
  corrections: CorrectieUitkomst[];
  appliedSpeakers: SprekerToewijzingUitkomst[];
  appliedCorrections: CorrectieUitkomst[];
}

interface NoteRun {
  label: string;
  execution: "live-provider" | "offline-replay";
  replay: {
    source: string;
    sha256: string;
    availableResponses: number;
    consumedResponses: number;
    realProviderRequests: 0;
  } | null;
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  completedAt: string | null;
  input: { file: string; sha256: string; runId: string; completedAt: string | null; recordingSha256: string };
  parameters: { language: "en"; consultType: "psychiatrie"; batch: number; maxSegments: number | null };
  model: string;
  apiMode: string;
  promptVersion: string;
  sourceHashes: Record<string, string>;
  originalSegments: ScribeSegment[];
  segments: ScribeSegment[];
  requests: RequestEvidence[];
  rounds: AnalysisEvidence[];
  finalState: KlinischeStaat;
  report: VerslagUitkomst | null;
  reportMetrics: Record<string, number> | null;
  finalCounts: Record<string, number>;
}

function option(name: string, fallback?: string): string | undefined {
  const flag = `--${name}`;
  const equals = process.argv.find((argument) => argument.startsWith(`${flag}=`));
  if (equals) return equals.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : process.argv[index + 1];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parsedModelContent(response: unknown): Record<string, unknown> | null {
  const body = record(response);
  if (!body) return null;
  if (typeof body.output_text === "string") return record(parseJson(body.output_text));
  if (Array.isArray(body.choices)) {
    const content = record(record(body.choices[0])?.message)?.content;
    return typeof content === "string" ? record(parseJson(content)) : null;
  }
  if (!Array.isArray(body.output)) return null;
  const content = body.output
    .flatMap((item) => {
      const parts = record(item)?.content;
      return Array.isArray(parts) ? parts : [];
    })
    .map((part) => record(part)?.text)
    .filter((part): part is string => typeof part === "string")
    .join("");
  return record(parseJson(content));
}

function factCounts(state: unknown): Record<string, number> {
  const result: Record<string, number> = {
    arrayFacts: 0,
    activeFacts: 0,
    retractedFacts: 0,
    citedFacts: 0,
    citedSegments: 0,
    derivedChecklistItems: 0,
    derivedChecklistCitations: 0,
    derivedWarnings: 0,
    derivedWarningCitations: 0,
    scalarFields: 0,
    conversationWindows: 0,
    conversationQuotes: 0,
  };
  const clinicalFields = new Set<string>(STAAT_CATEGORIEEN);
  const sources = new Set<number>();
  for (const [key, value] of Object.entries(record(state) ?? {})) {
    if (key === "gesprekscontext" && Array.isArray(value)) {
      result.conversationWindows = value.length;
      result.conversationQuotes = value.reduce(
        (sum, item) => sum + (Array.isArray(record(item)?.citaten) ? (record(item)?.citaten as unknown[]).length : 0),
        0,
      );
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = value.length;
      if (!clinicalFields.has(key)) {
        const cited = value.filter((item) => {
          const source = record(item)?.bron;
          return Array.isArray(source) && source.length > 0;
        }).length;
        if (key === "ontbrekend") {
          result.derivedChecklistItems = value.length;
          result.derivedChecklistCitations = cited;
        } else if (key === "waarschuwingen") {
          result.derivedWarnings = value.length;
          result.derivedWarningCitations = cited;
        }
        continue;
      }
      result.arrayFacts += value.length;
      for (const item of value) {
        if (record(item)?.ingetrokken === true) {
          result.retractedFacts += 1;
          continue;
        }
        result.activeFacts += 1;
        const source = record(item)?.bron;
        if (!Array.isArray(source) || source.length === 0) continue;
        result.citedFacts += 1;
        for (const number of source) if (typeof number === "number") sources.add(number);
      }
    } else if (typeof value === "string" && value.trim()) {
      result.scalarFields += 1;
    }
  }
  result.citedSegments = sources.size;
  return result;
}

function persist(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

interface CachedResponse {
  stage: string;
  endpoint: string;
  status: number;
  schema: string | null;
  rawResponse: string;
}

function requestSchema(request: unknown): string | null {
  const body = record(request);
  const format = record(record(body?.text)?.format);
  const chatFormat = record(record(body?.response_format)?.json_schema);
  const name = format?.name ?? chatFormat?.name;
  return typeof name === "string" ? name : null;
}

function ignoredPath(path: string, artifactRoot: string): string {
  const fullPath = resolve(path);
  if (!fullPath.startsWith(`${artifactRoot}${sep}`))
    throw new Error("Input and output must be local ignored teaching evidence.");
  return fullPath;
}

function readReplay(file: string, inputHash: string, batch: number, artifactRoot: string) {
  const raw = readFileSync(ignoredPath(file, artifactRoot), "utf8");
  const cached = JSON.parse(raw) as Partial<NoteRun>;
  if (
    cached.schemaVersion !== 1 ||
    cached.input?.sha256 !== inputHash ||
    cached.parameters?.batch !== batch ||
    !["chat", "responses"].includes(cached.apiMode ?? "") ||
    typeof cached.model !== "string" ||
    !Array.isArray(cached.requests) ||
    cached.requests.length === 0
  )
    throw new Error("Replay requires matching input hash, batch and valid cached provider evidence.");
  const directory = dirname(resolve(file));
  const responses: CachedResponse[] = cached.requests.map((request, index) => {
    if (request.index !== index + 1 || !/^provider\/\d{3,6}\.json$/.test(request.file))
      throw new Error("Replay contains an invalid provider evidence path or sequence.");
    const saved = JSON.parse(readFileSync(join(directory, request.file), "utf8"));
    if (
      saved.index !== request.index ||
      saved.stage !== request.stage ||
      saved.status !== request.status ||
      saved.status !== 200 ||
      !["/v1/responses", "/v1/chat/completions"].includes(saved.endpoint) ||
      typeof saved.rawResponse !== "string" ||
      !record(parseJson(saved.rawResponse)) ||
      !requestSchema(saved.request)
    )
      throw new Error("Replay requires complete successful saved JSON provider responses.");
    return {
      stage: saved.stage,
      endpoint: saved.endpoint,
      status: saved.status,
      schema: requestSchema(saved.request),
      rawResponse: saved.rawResponse,
    };
  });
  return { cached: cached as NoteRun, responses, sha256: createHash("sha256").update(raw).digest("hex") };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const artifactRoot = resolve(repoRoot, ".next-e2e");
  const input = option("input");
  const runId = option("run");
  const batch = Number(option("batch", "3"));
  const max = option("max-segments");
  const replayFile = option("replay");
  const explicitOutput = option("output");
  const maxSegments = max === undefined ? null : Number(max);
  if (!input || !runId || !/^[a-z0-9][a-z0-9_-]{0,70}$/.test(runId))
    throw new Error("Use --input and a bounded --run identifier.");
  if (![3, 12, 40].includes(batch) || (maxSegments !== null && (!Number.isInteger(maxSegments) || maxSegments < 1)))
    throw new Error("Use --batch=3,12,40 and a positive --max-segments.");
  if (replayFile && !explicitOutput) throw new Error("Replay requires an explicit --output directory.");
  const inputFile = ignoredPath(input, artifactRoot);
  const directory = explicitOutput ? ignoredPath(explicitOutput, artifactRoot) : join(dirname(inputFile), runId);
  const evidenceFile = join(directory, "notes.json");
  if (existsSync(directory)) throw new Error("Evidence directory already exists; use another output to preserve it.");
  const rawInput = readFileSync(inputFile, "utf8");
  const inputHash = createHash("sha256").update(rawInput).digest("hex");
  const source = JSON.parse(rawInput) as TeachingRun;
  const replay = replayFile ? readReplay(replayFile, inputHash, batch, artifactRoot) : null;
  if (!source.completedAt && maxSegments === null)
    throw new Error("Full note run requires completed transcription evidence.");
  if (!Array.isArray(source.segmenten)) throw new Error("Input has no transcript evidence.");

  // Clear database credentials BEFORE lazily importing runtime/provider modules.
  if (replay) {
    // No .env file is read. The loopback URL is intercepted, never contacted.
    process.env.OPENAI_API_KEY = "offline-replay-no-credential";
    process.env.OPENAI_MODEL = replay.cached.model;
    process.env.OPENAI_API_MODE = replay.cached.apiMode;
    process.env.OPENAI_API_BASE_URL = "http://127.0.0.1:9/v1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    process.env.CAREON_ASSISTANT_LIVE = "1";
    process.env.CAREON_SCRIBE_LIVE = "1";
    process.env.CAREON_ASSISTANT_MAX_RETRIES = "0";
    globalThis.fetch = async () => {
      throw new Error("Replay blocked a request before interception was ready.");
    };
  } else loadTeachingProviderEnvironment(repoRoot);
  const agent = await import("../lib/careon-scribe/agent.server");
  const runtime = await import("../lib/careon-assistant/runtime.server");
  const { isScribeSegment } = await import("../lib/careon-scribe/types");
  if (!source.segmenten.every(isScribeSegment)) throw new Error("Input contains invalid transcript segments.");
  if (!agent.scribeAgentLive()) throw new Error("Local teaching note provider is unavailable.");
  const segments = structuredClone(source.segmenten.slice(0, maxSegments ?? source.segmenten.length));
  if (segments.length === 0) throw new Error("Input contains no segments to analyze.");
  if (segments.some((segment, index) => index > 0 && segment.volgnummer <= segments[index - 1].volgnummer))
    throw new Error("Transcript segment order is invalid.");
  mkdirSync(join(directory, "provider"), { recursive: true });
  const run: NoteRun = {
    label: `${source.label}; local note verification; ${replay ? "OFFLINE REPLAY, zero real provider requests" : "real provider control, no clinical approval"}`,
    execution: replay ? "offline-replay" : "live-provider",
    replay: replay
      ? {
          source: relative(repoRoot, resolve(replayFile as string)),
          sha256: replay.sha256,
          availableResponses: replay.responses.length,
          consumedResponses: 0,
          realProviderRequests: 0,
        }
      : null,
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    input: {
      file: relative(repoRoot, inputFile),
      sha256: inputHash,
      runId: source.runId,
      completedAt: source.completedAt,
      recordingSha256: source.recording.sha256,
    },
    parameters: { language: "en", consultType: "psychiatrie", batch, maxSegments },
    model: runtime.ASSISTANT_MODEL,
    apiMode: runtime.ASSISTANT_API_MODE,
    promptVersion: agent.SCRIBE_CONTEXT_PROMPT_VERSION,
    sourceHashes: Object.fromEntries(
      [
        "careon-scribe/agent.server.ts",
        "careon-scribe/deterministisch.ts",
        "careon-scribe/gesprekscontext.ts",
        "careon-scribe/english-evidence.ts",
        "careon-scribe/english-report.ts",
        "careon-scribe/klinische-staat.ts",
        "careon-assistant/runtime.server.ts",
      ].map((file) => [
        file,
        createHash("sha256")
          .update(readFileSync(join(repoRoot, "src/lib", file)))
          .digest("hex"),
      ]),
    ),
    originalSegments: structuredClone(segments),
    segments,
    requests: [],
    rounds: [],
    finalState: agent.nieuweStaat(),
    report: null,
    reportMetrics: null,
    finalCounts: {},
  };
  let stage = "setup";
  let lastParsedResponse: Record<string, unknown> | null = null;
  let replayFailure: Error | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request, init) => {
    let address: string;
    if (typeof request === "string") address = request;
    else if (request instanceof URL) address = request.href;
    else address = request.url;
    const url = new URL(address);
    if (
      url.origin !== (replay ? "http://127.0.0.1:9" : "https://api.openai.com") ||
      !["/v1/responses", "/v1/chat/completions"].includes(url.pathname) ||
      url.search ||
      url.username ||
      url.password ||
      (init?.method ?? (request instanceof Request ? request.method : "GET")) !== "POST"
    )
      throw new Error("Teaching note verification blocked a non-provider request.");
    const started = Date.now();
    const index = run.requests.length + 1;
    const file = `provider/${String(index).padStart(3, "0")}.json`;
    const base = { index, stage, file };
    let requestBody: string | null = typeof init?.body === "string" ? init.body : null;
    if (requestBody === null && request instanceof Request) requestBody = await request.clone().text();
    try {
      let response: Response;
      if (replay && run.replay) {
        const saved = replay.responses[run.replay.consumedResponses];
        if (
          !saved ||
          saved.stage !== stage ||
          saved.endpoint !== url.pathname ||
          saved.schema !== requestSchema(requestBody ? parseJson(requestBody) : null)
        ) {
          replayFailure = new Error(
            "Replay exhausted or request stage, endpoint, or schema differs from cached evidence.",
          );
          throw replayFailure;
        }
        run.replay.consumedResponses += 1;
        response = new Response(saved.rawResponse, {
          status: saved.status,
          headers: { "Content-Type": "application/json" },
        });
      } else response = await originalFetch(request, init);
      const rawResponse = await response.clone().text();
      const parsed = parseJson(rawResponse);
      const usage = record(record(parsed)?.usage);
      const evidence = { ...base, status: response.status, durationMs: Date.now() - started, usage };
      lastParsedResponse = parsedModelContent(parsed);
      // Explicit teaching-only raw evidence. No headers/API keys are persisted.
      persist(join(directory, file), {
        ...evidence,
        endpoint: url.pathname,
        execution: run.execution,
        request: requestBody ? parseJson(requestBody) : null,
        rawResponse,
        parsedContent: lastParsedResponse,
      });
      run.requests.push(evidence);
      persist(evidenceFile, run);
      console.log(JSON.stringify({ stage, request: index, status: response.status, durationMs: evidence.durationMs }));
      return response;
    } catch (error) {
      const evidence = { ...base, status: 0, durationMs: Date.now() - started, usage: null };
      persist(join(directory, file), { ...evidence, endpoint: url.pathname, requestFailed: true });
      run.requests.push(evidence);
      persist(evidenceFile, run);
      throw error;
    }
  };
  const context = () => ({
    consultType: "psychiatrie" as const,
    taal: "en" as const,
    actorHash: createHash("sha256").update(`teaching-note-verification:${runId}`).digest("hex"),
    orgId: null,
    userId: null,
    aiToegestaan: true,
    signal: AbortSignal.timeout(120_000),
  });
  persist(evidenceFile, run);
  try {
    for (let offset = 0; offset < segments.length; offset += batch) {
      stage = `analysis-${run.rounds.length + 1}`;
      lastParsedResponse = null;
      const requestOffset = run.requests.length;
      const fresh = segments.slice(offset, offset + batch);
      const started = Date.now();
      const result = await agent.analyseerSegmenten({
        ...context(),
        staat: structuredClone(run.finalState),
        nieuweSegmenten: structuredClone(fresh),
        contextSegmenten: structuredClone(segments.slice(0, offset)),
      });
      if (replayFailure) throw replayFailure;
      const appliedSpeakers: SprekerToewijzingUitkomst[] = [];
      const appliedCorrections: CorrectieUitkomst[] = [];
      for (const speaker of result.sprekers) {
        const segment = segments.find((row) => row.volgnummer === speaker.volgnummer);
        if (segment?.spreker !== "onbekend" || speaker.spreker === "onbekend") continue;
        segment.spreker = speaker.spreker;
        appliedSpeakers.push(speaker);
      }
      for (const correction of result.correcties) {
        const segment = segments.find((row) => row.volgnummer === correction.volgnummer);
        if (
          !segment ||
          segment.correctieBron === "behandelaar" ||
          segment.tekstGecorrigeerd === correction.tekstGecorrigeerd
        )
          continue;
        segment.tekstGecorrigeerd = correction.tekstGecorrigeerd;
        segment.correctieBron = "ai";
        appliedCorrections.push(correction);
      }
      run.finalState = result.staat;
      run.rounds.push({
        firstSegment: fresh[0].volgnummer,
        lastSegment: fresh[fresh.length - 1].volgnummer,
        source: result.bron,
        model: result.model,
        elapsedMs: Date.now() - started,
        requestIndices: run.requests.slice(requestOffset).map((row) => row.index),
        state: structuredClone(result.staat),
        counts: factCounts(result.staat),
        rawStateCounts: lastParsedResponse ? factCounts(record(lastParsedResponse)?.staat) : null,
        speakers: result.sprekers,
        corrections: result.correcties,
        appliedSpeakers,
        appliedCorrections,
      });
      persist(evidenceFile, run);
      console.log(
        JSON.stringify({
          stage,
          processed: Math.min(offset + batch, segments.length),
          total: segments.length,
          source: result.bron,
          facts: factCounts(result.staat).citedFacts,
          conversationWindows: factCounts(result.staat).conversationWindows,
          speakers: appliedSpeakers.length,
        }),
      );
    }
    stage = "report";
    const reportInput = {
      ...context(),
      staat: structuredClone(run.finalState),
      citaten: agent.citaatSegmenten(run.finalState, segments),
      gatSegmenten: agent.gatSegmentenVan(segments),
    };
    // Save the exact canonical prompt independently for diagnosing rejected output.
    persist(join(directory, "report-input.json"), { prompt: agent.bouwVerslagInvoerTekst(reportInput) });
    run.report = await agent.genereerVerslag(reportInput);
    if (replayFailure) throw replayFailure;
    if (run.replay && run.replay.consumedResponses !== run.replay.availableResponses)
      throw new Error("Replay left unused responses; the current pipeline differs from cached evidence.");
    run.reportMetrics = {
      sections: run.report.secties.length,
      populatedSections: run.report.secties.filter((section) => section.tekst.trim().length > 0).length,
      clinicianRequiredSections: run.report.secties.filter((section) => section.vereistBehandelaar).length,
      citedSections: run.report.secties.filter((section) => section.bron.length > 0).length,
    };
    run.finalCounts = {
      ...factCounts(run.finalState),
      unknownSpeakerSegments: segments.filter((segment) => segment.spreker === "onbekend").length,
      correctedSegments: segments.filter((segment) => segment.tekstGecorrigeerd !== null).length,
      aiRounds: run.rounds.filter((round) => round.source === "ai").length,
      fallbackRounds: run.rounds.filter((round) => round.source !== "ai").length,
      providerRequests: run.requests.length,
      realProviderRequests: replay ? 0 : run.requests.length,
      replayedRequests: run.replay ? run.replay.consumedResponses : 0,
      httpFailures: run.requests.filter((request) => request.status < 200 || request.status >= 300).length,
    };
    run.completedAt = new Date().toISOString();
    persist(evidenceFile, run);
    console.log(
      JSON.stringify({
        stage: "complete",
        run: runId,
        source: run.report.bron,
        ...run.reportMetrics,
        requests: run.requests.length,
        facts: run.finalCounts.citedFacts,
      }),
    );
  } catch (error) {
    throw replayFailure ?? error;
  } finally {
    globalThis.fetch = originalFetch;
    persist(evidenceFile, run);
  }
}

function safeFailureDetails(error: unknown, depth = 0): Record<string, unknown> {
  // Only local diagnostics: never log a request, response, credentials or the
  // first stack line (which can repeat arbitrary provider error content).
  const failure = error instanceof Error ? error : null;
  const rawCode = failure && "code" in failure ? failure.code : null;
  const code = typeof rawCode === "string" && /^[A-Z0-9_]{1,60}$/.test(rawCode) ? rawCode : null;
  const message = failure?.message ?? "Unknown error";
  const localMessage =
    /^(?:Use |Input |Full note |Evidence |Replay |Transcript segment |Local teaching |Teaching note verification blocked |De analyse van bevestigde Engelse uitspraken|De Engelse bronanalyse|De Engelse analyse|EACCES:|EPERM:|EBUSY:|ENOENT:|ENOSPC:|EEXIST:)/.test(
      message,
    );
  return {
    error: failure?.name ?? "UnknownError",
    code,
    message: localMessage ? message.slice(0, 400) : "Nonlocal error message omitted; inspect ignored evidence.",
    stack:
      failure?.stack
        ?.split(/\r?\n/)
        .filter((line) => /^\s+at\s/.test(line))
        .slice(0, 4)
        .map((line) => line.slice(0, 500)) ?? [],
    cause: failure?.cause && depth < 3 ? safeFailureDetails(failure.cause, depth + 1) : null,
  };
}

main().catch((error: unknown) => {
  console.error(JSON.stringify(safeFailureDetails(error)));
  console.error("Teaching note verification failed; inspect the ignored local evidence for completed stages.");
  process.exitCode = 1;
});
