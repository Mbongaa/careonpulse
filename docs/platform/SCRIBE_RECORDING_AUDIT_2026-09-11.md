# Careon AI — English teaching-recording verification

Date: 11 September 2026. Owner-authorized local verification and iteration.
This extends the [initial browser review](./audits/scribe-browser-2026-09-11/README.md).

## Result

Two complete immutable-build browser runs passed recording/transport/processing
checks, including one pause/resume run. The transcription provider can process
this recording, but the current English
extraction pipeline has not produced a usable automatically populated psychiatric
report. Successful provider requests and a completed browser screen must not be
treated as clinical-output acceptance. G20 remains open.

The supplied source was located at
`C:\Users\HP\Downloads\Psychiatric Interviews for Teaching_ Psychosis.mp3`:
12:29.076, 6,640,300 bytes, stereo 44.1 kHz, SHA-256
`b64c04c1ff5a7635c1f50e458fe1cebf1567b91b2c7ff4152db664c382fd5d2d`.
Only this teaching recording was used; repeated runs do not establish performance
on other consultations, languages, diagnoses, microphones or environments.

## Test design and scope

New [reusable tools](./SCRIBE_RECORDING_VERIFICATION.md) separately exercise:

1. Actual transcription adapter, recorder-sized fragments and overlap removal.
2. Alternate transcription/chunking for source-disagreement review.
3. Actual clinical analysis, source validation and report generation, with raw
   model proposals compared against accepted state.
4. Actual browser recorder, resampling, WAV encoding, upload queue, analysis
   timing, pause/resume, stop/drain and report rendering.

Provider calls used isolated process settings. The Next server stayed demo-only
with inert database credentials; Playwright routed Scribe requests to an
in-memory test adapter calling the real provider functions. This is not a test
of production authentication, database persistence, RLS, transaction concurrency,
quotas, retention or physical microphone permission/noise processing. No
production deployment, organization activation or migration was performed.
Audio stayed in RAM; the original MP3 was not modified and no derived audio was
saved. Content-bearing evidence is under the ignored
`.next-e2e/scribe-audio-20260911/` directory.

## Provider and note rounds

| Run | Input / configuration | Result |
|---|---|---|
| `smoke-32s` | First 32 seconds; normal adapter | 3 successful requests; one silence interval skipped |
| `baseline-8s` | Complete MP3; `gpt-4o-mini-transcribe`; 8 new seconds + 1 overlap | 94 planned fragments, 92 successful requests, 2 silence skips, no transport errors; 92 unknown-role segments |
| `reference-45s` | Complete MP3; `gpt-4o-transcribe`; 45 seconds, no overlap | 17 successful requests; alternate machine transcript for comparison |
| `notes-baseline-batch12` | All 92 baseline segments; original prompt; batches of 12 | 8 analysis calls + report, all HTTP 200; 37 proposed cited rows, 0 exact complete source quotes, 0 accepted facts, 8 empty clinician-required report sections |
| `notes-baseline-batch12-prompt1` | Same input; experimental explicit-quote/role prompt | 8 analysis calls + report, all HTTP 200; 29 proposed cited rows, 8 exact source quotes, 0 accepted facts, 8 empty report sections |
| `diarized-45s` | Complete MP3; existing `gpt-4o-transcribe-diarize` adapter path; 45 seconds | 17 successful requests; 287 segments, all unknown roles after adapter; 136 segments contain at most three words |
| `notes-diarized-full-control` | All 287 diarized segments; original prompt, batches of 12 | 25 HTTP 200 responses; 23 AI analysis rounds plus one fallback; 0 accepted facts, 8 empty report sections |

Baseline adapter processing totaled 116.5 seconds; median request 896 ms, p95
1,175 ms, with a 31.8-second outlier. These are local-run observations, not an SLA.
The diarized pass totaled 358.4 seconds; median 21.7 seconds and p95 26.0 seconds
per 45-second input. More output segments did not establish better accuracy.

The experimental prompt was **not retained**. It improved literal quote proposals
but not usable extraction; a browser run labeled the clinician's opening greeting
as the patient. The original production prompt and its original source hash were
restored. Saved requests and the experimental prompt retain the experiment for
review. Source validators, clinician-required assessment sections and production
provider defaults were not weakened or changed.

## Browser rounds and evidence corrections

The initial development-server runs are exploratory evidence, not complete
recording acceptance:

- `browser-smoke-v2` captured audio but used an insufficient report-shell wait.
  It ended before a note was saved. Its evidence now explicitly corrects the
  original completion flag. The runner now waits for actual note controls and
  verifies the saved note and analysis cursor.
- `browser-full-A` and `browser-full-B` played all 749 seconds, but each captured
  only 47 fragments / 372.835 seconds of new audio; last recording offset 380.835
  seconds. Both ended with 0 facts and 8 empty report sections. Their full-source
  coverage checks **fail**. B's requested pause occurred after capture had already
  stopped and therefore does not establish pause/resume acceptance.
- Both last partial-fragment uploads occurred within a second of the same UI
  source update. Recorder effect cleanup flushes its remainder and stops media
  tracks. This strongly correlates the truncation with development Fast Refresh;
  it does not establish a production recorder defect.
- `browser-full-C-prompt1` captured 92 successful fragments / 736 seconds of new
  audio, with continuous submitted intervals from 8 to 744 seconds and the
  closing discussion in the transcript. The recorded-tail check passes. Its 31
  AI analysis rounds still retained 0 facts and produced 8 blank sections. Eleven
  segments acquired roles; clinician speech in sections 1 and 3 was labeled as
  patient speech, and some mixed dialogue received a single patient label. This
  is observed attribution error in one experiment, not a measured causal effect
  of a prompt change. Legacy evidence lacks separately recorded input-stop and
  pending-request assertions; the replacement runs use the corrected harness.

The replacement runs used immutable optimized build
`FRDKIpW5Lv0_0pQvtE-R-` (`.next-e2e/run-mYS3rE`), with source-track stop detection,
audio-tail coverage checks, request/analysis/note assertions, input/code hashes and
separate quality diagnostics. Both completed successfully:

| Final run | Recording / processing | Extracted output |
|---|---|---|
| `browser-fixed-D` | Full 749-second playback; 92/92 successful WAV fragments; 736 new audio seconds, last offset 744; no system gaps, API failures or browser errors; analysis cursor 92/92 | 92 unknown roles; 28 AI analyses + 1 deterministic fallback; 0 facts, 0 populated factual sections, all 8 sections empty/manual |
| `browser-fixed-E-pause` | Same source; 5-second pause at source second 385 and resumed delivery; 92/92 successful WAV fragments; same coverage, no gaps/errors; cursor 92/92 | 92 unknown roles; 32 AI analyses; 0 facts, 0 populated factual sections, all 8 sections empty/manual |

The six factual sections were empty; the two assessment sections are intentionally
clinician-authored. Both saved reports had deterministic fallback provenance.
The first run had one fallback after 20.7 seconds and a separate successful AI
analysis taking 51.5 seconds; the fallback reason was not established by the
browser evidence. The second run never used an analysis
fallback and still produced zero facts, so note failure is not explained by that
single fallback.

The supplied audio includes silence-filtered intervals. The source-tail assertion
and continuous submitted intervals from 8 to 744 seconds establish capture beyond
the prior cutoff and through the closing discussion; they do not provide an
independent word-level accuracy score. Later transcript material about weapons,
pill/overdose discussion, substances and discussion with the mother is present in
both final runs and absent from the factual report sections.

Desktop and 390-pixel phone captures show the retained warnings and disabled bulk
approval without visible horizontal clipping. The three-pane desktop workspace
remains dense and requires separate scrolling; phone report/transcript tabs are
usable but require switching views for source review. Physical mobile recording
was not tested.

- [Final desktop report](./audits/scribe-browser-2026-09-11/fixed-build-report-desktop.png)
- [Final phone report](./audits/scribe-browser-2026-09-11/fixed-build-report-phone.png)
- [Visible zero-fact warning](./audits/scribe-browser-2026-09-11/fixed-build-no-facts-warning.png)

## Confirmed product gaps

1. **English clinical extraction is incomplete.** Both full-transcript report
   rounds accepted zero facts. Statements about symptoms, substance use and
   options are present in source transcripts but absent from the generated note.
   An empty clinician-required section is visible incompleteness, not a negative
   history or an acceptable automatic summary.
2. **Speaker attribution is unresolved.** The default adapter returns unknown
   roles. The diarized adapter separates more turns but discards neutral speaker
   identity and provider timing before the note pipeline. Text-based model role
   assignment can be wrong and is accepted without acoustic verification.
3. **Fixed audio chunks do not match source-statement validation.** 57 of 92
   baseline chunks contain a question mark. The source validator rejects an
   entire question-containing chunk, including a valid answer sharing it.
   Conversely, diarization produces short answers such as “No” or “Three” that
   need the linked question for meaning. Punctuation alone is not reliable
   evidence of speaker role or question intent.
4. **English categories and evidence rules do not line up.** Psychiatric category
   labels emitted by the model can differ from the accepted canonical IDs.
   Lifestyle facts depend on deterministic corroboration that returns empty for
   English. Neutral Dutch risk markers cannot also be literal English source
   statements. Family-subject and related safeguards need a coherent multilingual
   contract, not removal of validation.
5. **Live analysis can display an old fallback status as a clinical summary.**
   “Automatic English extraction is unavailable” survives the deterministic
   state merge while the envelope says `ai`. Capability/status text should be
   separate from clinical summary content. The new zero-output warning makes the
   missing result visible, but this underlying state-model issue remains.
6. **No product MP3 importer exists.** The reusable replay tool supplies a test
   input device; it does not add a recording-upload flow to the product.

Key source locations: recorder framing in
[opname.client.ts](../../src/lib/careon-scribe/opname.client.ts) (lines 51–54),
question detection and the English early return in
[deterministisch.ts](../../src/lib/careon-scribe/deterministisch.ts) (79 and 729),
source/role/category validation in
[agent.server.ts](../../src/lib/careon-scribe/agent.server.ts) (499, 620, 675 and 742),
and diarization adaptation in
[transcriptie.server.ts](../../src/lib/careon-scribe/transcriptie.server.ts) (176–201).
These refer to the restored production prompt/source, not the withdrawn experiment.

## Transcript accuracy review

The default and alternate machine transcripts differ in 133 alignment groups;
59 are near short-fragment boundaries. These are review candidates, not 133 proven
errors or a word-error rate. Important listening windows include:

| Approximate source time | Disagreement requiring listening |
|---|---|
| 02:48 | Quoted voice says “you've left” versus “he's left”; distinguish reported speech and direct address |
| 05:44 | Differing negation in the statement about leaving the room |
| 08:16 | An answer concerning parents includes a denial in one transcript but not the other |
| 09:20 | “Don't a bit of speed” versus “I've done a bit of speed” |

The two automated number flags were MI5 recognition differences, not measured
medication-dose discrepancies. A third recognizer introduced further disputed
wording; no recognizer is treated as ground truth. The full timestamped paired
review and report checklist are saved as `clinical-source-review.md` in ignored
evidence. Independent listening and clinician adjudication remain necessary for
an accuracy score.

## Retained fixes

- Disclose unavailable English extraction before starting when provider gates
  do not support it, including loading/error states.
- Label empty fields as unrecorded information requiring transcript review.
- Explicitly identify the fixed Dutch demo script when English is selected.
- Disable bulk approval when no eligible factual section exists; retain manual
  assessment and ownership guards.
- Warn when an AI analysis returns no supported consultation information.
- Use “Fragmenten verwerken…” during active capture and reserve “Laatste
  fragmenten verwerken…” for stopping/draining.

The new UI regression suite is part of `verify:scribe` and therefore `verify:ci`.
Existing draft/edit protections were checked in the initial review. The test
adapter is not evidence for database-backed edit/concurrency guarantees.

## Regression verification

The final `verify:ci` run passed, including 124 server/provider, 97 domain, 120
clinical and 55 actual route-handler Scribe checks, client lifecycle checks and
the new UI readiness suite. Dependency audit: zero vulnerabilities. Script
TypeScript and the final repository Biome check also passed.

The complete optimized browser suite passed all 162 scenarios: 161 directly and
one cancellation/draft-cleanup scenario on retry. Two earlier failures were test
expectations for the deliberately changed Dutch-demo wording and were corrected.
The remaining retry reproduced a previously recorded test synchronization issue:
it read storage while cancellation was still pending. The assertion now waits
for actual storage cleanup with `expect.poll`, with no timeout increase. That
scenario then passed five consecutive focused runs with retries disabled. These
test-only corrections did not change the running application build.

## Next acceptance work

Preserve stable speaker identity and actual time ranges, obtain clinician-confirmed
role mapping, and represent linked question/answer evidence without inventing a
standalone sentence. Align canonical category IDs and multilingual source checks;
construct neutral assessment markers server-side while preserving the cited
source. Then repeat complete recordings with an adjudicated reference and negative
tests for role swaps, negation, subject, medication status and tentative plans.
Do not turn discussed admission/medication options into an agreed treatment plan,
or allow a model to write the clinician's risk assessment.

The next corpus should include a second teaching consultation and contrasting
medication/dose and negation examples. Production and clinical acceptance remain
separate from this local engineering verification.
