# Scribe English engine iteration: source quotations, reviewed facts and remaining work

## Subsequent implementation and repeated controls

The source-quotation experiments below are an earlier stage of this repair. The
current local engine also supports a deliberately narrow set of literal English
facts from individually confirmed speaker turns. It does not automatically trust
an ASR label or an existing patient/clinician enum. See the
[implementation and persistence contract](./SCRIBE_ENGINE_ACCEPTANCE_2026-09-11.md).

Repeated provider controls found and fixed a genuine retention defect: the model
returns new facts only, while the prior general merge replaced some categories.
An alcohol statement accepted in batch 17 disappeared in batch 18. The English
delta merge now keeps earlier facts and preserves each source binding. Replaying
the same 42 saved responses and a later full live control retained the statement
through the final batch. The controls used synthetic A=clinician/B=patient role
assertions; they do not validate those roles or the recording's clinical accuracy.

The final live control (`engine-reviewed-full-control-v4`) completed all 252 turns
in 21 analysis batches and 42 successful provider requests, in 91.955 seconds.
It retained **one clinical fact**, no plan or task, and 267 exact quotations covering
240 distinct selected source turns, with no quote-ID/text mismatch. Five of eight
report editors were populated. The model proposed an overdose question as an
action and an incomplete closing discussion as a task; both were rejected. This
remains a poor clinical-completeness result, even though the retention path works.

A previous live control stopped after 41 valid responses. Offline replay parsed
all 41 and reached the missing 42nd request; its original transient runtime cause
was not captured and remains unproven. The engine now preserves bounded failure
stage/cause diagnostics and fails English analysis without advancing the processed
cursor. The harness supports isolated cached-response replay; see
[the replay guide](../SCRIBE_OFFLINE_REPLAY.md). A passing later run does not erase
this reliability observation.

Source review also found an integration gap: accepting one alcohol fact hid the
remaining unreviewed social-history quotations in the finished workspace. Those
quotations remained in state; they were not lost accepted clinical facts. The UI
repair exposes remaining source context separately from the factual note, so it
does not silently turn unconfirmed statements into approved findings.

Additional repairs cover stopped-medication evidence, preservation of manually
entered medication metadata, exact provider timestamps where supplied, safe
fallback time placement, explicit speaker confirmation, stale-source approval
blocking, source correction after finishing, regeneration refresh and bounded
scroll/expand views that keep complete source text.

The synthetic real-provider browser control (`browser-reviewed-facts-1`) passed
the full menu-confirmation → factual draft → source-dose correction → regeneration
→ individual approval → reload flow. Its source is deliberately authored test
text and its persistence adapter is in memory. It is separate evidence from the
teaching recording, database/RLS tests and clinical acceptance.

The teaching browser run `browser-engine-context-F` completed the whole recording
with 92 successful audio fragments, no browser/provider errors, all 92 segments
processed and six factual sections populated with **source quotations**. It still
retained zero clinical facts because the mixed fragments had no confirmed roles.
The quotation-only report was excessively long (9,223 pixels in the desktop
capture); the later UI bounds long text and provides explicit expansion.

Production deployment, organization activation, independent clinical reference
notes, broader recording coverage, concise clinical composition, question/answer
grounding and reliable participant identification remain open. This work must not
be described as employee clinical readiness or a perfect English scribe.

### Final local verification

| Check | Result and scope |
| --- | --- |
| `npm run verify:ci` | Pass; zero dependency vulnerabilities. Includes 186 complete English analysis assertions, 53 evidence scenarios, 36 source-context scenarios and 11 isolated replay checks, alongside the existing application suites. |
| `npm run test:e2e` | 162/162 passed without retries on the final immutable build `.next-e2e/run-D4lmPG`; desktop, phone and accessibility routes. |
| PostgreSQL | 626 actual database assertions plus 106 TypeScript controls; fresh-schema and additive-upgrade paths, exact source/role/approval enforcement and shared grammar fixtures. No production database touched. |
| Teaching browser F | Full recording completed; 92 successful fragments, zero gaps/errors, cursor 92/92. Six factual editors contain reviewable quotations; zero accepted clinical facts. |
| Teaching browser G | Full recording plus pause/resume completed; 92 successful fragments, 736 new audio seconds, recorded tail at 744 seconds, zero gaps/browser/provider errors, cursor 92/92. Six factual editors contain quotations; stored context covers 90 distinct source turns. Zero accepted facts because all roles remain unconfirmed. |
| Synthetic browser review 2 | Real-provider confirmation → draft → correction → regeneration → individual approval → reload passed, including separate uncertain source context and stale-approval blocking. |
| Synthetic browser review 4 | Same flow passed on the final build, plus zero serious/critical WCAG 2 A/AA axe findings at desktop and phone widths. Review 3 had caught a 2.62:1 approved-status badge contrast defect; the local badge now uses the readable secondary variant. |
| Full teaching fact control v4 | 252 turns/42 successful provider requests; one accepted and retained alcohol fact under synthetic role assumptions. This is not clinical coverage or speaker-accuracy acceptance. |

The two teaching-browser runs used immutable builds from their respective repair
stages (F: `run-0H7YCL`, G: `run-kF5gNJ`); they do not silently stand in for every
later UI change. Final UI additions were checked by the full suite and synthetic
real-provider review 4 on `run-D4lmPG`. Backend source hashes are preserved per run.

Logs, snapshots and screenshots are under ignored
`.next-e2e/scribe-audio-20260911/`: `engine-verified-ci.log`,
`engine-verified-e2e.log`, `browser-engine-context-F/`,
`browser-engine-final-G/`, and `browser-reviewed-facts-4/`. The original MP3 was
not changed, and no converted recording was saved. Test outputs are explicitly
labelled teaching or synthetic evidence and must not enter real patient records.

Date: 11 September 2026. Local development evidence only. This review covers the
owner-authorized psychiatric teaching recording and the new conversation-context
engine. It does not establish production readiness or clinical accuracy.

The new engine makes source material visible where the previous pipeline returned
eight blank report fields. Its output is **unconfirmed conversation quotations
grouped for review**, not validated clinical facts or a finished clinical note.
All reviewed engine runs still contain zero validated clinical facts and leave all
92 source speaker roles unknown. This distinction must remain explicit in product
copy, demonstrations, acceptance results and release decisions.

## Evidence and method

The completed input is
[`baseline-8s.json`](../../.next-e2e/scribe-audio-20260911/baseline-8s.json),
SHA-256 `03c7bed92ca59f8386f143831d02483e2ce8b262e0755a433c3488f3e0f1c918`.
It contains 92 machine-transcribed segments from the 12:29 teaching recording.
The audio harness classified the first and final fragments as silence and recorded
zero failed fragments. That operational result is not a guarantee of accurate
transcription. Several eight-second segments combine interviewer and interviewee,
and sentences cross segment boundaries.

This review compared saved state, report sections, quote text, source IDs and
source numbers against the complete machine transcript. It did not produce or use
a human-verified verbatim reference, independently score the audio, or measure
clinician task completion time. Source-selection coverage below is therefore not
clinical recall, word-error rate or a hallucination score.

Completed saved runs:

- [Earlier note baseline](../../.next-e2e/scribe-audio-20260911/notes-baseline-batch12/notes.json): original analysis prompt, batch 12.
- [Context v1, batch 12](../../.next-e2e/scribe-audio-20260911/engine-context-v1-batch12/notes.json): context prompt `2026-09-11.1`.
- [Context v2, batch 12](../../.next-e2e/scribe-audio-20260911/engine-context-v2-batch12/notes.json): context prompt `2026-09-11.2`.
- [Context v2, batch 3](../../.next-e2e/scribe-audio-20260911/engine-context-v2-batch3/notes.json): the smaller ingestion cadence, same context prompt version.

Each artifact retains its exact model, prompt version, source hashes, input hash,
provider request records and completion time. These are completed offline note
experiments over the same transcript, not additional microphone or browser runs.
The v2 batch-12 and batch-3 runs share the input, model, prompt version and four of
five recorded source hashes, but their `gesprekscontext.ts` hashes differ. They are
also single stochastic observations. Their output differences are real; the effect
of batch size alone is not isolated by this comparison.
The broader audio/browser evidence is in
[the recording audit](SCRIBE_RECORDING_AUDIT_2026-09-11.md).

## Results

| Measure | Earlier baseline | Context v1 / 12 | Context v2 / 12 | Context v2 / 3 |
| --- | ---: | ---: | ---: | ---: |
| Provider requests | 9 | 8 | 8 | 31 |
| Validated clinical facts | 0 | 0 | 0 | 0 |
| Unknown source speaker roles | 92 | 92 | 92 | 92 |
| Stored conversation windows | 0 | 7 | 41 | 65 |
| Quote occurrences across windows | 0 | 19 | 114 | 180 |
| Distinct source segments selected | 0 | 19 / 92 | 91 / 92 | 90 / 92 |
| Distinct quotations per section, summed | 0 | 19 | 109 | 132 |
| Populated factual report fields | 0 / 6 | 3 / 6 | 6 / 6 | 5 / 6 |
| Populated clinical assessment fields | 0 / 2 | 0 / 2 | 0 / 2 | 0 / 2 |
| Words in editable report fields | 0 | 426 | 2,450 | 2,607 |

Word counts use whitespace-separated tokens and include visible source numbers and
warning headers. The complete source transcript contains 2,237 words by the same
method. Report-word counts exclude the separate source-context panels beneath the
two assessment fields, so the total material a reviewer may need to read is larger.

Every inspected context quotation matched its saved source ID, source number and
full source text exactly: 19/19 in v1, 114/114 in v2 batch 12 and 180/180 in v2 batch 3.
This verifies copying fidelity against machine text. It does not verify that the
transcription, selected conversational boundary, speaker or inferred meaning is
correct. No inferred speaker labels, medication actions or risk assessments were
introduced by these context outputs. All eight report sections remain individually
reviewed; the two actual assessment text fields remain blank.

## Coverage and grouping findings

1. **V1 materially omitted relevant evidence.** Only 19 of 92 source segments were
   selected. The special history, medication and social-history fields remained
   blank. Risk context contained §46–48, showing the knife/baseball-bat discussion,
   but omitted the following qualifications and the pill/overdose discussion in
   §49–54. Its policy field included proposed medication/admission in §83–84 but
   omitted the uncertain response in §85. Exact quotations alone do not make such
   partial conversational windows adequate.

2. **V2 batch 12 largely copied the conversation rather than selecting a concise
   evidence set.** It selected every segment except the opening greeting (§1).
   The special-history field contains 44 source segments, 5,721 characters and
   1,073 words. Its psychiatric-examination field repeats the subjective narrative
   in §7–18. Some repetition is useful for context, but this result still requires
   substantial reading, consolidation and clinician writing.

3. **Treatment options and the response were separated into different sections.**
   In both v2 runs the medication/admission discussion in §83–84 is in social
   history. The uncertain response and explanation about attending because of the
   mother (§85–86) are in reason for attendance. Policy contains only §90–92 in
   batch 12 and §91–92 in batch 3. A reviewer opening only policy would miss the
   earlier options, while a reviewer copying social history could fail to carry
   their uncertainty forward. These passages must not become an agreed medication,
   admission or action plan without clinician review.

4. **The smaller-batch run has different clinically useful placement.** Batch 12 places §61–64 in
   somatics/medication. Batch 3 leaves that field entirely blank, although §63–64
   remain available in social and risk context. In that run the 27-fragment risk
   context extends through general health, medication and substance questions
   (§46–72). Overall source coverage remains high while section-level usefulness
   degrades. Counting populated sections or total quotations alone misses this.
   A fixed-source repeated experiment is needed to attribute this difference to
   cadence rather than code drift or model variability.

5. **The category boundaries remain broad.** Batch 12 places illness-denial and
   alternative-explanation discussion (§78–82) in social history and leaves
   considerations without source context. Batch 3 places some of this material in
   both social and special history; its considerations context instead contains
   §88–90. These are unconfirmed source passages, not assessments, but their
   placement strongly affects what a busy reviewer will notice.

6. **Small omissions and boundary errors still matter.** Batch 3 omits §87 as well
   as the greeting. §87 includes the question about whether the clinician believes
   the account and the start of the response; §88 is retained without that full
   lead-in. Other source fragments end mid-sentence. A full fragment is not
   necessarily a complete conversational statement or a complete question/answer.

Examples of evidence retained in v2, expressed only as transcript topics:

| Topic to check against the recording | Machine transcript reference | Observed v2 placement issue |
| --- | --- | --- |
| Duration and beliefs involving housemates/lecturer | §6–13 | Repeated across history/examination; batch 3 also puts part in reason for attendance. |
| Three voices, commentary/conversation, direct-address denial | §14–25 | Present as quotations; mixed roles and question/answer interpretation remain unconfirmed. |
| Inserted thoughts, chip/tracker and physical sensation | §27–38 | Present as quotations; no validated patient fact was produced. |
| Food/poisoning discussion and reduced eating | §43–45 | Present in special history. |
| Knife/bat, intent qualifications and pills/overdose discussion | §46–54 | Present in v2 risk context; the actual risk-assessment field correctly remains blank. |
| General health and prescribed-medication question | §63–64 | Batch 3 leaves the medication field blank despite retaining the sources elsewhere. |
| Cannabis amount/frequency, speed and last use | §65–72 | Present as quotations, not normalized medication/substance facts. |
| Treatment options, uncertain response, mother/support discussion | §83–92 | Options, response and support are split between different report fields. |

The table is a retrieval checklist, not an independently verified clinical case
summary. No diagnosis, risk classification or treatment recommendation is inferred.

## Review workflow and integration

The state UI now separates **“Gesprekscitaten — nog controleren”** from validated
clinical facts. It presents full quotations, source navigation and the warning that
speaker and meaning are not confirmed. The zero-facts message distinguishes
available review material from an absence of useful output.

The first implementation assumed one context entry per section, whereas the engine
stores many windows per section. That produced repeated headings and duplicate React
keys. The integration was corrected during this review: one panel per section,
deduplication by segment ID within that section, and chronological source ordering.
This reduces v2 batch 12 from 114 displayed quote occurrences to 109, and batch 3
from 180 to 132. Cross-section repetition remains: 18 and 42 occurrences above the
number of distinct selected source segments, respectively. The aggregate count is
the number of displayed quotations, not the number of independent facts.

Factual source drafts are labelled **“Broncitaten — afzonderlijk controleren”**;
the two assessment sections retain clinician-assessment labels. Edited and approved
states use corresponding labels. Bulk approval excludes every clinician-required
section. An unchanged source prefill, including a whitespace-only alteration, is
blocked by the UI button and handler. Matching enforcement in the shared/server
and database paths is owned by the coordinating task; this document
does not substitute for its final acceptance results or deployment evidence.

The remaining employee burden is substantial:

- Six populated factual fields in batch 12 require turning 2,450 words of source
  quotations into a checked note; both assessment fields still need clinician
  writing. Batch 3 additionally requires writing the empty medication field.
- Context is visible in the transcript, the state quote panels, the prefilled
  report and the expandable report context. These are useful provenance surfaces,
  but repeated reading and navigation can outweigh the assistance.
- A changed string proves editing, not correct clinical review. Adding one
  non-whitespace character can satisfy a text-change check. That guard prevents
  accidental unchanged approval; it cannot certify the quality of a note.
- The existing speaker chip cycles through roles. Direct role choices with nearby
  transcript context and “next unknown” navigation would reduce clicks and error.
  Mixed-speaker chunks must stay unknown until split. Do not bulk-assign a role
  without preserved stable speaker identity and an explicit employee choice.

## Next engine work and acceptance criteria

1. **Measure source coverage and placement independently.** Build a manually checked
   teaching reference for important statements, their qualifications, source spans,
   speaker/subject and expected sections. Track missing evidence, incorrect section
   placement, duplicates and changed meaning separately. Add a second recording;
   this one sample cannot establish general English performance.
2. **Preserve complete conversational relationships.** Keep linked question/answer
   passages and explicit uncertainty together, especially at batch boundaries.
   Test the options/uncertain-response example (§83–86) and the weapons/intent/pills
   sequence (§46–54) without generating risk conclusions or agreed actions.
3. **Make selection stable at actual ingestion cadence.** Repeat batch 3 and batch
   12 with recorded prompt/source hashes. Medication and other factual sections
   should not become empty solely because cadence changes while their supporting
   source is still present. Quantify stability rather than choosing the best run.
4. **Separate traceable evidence from concise note composition.** Retain exact source
   excerpts behind a compact evidence view. Only generate concise factual proposals
   after speaker, subject, temporality, negation and uncertainty are grounded;
   validate every proposition against its sources. Keep clinical assessments for
   the clinician and preserve medication/action safeguards.
5. **Measure real review effort.** Have an authorized clinician complete the same
   teaching note with the transcript-only and quote-draft flows. Record completion
   time, edits, navigation, missed qualifiers and satisfaction. Set a review-burden
   target from that comparison rather than treating additional output as progress.
6. **Finish end-to-end acceptance on an immutable build.** Verify context persistence,
   correction invalidation, source navigation, duplicate-free rendering, individual
   approval, bulk exclusion and export in desktop/mobile layouts. Verify source-draft
   enforcement through the API as well as the UI. No local passing test is evidence
   that an undeployed database or application change is live.

Scoped integration checks during this review: UI readiness, client lifecycle,
TypeScript and Biome checks passed. The focused UI regression exercises overlapping windows,
deduplication, chronological ordering, exact multiline quotations, source links,
zero-facts status, individual-edit gating and unchanged assessment behaviour.
The coordinating task owns aggregate checks, further repeat runs and final release
evidence. The safe description of the current improvement is **reviewable source
context in place of blank fields**. Validated English clinical extraction and an
efficient final-note workflow remain open work.
