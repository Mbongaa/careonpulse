/** Explicit one-request teaching MP3 experiment. Raw audio is read into RAM only. */

import { preserveDiarizedTurns } from "./lib/scribe-diarization-prototype";
import { loadTeachingProviderEnvironment, probeRecording } from "./lib/scribe-recording-harness";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const audioPath = process.argv[2];
  if (!audioPath) throw new Error("Explicit authorized teaching MP3 path required.");
  const recording = probeRecording(audioPath);
  if (recording.bytes > 25_000_000) throw new Error("Recording exceeds provider upload limit.");
  const output = resolve(".next-e2e/scribe-audio-20260911/full-diarization.json");
  loadTeachingProviderEnvironment();
  const { bouwOpenAITranscriptieVerzoek } = await import("../lib/careon-scribe/transcriptie.server");
  const bytes = new Uint8Array(readFileSync(audioPath));
  const request = bouwOpenAITranscriptieVerzoek(
    { audio: bytes, mime: "audio/mpeg", taal: "en", contextTekst: "" },
    "gpt-4o-transcribe-diarize",
  );
  if (request.url !== "https://api.openai.com/v1/audio/transcriptions")
    throw new Error("Unexpected provider destination.");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/mpeg" }), "authorized-teaching.mp3");
  for (const [key, value] of Object.entries(request.velden)) form.append(key, value);
  const startedAt = new Date().toISOString();
  const start = Date.now();
  writeFileSync(
    output,
    JSON.stringify(
      {
        label: "Authorized teaching recording, isolated one-request experiment; no clinical role assignments.",
        startedAt,
        recording,
        status: "running",
        request: request.velden,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "request-started",
      bytes: recording.bytes,
      durationSeconds: recording.durationSeconds,
      model: request.velden.model,
    }),
  );
  const response = await fetch(request.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(480_000),
  });
  const rawProviderResponse: unknown = await response.json();
  if (!response.ok) {
    writeFileSync(
      output,
      JSON.stringify(
        { startedAt, completedAt: new Date().toISOString(), recording, status: response.status, rawProviderResponse },
        null,
        2,
      ),
    );
    throw new Error("Provider rejected one-request experiment.");
  }
  const turns = preserveDiarizedTurns(rawProviderResponse, {
    fragmentId: "whole-consult",
    offsetMs: 0,
    duurMs: Math.round(recording.durationSeconds * 1000),
    overlapMs: 0,
  });
  const segmenten = turns.map((turn, index) => ({
    ...turn,
    id: `full-diarization-${index + 1}`,
    volgnummer: index + 1,
    tekstGecorrigeerd: null,
    correctieBron: null,
    bron: "live",
    createdAt: startedAt,
  }));
  const intervals = turns
    .filter((turn) => turn.diarisatie.timing === "provider")
    .map((turn) => [turn.beginMs, turn.eindMs])
    .sort((a, b) => a[0] - b[0]);
  let through = 0;
  let covered = 0;
  const uncoveredIntervals: { beginMs: number; eindMs: number }[] = [];
  for (const [begin, end] of intervals) {
    if (begin > through) uncoveredIntervals.push({ beginMs: through, eindMs: begin });
    covered += Math.max(0, end - Math.max(begin, through));
    through = Math.max(through, end);
  }
  if (through < recording.durationSeconds * 1000)
    uncoveredIntervals.push({ beginMs: through, eindMs: Math.round(recording.durationSeconds * 1000) });
  const metrics = {
    elapsedMs: Date.now() - start,
    requests: 1,
    status: response.status,
    turns: turns.length,
    labels: [...new Set(turns.map((turn) => turn.diarisatie.sprekerLabel))],
    invalidTimestamps: turns.filter((turn) => turn.diarisatie.timing !== "provider").length,
    questionTurns: turns.filter((turn) => turn.tekst.includes("?")).length,
    firstSourceMs: intervals[0]?.[0] ?? null,
    lastSourceMs: through,
    coveredSpeechIntervalMs: covered,
    uncoveredIntervalMs: Math.round(recording.durationSeconds * 1000) - covered,
  };
  writeFileSync(
    output,
    JSON.stringify(
      {
        label:
          "Authorized teaching recording; neutral labels scoped to one whole-consult provider request; no accuracy or clinical identity claim.",
        startedAt,
        completedAt: new Date().toISOString(),
        recording,
        parameters: { fragmentSeconds: recording.durationSeconds, overlapSeconds: 0 },
        request: request.velden,
        rawProviderResponse,
        segmenten,
        metrics,
        uncoveredIntervals,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ phase: "complete", ...metrics }));
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      status: "stopped",
      errorType: error instanceof Error ? error.name : "unknown",
      message: "One-request diarization failed; no source or credentials logged.",
    }),
  );
  process.exitCode = 1;
});
