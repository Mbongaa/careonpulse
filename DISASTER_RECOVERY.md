# Disaster recovery

## Targets

- Application rollback objective: 15 minutes by promoting the previous immutable deployment.
- Database recovery-time objective (RTO): 4 hours.
- Database recovery-point objective (RPO): 24 hours, or the lower point-in-time window provided by the active Supabase plan.
- Storage bucket `facturen` (invoice PDFs + template logos, handoff 15) recovery-point objective (RPO): the last issuance — objects are written only when an invoice is made definitive, so a bucket loss can cost every PDF written since the last copy, never a row. Recovery-time objective (RTO): 8 hours, because the fallback is regeneration rather than restore: PDFs are rebuildable from the frozen row snapshots (`POST /api/careon/facturatie/facturen/<id>/pdf`, integrity via `pdf_sha256` on the row). Supabase DB backups/PITR do **not** cover Storage objects, while these PDFs carry a 7-year statutory retention. The repository now contains a fail-closed inventory/integrity/snapshot boundary; a scheduled encrypted copy to a client-owned second bucket/R2 still has to be activated before invoice volume becomes material.
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

## Facturatie Storage backup boundary

The private `facturen` bucket is independent of the managed Postgres backup. Migration
`20260822234500_facturatie_storage_backup_boundary.sql` enforces complete PDF archive metadata (path, SHA-256,
byte count and generation time), organization-scoped paths, a 25 MB object ceiling, a PDF/PNG MIME allowlist and a
private bucket. There are no browser/client Storage policies; the application and recovery tooling use the service role
only after their own authorization boundary.

Run the credential-free corruption/path-escape matrix in CI:

```powershell
npm run verify:facturatie-storage
```

Run the production-safe, no-write inventory and byte-integrity check from an approved operator machine whose ignored
`.env.local` contains the production URL and service-role credential:

```powershell
npm run backup:facturatie-storage -- --verify
```

The command reads only archive metadata from Postgres, recursively inventories the private bucket, downloads every
object server-side and requires exact path/count/size/SHA-256/signature/MIME agreement. It writes and logs no customer,
invoice or settings content. Missing, unexpected/orphaned, cross-organization, malformed or corrupt objects fail the
run. On 22 August 2026 the production acceptance returned
`FACTURATIE_STORAGE_VERIFY=OK objects=0 bytes=0 bucket=private`, matching the known-empty administration.

A local recovery snapshot is possible only at a new absolute path outside the repository. It is plaintext and therefore
must be placed on an already approved encrypted/private volume; the one-run acknowledgement is deliberately not an
`.env.example` setting:

```powershell
$env:CAREON_FACTURATIE_BACKUP_ALLOW_PLAINTEXT = "1"
npm run backup:facturatie-storage -- --snapshot "D:\approved-encrypted-backups\facturatie-20260822"
Remove-Item Env:CAREON_FACTURATIE_BACKUP_ALLOW_PLAINTEXT
```

The snapshot refuses overwrite, uses private directory/file modes where the operating system supports them, publishes
only after every object verifies, and contains `manifest.json`, its SHA-256 sidecar and the exact object tree. The
manifest is metadata-only; the object tree contains confidential invoice bytes. The command does not upload externally,
delete Storage objects or invoke restore.

### Encrypted secondary-copy boundary

The separate off-site command is build-ready and deliberately dormant until TGC supplies the operator-only variables
documented in `.env.example`. It uses a **separate client-owned R2 bucket/token** for D19; it does not silently reuse the
D8 recording/HumHub backup bucket. The endpoint is fixed to Cloudflare's EU jurisdiction. Logical object paths and file
bytes are encrypted client-side with AES-256-GCM before upload; opaque per-run HMAC object keys prevent invoice paths or
organization IDs from appearing in R2 keys. The logical manifest is encrypted too. The completion marker contains only
the backup timestamp, key ID, object count, opaque keys, encrypted byte counts and encrypted SHA-256 values.

Run an encrypted upload only from the approved backup operator after the source verifier passes:

```powershell
npm run backup:facturatie-storage -- --verify
npm run backup:facturatie-storage:offsite -- --upload
```

Every upload uses conditional no-overwrite writes and publishes `complete.json` last. A failed partial prefix is never
eligible for verification or restore. The R2 token needs only prefix-scoped Put/Get/List/Head capabilities; the tooling
has no delete command. Configure a seven-year lifecycle for completed invoice backups in line with the statutory
retention, and review incomplete prefixes operationally rather than granting the backup writer deletion rights.

The recurring, decrypt-key-free health command checks the newest completion marker, age, every remote byte count,
SHA-256 metadata and run/kind binding:

```powershell
npm run backup:facturatie-storage:offsite -- --verify
```

With no client configuration it returns `FACTURATIE_STORAGE_OFFSITE=DISABLED required=0`; after activation set
`CAREON_FACTURATIE_BACKUP_OFFSITE_REQUIRED=1` so missing, partial, stale or corrupt state fails closed. The encryption
key itself must be held outside R2 in the approved secret manager; keep every historical key while its key ID remains in
retained backups.

After TGC has accepted the bucket/token, key custody and one manual non-empty upload, install the daily Windows task from
the approved always-on operator account (time is configurable):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-facturatie-storage-backup-task.ps1 -At "02:30"
```

The hidden limited-user task uses a named mutex, refuses overlapping runs, retries three times and records only the
already-redacted command output in `logs/facturatie-storage-backup.log`. Its runner invokes the encrypted `--upload`
path, which performs source and remote verification before success. The current installer deliberately uses the
interactive operator identity so Windows never stores or prompts for an account password; that account must therefore
remain signed in on an always-on managed host. Moving this task to a centrally owned service host remains preferable and
is still part of G17 acceptance.

With `CAREON_FACTURATIE_BACKUP_MONITOR_ENABLED=1` on both the operator and Vercel, each run publishes only
healthy/failed, a fixed failure code and database timestamps through a service-only RPC. Vercel derives
healthy/stale/failed/unknown using the configured maximum age and atomically adds incident/recovery transitions to the
same durable operations outbox used by the TGC worker. Bucket names, object paths/counts, invoice fields, backup keys and
credentials never enter the status table, audit detail or Teams body. Set `..._REQUIRED=1` only after the first
status/age/offline/recovery acceptance. Teams delivery itself remains disabled until TGC names the exact channel and a
service-principal or redundant TGC IT owner.

Cloudflare references: [EU jurisdiction endpoint and residency](https://developers.cloudflare.com/r2/reference/data-location/)
and [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

Fetching is non-destructive: it verifies the exact completion index, decrypts and revalidates every original
path/size/MIME/signature/SHA-256, then publishes a new local snapshot only on an approved encrypted volume. It never
writes into Supabase and refuses overwrite or repository destinations:

```powershell
$env:CAREON_FACTURATIE_BACKUP_ALLOW_PLAINTEXT = "1"
npm run backup:facturatie-storage:offsite -- --fetch 20260822-120000 "D:\approved-encrypted-recovery\facturatie-20260822"
Remove-Item Env:CAREON_FACTURATIE_BACKUP_ALLOW_PLAINTEXT
```

Until the client-owned destination, schedule and isolated non-empty fetch/restore acceptance are active, this remains a
tested fail-closed recovery boundary—not proof that the Storage RPO is met.

## Quarterly restore drill

1. Create an isolated Supabase branch or disposable project; never restore into production.
2. Restore the selected backup or point in time.
3. Apply pending migrations in order.
4. Verify all application tables have RLS enabled and no grants for `anon` or `authenticated`.
5. Verify `careon_consume_assistant_quota` accepts requests up to its threshold and rejects the next request atomically.
6. Verify the latest complete import contains `total_rows` records and that the latest means/HR revisions are readable.
7. Start the matching immutable application build against the restored database.
8. Require 200 from `/api/health/live` and `/api/health/ready`, then run `npm run verify:assistant:live` in the isolated environment.
9. Facturatie: run `npm run backup:facturatie-storage -- --verify` against the isolated restored project and require exact manifest/row/object agreement. Then (a) run the herstel-route on an invoice whose object still exists and confirm `pdf_sha256` is unchanged (metadata branch preserves the anchor), and (b) delete a test object, re-render via the herstel-route and confirm a new `pdf_sha256` is recorded and the download serves a valid `%PDF-` stream. Never perform the deletion branch in production.
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
