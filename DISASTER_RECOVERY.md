# Disaster recovery

## Targets

- Application rollback objective: 15 minutes by promoting the previous immutable deployment.
- Database recovery-time objective (RTO): 4 hours.
- Database recovery-point objective (RPO): 24 hours, or the lower point-in-time window provided by the active Supabase plan.
- Storage bucket `facturen` (invoice PDFs + template logos, handoff 15) recovery-point objective (RPO): the last issuance — objects are written only when an invoice is made definitive, so a bucket loss can cost every PDF written since the last copy, never a row. Recovery-time objective (RTO): 8 hours, because the fallback is regeneration rather than restore: PDFs are rebuildable from the frozen row snapshots (`POST /api/careon/facturatie/facturen/<id>/pdf`, integrity via `pdf_sha256` on the row). Supabase DB backups/PITR do **not** cover Storage objects, while these PDFs carry a 7-year statutory retention; a periodic server-side copy to a second bucket/R2 remains the planned durable backup and must be in place before invoice volume becomes material.
- Caveats on that fallback: (a) **template logo bytes exist only in the bucket** — the settings snapshot stores the path and hash, not the image; re-upload the logo through the logo route (`POST /api/careon/facturatie/instellingen/logo?template=<id>`) before regenerating invoices, or the rebuilt PDFs render without it. (b) **A re-rendered PDF is never byte-identical to the lost original** (react-pdf stamps a CreationDate), so after a true bucket loss the herstel-route records a *new* `pdf_sha256` for the new object; integrity of the *content* rests on the frozen row snapshot, which is what the audit trail hashes. The stored `pdf_sha256` only proves an archived object unchanged — it cannot resurrect one. The herstel-route's metadata-only branch therefore never overwrites an existing hash.
- AI provider failure does not block the dashboard: set `CAREON_ASSISTANT_LIVE=0` and use deterministic answers.

## Required recovery assets

- Git history and a tagged/immutable release commit.
- The exact `package-lock.json` and CI-generated CycloneDX SBOM.
- Supabase managed backups or point-in-time recovery enabled for the production project.
- The `facturen` Storage bucket, or its backup copy once the periodic copy routine exists — including the template logo objects, which Supabase database backups never contain.
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
9. Facturatie: verify the `facturen` bucket exists and is private. Then (a) run the herstel-route on an invoice whose object still exists and confirm `pdf_sha256` is unchanged (metadata branch preserves the anchor), and (b) delete a test object, re-render via the herstel-route and confirm a new `pdf_sha256` is recorded and the download serves a valid `%PDF-` stream.
10. Record actual RTO, achieved RPO, release/database versions, row counts and every deviation.
11. Destroy the isolated restore environment after evidence has been retained.

## Production incident sequence

1. Freeze data-changing assistant concepts by setting `CAREON_ASSISTANT_LIVE=0`.
2. Preserve request IDs, deployment ID, database time and the affected operation IDs.
3. Roll the application back when the fault is code-only.
4. Restore the database only when integrity checks prove data corruption or loss; prefer forward repair for isolated rows.
5. Run liveness/readiness, deterministic CI gates and targeted browser smoke tests before reopening writes.
6. Document the incident and add a regression/fault-injection case before the next release.

The first real restore drill still requires an isolated paid branch/project and must be recorded by the operator; this repository cannot prove a managed-backup restore by itself.
