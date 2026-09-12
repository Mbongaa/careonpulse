# Teaching-recording verification tools

These opt-in local tools exercise the Careon AI/Scribe recorder, actual provider
adapters and validation. They are for explicitly authorized teaching recordings.
They do not enable an organization, change deployment settings or establish
clinical, consent, production API, database or RLS acceptance.

## Prerequisites and isolation

- Run from `careon-dashboard` using the installed npm dependencies.
- `ffmpeg` and `ffprobe` must be on PATH for the transcription CLI. The browser
  runner decodes the original MP3 through Web Audio.
- Chromium must be installed for the existing Playwright version.
- The provider helper reads only `OPENAI_API_KEY`, `OPENAI_MODEL`,
  `OPENAI_API_MODE` and `CAREON_SCRIBE_TRANSCRIPTION_MODEL` from `.env.local`.
  It isolates database credentials before lazily importing provider modules.
  Provider requests go to the official OpenAI API and incur normal usage.
- Audio is read into RAM. The tools do not write a converted audio file or
  upload to Supabase. Original source files are left intact.
- Transcript, model response and clinical-state evidence is saved under ignored
  `.next-e2e/scribe-audio-20260911/`. Treat that directory as content-bearing
  evidence. Console output contains progress/counts, not interview content or keys.
- Use a new `--run` name for every run to keep evidence distinct. Do not place
  raw transcripts or model responses in the tracked documentation tree.

## Provider and report passes

```powershell
npm run verify:scribe:recording -- --audio 'C:\path\teaching.mp3' --run baseline-8s
npm run verify:scribe:recording:notes -- --input '.next-e2e/scribe-audio-20260911/baseline-8s.json' --run notes-batch12 --batch 12
```

The default transcription pass reproduces eight seconds of new audio plus one
second of overlap, the production silence threshold and production overlap
removal. It uses the actual transcription adapter. It does not exercise Web Audio
or the browser queue; use the browser runner for those layers.

The notes pass uses the real analysis/report adapters and validators over the
saved transcript. It preserves raw provider responses, validated state, applied
speaker labels, corrections, report sections, usage and source hashes. An HTTP
200 or analysis source `ai` does not mean any useful fact survived validation.

To make an alternate transcript, set the model in the current process, use a
different run name, and select larger chunks, for example `--fragment 45
--overlap 0`. Restore the variable afterward. Compare saved runs with:

```powershell
npm run verify:scribe:recording:compare -- '.next-e2e/scribe-audio-20260911/baseline-8s.json' '.next-e2e/scribe-audio-20260911/reference-45s.json'
```

This comparison identifies lexical disagreements and timestamps for review. An
alternate ASR output is not a human reference transcript; disagreement counts are
not word-error rates or clinical accuracy scores.

## Full browser passes

Use an immutable optimized build. **Do not run a long acceptance recording on a
development server while editing source**: Fast Refresh can clean up the recorder
while the injected source keeps playing. The corrected harness detects an early
input-track stop and can require delivery of a known speech-bearing tail.

The existing isolated browser suite builds with inert database values and
providers disabled. After it creates a complete artifact, serve that same artifact
on a separate local port:

```powershell
npm run test:e2e
$scribeBuild = Get-ChildItem -LiteralPath '.next-e2e' -Directory -Filter 'run-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
node src/scripts/serve-scribe-recording-build.mjs --dist-dir $scribeBuild.FullName --port 3311
```

In another process:

```powershell
npm run verify:scribe:recording:browser -- --audio 'C:\path\teaching.mp3' --run browser-A --seconds 749.076 --minimum-recorded-end-seconds 734.076
npm run verify:scribe:recording:browser -- --audio 'C:\path\teaching.mp3' --run browser-B --seconds 749.076 --minimum-recorded-end-seconds 734.076 --pause-at 385 --pause-seconds 5
```

The default browser origin is `http://127.0.0.1:3311`. The launcher validates a
complete build beneath this repository's `.next-e2e`, binds only loopback, disables
provider processing in the server and clears database/provider credentials in its
child environment. Build only through the isolated suite above; runtime variables
cannot retroactively change public variables baked into an arbitrary build.

The optional `--minimum-recorded-end-seconds` is a fixture-specific lower bound,
not a generic silence detector. The example source contains speech near its end.
Choose the bound from the expected source, and inspect skipped silence separately.

The runner injects a teaching-audio MediaStream into a disposable browser. The
application's actual recorder, resampler, WAV encoding, upload queue, API client,
analysis timing, stop/drain and report UI run normally. The original MP3 is not
sent through a product file importer; that feature does not currently exist.
Pause tests pause both the teaching source and recorder, so they test continuity
across an intentional break rather than speech continuing while paused.

Playwright intercepts Scribe requests in the test browser and directs them to an
in-memory adapter using real provider functions. Every other external browser
origin is blocked. A visible overlay identifies the simulated persistence.
The server remains demo-only. Therefore these runs do not verify production
authentication, RLS, provider quota enforcement, concurrent database transactions,
retention or persistence after a server restart. Test those using the separate
route/PostgreSQL/live acceptance suites.

Evidence includes request metadata, audio geometry/hashes, raw and inserted
transcript segments, evolving state, report results, desktop/phone screenshots,
rendered text and completion/failure checkpoints. A pure evidence summarizer
separates transport/processing assertions from clinical-output diagnostics and
rejects incomplete notes, an unfinished analysis cursor, early source loss and
requested tail-coverage failures. Inspect report content and source support
separately from whether execution assertions pass.

## Acceptance review

### Synthetic reviewed-fact browser control

After starting the same immutable local build, this separate real-provider control
tests a deliberately authored English statement through the actual UI:

```powershell
npx ts-node -r tsconfig-paths/register -P tsconfig.scripts.json src/scripts/verify-scribe-browser-review.ts --base-url http://127.0.0.1:3312 --run reviewed-control-A
```

It creates an isolated synthetic consult, adds a medication statement, explicitly
confirms its speaker through the menu, finishes and checks the generated factual
draft. It then corrects the source after finishing, regenerates, verifies that the
old dose is absent, approves the individual section and reloads. The fixture's
medication/doses are test data, not treatment advice. The test saves screenshots,
source hashes and an execution result under ignored `.next-e2e`; use a new run ID
each time. This proves a controlled review workflow, not recording accuracy,
real-patient role identification, production API/RLS or clinical acceptance.

### Clinical and operational acceptance

For each pass, distinguish input coverage, transport failures, overlap artefacts,
speaker attribution, facts retained after validation, report completeness and
unsupported additions. Review clinically consequential negation, medication,
quantities, family versus patient history, and proposed versus agreed plans
against the recording. A clinician must assess clinical correctness; this tool
does not assign an autonomous diagnosis or risk classification.

The current recording and results are documented in
[the 11 September audit](./audits/scribe-browser-2026-09-11/README.md).
