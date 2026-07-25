# AI operations

## Production contract

- API: OpenAI Responses API by default; temporary Chat Completions fallback via `OPENAI_API_MODE=chat`.
- Model: pinned default `gpt-4o-mini-2024-07-18`. Override with `OPENAI_MODEL` only after the live evaluation passes.
- Storage: provider-side storage is disabled with `store:false`.
- Tools: strict JSON schemas and a per-question allowlist. Read-only questions receive no mutation tools.
- Execution: tools modify an in-browser concept, never the database directly. Applying the concept is a separate user action; removals and high-impact bulk changes require additional explicit confirmation.
- Sensitive inference: language, origin, nationality, religion and similar attributes may never be inferred from names, photos or appearance. The route blocks these prompts before model/tool execution.
- Production evidence: facts and canvas values are generated from the same filtered `ProductionSnapshot`. Demo values are not presented as live evidence.

## Privacy boundary

The provider receives only the facts required for the inferred intent.

- Never sent: client records, dossier URLs, risk-list rows, raw exports.
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

## Incident response

- Provider outage: set `CAREON_ASSISTANT_LIVE=0`; deterministic dashboard answers remain available.
- Unsafe or incorrect tool selection: disable live AI, preserve request IDs, and inspect pseudonymous events plus the live-eval scenario.
- Cost spike: lower rate limits, inspect token usage by prompt/model version, and disable live AI if necessary.
- Maintenance failure: inspect the daily `/api/internal/maintenance` cron invocation, `CRON_SECRET`, and the `careon_prune_runtime_data` RPC. Do not delete product snapshots as part of telemetry cleanup.
- Sync conflict: choose the central version to discard the local draft, or explicitly choose the local version to write it on top of the latest revision.
- Suspected data exposure: rotate the OpenAI key and safety salt, disable live AI, remove affected chat storage from browsers, and review the configured retention window.
