# Careon Scribe — phased remediation, 10 September 2026

Status: all four phases implemented and locally verified. All 35 audited engineering findings have fixes and regression coverage. This is the response to the [independent audit](./SCRIBE_AUDIT_2026-09-10.md). The audit remains the historical baseline; passing baseline tests did not establish safety for the reproduced failure cases.

Scope: repair the 35 distinct engineering findings in the current working tree, add negative regression coverage, and verify the full application. Existing uncommitted implementation work is retained. Changes are local until a separately evidenced deployment. D24 stays Proposed; organization activation, external providers, clinical acceptance and native-shell microphone permissions retain their existing gates.

## Phase 1 — persistence, privacy and approval boundaries

Findings: SEC-01–SEC-10, UI-01 and UI-09 (the UI manifestation of SEC-03).

Implemented an additive database migration, canonical consent and activation validation, serialized session lifecycle operations, transcript/source revisions, compare-and-swap note edits, canonical report-section approval, one active recipient, truthful maintenance failure responses and browser-draft cleanup. Real PostgreSQL negative/concurrency tests, retained-token/direct-client paths and route-level checks pass. The already applied original migration is unchanged.

## Phase 2 — clinical extraction and AI safeguards

Findings: C-01–C-09, INT-01 and INT-02.

Bound medication doses to the correct mention; excluded questions, normal findings and family-member statements from patient facts; applied corrected speakers and transcript text before extraction; validated AI source references and content; preserved clinician assessments while preventing machine-authored risk conclusions; reconciled medication discontinuation. English deterministic analysis now explicitly requires manual review. Provider requests follow model-specific fields and the planned EU destination allowlist. Synthetic counterexamples and mocked AI/provider regressions pass, without patient data or external AI calls.

## Phase 3 — recording and clinical workflow

Findings: UI-02–UI-08 and UI-10–UI-12.

Guarded permission and recorder lifetimes, retained unresolved gap metadata idempotently, prevented silent draft loss, preserved monotonic audio offsets, respected organization transcription settings, completed multi-item EPD import with current revisions, exposed mobile lifecycle controls, bound export actions to the approved note revision and recorded explicit EPD review. Lifecycle harnesses pass; the full browser gate covers the integrated workflows and audit reproductions.

## Phase 4 — release gates, dependencies and evidence

Findings: INT-03–INT-05, plus integration verification for all preceding phases.

Updated vulnerable dependencies, added the Scribe database suite to CI, made browser runs explicitly inert with isolated build directories and corrected readiness/documentation claims. The complete quality, database, optimized build and browser gates provide acceptance evidence below. Every audit finding and the remaining external acceptance requirements are recorded here.

## Verification record

| Gate | Result | Evidence |
|---|---|---|
| Full `npm run verify:ci` | Passed again after the assertion-only test correction. Biome checks 476 files; TypeScript and all included regression suites pass; npm reports zero vulnerabilities. | [Complete quality output](./audits/scribe-remediation-2026-09-10/verify-ci-final.txt) |
| Scribe server/provider and domain | 124 server/provider + 97 domain checks pass. | Complete quality output above |
| Clinical and final report grounding | 120 checks pass with synthetic inputs and mocked provider responses. | [Clinical results](./audits/scribe-remediation-2026-09-10/clinical-verification.txt) |
| Client recording/draft/report lifecycle | All assertions pass, including real-hook reload recovery and actual demo-store correction/batching. | Complete quality output and [UI evidence](./audits/scribe-remediation-2026-09-10/ui.md) |
| Actual Scribe route handlers | 55 assertions pass with synthetic auth/storage adapters and no network. | [Route results](./audits/scribe-remediation-2026-09-10/routes-scribe.txt) |
| Actual PostgreSQL, Scribe upgrade | 105 baseline + 125 upgraded-schema assertions pass, including concurrent connections; synthetic database removed. | [Scribe database results](./audits/scribe-remediation-2026-09-10/postgres-scribe.txt) |
| Other database boundaries with new migration | Authorization 247, invoices 26 and EPD 37 checks pass; each synthetic database removed. | [Authorization](./audits/scribe-remediation-2026-09-10/postgres-auth.txt), [invoices](./audits/scribe-remediation-2026-09-10/postgres-facturatie.txt), [EPD](./audits/scribe-remediation-2026-09-10/postgres-epd.txt) |
| Dependency audit | Zero findings across all dependencies; Next 16.3.4 and Sharp 0.35.4 pinned, Hono 4.13.7 and js-yaml 4.3.2 resolved. | [Audit JSON](./audits/scribe-remediation-2026-09-10/dependency-audit.json) |
| Optimized build and full Playwright | Build passed. All 162 scenarios completed: 161 passed directly and one EPD test passed on retry; process exit 0, 14.8 minutes. The test timing issue and follow-up are documented below. | [Full build/browser output](./audits/scribe-remediation-2026-09-10/build-and-browser-final.txt) |
| Visual workflow acceptance | Six screenshots refreshed and inspected. Mobile light/dark layouts fit at 390px, privacy actions and dialogs remain reachable, approval reminder clears, and export preview contains clinician text. Zero page errors. | [Observations and screenshots](./audits/scribe-remediation-2026-09-10/visual/observations.md) |

Other full-CI results: 1,168 Careon, 423 production-fixture, 145 assistant, 178 runtime, 11 organization-identity, 21 invoice-route, 19 EPD-client, 79 mobile-shell, 64 Storage-policy and 122 queue checks pass; synthetic five-source TGC parser verification also passes. The final data-hygiene gate checks 705 indexed and nonignored untracked files; ignored outputs are excluded. The optional real-export sanity pass is skipped because that export is absent; none of these results verifies current production patient data.

The final independent integration review exposed four additional manifestations of the original C-06/C-07 findings: fabricated final-report content, malformed report rows, stale demo tasks and reading beyond a demo analysis batch. Each was fixed with regression coverage before the complete quality run. See [the cross-review and closure](./audits/scribe-remediation-2026-09-10/final-cross-review.md).

Visual acceptance also exposed a stale reminder to approve clinician sections after they were already approved. The reminder now derives its count from the current note, disappears on completion and cannot carry into a replacement note. The real-controller regression and existing report browser scenario cover this follow-up. The earlier partial browser run was intentionally interrupted for this change; only the final complete run is acceptance evidence.

The complete browser run exposed one test synchronization issue. The controlled EPD checkbox updates after its saved
state arrives, while Playwright's `.check()` immediately asserted a synchronous change. The failed attempt's own final
snapshot already showed **Beoordeeld** and a checked checkbox. Only the test was changed to click once and await
`toBeChecked()`; the application was unchanged. The [trace analysis and exact test diff](./audits/scribe-remediation-2026-09-10/epd-retry/analysis.md)
and [original trace](./audits/scribe-remediation-2026-09-10/epd-retry/trace.zip) are preserved. All
[five retry-free repetitions](./audits/scribe-remediation-2026-09-10/epd-repeat-final.txt) passed against the same
verified build in 1.0 minute. The final full quality check also passed after this assertion-only correction.

The source comparison covers 105 files: application/configuration files are unchanged from the final build snapshot;
only that documented test assertion differs. Both [pre-build](./audits/scribe-remediation-2026-09-10/source-sha256-before-final-build.txt)
and [final source](./audits/scribe-remediation-2026-09-10/source-sha256.txt) manifests are preserved. The
[final comparison](./audits/scribe-remediation-2026-09-10/source-verification.txt) confirms all 105 current hashes match.
The isolated wrapper also restored its temporary generated TypeScript include paths.

No production migration, deployment, live provider call or organization activation has been performed. The applied original migration's SHA-256 remains `ca771ede84b8720916d1fd8acf75944286079e36fa886540baf6b796e9fad7a3`, identical to the audit baseline. The new migration and application need coordinated staging/production acceptance as described below.

## Finding-to-fix register

The entries below cover all 35 audit findings in the combined working tree. UI-09 is the interface manifestation of SEC-03 and is not counted twice. The engineering changes and local test evidence do not close the separately listed deployment, contractual or clinical acceptance gates.

| Audit finding | Implemented change | Acceptance coverage |
|---|---|---|
| SEC-01 | A service-only deletion RPC reauthorizes the signed-in actor, locks the consult, returns the deleted identity and counts, and the route audits only confirmed deletion. Direct authenticated table deletion is revoked. | Real administrator deletion, revoked administrator, wrong organization and zero-row route responses. |
| SEC-02 | Transcript corrections atomically increment source/state revisions and remove obsolete unreviewed task suggestions. Analysis and its derived tasks commit together; stale analysis fails compare-and-swap. | Two-connection stale-analysis race, corrected-source replay and retained clinician task decisions. |
| SEC-03 / UI-09 | Report text edits carry `bewerkRevisie`; one atomic operation applies section patches and approval. The interface serializes pending edits using each returned revision. | Competing report edits, stale revision rejection, blur/edit then approval. |
| SEC-04 | The database renders retention placeholders into the consent text captured for the consult. | Exact stored text compared with the organization settings. |
| SEC-05 | SQL validates DPIA date, owner, processor-agreement confirmation and consent approval date, and gates enabled settings. | Missing, blank, malformed and null activation evidence. |
| SEC-06 | Canonical definitions for all eight report formats, required assessment sections, nonempty approved text, source freshness and explicit missing-fragment review are enforced together. The old revision-free approval RPC is revoked. | Empty/forged sections, all eight formats, stale source, null revisions, English manual sections and missing-gap acknowledgement. |
| SEC-07 | Content mutations lock the parent consult and require supported RPCs, valid lifecycle and retention. Direct content/counter writes and late re-creation of purged content fail. | Cancel versus analysis, terminal insert/update rejection, immutable counters and pruning. |
| SEC-08 | A unique per-consult release index and a parent-locking, service-only release RPC prevent concurrent recipients. | Two simultaneous recipients, allowed recipient, revoked privileges. |
| SEC-09 | Session creation freezes consent from the actual current organization settings under the same organization lock as settings changes; caller text cannot forge provenance. | Invented/stale revision and forged consent text. |
| SEC-10 | A failed Scribe retention job returns HTTP 502 with `partial_failed` and a failure audit record. Successful unrelated cleanup remains visible in the response. | Actual maintenance handler with injected prune failure. |
| C-01 | Dose spans are bound to each medicine mention; decimal punctuation remains intact and ambiguous doses stay unknown. | Reversed medicines, dose-before-name, mixed decimal separators and missing dose. |
| C-02 | Positive topic mentions are distinguished from pathological symptoms; normal sleep and appetite do not become complaints. | Normal findings plus pathological positive controls. |
| C-03 | Unanswered questions and historical queries do not establish allergies, duration, severity or future actions. | Question-versus-assertion pairs and historical lab questions. |
| C-04 | Family-member statements are assigned to family history rather than patient medicines or symptoms. | Relatives' conditions and medicines plus patient statements. |
| C-05 | English deterministic extraction explicitly declines automatic inference. Fallback reports require clinician-authored sections; English provider instructions follow the selected language. | English negation, fallback report sections and database approval requirements. |
| C-06 | Speaker assignments and permitted transcript corrections are applied before extraction. Authoritative correction replay clears stale machine facts while retaining clinician-entered facts. Demo analysis respects the current batch boundary and removes only proposed tasks on correction. | Last-fragment role assignment, corrected dose/medicine, old allergy removal and multi-batch correction/task parity. |
| C-07 | AI fact sources must be positive existing segment numbers and semantically supported. Provider-supplied clinician ownership and nested dose history are discarded. Report generation independently checks model sections against canonical content and source references, so a second model pass cannot reintroduce unsupported claims. Unsafe/malformed fields fall back conservatively. | Missing/zero/nonexistent/wrong source, invented medicine/dose, spoofed ownership, malformed arrays and fabricated final-report medication/allergy. |
| C-08 | Machine-generated scalar and list risk statements are normalized at ingress. Clinician-authored assessments retain their own meaning. | Scalar risk-polarity counterexamples and clinician preservation controls. |
| C-09 | Medication history reconciles later stopping/restarting against current use; obsolete machine rows are retracted rather than simultaneously current. | Stop, restart and retained history without false current-medication signals. |
| UI-01 | One draft API clears personal drafts on logout, cancel, delete, transfer and account changes; lifecycle generations reject late writes. Ownership distinguishes users within the same organization. | Late callbacks, same-organization user switch, cancellation and logout. |
| UI-02 | Recorder permission and initialization use lifecycle guards; late streams and failed initialization release their tracks. | Unmount/stop while permission is pending and initialization failure. |
| UI-03 | Unacknowledged fragments, including partial buffered audio, have content-free recovery metadata. Reload restores unresolved UUIDs as idempotent gaps; completion waits for durable acknowledgement. | Fresh-hook reload, failed gap write, lost acknowledgement and successful retry. |
| UI-04 | Multi-item EPD import passes the returned state version to each subsequent mutation. | Multi-medicine/allergy import and revision conflict handling. |
| UI-05 | Pending manual submissions preserve newer typing and the selected speaker. Completion requires the draft to be submitted or explicitly discarded. | Delayed submission with new text, restored speaker, unsent-draft completion. |
| UI-06 | Pending permission, buffered PCM and unresolved gaps participate in navigation/unload/finalization protection. | Pause with less than one fragment of audio. |
| UI-07 | Recording offsets continue from the persisted consult timeline and the previous recording run. | Stop/start and reload with existing segment timestamps. |
| UI-08 | Recording availability includes the organization's transcription switch. Typed permanent-disable responses stop capture and avoid treating disabled processing as an ordinary network retry. | Organization-disabled controls and permanent-disable response. |
| UI-10 | Mobile consult cards expose the same applicable delete, release/revoke and retention information as desktop. | Mobile lifecycle action flow and responsive coverage. |
| UI-11 | Copy/export requires the approved report; export readiness is bound to its identity and edit revision. Preview fetches do not record clipboard use; successful actions are recorded separately. A section copy cannot represent a complete report transfer. | Approval/export lifecycle, replacement report, actual download/copy, preview and section-copy controls. |
| UI-12 | EPD review has its own explicit persisted flag, independent of entering or retracting one fact. Relevant data changes invalidate the review. | Partial import/manual changes do not imply completed review. |
| INT-01 | Diarization requests omit the unsupported prompt. Invalid provider response shapes produce a visible missing-fragment path; parser failures expose content-free errors only. | Model-specific request fields, language, malformed JSON/segments and silence controls. |
| INT-02 | Vertex accepts only the planned `europe-west4` destination, valid project/model path components and an RSA service account using Google's fixed token endpoint. Credential-token caching uses a full SHA-256 identity. | US/global/nonapproved regions, path injection and invalid credentials. |
| INT-03 | Next.js is pinned to 16.3.4, Sharp to 0.35.4; the lockfile resolves Hono 4.13.7 and js-yaml 4.3.2. | Full and production dependency audits plus optimized build/browser checks. |
| INT-04 | CI executes the real Scribe PostgreSQL suite; Scribe clinical, provider, route and lifecycle regressions join the quality gate. Browser build/run explicitly disables both AI live switches and uses a fresh output directory. | Workflow/script wiring and final complete gates. |
| INT-05 | Delivery docs separate historical baseline, local remediation, production deployment and external activation. The administrator-use exception and limits of name detection are explicit. | Updated Project Status, Gap Register, release and production/AI operations docs. |

## Changes clinicians and operators will notice

- A report can be approved only against the transcript and analyzed state that produced it. Editing the source invalidates the old draft even after reanalysis; generate and review a new report. Concurrent note edits now return a conflict instead of overwriting another saved edit.
- Missing audio fragments must be acknowledged before approval. Reload recovery stores only unresolved fragment identity/duration, so an interrupted recording becomes a visible gap; it cannot reconstruct lost audio. Recording pauses or refuses to start when recovery metadata cannot be stored.
- Unsent text and pending audio prevent completion until saved or explicitly discarded. Clearing a consult or changing users clears personal drafts, including late asynchronous callbacks. Recording time continues across separate capture runs.
- EPD-list review is explicit and separate from importing or changing one item. Copy/download becomes available after report approval, and only a complete report export enables transfer. Export audit records the client's successful-operation report; it cannot independently prove an operating-system clipboard or disk write.
- Clinical extraction deliberately declines ambiguous assertions. Dutch deterministic extraction remains a limited heuristic system. English deterministic reports require manual completion of every section. AI-generated report wording is accepted only when canonical content and source references can be preserved; unsupported additions, omissions or clinical paraphrases fall back to canonical material.
- Organization administrators retain their existing use exception. The short dossier-reference validator rejects defined BSN/date patterns and invalid characters, but cannot reliably distinguish an alphanumeric personal name from a reference. These existing product-policy limits are documented for organization acceptance.

These changes have engineering regression coverage. They do not establish clinical sensitivity/specificity, transcription quality, real-device microphone behavior or provider contractual/residency acceptance.

## Controlled deployment sequence

The code and migration must be deployed as one reviewed release. The new application calls new RPCs; the migration revokes legacy direct writes and approval, so mixed old/new application-schema operation is unsupported.

1. Keep Scribe organization activation and provider switches disabled. Capture the exact reviewed application commit/build and a verified backup using the existing deployment procedure.
2. Run metadata-only preflight checks for duplicate releases, malformed existing report sections and legacy concept reports without source bindings. A duplicate recipient row deliberately prevents the unique-index migration; do not silently pick a recipient. Preserve existing approved records and resolve any findings through an explicit reviewed data decision.
3. Validate the [additive integrity migration](../../supabase/migrations/20260910120000_scribe_audit_integrity.sql) in staging, then apply the reviewed artifact in the controlled production release. The original `20260907120000` migration is unchanged. The added `NOT VALID` constraints enforce new/updated rows; existing rows require review before a separate validation step. Legacy concept reports need regeneration to obtain source bindings. Exact pre/post-migration inspection queries are in the [backend handoff](./audits/scribe-remediation-2026-09-10/security.md).
4. Deploy the matching application while the module remains disabled. Verify actual database function grants, constraints, triggers and API behavior against the reviewed artifact. Exercise synthetic owner/admin/recipient paths and inspect retention failure reporting.
5. Complete the existing D24, contractual, DPIA, consent, clinician and device/provider acceptance gates before any organization or provider is enabled. Local mocked-provider and Chromium results are not live microphone, clinical, Safari/iOS or provider acceptance.

Rollback should retain the protective additive schema while the module is disabled and use a forward correction. Releasing the old application against the new write restrictions will fail; blindly removing the migration would reopen the audit defects.

Historical machine-derived clinical state is not backfilled by these changes. During staged legacy-data review, rebuild
and clinically review working copies from the available effective transcript before generating replacement reports;
regenerating a note from an old inferred state alone does not correct that state. Preserve clinician-authored facts and
approved historical reports. If the source has expired, do not invent source bindings or reconstruct missing clinical
content. The legacy row review and any corrective data operation require their own explicit release evidence.

## Provider references

The OpenAI diarization model does not support prompts; request construction omits them for diarization ([OpenAI speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)). Vertex endpoint selection alone is not evidence of a model's residency guarantees; the local allowlist restricts the planned destination to `europe-west4`, and model-specific contractual and residency acceptance remains required before activation ([Google data residency](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/data-residency)).
