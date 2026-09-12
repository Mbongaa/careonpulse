/** Synthetic semantic-boundary regressions; no provider, storage or audio access. */

import { valideerEngelsBewijs } from "../lib/careon-scribe/english-evidence";
import type { Feit, ScribeSegment } from "../lib/careon-scribe/types";
import { ENGLISH_EVIDENCE_EXAMPLES } from "./lib/scribe-english-evidence-fixtures";
import assert from "node:assert/strict";

let passed = 0;
let failed = 0;
for (const example of ENGLISH_EVIDENCE_EXAMPLES) {
  const segment: ScribeSegment = {
    id: "synthetic-source",
    volgnummer: 1,
    spreker: example.speaker ?? "patient",
    tekst: example.source,
    tekstGecorrigeerd: null,
    correctieBron: null,
    beginMs: 0,
    eindMs: 8_000,
    bron: "handmatig",
    createdAt: "2026-09-11T00:00:00.000Z",
  };
  const row: Feit = { tekst: example.quote ?? example.source, bron: [1], ingetrokken: false, ...example.additions };
  const original = JSON.stringify({ segment, row });
  try {
    assert.equal(valideerEngelsBewijs(example.field, row, [segment]), example.expected);
    assert.equal(JSON.stringify({ segment, row }), original, "validator must not mutate evidence");
    assert.equal(valideerEngelsBewijs(example.field, { ...row, bron: [2] }, [segment]), false);
    assert.equal(valideerEngelsBewijs(example.field, row, [{ ...segment, bron: "systeem" }]), false);
    assert.equal(
      valideerEngelsBewijs(example.field, row, [{ ...segment, tekstGecorrigeerd: "Corrected source differs." }]),
      false,
    );
    passed += 1;
  } catch {
    failed += 1;
    console.error(`FAIL ${example.name}`);
  }
}
console.log(
  `English evidence: ${passed} scenarios passed, ${failed} failed; each checks mutation, source references, gaps and corrections; no provider calls.`,
);
if (failed > 0) process.exitCode = 1;
