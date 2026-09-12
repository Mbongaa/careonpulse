/** Bounded, explicit teaching-only benchmark. Never imported by the product. */

import { markExactOverlap, preserveDiarizedTurns, scopedSpeakerKey } from "./lib/scribe-diarization-prototype";
import {
  decodeRecordingPcm,
  fragmentRecording,
  loadTeachingProviderEnvironment,
  wavFromPcm,
} from "./lib/scribe-recording-harness";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function pureChecks(): void {
  const context = { fragmentId: "new", offsetMs: 15_000, duurMs: 17_000, overlapMs: 1000 };
  const one = preserveDiarizedTurns(
    { segments: [{ id: "s0", start: 0.1, end: 0.8, speaker: "A", text: "No." }] },
    context,
  );
  assert.equal(one[0].beginMs, 15_100);
  assert.equal(one[0].eindMs, 15_800);
  assert.equal(one[0].spreker, "onbekend");
  assert.notEqual(scopedSpeakerKey("new", "A"), scopedSpeakerKey("prior", "A"));
  const prior = preserveDiarizedTurns(
    { segments: [{ id: "old", start: 15.1, end: 15.8, speaker: "B", text: "No." }] },
    { fragmentId: "prior", offsetMs: 0, duurMs: 16_000, overlapMs: 0 },
  );
  const overlap = markExactOverlap(prior, one, context);
  assert.equal(overlap[0].overlap, "exact-duplicate");
  assert.equal(overlap[0].tekst, "No.");
  assert.equal(overlap[0].neutralSpeakerKey, "new:A");
  const crossing = preserveDiarizedTurns(
    { segments: [{ start: 0.1, end: 2, speaker: "A", text: "No, I do not take pills." }] },
    context,
  );
  assert.equal(markExactOverlap(prior, crossing, context)[0].overlap, "review");
  assert.equal(markExactOverlap(prior, crossing, context)[0].tekst, "No, I do not take pills.");
  assert.equal(markExactOverlap(prior, one, { ...context, overlapMs: 0 })[0].overlap, "none");
  const invalid = preserveDiarizedTurns(
    { segments: [{ start: -1, end: 999, speaker: "doctor", text: "A source sentence." }] },
    context,
  );
  assert.equal(invalid[0].diarisatie.timing, "fragment-estimate");
  assert.equal(invalid[0].spreker, "onbekend");
  const repeated = markExactOverlap([...prior, ...prior], one, context);
  assert.equal(repeated[0].overlap, "review");
  process.stdout.write("Diarization prototype: 13 source-boundary assertions passed.\n");
}

async function main(): Promise<void> {
  pureChecks();
  if (!process.argv.includes("--live-first-minute")) return;
  loadTeachingProviderEnvironment();
  process.env.CAREON_SCRIBE_TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";
  const { transcribeer } = await import("@/lib/careon-scribe/transcriptie.server");
  const audioPath = process.argv[process.argv.indexOf("--live-first-minute") + 1];
  if (!audioPath) throw new Error("Expected the authorized teaching audio path.");
  const pcm = decodeRecordingPcm(audioPath);
  const outputDirectory = resolve(".next-e2e/scribe-audio-20260911");
  mkdirSync(outputDirectory, { recursive: true });
  const originalFetch = globalThis.fetch;
  let providerResponses: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    let url: string;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else url = input.url;
    if (url !== "https://api.openai.com/v1/audio/transcriptions") throw new Error("Blocked non-transcription request.");
    const response = await originalFetch(input, init);
    if (response.ok) providerResponses.push(await response.clone().json());
    return response;
  };
  try {
    const rounds = [];
    for (const fragmentSeconds of [8, 16, 30]) {
      const fragments = [];
      let previous: ReturnType<typeof preserveDiarizedTurns> = [];
      for (const fragment of fragmentRecording(pcm, { endSeconds: 60, fragmentSeconds, overlapSeconds: 1 })) {
        if (fragment.rms < 0.004) continue;
        providerResponses = [];
        const startedAt = Date.now();
        const result = await transcribeer(
          { audio: wavFromPcm(fragment.pcm), mime: "audio/wav", taal: "en", contextTekst: "" },
          AbortSignal.timeout(60_000),
        );
        const context = {
          fragmentId: `probe-${fragmentSeconds}-${fragment.index}`,
          offsetMs: fragment.offsetMs,
          duurMs: fragment.durationMs,
          overlapMs: fragment.overlapMs,
        };
        const raw = providerResponses.at(-1);
        const turns = markExactOverlap(previous, preserveDiarizedTurns(raw, context), context);
        previous = [...previous, ...turns];
        const item = {
          index: fragment.index,
          offsetMs: fragment.offsetMs,
          durationMs: fragment.durationMs,
          elapsedMs: Date.now() - startedAt,
          provider: result.provider,
          model: result.model,
          rawProviderResponse: raw,
          adapterOutput: result.segmenten,
          preservedTurns: turns,
        };
        fragments.push(item);
        process.stdout.write(
          `${JSON.stringify({ fragmentSeconds, fragmentIndex: fragment.index, throughSeconds: (fragment.offsetMs + fragment.durationMs) / 1000, elapsedMs: item.elapsedMs, turns: turns.length, labels: [...new Set(turns.map((turn) => turn.diarisatie.sprekerLabel))], invalidTimestamps: turns.filter((turn) => turn.diarisatie.timing !== "provider").length })}\n`,
        );
      }
      const timings = fragments.map((fragment) => fragment.elapsedMs).sort((a, b) => a - b);
      const round = {
        fragmentSeconds,
        overlapSeconds: 1,
        sourceWindowSeconds: 60,
        label: "Authorized teaching audio; source metadata experiment, not patient data or accuracy measurement.",
        fragments,
        metrics: {
          requests: fragments.length,
          medianMs: (timings[Math.floor((timings.length - 1) / 2)] + timings[Math.floor(timings.length / 2)]) / 2,
          maxMs: Math.max(...timings),
          elapsedMs: timings.reduce((sum, value) => sum + value, 0),
          sourceSecondsSent: fragments.reduce((sum, fragment) => sum + fragment.durationMs / 1000, 0),
          turns: previous.length,
          emptyResponses: fragments.filter((fragment) => fragment.adapterOutput.length === 0).length,
          questionTurns: previous.filter((turn) => turn.tekst.includes("?")).length,
          overlapReviews: previous.filter((turn) => turn.overlap === "review").length,
          exactDuplicates: previous.filter((turn) => turn.overlap === "exact-duplicate").length,
          invalidTimestamps: previous.filter((turn) => turn.diarisatie.timing !== "provider").length,
        },
      };
      rounds.push(round);
      writeFileSync(
        resolve(outputDirectory, `diarization-early-${fragmentSeconds}s.json`),
        `${JSON.stringify(round, null, 2)}\n`,
        "utf8",
      );
      process.stdout.write(`${JSON.stringify({ status: "round-completed", fragmentSeconds, ...round.metrics })}\n`);
    }
    writeFileSync(
      resolve(outputDirectory, "diarization-early-summary.json"),
      `${JSON.stringify(
        rounds.map(({ metrics, fragmentSeconds }) => ({ fragmentSeconds, ...metrics })),
        null,
        2,
      )}\n`,
      "utf8",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch(() => {
  process.stderr.write("Diarization experiment stopped; no content logged.\n");
  process.exitCode = 1;
});
