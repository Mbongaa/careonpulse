/** Compare provider transcripts; disagreements are review candidates, never ground-truth error rates. */

import type { TeachingRun } from "./lib/scribe-recording-harness";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

interface Token {
  word: string;
  segment: number;
  beginMs: number | null;
  position: number;
  segmentLength: number;
}

function tokens(run: TeachingRun): Token[] {
  return run.segmenten
    .filter((row) => row.bron !== "systeem")
    .flatMap((row) => {
      const words = row.tekst.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
      return words.map((word, position) => ({
        word: word.replaceAll("’", "'"),
        segment: row.volgnummer,
        beginMs: row.beginMs,
        position,
        segmentLength: words.length,
      }));
    });
}

type Operation = {
  type: "match" | "substitution" | "extraBaseline" | "missingBaseline";
  baseline: number;
  reference: number;
};

function align(baseline: Token[], reference: Token[]): Operation[] {
  if (baseline.length * reference.length > 40_000_000) throw new Error("Comparison exceeds the bounded token limit.");
  const width = baseline.length + 1;
  const matrix = new Uint16Array(width * (reference.length + 1));
  for (let column = 0; column < width; column += 1) matrix[column] = column;
  for (let row = 1; row <= reference.length; row += 1) {
    matrix[row * width] = row;
    for (let column = 1; column < width; column += 1) {
      matrix[row * width + column] = Math.min(
        matrix[(row - 1) * width + column] + 1,
        matrix[row * width + column - 1] + 1,
        matrix[(row - 1) * width + column - 1] + Number(reference[row - 1].word !== baseline[column - 1].word),
      );
    }
  }
  const operations: Operation[] = [];
  let row = reference.length;
  let column = baseline.length;
  while (row > 0 || column > 0) {
    const cost = matrix[row * width + column];
    const equal = row > 0 && column > 0 && reference[row - 1].word === baseline[column - 1].word;
    if (row > 0 && column > 0 && cost === matrix[(row - 1) * width + column - 1] + Number(!equal)) {
      operations.push({ type: equal ? "match" : "substitution", baseline: --column, reference: --row });
    } else if (column > 0 && cost === matrix[row * width + column - 1] + 1) {
      operations.push({ type: "extraBaseline", baseline: --column, reference: row });
    } else {
      operations.push({ type: "missingBaseline", baseline: column, reference: --row });
    }
  }
  return operations.reverse();
}

function main(): void {
  const baselineFile = process.argv[2];
  const referenceFile = process.argv[3];
  if (!baselineFile || !referenceFile) throw new Error("Pass baseline.json and reference.json.");
  const root = resolve(".next-e2e");
  for (const file of [baselineFile, referenceFile]) {
    if (!resolve(file).startsWith(`${root}${sep}`)) throw new Error("Evidence must stay under .next-e2e.");
  }
  const baselineRun = JSON.parse(readFileSync(baselineFile, "utf8")) as TeachingRun;
  const referenceRun = JSON.parse(readFileSync(referenceFile, "utf8")) as TeachingRun;
  if (!baselineRun.completedAt || !referenceRun.completedAt) throw new Error("Both runs must be complete.");
  if (baselineRun.recording.sha256 !== referenceRun.recording.sha256) throw new Error("Recordings must match.");
  if (
    baselineRun.parameters.startSeconds !== referenceRun.parameters.startSeconds ||
    baselineRun.parameters.endSeconds !== referenceRun.parameters.endSeconds
  )
    throw new Error("Recording intervals must match.");
  const baseline = tokens(baselineRun);
  const reference = tokens(referenceRun);
  const operations = align(baseline, reference);
  const grouped: Operation[][] = [];
  for (const operation of operations) {
    if (operation.type === "match") continue;
    const prior = grouped.at(-1);
    const previousOperation = prior?.at(-1);
    if (
      previousOperation &&
      operation.baseline - previousOperation.baseline <= 1 &&
      operation.reference - previousOperation.reference <= 1
    )
      prior?.push(operation);
    else grouped.push([operation]);
  }
  const reviewCandidates = grouped.map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    const baselineFrom = Math.max(0, first.baseline - 5);
    const referenceFrom = Math.max(0, first.reference - 5);
    const baselineTo = Math.min(baseline.length, last.baseline + 6);
    const referenceTo = Math.min(reference.length, last.reference + 6);
    const changedWords = group.flatMap((op) => [
      op.type === "missingBaseline" ? "" : (baseline[op.baseline]?.word ?? ""),
      op.type === "extraBaseline" ? "" : (reference[op.reference]?.word ?? ""),
    ]);
    return {
      baselineSegment: baseline[first.baseline]?.segment ?? null,
      baselineBeginMs: baseline[first.baseline]?.beginMs ?? null,
      referenceSegment: reference[first.reference]?.segment ?? null,
      referenceBeginMs: reference[first.reference]?.beginMs ?? null,
      nearBaselineFragmentBoundary: group.some((op) => {
        const token = baseline[op.baseline];
        return token && (token.position < 3 || token.position >= token.segmentLength - 3);
      }),
      needsNegationReview: changedWords.some((word) =>
        /^(?:not|no|never|none|denies|don't|doesn't|didn't|isn't|wasn't|can't|couldn't|wouldn't|without)$/.test(word),
      ),
      needsNumberReview: changedWords.some((word) => /\d/.test(word)),
      operations: group.map((op) => ({
        type: op.type,
        baseline: op.type === "missingBaseline" ? null : (baseline[op.baseline]?.word ?? null),
        reference: op.type === "extraBaseline" ? null : (reference[op.reference]?.word ?? null),
      })),
      baselineContext: baseline
        .slice(baselineFrom, baselineTo)
        .map((token) => token.word)
        .join(" "),
      referenceContext: reference
        .slice(referenceFrom, referenceTo)
        .map((token) => token.word)
        .join(" "),
    };
  });
  const metrics = {
    baselineWords: baseline.length,
    referenceWords: reference.length,
    matches: operations.filter((op) => op.type === "match").length,
    substitutions: operations.filter((op) => op.type === "substitution").length,
    extraBaselineWords: operations.filter((op) => op.type === "extraBaseline").length,
    missingBaselineWords: operations.filter((op) => op.type === "missingBaseline").length,
    disagreementGroups: reviewCandidates.length,
    groupsNearBaselineFragmentBoundary: reviewCandidates.filter((row) => row.nearBaselineFragmentBoundary).length,
    groupsNeedingNegationReview: reviewCandidates.filter((row) => row.needsNegationReview).length,
    groupsNeedingNumberReview: reviewCandidates.filter((row) => row.needsNumberReview).length,
  };
  const report = {
    label:
      "Teaching recording comparison. Neither provider output is human-verified ground truth; these are disagreement counts, not WER or clinical accuracy scores.",
    baseline: { runId: baselineRun.runId, model: baselineRun.model, parameters: baselineRun.parameters },
    reference: { runId: referenceRun.runId, model: referenceRun.model, parameters: referenceRun.parameters },
    metrics,
    reviewCandidates,
  };
  const target = resolve(baselineFile).replace(/\.json$/, `.vs-${referenceRun.runId}.comparison.json`);
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: "comparison-completed", ...metrics })}\n`);
}

try {
  main();
} catch {
  process.stderr.write("Teaching comparison stopped; validate completed artifact inputs. No content logged.\n");
  process.exitCode = 1;
}
