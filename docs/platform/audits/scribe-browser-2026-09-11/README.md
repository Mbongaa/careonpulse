# Careon AI: English recording test readiness and browser review

Follow-up: the owner-authorized tools, real provider experiments, two completed
immutable-build browser recordings, retained UI fixes and final regression results
are in [the complete recording audit](../../SCRIBE_RECORDING_AUDIT_2026-09-11.md).
The findings below preserve the earlier demo-only review.

Date: 11 September 2026. Latest local working-tree implementation, Next.js 16.3.4,
Edge, isolated demo at `http://127.0.0.1:3309`. This is preliminary browser evidence,
not completed MP3 transcription or clinical-accuracy acceptance.

## Requested sample and actual coverage

The requested recording was found at
`C:\Users\HP\Downloads\Psychiatric Interviews for Teaching_ Psychosis.mp3`.
Metadata: MP3, stereo, 44,100 Hz, 749.076 seconds (12:29), 6,640,300 bytes.
The originally supplied path incorrectly separated the filename into a folder.

**Actual MP3 transcription runs: zero.** The current browser has no file importer.
The local environment has no configured Scribe transcription provider or live flag.
The demo recording controls insert a fixed script and do not process audio.
No audio was uploaded, no external provider was called, and no production setting,
organization, database or application deployment was changed.

Three supplemental browser workflows were exercised. They do not substitute for
repeated listening/transcription tests. Runs 1 and 2 used identical, explicitly
fictional English text written for this review, not a transcript of the MP3:

> This is a fictional QA example. I have heard two voices for three weeks. I sleep four hours a night. I do not drink alcohol or use recreational drugs. I take risperidone 2 mg at night. I stopped sertraline last month. Penicillin causes a rash. I have no thoughts of harming myself or anyone else. My mother has depression.

| Run | Workflow | Observed result |
| --- | --- | --- |
| QA-EN-A01 | English psychiatric consult; patient-labelled manual text; explicit analysis; finish; bulk approval; edit and reopen | Text preserved. English-unavailable warning after analysis. All eight report sections initially empty and clinician-required. Bulk approval skipped all eight. A manual edit to reason for attendance survived reopening. |
| QA-EN-A02 | Fresh consult with the same settings/text; analysis; unsent draft; navigate away and cancel; clear draft; finish | Same unsupported-English result and eight empty report fields. Navigation guard preserved pending text when returning. Keyboard clearing enabled completion. |
| QA-EN-A03 | English psychiatric consult; built-in full demo playback; finish | Inserted 30 Dutch script lines despite English selection. Produced eight empty clinician-required report sections. This was scripted playback, not audio processing. |

## Findings

1. **Audio test blocker: no MP3 import or replay input.** The UI exposes microphone,
   demo script and manual transcript input. Although the API accepts `audio/mpeg`,
   it accepts fragments of at most 2 MiB and clamps duration metadata to 45 seconds;
   submitting this complete 6.6 MB recording directly would not be a valid test.
   A test-only microphone replay or an appropriately chunked importer is needed.
   Source: `src/app/(main)/scribe/_components/opname-besturing.tsx:79–114`;
   `src/lib/careon-scribe/api-contract.ts:256–265`.
2. **English capability disclosure comes too late.** English is offered when
   creating a consult without saying that this mode requires completely manual
   report writing. The explicit limitation appears only after analysis. Show
   capability and provider status before starting. This finding concerns the
   tested fallback mode; live-provider English accuracy remains untested.
   Source: `nieuw-consult-form.tsx:84–91,178–188`; `deterministisch.ts:1662–1663`.
3. **“Nog niet besproken” misrepresents unavailable extraction.** Medication,
   allergies, duration and other categories said “Not yet discussed” despite
   explicit text in the transcript. The application should distinguish “not
   extracted/not assessed” from absence in the conversation. The general warning
   is helpful but does not make the individual field labels accurate.
   Source: `staat-paneel.tsx:451–465`.
4. **English demo uses a Dutch script.** The English selection does not select a
   matching demo conversation. This produces a confusing demonstration with no
   useful generated report. Provide language-matched fixtures or clearly label
   and restrict the demo to its supported language.
5. **Bulk approval offers a no-op.** “Alles goedkeuren” opens a confirmation even
   when all eight sections are ineligible; it then reports that eight assessment
   sections were skipped. Disable the action when no section is eligible and
   explain manual-entry requirements. Skipping those sections is correct; retain
   that protection. Source: `verslag-review.tsx:462,496,544–545`;
   `storage.client.ts:1031–1033`.

Component-only filenames above are under
`src/app/(main)/scribe/_components/`; domain files are under
`src/lib/careon-scribe/`.

## Working behavior and presentation

- Consent checkbox gated consult creation in the fictional demo workflow.
- Both manually entered English transcripts were preserved in report review.
- Pending text blocked finishing and triggered the navigation warning.
- Empty, clinician-required report sections were not silently bulk-approved.
- The saved report edit survived leaving and reopening the consult.
- Desktop separates Transcript, Notities and Aanwijzingen into three independently
  scrolling panels. This supports side-by-side comparison, but the blank categories
  and embedded medication controls make the notes panel dense.
- At a 390 × 844 viewport the report uses stacked cards and separate Verslag /
  Transcript tabs; the captured view has no visible horizontal clipping. This was
  a narrow-screen presentation check, not physical-phone microphone testing.
- Captured browser warning/error log query returned no entries. A few automation
  timeouts were resolved by inspecting the rendered state; they are not counted
  as application failures. Empty-string automated fill did not clear one field;
  actual Ctrl+A/Backspace did, so no product clearing defect is asserted.

## Remaining audio acceptance

Prepare an isolated test environment with the actual transcription and note
providers configured, and a replay path that feeds the MP3 through the recorder's
normal fragment lifecycle. Do not represent demo-script tests as audio acceptance.
Then run the complete recording twice in fresh consults and once with pause/resume
at a speech boundary. Compare source audio, transcript, extracted facts and final
report separately; check speaker attribution, omissions, negation, medication
names/doses, timing, duplicates and unsupported additions. A second teaching
recording can broaden coverage when supplied. No word-error rate, hallucination
rate or clinical accuracy score is claimed by this review.

## Evidence

- [First report after saved edit](run1-report.txt)
- [Repeated English report](run2-report.txt)
- [English-selected Dutch demo](run3-english-demo.txt)
- [Third report](run3-report.txt)
- [Desktop first report](run1-report.png)
- [Desktop repeated report](run2-report.png)
- [Phone report](run1-report-phone.png)
- [Demo workspace](run3-english-demo.png)

G20 remains In progress; D24 and existing release/activation gates are unchanged.
No application fixes were made during this review.
