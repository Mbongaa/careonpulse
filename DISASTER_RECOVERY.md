# Disaster recovery

## Targets

- Application rollback objective: 15 minutes by promoting the previous immutable deployment.
- Database recovery-time objective (RTO): 4 hours.
- Database recovery-point objective (RPO): 24 hours, or the lower point-in-time window provided by the active Supabase plan.
- AI provider failure does not block the dashboard: set `CAREON_ASSISTANT_LIVE=0` and use deterministic answers.

## Required recovery assets

- Git history and a tagged/immutable release commit.
- The exact `package-lock.json` and CI-generated CycloneDX SBOM.
- Supabase managed backups or point-in-time recovery enabled for the production project.
- Every file in `supabase/migrations/` stored with the release.
- Source EPD exports retained under the organisation's approved source-system policy; they are never committed to this repository.
- Hosting and database secrets stored in the approved secret manager, not in the repository.

## Quarterly restore drill

1. Create an isolated Supabase branch or disposable project; never restore into production.
2. Restore the selected backup or point in time.
3. Apply pending migrations in order.
4. Verify all application tables have RLS enabled and no grants for `anon` or `authenticated`.
5. Verify `careon_consume_assistant_quota` accepts requests up to its threshold and rejects the next request atomically.
6. Verify the latest complete import contains `total_rows` records and that the latest means/HR revisions are readable.
7. Start the matching immutable application build against the restored database.
8. Require 200 from `/api/health/live` and `/api/health/ready`, then run `npm run verify:assistant:live` in the isolated environment.
9. Record actual RTO, achieved RPO, release/database versions, row counts and every deviation.
10. Destroy the isolated restore environment after evidence has been retained.

## Production incident sequence

1. Freeze data-changing assistant concepts by setting `CAREON_ASSISTANT_LIVE=0`.
2. Preserve request IDs, deployment ID, database time and the affected operation IDs.
3. Roll the application back when the fault is code-only.
4. Restore the database only when integrity checks prove data corruption or loss; prefer forward repair for isolated rows.
5. Run liveness/readiness, deterministic CI gates and targeted browser smoke tests before reopening writes.
6. Document the incident and add a regression/fault-injection case before the next release.

The first real restore drill still requires an isolated paid branch/project and must be recorded by the operator; this repository cannot prove a managed-backup restore by itself.
