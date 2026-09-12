# Scribe frontend/recorder remediation

Date: 2026-09-10. Scope: UI01–UI12 from `.next-e2e/scribe-audit-evidence/ui/UI_AUDIT_FINDINGS.md`. All data used in regressions is synthetic. No production changes, provider calls, real microphone capture or standalone app server were made by this worker.

## Implemented

| Finding | Change |
|---|---|
| UI01 – clinical draft retention and late responses | New `drafts.client.ts` centralizes text/speaker drafts, session/global lifecycle generations, owner checks and pending-input state. Logout/cache clearing is wired by root. Cancel/delete/transfer clear the relevant text and recording recovery metadata. Same-organization account changes clear personal drafts and local demo clinical state. Old-generation HTTP responses and recording callbacks cannot rewrite cleared data. |
| UI02 – pending microphone permission | Recorder invalidates asynchronous start attempts on stop/unmount, releases tracks if permission arrives late, releases streams on AudioContext initialization failure, and handles ended tracks. |
| UI03 – pending gaps and reload recovery | Audio queue, partial PCM and unacknowledged gaps all block completion. Fragment UUID/duration metadata is persisted before upload and from the first PCM block; no audio or transcript is stored in that metadata. New mounts recover unresolved entries through the durable gap endpoint with the original UUID. Shared server deduplication returns an already committed audio fragment instead of adding a false gap. Acknowledged entries are removed. Storage failure pauses/prevents capture. Failed gap persistence remains visible and retryable. |
| UI04 – multi-item EPD import | Sequential CAS writes use the most recently returned envelope version in a ref. Import controls stay busy for the whole operation; failures stop the import and preserve truthful counts/messages. |
| UI05 – pending manual text and completion | Editor tracks input revisions and preserves text typed during an in-flight save. Completion and navigation account for both unsent drafts and pending requests. Text/speaker are restored together. |
| UI06 – paused partial PCM | Before-unload and completion gates include partial PCM, starting permission, pending uploads and unsaved gaps. Stop packages the remainder and awaits ongoing processing. |
| UI07 – timestamp resets | Recording origin starts from the persisted consult end and stays monotonic across stop/start cycles. Demo mixed-duration segments now also advance one monotonic timeline. |
| UI08 – organization transcription switch | Recording availability requires the organization switch and configured provider. A permanent `transcriptie_uitgeschakeld` response stops capture instead of retrying the disabled provider as a transient network failure. |
| UI09 / SEC03 – note races | Autosave and approval requests are serialized. Each request uses the latest note `bewerkRevisie`. Dirty text is preserved until acknowledged; bulk approval flushes dirty sections and stops if a save fails. Demo mirrors revision CAS, gap-review requirements and session approval transition. |
| UI10 – mobile parity | Desktop and mobile consult lists share the same action renderer, including admin/delete/release/revoke actions. Mobile cards show retention/expiry information. |
| UI11 – export and transfer | Report preview does not create an audit event. Actual successful clipboard/download actions post their real channel and exact approved note/revision. Section copying is available only after full report approval and does not unlock whole-report transfer. Merely showing text does not unlock transfer; manual copying requires explicit acknowledgment. Export/transfer/display state is tied to note UUID + edit revision, so old exported versions cannot unlock a replacement. |
| UI12 – EPD-list review | Explicit persisted list review replaces the inference from any edited fact. Medication/allergy changes and new transcript analysis reset that review flag. Limited-rule medication warnings remain visible even after review. |

Demo/source consistency: report generation records state/transcript source versions. A transcript correction invalidates approval of the prior note even after reanalysis; the clinician must generate and review a new report. Reanalysis after a source correction resets inferred state through `heranalyseStartStaat` while preserving clinician facts and replays the effective transcript. All deterministic analysis/report calls receive session language, including the clinical agent's English/manual-review fallback.

## Verification completed by this worker

- `npx tsc --noEmit -p tsconfig.typecheck.json --incremental false`: passed at integration checkpoint. Root will repeat after the final aggregate changes.
- `npx biome check --write 'src/app/(main)/scribe/_components' src/lib/careon-scribe/opname.client.ts src/lib/careon-scribe/remote.client.ts src/lib/careon-scribe/storage.client.ts src/lib/careon-scribe/drafts.client.ts src/scripts/verify-scribe-client.cjs e2e/careon.spec.ts e2e/mobile.spec.ts`: final pass, 24 files checked, no diagnostics or fixes required.
- `node src/scripts/verify-scribe-client.cjs`: final pass, `Scribe client lifecycle: all assertions passed (synthetic; no microphone, network or provider).`

The new maintainable client script transpiles the real recorder and draft modules, uses synthetic hook lifecycles/media/network, and checks: late permission after unmount; pending-start cancellation; AudioContext initialization failure cleanup; paused PCM unload/completion blocking; metadata-only partial-buffer persistence; a fresh hook mount recovering the original UUID after a simulated crash; failed gap recovery remaining blocked; successful acknowledgment removing metadata; restart offsets; failed upload/gap retries; draft lifecycle invalidation and same-org ownership changes. It also renders the actual report controller with mocked UI primitives/I/O to check approved-only section export, section copy versus full transfer, successful full export, edit-revision replacement and report-ID replacement invalidation, and silent preview auditing. A source-resolved real demo-store harness checks transcript-correction source invalidation, reanalysis still requiring a new note, fresh note approval, stale edit CAS rejection and idempotent gap recovery.

## Playwright changes for root's full suite

New titles:

- `handmatige invoer blijft behouden tijdens verzenden en blokkeert afronden` — delays the synthetic manual POST, types during the request, checks the second draft survives and completion stays disabled until submitted.
- `annuleren wist handmatige concepten` — cancels a consult with an unsent synthetic draft and checks sessionStorage erasure.
- `mobile: scribe privacyacties en opschoning blijven beschikbaar @mobile` — verifies visible delete action and retention label on the mobile consult card and opens/cancels its dialog.

Existing title preserved, assertions extended:

- Authentication logout scenario: seeds a synthetic Scribe draft and verifies it is removed.
- `consultstaat corrigeren: feit intrekken en de EPD-lijst overnemen`: imports two medications and one allergy, checks all three survive, requires explicit EPD-list review and retains the limited-rule warning.
- `verslagreview: beoordelingssecties blijven van de behandelaar, daarna overname in het EPD`: checks no preapproval section copying, show-text does not enable transfer, actual download does enable it and only the actual file channel is recorded.

No existing Playwright title was renamed. The cancellation title above was shortened during implementation before execution because that browser test checks erasure only; late-response invalidation is covered by lifecycle/transport protections and the synthetic regression suite.

## Limits and handoff

Final cross-review follow-up: demo transcript corrections now immediately remove only `voorgesteld` tasks; reviewed clinician task decisions remain. Real-store regression covers an affirmative laboratory request corrected to a negated request, verifies the proposal disappears before and after reanalysis, and verifies an approved task survives. Demo analysis now feeds only the already processed context plus its current capped batch into the deterministic round. A 41-segment regression verifies the ASR typo `sertaline` at segment 41 is not inferred during batch one and becomes exactly one `sertraline` entry during batch two. The client regression suite passed with both additions; the two touched source/script files were checked with Biome again.

Visual acceptance follow-up: the bulk-approval reminder is now tied to the originating note ID and filtered to currently unapproved section IDs. Its count shrinks during review and disappears after completion or note replacement. The existing report Playwright flow checks the one-section reminder and absence after full approval; the real report-controller regression checks shrinking count, replacement isolation and disappearance. Client checks and owned-file Biome passed. Final rebuilt-server visual capture completed at 2026-09-09 23:49 UTC, replacing all six PNGs/results. All images were inspected: dark/light mobile layout and delete dialog fit; desktop required-section review, reminder disappearance and complete clinician text in the actual export preview passed; no page errors. See `visual/observations.md`.

Root owns final aggregate CI, optimized build and complete Playwright execution. Device/browser microphone permission, real audio capture, provider and production database paths were not exercised by this worker. Metadata recovery can conservatively report an interrupted partial fragment as missing even if its contents were only silence; losing a capture must remain visible. Captured audio stays only in bounded memory. Under unavailable browser session storage, recording is refused/paused and manual text entry remains available. Historical cached concept reports without trustworthy source-version metadata require regeneration before approval.
