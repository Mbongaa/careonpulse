/**
 * Local teaching-recording verification only. Does not call application routes,
 * change organization settings, write to Supabase, or persist derived audio.
 * Provider calls require explicit invocation; output belongs under .next-e2e.
 */

import type { TranscriptieResultaat } from "@/lib/careon-scribe/transcriptie.server";
import type { ScribeSegment } from "@/lib/careon-scribe/types";

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const SAMPLE_RATE = 16_000;
const SILENCE_RMS = 0.004;
const LABEL = "Authorized psychiatric teaching recording; local verification, not a patient record.";

export function loadTeachingProviderEnvironment(repoRoot = process.cwd()): void {
  const allowed = new Set(["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_API_MODE", "CAREON_SCRIBE_TRANSCRIPTION_MODEL"]);
  const file = join(repoRoot, ".env.local");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || !allowed.has(match[1]) || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  // These must precede the lazy production-module imports: runtime.server
  // captures database credentials when it is first evaluated.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  process.env.CAREON_SCRIBE_LIVE = "1";
  process.env.CAREON_ASSISTANT_LIVE = "1";
  process.env.CAREON_SCRIBE_TRANSCRIPTION_PROVIDER = "openai";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.com/v1";
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("Teaching provider key is unavailable.");
}

export interface RecordingProbe {
  fileName: string;
  bytes: number;
  sha256: string;
  durationSeconds: number;
  sourceSampleRate: number;
  sourceChannels: number;
}

export function probeRecording(audioPath: string): RecordingProbe {
  const info = statSync(audioPath);
  if (!info.isFile() || info.size > 150 * 1024 * 1024) throw new Error("Unsupported teaching recording size.");
  const raw = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_streams", "-show_format", "-of", "json", audioPath],
    { encoding: "utf8", windowsHide: true, timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  const metadata = JSON.parse(raw) as {
    streams: { sample_rate: string; channels: number }[];
    format: { duration: string };
  };
  const durationSeconds = Number(metadata.format.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3_600)
    throw new Error("Unsupported teaching recording duration.");
  return {
    fileName: audioPath.split(/[\\/]/).at(-1) ?? "teaching-recording",
    bytes: info.size,
    sha256: createHash("sha256").update(readFileSync(audioPath)).digest("hex"),
    durationSeconds,
    sourceSampleRate: Number(metadata.streams[0]?.sample_rate),
    sourceChannels: metadata.streams[0]?.channels,
  };
}

/** Decode only to stdout/memory. No WAV/PCM copy is written to disk. */
export function decodeRecordingPcm(audioPath: string): Buffer {
  return execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", audioPath, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:1"],
    { windowsHide: true, timeout: 60_000, maxBuffer: 150 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
}

export interface FragmentOptions {
  startSeconds?: number;
  endSeconds?: number;
  /** New audio per fragment; the prior overlap is prepended, like opname.client. */
  fragmentSeconds?: number;
  overlapSeconds?: number;
}

export interface TeachingFragment {
  index: number;
  offsetMs: number;
  durationMs: number;
  overlapMs: number;
  newDurationMs: number;
  rms: number;
  pcm: Buffer;
}

export function* fragmentRecording(pcm: Buffer, options: FragmentOptions = {}): Generator<TeachingFragment> {
  const duration = pcm.length / (SAMPLE_RATE * 2);
  const start = Math.round((options.startSeconds ?? 0) * SAMPLE_RATE);
  const end = Math.min(pcm.length / 2, Math.round((options.endSeconds ?? duration) * SAMPLE_RATE));
  const step = Math.round((options.fragmentSeconds ?? 8) * SAMPLE_RATE);
  const overlap = Math.round((options.overlapSeconds ?? 1) * SAMPLE_RATE);
  if (start < 0 || end <= start || step < SAMPLE_RATE || step > 120 * SAMPLE_RATE || overlap < 0 || overlap >= step)
    throw new Error("Invalid teaching fragment interval.");
  let index = 0;
  for (let position = start; position < end; position += step) {
    const until = Math.min(end, position + step);
    const from = Math.max(start, position - overlap);
    let sum = 0;
    for (let sample = position; sample < until; sample += 1) sum += (pcm.readInt16LE(sample * 2) / 32768) ** 2;
    yield {
      index: index++,
      offsetMs: Math.round((from / SAMPLE_RATE) * 1000),
      durationMs: Math.round(((until - from) / SAMPLE_RATE) * 1000),
      overlapMs: Math.round(((position - from) / SAMPLE_RATE) * 1000),
      newDurationMs: Math.round(((until - position) / SAMPLE_RATE) * 1000),
      rms: Math.sqrt(sum / (until - position)),
      pcm: pcm.subarray(from * 2, until * 2),
    };
  }
}

export function wavFromPcm(pcm: Buffer): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

interface ProviderRequestMetric {
  status: number;
  durationMs: number;
  usage: Record<string, unknown> | null;
}

export interface FragmentEvidence {
  index: number;
  offsetMs: number;
  durationMs: number;
  overlapMs: number;
  rms: number;
  status: "transcribed" | "silence" | "empty" | "failed";
  elapsedMs: number;
  providerRequests: ProviderRequestMetric[];
  rawSegments: TranscriptieResultaat["segmenten"];
  segmenten: ScribeSegment[];
  overlapRemovedCharacters: number;
}

export interface TeachingRun {
  label: string;
  schemaVersion: number;
  runId: string;
  startedAt: string;
  completedAt: string | null;
  recording: RecordingProbe;
  parameters: Required<FragmentOptions>;
  provider: string;
  model: string;
  sourceHashes: Record<string, string>;
  fragments: FragmentEvidence[];
  segmenten: ScribeSegment[];
  metrics: Record<string, number>;
}

export interface TranscriptionRoundOptions extends FragmentOptions {
  audioPath: string;
  outputDir: string;
  runId: string;
  repoRoot?: string;
  onProgress?: (metrics: Record<string, number | string>) => void;
}

function safeOutputDirectory(outputDir: string, repoRoot: string): string {
  const root = resolve(repoRoot, ".next-e2e");
  const directory = resolve(outputDir);
  if (!directory.startsWith(`${root}${sep}`)) throw new Error("Teaching evidence must stay inside .next-e2e.");
  mkdirSync(directory, { recursive: true });
  return directory;
}

function persistRun(file: string, run: TeachingRun): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

function recomputeMetrics(run: TeachingRun): void {
  const requests = run.fragments.flatMap((fragment) => fragment.providerRequests);
  const timings = run.fragments.filter((fragment) => fragment.providerRequests.length > 0).map((row) => row.elapsedMs);
  timings.sort((a, b) => a - b);
  run.metrics = {
    fragmentsCompleted: run.fragments.length,
    fragmentsTranscribed: run.fragments.filter((row) => row.status === "transcribed").length,
    fragmentsFailed: run.fragments.filter((row) => row.status === "failed").length,
    silenceFragments: run.fragments.filter((row) => row.status === "silence").length,
    emptyFragments: run.fragments.filter((row) => row.status === "empty").length,
    providerRequests: requests.length,
    httpFailures: requests.filter((row) => row.status < 200 || row.status >= 300).length,
    audioSecondsSubmitted: run.fragments.reduce(
      (sum, row) => sum + (row.durationMs * row.providerRequests.length) / 1000,
      0,
    ),
    providerReportedInputTokens: requests.reduce((sum, row) => sum + Number(row.usage?.input_tokens ?? 0), 0),
    providerReportedOutputTokens: requests.reduce((sum, row) => sum + Number(row.usage?.output_tokens ?? 0), 0),
    elapsedProcessingMs: run.fragments.reduce((sum, row) => sum + row.elapsedMs, 0),
    medianFragmentMs: timings[Math.floor(timings.length / 2)] ?? 0,
    p95FragmentMs: timings[Math.max(0, Math.ceil(timings.length * 0.95) - 1)] ?? 0,
    segments: run.segmenten.length,
    unknownSpeakerSegments: run.segmenten.filter((row) => row.spreker === "onbekend").length,
    transcriptCharacters: run.segmenten.reduce((sum, row) => sum + row.tekst.length, 0),
    overlapRemovedCharacters: run.fragments.reduce((sum, row) => sum + row.overlapRemovedCharacters, 0),
  };
}

/** Sequential by design: each real provider call receives the preceding transcript context. */
export async function runTranscriptionRound(options: TranscriptionRoundOptions): Promise<TeachingRun> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  loadTeachingProviderEnvironment(repoRoot);
  const { transcribeer, transcriptieModel } = await import("@/lib/careon-scribe/transcriptie.server");
  const { staartVan, verwijderOverlap } = await import("@/lib/careon-scribe/overlap");
  const { SCRIBE_LIMITS } = await import("@/lib/careon-scribe/types");
  if (!/^[a-z0-9][a-z0-9_-]{0,70}$/.test(options.runId)) throw new Error("Invalid teaching run ID.");
  const directory = safeOutputDirectory(options.outputDir, repoRoot);
  const evidenceFile = join(directory, `${options.runId}.json`);
  const recording = probeRecording(options.audioPath);
  const pcm = decodeRecordingPcm(options.audioPath);
  const parameters: Required<FragmentOptions> = {
    startSeconds: options.startSeconds ?? 0,
    endSeconds: Math.min(options.endSeconds ?? recording.durationSeconds, pcm.length / (SAMPLE_RATE * 2)),
    fragmentSeconds: options.fragmentSeconds ?? 8,
    overlapSeconds: options.overlapSeconds ?? 1,
  };
  const sourceHashes = Object.fromEntries(
    ["transcriptie.server.ts", "overlap.ts", "opname.client.ts"].map((name) => [
      name,
      createHash("sha256")
        .update(readFileSync(join(repoRoot, "src/lib/careon-scribe", name)))
        .digest("hex"),
    ]),
  );
  let run: TeachingRun = {
    label: LABEL,
    schemaVersion: 1,
    runId: options.runId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    recording,
    parameters,
    provider: "openai",
    model: transcriptieModel() ?? "unavailable",
    sourceHashes,
    fragments: [],
    segmenten: [],
    metrics: {},
  };
  if (existsSync(evidenceFile)) {
    const existing = JSON.parse(readFileSync(evidenceFile, "utf8")) as TeachingRun;
    if (
      existing.recording.sha256 !== recording.sha256 ||
      JSON.stringify(existing.parameters) !== JSON.stringify(parameters) ||
      JSON.stringify(existing.sourceHashes) !== JSON.stringify(sourceHashes) ||
      existing.model !== run.model
    )
      throw new Error("Existing evidence has different inputs; choose another run ID.");
    run = existing;
  }
  if (run.completedAt) return run;
  persistRun(evidenceFile, run);
  const originalFetch = globalThis.fetch;
  let activeRequests: ProviderRequestMetric[] = [];
  globalThis.fetch = async (input, init) => {
    let url: string;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else url = input.url;
    if (!url.startsWith("https://api.openai.com/v1/"))
      throw new Error("Teaching harness blocked a non-provider request.");
    const startedAt = Date.now();
    try {
      const response = await originalFetch(input, init);
      let usage: Record<string, unknown> | null = null;
      if (response.ok) {
        try {
          const copy = (await response.clone().json()) as { usage?: Record<string, unknown> };
          // Store only numerical usage metadata, never provider text in request metrics.
          if (copy.usage)
            usage = Object.fromEntries(Object.entries(copy.usage).filter(([, value]) => typeof value === "number"));
        } catch {
          // The real adapter remains authoritative for response validation.
        }
      }
      activeRequests.push({ status: response.status, durationMs: Date.now() - startedAt, usage });
      return response;
    } catch {
      activeRequests.push({ status: 0, durationMs: Date.now() - startedAt, usage: null });
      throw new Error("Teaching provider network request failed.");
    }
  };
  try {
    for (const fragment of fragmentRecording(pcm, parameters)) {
      if (fragment.index < run.fragments.length) continue;
      activeRequests = [];
      const startedAt = Date.now();
      const evidence: FragmentEvidence = {
        index: fragment.index,
        offsetMs: fragment.offsetMs,
        durationMs: fragment.durationMs,
        overlapMs: fragment.overlapMs,
        rms: fragment.rms,
        status: "silence",
        elapsedMs: 0,
        providerRequests: [],
        rawSegments: [],
        segmenten: [],
        overlapRemovedCharacters: 0,
      };
      if (fragment.rms >= SILENCE_RMS) {
        try {
          const context = run.segmenten
            .slice(-3)
            .map((row) => row.tekstGecorrigeerd ?? row.tekst)
            .join(" ");
          const result = await transcribeer(
            { audio: wavFromPcm(fragment.pcm), mime: "audio/wav", taal: "en", contextTekst: context },
            AbortSignal.timeout(60_000),
          );
          evidence.rawSegments = result.segmenten;
          const cleaned = result.segmenten
            .map((row, index) => ({
              ...row,
              tekst: index === 0 ? verwijderOverlap(staartVan(context), row.tekst) : row.tekst,
            }))
            .filter((row) => row.tekst.trim().length > 0);
          const perSegment = Math.max(1, Math.round(fragment.durationMs / cleaned.length));
          const begin = fragment.offsetMs + fragment.overlapMs;
          evidence.segmenten = cleaned.map((row, index) => ({
            id: randomUUID(),
            volgnummer: run.segmenten.length + index + 1,
            spreker: row.spreker,
            tekst: row.tekst.slice(0, SCRIBE_LIMITS.segmentTekst),
            tekstGecorrigeerd: null,
            correctieBron: null,
            beginMs: begin + index * perSegment,
            eindMs: Math.min(fragment.offsetMs + fragment.durationMs, begin + (index + 1) * perSegment),
            bron: "live",
            createdAt: new Date().toISOString(),
          }));
          evidence.overlapRemovedCharacters =
            result.segmenten.reduce((sum, row) => sum + row.tekst.length, 0) -
            cleaned.reduce((sum, row) => sum + row.tekst.length, 0);
          evidence.status = cleaned.length ? "transcribed" : "empty";
        } catch {
          evidence.status = "failed";
          evidence.segmenten = [
            {
              id: randomUUID(),
              volgnummer: run.segmenten.length + 1,
              spreker: "onbekend",
              tekst: "[Teaching verification: fragment transcription failed]",
              tekstGecorrigeerd: null,
              correctieBron: null,
              beginMs: fragment.offsetMs,
              eindMs: fragment.offsetMs + fragment.durationMs,
              bron: "systeem",
              createdAt: new Date().toISOString(),
            },
          ];
        }
      }
      evidence.elapsedMs = Date.now() - startedAt;
      evidence.providerRequests = activeRequests;
      run.fragments.push(evidence);
      run.segmenten.push(...evidence.segmenten);
      recomputeMetrics(run);
      persistRun(evidenceFile, run);
      options.onProgress?.({
        runId: run.runId,
        throughSeconds: (fragment.offsetMs + fragment.durationMs) / 1000,
        ...run.metrics,
      });
      if (run.fragments.slice(-3).every((row) => row.status === "failed") && run.fragments.length >= 3)
        throw new Error("Teaching verification stopped after three consecutive failed fragments.");
    }
    run.completedAt = new Date().toISOString();
    recomputeMetrics(run);
    persistRun(evidenceFile, run);
    writeFileSync(
      join(directory, `${run.runId}.transcript.txt`),
      `${LABEL}\n\n${run.segmenten.map((row) => `§${row.volgnummer} [${row.beginMs}-${row.eindMs}ms] [${row.spreker}] ${row.tekst}`).join("\n\n")}\n`,
      "utf8",
    );
    options.onProgress?.({
      runId: run.runId,
      status: "completed",
      artifact: relative(repoRoot, evidenceFile),
      ...run.metrics,
    });
    return run;
  } finally {
    globalThis.fetch = originalFetch;
  }
}
