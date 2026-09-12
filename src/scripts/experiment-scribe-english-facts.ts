/** Diagnostic experiment, not clinical ground truth. Synthetic text; no provider or database calls. */

import { legeKlinischeStaat } from "../lib/careon-scribe/klinische-staat";
import type { Feit, KlinischeStaat, ScribeSegment, Spreker } from "../lib/careon-scribe/types";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

interface Probe {
  group: string;
  label: string;
  source: string;
  speaker: Spreker;
  field: keyof KlinischeStaat;
  additions?: Record<string, unknown>;
  candidateText?: string;
  expectedAccepted: boolean;
}

const probes: Probe[] = [
  {
    group: "current-medication",
    label: "literal current use",
    source: "I take sertraline 50 mg every morning.",
    speaker: "patient",
    field: "medicatie",
    additions: { naam: "sertraline", dosering: "50 mg", gebruik: "huidig" },
    expectedAccepted: true,
  },
  {
    group: "current-medication",
    label: "invented dose",
    source: "I take sertraline 50 mg every morning.",
    speaker: "patient",
    field: "medicatie",
    additions: { naam: "sertraline", dosering: "100 mg", gebruik: "huidig" },
    expectedAccepted: false,
  },
  {
    group: "dose-binding",
    label: "dose belonging to another named medicine",
    source: "I take sertraline 50 mg and tramadol 100 mg every morning.",
    speaker: "patient",
    field: "medicatie",
    additions: { naam: "sertraline", dosering: "100 mg", gebruik: "huidig" },
    expectedAccepted: false,
  },
  {
    group: "negation-and-stopping",
    label: "denial cannot become current use",
    source: "I do not take sertraline.",
    speaker: "patient",
    field: "medicatie",
    additions: { naam: "sertraline", dosering: null, gebruik: "huidig" },
    expectedAccepted: false,
  },
  {
    group: "negation-and-stopping",
    label: "explicit stopping",
    source: "I stopped taking sertraline last week.",
    speaker: "patient",
    field: "medicatie",
    additions: { naam: "sertraline", dosering: null, gebruik: "gestopt" },
    expectedAccepted: true,
  },
  {
    group: "multiword-medicine",
    label: "literal two-word medicine",
    source: "I take sodium valproate 500 mg every evening.",
    speaker: "patient",
    field: "medicatie",
    additions: { naam: "sodium valproate", dosering: "500 mg", gebruik: "huidig" },
    expectedAccepted: true,
  },
  {
    group: "allergy",
    label: "affirmed allergy",
    source: "I am allergic to penicillin.",
    speaker: "patient",
    field: "allergieen",
    additions: { aard: "allergie" },
    expectedAccepted: true,
  },
  {
    group: "allergy",
    label: "denied allergy",
    source: "I am not allergic to penicillin.",
    speaker: "patient",
    field: "allergieen",
    additions: { aard: "allergie" },
    expectedAccepted: false,
  },
  {
    group: "allergy",
    label: "uncertainty cannot become established allergy",
    source: "I may be allergic to penicillin.",
    speaker: "patient",
    field: "allergieen",
    additions: { aard: "allergie" },
    expectedAccepted: false,
  },
  {
    group: "symptoms",
    label: "literal current symptom",
    source: "I feel dizzy today.",
    speaker: "patient",
    field: "symptomen",
    expectedAccepted: true,
  },
  {
    group: "symptoms",
    label: "literal denial retains its polarity",
    source: "I do not feel dizzy today.",
    speaker: "patient",
    field: "symptomen",
    expectedAccepted: true,
  },
  {
    group: "symptoms",
    label: "denial cannot be shortened to a positive",
    source: "I do not feel dizzy today.",
    candidateText: "I feel dizzy today.",
    speaker: "patient",
    field: "symptomen",
    expectedAccepted: false,
  },
  {
    group: "symptoms",
    label: "English question missing punctuation",
    source: "Do you feel dizzy today",
    speaker: "arts",
    field: "symptomen",
    expectedAccepted: false,
  },
  {
    group: "symptoms",
    label: "historical symptom is not current",
    source: "I felt dizzy last year.",
    speaker: "patient",
    field: "symptomen",
    expectedAccepted: false,
  },
  {
    group: "symptoms",
    label: "unknown speaker remains excluded",
    source: "I feel dizzy today.",
    speaker: "onbekend",
    field: "symptomen",
    expectedAccepted: false,
  },
  {
    group: "substance-use",
    label: "explicit cannabis use",
    source: "I smoke cannabis every evening.",
    speaker: "patient",
    field: "leefstijl",
    additions: { categorie: "drugs" },
    expectedAccepted: true,
  },
  {
    group: "substance-use",
    label: "explicit alcohol denial",
    source: "I do not drink alcohol.",
    speaker: "patient",
    field: "leefstijl",
    additions: { categorie: "alcohol" },
    expectedAccepted: true,
  },
  {
    group: "options-and-actions",
    label: "could consider does not establish a plan",
    source: "We could consider sertraline at a later appointment.",
    speaker: "arts",
    field: "plan",
    expectedAccepted: false,
  },
  {
    group: "options-and-actions",
    label: "could consider does not create a task",
    source: "We could consider sertraline at a later appointment.",
    speaker: "arts",
    field: "acties",
    additions: { soort: "overig", omschrijving: "We could consider sertraline at a later appointment." },
    expectedAccepted: false,
  },
  {
    group: "options-and-actions",
    label: "explicit clinician commitment",
    source: "I will arrange a follow-up appointment tomorrow.",
    speaker: "arts",
    field: "plan",
    expectedAccepted: true,
  },
];

async function main(): Promise<void> {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  process.env.CAREON_SCRIBE_LIVE = "0";
  let attemptedRequests = 0;
  globalThis.fetch = async () => {
    attemptedRequests += 1;
    throw new Error("Network forbidden in synthetic validator experiment.");
  };
  const { valideerModelStaat } = await import("../lib/careon-scribe/agent.server");
  const { extraheerDeterministisch } = await import("../lib/careon-scribe/deterministisch");
  const results = probes.map((probe, index) => {
    const segment: ScribeSegment = {
      id: `synthetic-english-${index + 1}`,
      volgnummer: 1,
      spreker: probe.speaker,
      tekst: probe.source,
      tekstGecorrigeerd: null,
      correctieBron: null,
      beginMs: 0,
      eindMs: 8_000,
      bron: "handmatig",
      createdAt: "2026-09-11T00:00:00.000Z",
    };
    const row: Feit = { tekst: probe.candidateText ?? probe.source, bron: [1], ingetrokken: false, ...probe.additions };
    const candidate = { ...legeKlinischeStaat(), [probe.field]: [row] };
    const validated = valideerModelStaat(candidate, [segment], legeKlinischeStaat(), "psychiatrie", "en");
    const retained = validated[probe.field];
    const accepted = Array.isArray(retained) && retained.length > 0;
    const fallback = extraheerDeterministisch([segment], "psychiatrie", "en");
    return {
      ...probe,
      candidate: row,
      accepted,
      matchesExpected: accepted === probe.expectedAccepted,
      retained: validated[probe.field],
      fallbackField: fallback[probe.field],
    };
  });
  const output = path.resolve(".next-e2e/scribe-audio-20260911/english-fact-validator-probe.json");
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(
    output,
    JSON.stringify(
      {
        label: "SYNTHETIC DIAGNOSTIC; no provider calls; expected outcomes are engineering acceptance conditions",
        attemptedRequests,
        results,
      },
      null,
      2,
    ),
  );
  for (const result of results)
    console.log(
      `${result.matchesExpected ? "MATCH" : "GAP"} ${result.group}: ${result.label}; accepted=${result.accepted}`,
    );
  console.log(
    JSON.stringify({
      cases: results.length,
      gaps: results.filter((result) => !result.matchesExpected).length,
      attemptedRequests,
      output,
    }),
  );
  if (attemptedRequests > 0) process.exitCode = 1;
}

void main();
