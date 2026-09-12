/** Pure, offline diagnostics for the isolated teaching-audio browser harness. */
import { formaatVoor } from "../../lib/careon-scribe/formaten";
import { STAAT_CATEGORIEEN } from "../../lib/careon-scribe/types";
import type { createScribeBrowserTestBackend } from "./scribe-browser-test-backend";

export type ScribeBrowserBackendSnapshot = ReturnType<
  Awaited<ReturnType<typeof createScribeBrowserTestBackend>>["snapshot"]
>;

export interface ScribeBrowserEvidenceOptions {
  browserErrors?: readonly string[];
  replayCompleted?: boolean;
  requestedSeconds?: number;
  /** Fixture-specific lower bound; account for known trailing silence explicitly. */
  minimumRecordedEndSeconds?: number;
  pendingRequests?: number;
  /** False for a checkpoint; no complete-execution verdict is issued. */
  expectFinished?: boolean;
}

export interface ScribeBrowserEvidenceAssertion {
  id: string;
  status: "pass" | "fail" | "not-assessed";
  actual?: unknown;
  expected?: unknown;
  detail: string;
}

type EvidenceRow = Record<string, unknown>;

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rows(value: unknown): EvidenceRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is EvidenceRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

function counts(values: unknown[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const key = typeof value === "string" ? value : "unavailable";
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function latency(values: unknown[]) {
  const sorted = values
    .map(numeric)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return { samples: sorted.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? null };
}

/**
 * Execution checks say whether the recorded flow completed consistently. Clinical
 * quality remains diagnostics: nonempty text or a citation does not prove accuracy.
 * Silence-filtered intervals cannot be classified as missing speech from this
 * evidence alone. No provider call, file operation, or mutation occurs here.
 */
export function summarizeScribeBrowserEvidence(
  snapshot: ScribeBrowserBackendSnapshot,
  options: ScribeBrowserEvidenceOptions = {},
) {
  const finishedExpected = options.expectFinished !== false;
  const assertions: ScribeBrowserEvidenceAssertion[] = [];
  const check = (id: string, result: boolean | undefined, actual: unknown, expected: unknown, detail: string) => {
    let status: ScribeBrowserEvidenceAssertion["status"] = "not-assessed";
    if (result === true) status = "pass";
    if (result === false) status = "fail";
    assertions.push({ id, status, actual, expected, detail });
  };
  const audio = snapshot.audioEvents;
  const fragments = audio.map((row) => `${String(row.sessionId)}/${String(row.fragmentId)}`);
  const duplicateFragments = fragments.length - new Set(fragments).size;
  const missingFragmentIds = audio.filter((row) => typeof row.fragmentId !== "string" || !row.fragmentId).length;
  const failedAudio = audio.filter((row) => row.success === false);
  const emptyAudio = audio.filter((row) => row.success === true && row.segmentCount === 0);
  const wav = audio.filter((row) => numeric(row.pcmDurationMs) !== null);
  const invalidWav = wav.filter((row) => row.sampleRate !== 16_000 || row.channels !== 1 || row.bitsPerSample !== 16);
  const durationMismatches = wav.filter((row) => {
    const declared = numeric(row.durationMs);
    const measured = numeric(row.pcmDurationMs);
    return declared === null || measured === null || Math.abs(declared - measured) > 1;
  });
  const submittedNewSeconds = audio.reduce(
    (sum, row) => sum + Math.max(0, (numeric(row.durationMs) ?? 0) - (numeric(row.overlapMs) ?? 0)) / 1000,
    0,
  );
  const endOffsetSeconds = audio.reduce(
    (max, row) => Math.max(max, ((numeric(row.offsetMs) ?? 0) + (numeric(row.durationMs) ?? 0)) / 1000),
    0,
  );
  const apiFailures = snapshot.events.filter((row) => (numeric(row.status) ?? 0) >= 400);
  const adapterExceptions = snapshot.events.filter((row) => typeof row.exception === "string");
  const initialSegments = audio.flatMap((row) => rows(row.insertedSegments));
  const initialSpeech = initialSegments.filter((row) => row.bron !== "systeem");
  const finalSegments = Object.values(snapshot.state.segmenten).flat();
  const finalSpeech = finalSegments.filter((row) => row.bron !== "systeem");
  const systemGaps = finalSegments.filter((row) => row.bron === "systeem").length;
  const duplicateSegmentIds = finalSegments.length - new Set(finalSegments.map((row) => row.id)).size;
  const assignments = snapshot.analysisEvents.flatMap((event) => rows(event.speakers));

  check("audio_observed", audio.length > 0, audio.length, "> 0", "Real browser audio requests reached the adapter.");
  check(
    "audio_provider_success",
    failedAudio.length === 0,
    failedAudio.length,
    0,
    "No audio fragment became a provider-failure placeholder.",
  );
  check(
    "unique_fragment_ids",
    duplicateFragments === 0 && missingFragmentIds === 0,
    { duplicateFragments, missingFragmentIds },
    { duplicateFragments: 0, missingFragmentIds: 0 },
    "Counts provider executions; idempotent HTTP retries may legitimately reuse an ID.",
  );
  check(
    "pcm_format",
    wav.length === audio.length && invalidWav.length === 0,
    { measured: wav.length, total: audio.length, invalid: invalidWav.length },
    "All observed fragments: mono 16 kHz, 16-bit PCM WAV",
    "Checks the app's actual encoder output.",
  );
  check(
    "pcm_duration",
    durationMismatches.length === 0 && wav.length > 0,
    durationMismatches.length,
    0,
    "Declared duration agrees with PCM bytes within one millisecond.",
  );
  check(
    "unique_segment_ids",
    duplicateSegmentIds === 0,
    duplicateSegmentIds,
    0,
    "Transcript storage contains no duplicate IDs.",
  );
  check(
    "no_system_gaps",
    systemGaps === 0,
    systemGaps,
    0,
    "Explicit system gaps are counted; silence-filtered intervals are not assumed to contain missing speech.",
  );
  check(
    "no_api_failures",
    apiFailures.length === 0,
    apiFailures.length,
    0,
    "Every intercepted API response completed successfully in this happy-path recording run.",
  );
  check(
    "no_adapter_exceptions",
    adapterExceptions.length === 0,
    adapterExceptions.length,
    0,
    "Adapter failures must not be attributed to the product without separate investigation.",
  );
  check(
    "browser_errors",
    options.browserErrors === undefined ? undefined : options.browserErrors.length === 0,
    options.browserErrors?.length,
    0,
    "Requires the runner's browser error evidence.",
  );
  check(
    "replay_completed",
    options.replayCompleted,
    options.replayCompleted,
    true,
    "Requires the input source to reach the requested end.",
  );
  check(
    "no_pending_requests",
    options.pendingRequests === undefined ? undefined : options.pendingRequests === 0,
    options.pendingRequests,
    0,
    "Optional runner evidence; HTTP success logs alone cannot reveal a still-running request.",
  );
  if (options.requestedSeconds !== undefined) {
    const valid = Number.isFinite(options.requestedSeconds) && options.requestedSeconds > 0;
    check(
      "valid_requested_duration",
      valid,
      options.requestedSeconds,
      "> 0 finite seconds",
      "Sanity check for the supplied replay duration.",
    );
    check(
      "audio_not_replayed_twice",
      valid && submittedNewSeconds <= options.requestedSeconds + 2,
      submittedNewSeconds,
      `<= ${options.requestedSeconds + 2}`,
      "Upper bound only; missing duration may reflect silence suppression and requires listening to assess.",
    );
  }
  const minimumRecordedEnd = options.minimumRecordedEndSeconds;
  check(
    "recorded_source_tail",
    minimumRecordedEnd === undefined
      ? undefined
      : Number.isFinite(minimumRecordedEnd) && minimumRecordedEnd > 0 && endOffsetSeconds >= minimumRecordedEnd,
    endOffsetSeconds,
    minimumRecordedEnd === undefined ? "Fixture-specific lower bound not supplied" : `>= ${minimumRecordedEnd}`,
    "Requires recorded PCM to reach the known source tail. Source playback completion alone does not prove capture continued; this checks the tail, not every intervening speech interval.",
  );

  const sessions = snapshot.state.sessies.map((sessie) => {
    const transcript = snapshot.state.segmenten[sessie.id] ?? [];
    const speech = transcript.filter((row) => row.bron !== "systeem");
    const envelope = snapshot.state.staat[sessie.id];
    const notes = snapshot.state.notities[sessie.id] ?? [];
    const note = notes.at(-1) ?? null;
    const factsByCategory = Object.fromEntries(
      STAAT_CATEGORIEEN.map((category) => {
        const facts = envelope?.staat[category] ?? [];
        return [
          category,
          {
            active: facts.filter((row) => !row.ingetrokken).length,
            retracted: facts.filter((row) => row.ingetrokken).length,
            clinicianAuthored: facts.filter((row) => row.doorBehandelaar === true && !row.ingetrokken).length,
          },
        ];
      }),
    );
    const retainedFacts = Object.values(factsByCategory).reduce((sum, category) => sum + category.active, 0);
    const conversationContext = envelope?.staat.gesprekscontext ?? [];
    const conversationSources = new Set(conversationContext.flatMap((row) => row.bron));
    const scalarFacts = ["hoofdklacht", "duur", "beloop", "ernst"].filter((key) => {
      const value = envelope?.staat[key as "hoofdklacht" | "duur" | "beloop" | "ernst"];
      return typeof value === "string" && value.trim().length > 0;
    });
    const unknownSpeakers = speech.filter((row) => row.spreker === "onbekend").length;
    const sections = note?.secties ?? [];
    const definitions = formaatVoor(note?.formaat ?? sessie.consultType).secties;
    const assessmentIds = new Set(
      definitions.filter((section) => section.vereistBehandelaar).map((section) => section.id),
    );
    const factualSections = sections.filter((section) => !assessmentIds.has(section.id));
    const filled = sections.filter((section) => section.tekst.trim().length > 0);
    const sourceBackedFactual = factualSections.filter(
      (section) => section.tekst.trim().length > 0 && section.bron.length > 0,
    );
    const analysis = snapshot.analysisEvents.filter((event) => event.sessionId === sessie.id);
    const notesGenerated = snapshot.noteEvents.filter((event) => event.sessionId === sessie.id);
    const noteResponses = snapshot.events.filter(
      (event) => event.method === "POST" && event.path === `/api/careon/scribe/sessies/${sessie.id}/notitie`,
    );
    const diagnostics: string[] = [];
    if (unknownSpeakers > 0) diagnostics.push("unknown_speakers_remain");
    if (retainedFacts === 0 && scalarFacts.length === 0 && speech.length > 0)
      diagnostics.push("no_retained_clinical_facts");
    if (note && filled.length === 0) diagnostics.push("all_report_sections_blank");
    if (factualSections.some((section) => section.vereistBehandelaar))
      diagnostics.push("factual_sections_require_manual_entry");
    if (analysis.some((event) => event.source === "deterministisch"))
      diagnostics.push("analysis_used_deterministic_fallback");
    if (analysis.length > 0 && retainedFacts === 0 && scalarFacts.length === 0)
      diagnostics.push("analysis_completed_without_retained_facts");
    check(
      `${sessie.id}:counter_matches_transcript`,
      sessie.segmentTeller === transcript.length,
      { counter: sessie.segmentTeller, rows: transcript.length },
      "Equal",
      "Applies before the test transcript is deliberately erased.",
    );
    check(
      `${sessie.id}:analysis_caught_up`,
      finishedExpected
        ? Boolean(envelope && !envelope.verouderd && envelope.laatsteSegment === sessie.segmentTeller)
        : undefined,
      { cursor: envelope?.laatsteSegment, counter: sessie.segmentTeller, stale: envelope?.verouderd },
      "Current state covers every transcript segment",
      "A completed model request alone is insufficient.",
    );
    check(
      `${sessie.id}:report_generated`,
      finishedExpected ? Boolean(note && notesGenerated.length > 0 && noteResponses.at(-1)?.status === 200) : undefined,
      { notes: notes.length, generationEvents: notesGenerated.length, latestResponse: noteResponses.at(-1)?.status },
      "Persisted note and successful generation response",
      "Blank clinical output remains a separate quality diagnostic.",
    );
    check(
      `${sessie.id}:report_structure`,
      finishedExpected
        ? Boolean(
            note &&
              sections.length === definitions.length &&
              definitions.every((definition) => sections.some((section) => section.id === definition.id)),
          )
        : undefined,
      { actual: sections.length, expected: definitions.length },
      "Every format section present",
      "Checks structure without treating blank clinician assessments as an execution failure.",
    );
    check(
      `${sessie.id}:session_finished`,
      finishedExpected ? ["afgerond", "goedgekeurd", "overgenomen"].includes(sessie.status) : undefined,
      sessie.status,
      "afgerond, goedgekeurd or overgenomen",
      "This summary targets the recording-to-report workflow, before cleanup.",
    );
    return {
      sessionId: sessie.id,
      reference: sessie.patientReferentie,
      status: sessie.status,
      language: sessie.taal,
      transcript: {
        segments: transcript.length,
        speechSegments: speech.length,
        characters: speech.reduce((sum, row) => sum + (row.tekstGecorrigeerd ?? row.tekst).length, 0),
        speakerCounts: counts(speech.map((row) => row.spreker)),
        unknownSpeakerFraction: speech.length > 0 ? unknownSpeakers / speech.length : null,
        systemGaps: transcript.length - speech.length,
        declaredMissingFragments: sessie.ontbrekendeFragmenten,
      },
      clinical: {
        factsByCategory,
        retainedFacts,
        conversationContext: {
          windows: conversationContext.length,
          uniqueSourceSegments: conversationSources.size,
          sectionIds: [...new Set(conversationContext.map((row) => row.sectieId))],
          speakerStatus: "unconfirmed",
          countsAsClinicalFacts: false,
        },
        scalarFieldsPresent: scalarFacts,
        summaryPresent: Boolean(envelope?.staat.samenvatting.trim()),
        analysisCursor: envelope?.laatsteSegment ?? null,
        segmentCounter: sessie.segmentTeller,
        stale: envelope?.verouderd ?? null,
        analysisSources: counts(analysis.map((event) => event.source)),
        analysisLatency: latency(analysis.map((event) => event.durationMs)),
      },
      report: {
        present: Boolean(note),
        source: note?.bron ?? null,
        model: note?.model ?? null,
        totalSections: sections.length,
        populatedSections: filled.length,
        clinicianRequiredSections: sections.filter((section) => section.vereistBehandelaar).length,
        eligibleForBulkApproval: sections.filter(
          (section) =>
            !section.vereistBehandelaar &&
            section.status !== "goedgekeurd" &&
            (section.tekst.trim().length > 0 || section.conceptTekst.trim().length > 0),
        ).length,
        assessmentSections: sections.filter((section) => assessmentIds.has(section.id)).length,
        factualSections: factualSections.length,
        populatedFactualSections: factualSections.filter((section) => section.tekst.trim()).length,
        sourceBackedFactualSections: sourceBackedFactual.length,
        sourceBackedFactualCharacters: sourceBackedFactual.reduce(
          (sum, section) => sum + section.tekst.trim().length,
          0,
        ),
        sections: sections.map((section) => ({
          id: section.id,
          title: section.titel,
          status: section.status,
          clinicianRequired: section.vereistBehandelaar,
          assessment: assessmentIds.has(section.id),
          characters: section.tekst.trim().length,
          citedSegments: section.bron,
        })),
        generationLatency: latency(notesGenerated.map((event) => event.durationMs)),
      },
      diagnosticFlags: diagnostics,
    };
  });
  check(
    "session_observed",
    sessions.length > 0,
    sessions.length,
    "> 0",
    "A report workflow requires at least one test session.",
  );
  let executionPassed: boolean | null = null;
  if (assertions.some((assertion) => assertion.status === "fail")) executionPassed = false;
  else if (finishedExpected && options.replayCompleted === true && options.browserErrors !== undefined)
    executionPassed = true;
  return {
    version: 1,
    label: snapshot.label,
    limitations: [
      snapshot.limitations,
      "Clinical accuracy and source-audio completeness require independent review; populated/cited text is not proof of correctness.",
      "Checkpoint and post-cleanup snapshots do not establish completed recording-to-report acceptance.",
    ],
    executionPassed,
    assertions,
    diagnostics: {
      transport: {
        audioFragments: audio.length,
        successfulFragments: audio.filter((row) => row.success === true).length,
        failedFragments: failedAudio.length,
        emptySuccessfulFragments: emptyAudio.length,
        uniqueFragmentIds: new Set(fragments).size,
        duplicateFragmentIds: duplicateFragments,
        wavFragments: wav.length,
        invalidWavFragments: invalidWav.length,
        durationMismatches: durationMismatches.length,
        submittedNewSeconds,
        endOffsetSeconds,
        requestedSeconds: options.requestedSeconds ?? null,
        minimumRecordedEndSeconds: minimumRecordedEnd ?? null,
        providerLatency: latency(audio.map((event) => event.processingMs)),
      },
      speakers: {
        initialInsertedSpeechSegments: initialSpeech.length,
        initialCounts: counts(initialSpeech.map((row) => row.spreker)),
        finalSpeechSegments: finalSpeech.length,
        finalCounts: counts(finalSpeech.map((row) => row.spreker)),
        assignmentCount: assignments.length,
        knownAssignmentCount: assignments.filter((row) => ["arts", "patient", "overig"].includes(String(row.spreker)))
          .length,
        unknownAssignmentCount: assignments.filter((row) => row.spreker === "onbekend").length,
      },
      apiFailures: apiFailures.map((event) => ({
        method: event.method,
        path: event.path,
        status: event.status,
        durationMs: event.durationMs,
      })),
      adapterExceptions,
      browserErrors: options.browserErrors ?? null,
      pendingRequests: options.pendingRequests ?? null,
      models: snapshot.providerStatus,
    },
    sessions,
  };
}
