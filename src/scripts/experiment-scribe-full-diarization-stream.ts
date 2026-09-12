/** One explicitly authorized streaming retry. No raw-audio file is created. */

// biome-ignore lint/correctness/noUndeclaredDependencies: isolated teaching experiment uses the already installed Next.js transport; no product dependency or manifest change.
import { Agent, FormData, fetch } from "undici";

import { preserveDiarizedTurns } from "./lib/scribe-diarization-prototype";
import { loadTeachingProviderEnvironment, probeRecording } from "./lib/scribe-recording-harness";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const audioPath = process.argv[2];
  if (!audioPath) throw new Error("Explicit authorized teaching MP3 path required.");
  const recording = probeRecording(audioPath);
  if (recording.bytes > 25_000_000) throw new Error("Recording exceeds upload limit.");
  const output = resolve(".next-e2e/scribe-audio-20260911/full-diarization-stream.json");
  const rawOutput = resolve(".next-e2e/scribe-audio-20260911/full-diarization-stream.sse.txt");
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const rows: Record<string, unknown>[] = [];
  const otherEvents: Record<string, unknown>[] = [];
  const eventCounts: Record<string, number> = {};
  let httpStatus: number | null = null;
  let firstEventMs: number | null = null;
  let completed = false;
  let error: { type: string; causeCode: string | null } | null = null;
  const save = (): void => {
    const turns = preserveDiarizedTurns(
      { segments: rows },
      {
        fragmentId: "whole-consult-stream",
        offsetMs: 0,
        duurMs: Math.round(recording.durationSeconds * 1000),
        overlapMs: 0,
      },
    );
    const segmenten = turns.map((turn, index) => ({
      ...turn,
      id: `whole-stream-${index + 1}`,
      volgnummer: index + 1,
      tekstGecorrigeerd: null,
      correctieBron: null,
      bron: "live",
      createdAt: startedAt,
    }));
    writeFileSync(
      output,
      JSON.stringify(
        {
          label:
            "Authorized teaching recording, one streaming provider request; neutral speaker labels only, no role or accuracy claim.",
          startedAt,
          updatedAt: new Date().toISOString(),
          completed,
          error,
          recording,
          parameters: { fragmentSeconds: recording.durationSeconds, overlapSeconds: 0 },
          request: {
            model: "gpt-4o-transcribe-diarize",
            response_format: "diarized_json",
            chunking_strategy: "auto",
            stream: true,
          },
          metrics: {
            elapsedMs: Date.now() - start,
            httpStatus,
            firstEventMs,
            eventCounts,
            turns: turns.length,
            lastSourceMs: Math.max(0, ...turns.map((turn) => turn.eindMs)),
            labels: [...new Set(turns.map((turn) => turn.diarisatie.sprekerLabel))],
            invalidTimestamps: turns.filter((turn) => turn.diarisatie.timing !== "provider").length,
          },
          rawProviderSegments: rows,
          otherEvents,
          segmenten,
        },
        null,
        2,
      ),
    );
  };
  loadTeachingProviderEnvironment();
  const form = new FormData();
  const audio = new Uint8Array(readFileSync(audioPath));
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), "authorized-teaching.mp3");
  for (const [key, value] of Object.entries({
    model: "gpt-4o-transcribe-diarize",
    language: "en",
    response_format: "diarized_json",
    chunking_strategy: "auto",
    stream: "true",
  }))
    form.append(key, value);
  const dispatcher = new Agent({ headersTimeout: 480_000, bodyTimeout: 480_000 });
  writeFileSync(rawOutput, "");
  save();
  console.log(JSON.stringify({ phase: "stream-started", bytes: recording.bytes, timeoutMs: 480_000 }));
  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(480_000),
      dispatcher,
    });
    httpStatus = response.status;
    console.log(JSON.stringify({ phase: "headers", httpStatus, elapsedMs: Date.now() - start }));
    if (!response.ok || !response.body) {
      const providerError = await response.text();
      appendFileSync(rawOutput, providerError);
      throw new Error("ProviderRejected");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    const handle = (block: string): void => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;
      const event = JSON.parse(data) as Record<string, unknown>;
      if (firstEventMs === null) firstEventMs = Date.now() - start;
      const type = typeof event.type === "string" ? event.type : "unknown";
      eventCounts[type] = (eventCounts[type] ?? 0) + 1;
      if (type === "transcript.text.segment") {
        rows.push(event);
        save();
        if (rows.length % 20 === 0)
          console.log(
            JSON.stringify({
              phase: "progress",
              turns: rows.length,
              elapsedMs: Date.now() - start,
              throughSeconds: event.end,
            }),
          );
      } else if (type !== "transcript.text.delta") {
        otherEvents.push(event);
      }
      if (type === "transcript.text.done") completed = true;
      if (type === "error") throw new Error("ProviderStreamError");
    };
    for (;;) {
      const part = await reader.read();
      const text = decoder.decode(part.value, { stream: !part.done });
      appendFileSync(rawOutput, text);
      pending += text;
      let boundary = /\r?\n\r?\n/.exec(pending);
      while (boundary?.index !== undefined) {
        handle(pending.slice(0, boundary.index));
        pending = pending.slice(boundary.index + boundary[0].length);
        boundary = /\r?\n\r?\n/.exec(pending);
      }
      if (part.done) break;
    }
    if (pending.trim()) handle(pending);
    if (!completed) throw new Error("StreamEndedWithoutDone");
  } catch (caught) {
    const cause = caught instanceof Error ? caught.cause : undefined;
    const rawCode = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
    error = {
      type: caught instanceof Error ? caught.name : "unknown",
      causeCode: typeof rawCode === "string" && /^[A-Z0-9_]{1,60}$/.test(rawCode) ? rawCode : null,
    };
    process.exitCode = 1;
  } finally {
    save();
    await dispatcher.close();
    console.log(
      JSON.stringify({
        phase: "stream-finished",
        completed,
        httpStatus,
        elapsedMs: Date.now() - start,
        turns: rows.length,
        eventCounts,
        error,
      }),
    );
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ phase: "setup-failed", type: error instanceof Error ? error.name : "unknown" }));
  process.exitCode = 1;
});
