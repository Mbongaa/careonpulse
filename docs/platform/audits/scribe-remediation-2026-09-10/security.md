# Scribe backend and database remediation

Local implementation, 10 September 2026. No deployment, live SQL, provider call, application credential use, or production-data inspection occurred. The applied initial migration was preserved; changes are additive in `supabase/migrations/20260910120000_scribe_audit_integrity.sql`.

## Completed audit fixes

| Finding | Implemented behavior |
|---|---|
| SEC-01 | Administrator/owner deletion uses a narrowly service-only RPC that reauthorizes the authenticated actor against current membership, account and Scribe authorization, locks the session, rechecks protected-copy conditions, then deletes with returned ID/count evidence. The HTTP route emits success/audit only for the matching deleted ID. |
| SEC-02 | Transcript correction, state invalidation, revision increment, and cursor rewind are one transaction. Analysis saves use the expected state revision and the same parent lock, so old analysis cannot clear a newer correction. Correction replays machine facts from zero while preserving clinician-authored facts. Unreviewed machine task suggestions are removed; clinician-reviewed task statuses survive. |
| SEC-03 | Notes have a separate monotonic `bewerk_revisie`. One invoker RPC applies section patches and approval under the session/note lock with CAS. Stale revisions return conflict; final approval binds to the saved text revision. UI coordination uses required `bewerkRevisie`. |
| SEC-04 | The database renders retention placeholders from accepted organization settings before freezing consent text. Caller text is overwritten. |
| SEC-05 | Database activation requires processor agreement, bounded nonempty DPIA owner, and parseable ISO DPIA/consent approval dates. Missing/malformed values fail closed. The new CHECK also enforces future settings writes. ISO dates and valid ISO timestamps are accepted; the existing UI writes dates. |
| SEC-06 | Canonical section IDs/count/required clinician flags are enforced for all eight formats. Empty/duplicate/unknown/null section patches cannot bypass approval. Notes bind to state and transcript revisions; incomplete or stale analysis cannot generate/approve. Known gap count must be explicitly acknowledged and is frozen on approval. English deterministic fallback requires every section to be clinician-entered. Legacy revision-free approval RPC execution was revoked. |
| SEC-07 | Supported content writes and cancellation/transfer/pruning lock the same parent first. Child guards reject direct PostgREST writes and terminal/expired mutation; late analysis/note generation cannot restore erased content. Caller-writable counters are frozen. Ingestion derives missing-fragment count from persisted system rows, rather than trusting the request flag. |
| SEC-08 | Unique release per session, parent serialization, current actor/recipient checks, and a service-only release RPC enforce one colleague even under competing requests. Recipient content RLS remains approved-note only. |
| SEC-09 | Consent creation locks the organization against concurrent settings inserts, requires its current revision, and obtains canonical text from that row. Invented/stale revisions fail. |
| SEC-10 | Scribe pruning failure yields HTTP 502 with `partial_failed`, a dedicated failure audit, and no false `completed` response. Maintenance has a 120-second platform budget with bounded individual fetches. |

Additional integration contracts: explicit versioned EPD-list review; medication/allergy changes and new source input invalidate that flag; audio disabled/config errors carry `transcriptie_uitgeschakeld`; manual gap/audio retries share fragment IDs; actual browser export confirmation is separate from preview prefetch. A restored gap ID returns previously committed audio unchanged and does not add a missing count.

## Verification

- `npm run typecheck`: passed after backend integration.
- Owned-file Biome check: 18 files, clean after formatting.
- `node src/scripts/verify-scribe-routes.cjs`: **55 actual route-handler assertions passed**. Recorded at `routes-scribe.txt`. Executes the shipped handlers with synthetic auth/storage adapters and the real body reader/response/export formatter; all network calls are prohibited. Covers CAS forwarding/conflicts, false-delete evidence, ownership/auth failures, atomic correction and explicit EPD review, terminal analysis, preview versus completed-export audit, and maintenance failures.
- `verify-scribe-postgres.py --port 55439 --user hassan`: **105 baseline + 125 upgraded-schema assertions passed**, recorded in `postgres-scribe.txt`. The existing 105 checks run before the additive upgrade, then the new integrity checks run with the new migration active and legacy rows present. This deliberately verifies both original baseline and real upgrade behavior in one disposable database.
- New PG checks use independent connections and real row locks for competing note writers, one-recipient release, and cancellation versus late analysis. They also test direct authenticated bypasses, revoked old approval, missing state/null source bindings, all format definitions, role/active-account failures, actual admin delete/cascades, source correction to segment 10, gap false flags/dedup, and retention.
- The standard local harness excludes only `0019_careon_access_token_hook.sql`, whose Supabase-owned role is absent locally. Test fixtures are synthetic; their database is removed on completion. Root separately runs the full integration/CI/browser gates.

## Operator preflight and rollout implications

These are reviewable operator queries, **not executed against production**.

Before migration, check for legacy multiple recipients (the new unique index deliberately fails rather than choosing one):

```sql
select sessie_id, count(*) as recipients
from public.careon_scribe_vrijgaven
group by sessie_id having count(*) > 1;
```

An authorized operator must resolve any duplicate recipients explicitly before applying the migration. Do not automatically delete a chosen recipient's access.

After applying the migration in staging, inspect historical validation exceptions using the newly installed functions:

```sql
select org_id, revision
from public.careon_scribe_instellingen
where state->'ingeschakeld' = 'true'::jsonb
  and not app.scribe_activatie_geldig(state);

select id, sessie_id, status, formaat
from public.careon_scribe_notities
where not app.scribe_secties_canoniek(formaat, secties);

select id, sessie_id, status
from public.careon_scribe_notities
where status = 'concept'
  and (bron_staat_versie is null or bron_transcript_revisie is null);
```

Activation/canonical-section constraints are intentionally `NOT VALID`: they enforce future writes without rewriting historical evidence. Current activation lookup rejects invalid historical activation data immediately. Correct organization settings through the authorized workflow and regenerate legacy drafts from current reviewed analysis; do not invent historical source bindings. Existing approved reports retain their original immutable content and read/export access under RLS.

After historical exceptions have been reviewed/resolved, an operator may explicitly validate `careon_scribe_instellingen_activatie` and `careon_scribe_notities_canoniek`. Coordinate migration and application rollout: older clients lack the required note edit revision and use revoked direct writes/approval paths. Refresh open Scribe clients before acceptance; do not reopen old RPC grants to preserve compatibility.

Residual acceptance gates: staging against real Supabase/PostgREST and its auth claims, production schema drift/preflight, clinician review of corrected extraction and English fallback, real-device microphone behavior, deployed cron failure alert and catch-up evidence, and all existing DPIA/DPA/ZDR/consent/provider activation decisions. Local tests do not satisfy those gates. HTTP export confirmation records the client's completed-operation report; the server cannot independently prove a browser/OS clipboard or filesystem write.
