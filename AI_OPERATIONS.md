# AI operations

## Production contract

- API: OpenAI Responses API by default; temporary Chat Completions fallback via `OPENAI_API_MODE=chat`.
- Model: pinned default `gpt-4o-mini-2024-07-18`. Override with `OPENAI_MODEL` only after the live evaluation passes.
- Storage: provider-side storage is disabled with `store:false`.
- Tools: strict JSON schemas. The model receives the complete operational toolset and chooses the tools needed for the explicit request.
- Execution: tools modify an in-browser concept, never the database directly. Applying the concept is a separate user action; removals and high-impact bulk changes require additional explicit confirmation.
- Assumption-based proposals: when the user explicitly requests an estimate (for example a second-language concept based on employee names), the model may prepare it as a clearly labelled, editable assumption. Nothing is stored before the user reviews and applies the concept.
- Production evidence: facts and canvas values are generated from the same filtered `ProductionSnapshot`. Demo values are not presented as live evidence.

## Privacy boundary

This section describes the **dashboard assistant path** (`/dashboard/assistent` and its tools). Careon Scribe is a separate processing category with its own boundary — see the Careon Scribe section below.

The provider receives the dashboard facts plus the operational registration needed to answer the request or prepare a concept.

- Never sent **on the assistant path**: client records, dossier URLs, risk-list rows, raw exports.
- Employee names: only for explicit clinician/coaching questions or a relevant means action.
- Free notes and asset identifiers: only for an explicit note/tag question.
- Server telemetry: request ID, pseudonymous actor hash, model/prompt version, latency, token counts, status and tool names. Questions, answers, names and tool arguments are not logged.
- Browser chat history: `sessionStorage` by default, cleared on logout. Optional `local` retention is capped at 30 days; `off` keeps history in memory only.
- Operational event retention: 90 days by default (`CAREON_ASSISTANT_EVENT_RETENTION_DAYS`).

## Reliability controls

- Request and context size limits.
- Atomic per-minute and per-day actor limits, backed by a Supabase RPC when configured. A configured database outage fails closed instead of silently switching to per-instance counters.
- Provider timeouts with bounded exponential retry for transient status codes.
- Fail-closed input moderation. Provider/moderation outages return a controlled 503 and the deterministic dashboard path remains available.
- Stream terminal validation: failed, incomplete, malformed or prematurely closed provider streams emit an error, discard every pending tool call and are logged as failed.
- Request IDs returned in `x-careon-request-id` and stream metadata.
- Optimistic database concurrency with monotone revisions and idempotent operation IDs.
- Explicit sync-conflict resolution; no last-write-wins overwrite.

## Careon Scribe

Blueprint decision **D24 is Proposed** (owner confirmation required, 7 Sep 2026). Nothing below may be activated in
production before that confirmation, the per-provider DPAs and the DPIA. Specification:
`agent-handoff/20-clinical-scribe.md`; go-live checklist: `PRODUCTION_MODE.md`.

### New processing category

Consult audio and verbatim consult transcript are a **new processing category** and are not covered by the assistant's
"never sent" line above, which is bound to the dashboard assistant path. Transcript text is special-category data
(art. 9 GDPR) and can be directly identifying. Careon stores **no audio**: fragments are relayed to the transcription
provider and discarded. The stored transcript is a temporary working copy with its own retention, owner-bound RLS and
DPIA precondition (blueprint §18).

### Provider matrix

| Stage | Provider | Regime |
|---|---|---|
| Transcription (`openai` adapter) | OpenAI audio transcriptions | Within D17. Pinned model through `CAREON_SCRIBE_TRANSCRIPTION_MODEL`; **Careon stores no audio** — the fragment is relayed and discarded — but `/audio/transcriptions` has no `store` parameter, so provider-side retention of API input is governed solely by the DPA and must be zero data retention with abuse-logging excluded in writing before activation (V1). Medical context follows the selected NL/EN language; diarization requests omit the unsupported prompt field. |
| Transcription (`gemini` adapter) | Gemini on Vertex AI, planned destination `europe-west4` | **Outside the letter of D17**; allowed only under proposed D24(b) and a separate Google Cloud DPA. Model is mandatory and never hard-coded (D6). Only the planned `europe-west4` destination is accepted; other regions, global routing and malformed credentials fail closed. The service account uses Google's fixed token endpoint. Model-specific regional availability and residency guarantees still require acceptance before activation. |
| Clinical state extraction, report generation, transcript correction | OpenAI | Existing dashboard regime: pinned snapshot `ASSISTANT_MODEL`, `store:false`, strict JSON schemas (Responses `json_schema` with a chat fallback), bounded retries, quota, content-free telemetry |
| Organisation gate | — | A provider call for scribe happens only when three switches agree: platform opt-in `CAREON_SCRIBE_LIVE=1`, the organisation's own `transcriptieAan` (audio route) / `aiAnalyseAan` (analysis + report) under **Externe verwerking** in `/scribe/instellingen` (both default off), and a fully configured provider. Any missing switch yields the deterministic path (analysis/report) or 503 (transcription) |
| Medication safety, checklist, deterministic report | none (in code) | Curated rules always run locally, with or without live AI, and are visually separated from model signals |

### Environment and kill switch

`CAREON_SCRIBE_LIVE` is the opt-in kill switch for **every** provider call; without it the module runs fully
deterministically and labels its output "Deterministische analyse". Automatic deterministic clinical extraction
supports Dutch with synthetic regression coverage; English fallback explicitly requires clinician entry and review
of the report sections. This coverage is not clinical validation.
`CAREON_SCRIBE_TRANSCRIPTION_PROVIDER`,
`CAREON_SCRIBE_TRANSCRIPTION_MODEL`, `CAREON_SCRIBE_VERTEX_PROJECT_ID`, `CAREON_SCRIBE_VERTEX_LOCATION`,
`CAREON_SCRIBE_GEMINI_MODEL` and `CAREON_SCRIBE_VERTEX_SERVICE_ACCOUNT_JSON` select and configure the transcription
adapter; an incomplete configuration fails closed with 503 while manual text entry stays available. Quota runs on the
`scribe` scope: `CAREON_SCRIBE_RATE_LIMIT_PER_MINUTE`, `CAREON_SCRIBE_RATE_LIMIT_PER_DAY` and
`CAREON_SCRIBE_RATE_LIMIT_ORG_PER_DAY`, fail-closed on an RPC outage. All values are server-side only and never carry a
`NEXT_PUBLIC_` prefix. Beyond the platform switch, the module is off per organization until an `org_admin` enables it
and authorizes clinicians.

### Moderation exception

Input moderation is **deliberately not applied to consult transcripts**, unlike the fail-closed moderation on the
assistant path. Justification: a transcript is not a user prompt but a recording of a care conversation, and medical
and psychiatric content (self-harm, violence, substance use, sexuality) produces structural false positives; a blocked
fragment would silently remove clinical content from the documentation, which is more dangerous than the risk
moderation addresses here. Compensating controls: consent is a hard, frozen precondition per consult; access runs per
authorized clinician with owner-bound RLS; quota applies on the `scribe` scope per user and per organization; telemetry
and audit events contain no content; assessment and risk sections are never machine-written and risk categories carry
no machine polarity; the report only leaves the module after per-section clinician approval; and the whole path is
behind the `CAREON_SCRIBE_LIVE` kill switch.

### Prompt and telemetry

`SCRIBE_PROMPT_VERSION` versions the scribe prompts independently of `ASSISTANT_PROMPT_VERSION` and is written to the
telemetry event (`metadata.feature: "scribe"`, `promptVersion`, `apiMode`) together with model, latency, token counts
and status — never with content. Bump it with every prompt or schema change and in the model upgrade procedure below.

The 10 September audit fixes use prompt version `careon-scribe-2026-09-10.2`. Model facts require supported existing
sources, and the report-generation pass independently checks section text and citations against canonical material.
Only complete verifiable wording with limited formatting changes is accepted; unsupported paraphrases, added claims,
changed doses/negation or omissions fall back to canonical content. A report with no accepted model sections carries
deterministic provenance. This conservative boundary can increase manual work, especially for English, and requires
clinician acceptance before activation. See [the remediation report](docs/platform/SCRIBE_REMEDIATION_2026-09-10.md).

## Release procedure

1. `npm run verify:ci`
2. `npm run build`
3. `npm run test:e2e`
4. Start the production build on port 3210.
5. `npm run verify:assistant:live`
6. Review Supabase security/performance advisors after every DDL migration.
7. Verify `/api/health/live` returns 200 and `/api/health/ready` returns 200 in the deployment.
8. Deploy only a saved, immutable build with the production environment variables.

The GitHub `Assistant live evaluation` workflow runs weekly and can also be dispatched manually. It skips safely when the repository has no `OPENAI_API_KEY` secret.

## Model upgrade procedure

1. Set `OPENAI_MODEL` to the candidate dated snapshot in a non-production environment.
2. Run deterministic and live gates.
3. Compare tool selection, completion rate, latency and token usage with the current model.
4. Review at least the destructive, bulk, read-only, missing-data and privacy scenarios.
5. Promote only when there are no correctness/privacy regressions and the cost/latency change is accepted.
6. Update the pinned default and `ASSISTANT_PROMPT_VERSION` together.
7. Careon Scribe shares the pinned model: re-run the scribe gates (`verify:careon` scribe section, `verify:scribe`, and `verify:scribe:live` where keys exist) and check the extraction, report and assessment-section behaviour against the strict schemas — a model that starts filling a clinician-only section or writing a risk polarity is a blocking regression. Bump `SCRIBE_PROMPT_VERSION` together with the model, and keep the transcription model (`CAREON_SCRIBE_TRANSCRIPTION_MODEL`, `CAREON_SCRIBE_GEMINI_MODEL`) on its own dated pin — it is upgraded separately from the reasoning model.

## Incident response

- Provider outage: set `CAREON_ASSISTANT_LIVE=0`; deterministic dashboard answers remain available.
- Unsafe or incorrect tool selection: disable live AI, preserve request IDs, and inspect pseudonymous events plus the live-eval scenario.
- Cost spike: lower rate limits, inspect token usage by prompt/model version, and disable live AI if necessary.
- Maintenance failure: inspect the daily `/api/internal/maintenance` cron invocation, `CRON_SECRET`, and the `careon_prune_runtime_data` RPC. Do not delete product snapshots as part of telemetry cleanup.
- Sync conflict: choose the central version to discard the local draft, or explicitly choose the local version to write it on top of the latest revision.
- Suspected data exposure: rotate the OpenAI key and safety salt, disable live AI, remove affected chat storage from browsers, and review the configured retention window.
- Careon Scribe provider outage or quality incident: set `CAREON_SCRIBE_LIVE=0`. Transcription then answers 503 with manual entry available, and analysis/report generation continue deterministically; existing consults, transcripts and approved reports are untouched.
- Careon Scribe legal/consent incident (missing DPA clause, unfinished DPIA, disputed consent): set `CAREON_SCRIBE_LIVE=0` **and** have the `org_admin` switch the module off for the organization, which blocks new consults at the database. Existing content follows its retention; a specific consult can be cancelled (transcript and state erased synchronously) or deleted with an audited reason.
- Careon Scribe suspected content exposure: rotate the provider credentials (OpenAI key and, when used, the Vertex service-account JSON), disable the scribe, review `audit_events` for `scribe.transcript.read`, `scribe.export`, `scribe.sessie.vrijgegeven` and `scribe.sessie.verwijderd`, and check the organization's retention settings. Provider telemetry contains no consult content, so the audit trail — not the telemetry — is the investigative source.
