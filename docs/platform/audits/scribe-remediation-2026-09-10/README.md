# Careon Scribe remediation evidence — 10 September 2026

The [phased remediation report](../../SCRIBE_REMEDIATION_2026-09-10.md) is the main deliverable. The separate
[original audit](../../SCRIBE_AUDIT_2026-09-10.md) remains the pre-fix baseline.

This bundle records local engineering verification of the combined working tree. It contains synthetic tests,
metadata-only dependency results and demo screenshots. It contains no patient data, live audio, production database
result or live provider response. The implementation is uncommitted; `source-sha256.txt` identifies the reviewed source
snapshot independently of HEAD. Deployment and real Supabase/PostgREST acceptance remain pending.

## Evidence

- `verify-ci-final.txt`: complete quality gate, including TypeScript, Biome, product/domain/provider/clinical/route/client
  regressions, privacy checks, other module checks and dependency audit. The hygiene gate enumerates indexed and
  nonignored untracked files (`git ls-files --cached --others --exclude-standard`); ignored outputs are excluded.
- `build-and-browser-final.txt`: isolated optimized build and the full Playwright suite. This run disables both AI
  live switches and Microsoft login, uses inert local Supabase configuration and keeps demo state browser-local.
- `epd-retry/analysis.md`, `error-context.md`, `trace.zip`: one full-run test assertion raced a successfully saved
  checkbox update. The exact test-only correction and original failed-attempt evidence are preserved.
  `epd-repeat-final.txt` records five subsequent successful repetitions with retries disabled against the unchanged build.
- `postgres-scribe.txt`: original-schema checks followed by the upgraded schema, with independent connections for
  races. `postgres-auth.txt`, `postgres-facturatie.txt`, `postgres-epd.txt` verify related boundaries with the same new
  migration in place. Every suite creates and removes its own synthetic database.
- `routes-scribe.txt`: shipped route handlers exercised with synthetic auth/storage adapters and no network.
- `clinical-verification.txt`, `clinical-domain-verification.txt`, `clinical-biome.txt`: focused clinical evidence.
- `dependency-audit.json`: the complete npm dependency audit after the lockfile update.
- `clinical.md`, `security.md`, `ui.md`: detailed workstream changes, coverage and limitations. The security record
  includes operator preflight queries; these were not executed against production.
- `final-cross-review.md`: independent final integration review plus closure of its additional findings.
- `source-sha256-before-final-build.txt`, `source-sha256.txt`, `source-verification.txt`: 105 source/configuration
  hashes before the final application build and after the documented test-only waiting correction, with the final
  matching-hash verification. Application/configuration source was unchanged across the build/browser gate.
- `visual/observations.md`: six final light/dark/mobile/desktop screenshots and their acceptance observations.
  `visual/results.json.txt` preserves the structured result; `visual/capture.cjs.txt` is the synthetic capture script,
  retained as text outside the application lint/test inventory. Its original output directory is `.next-e2e/scribe-fixes/visual`.
- `cross-review-probe.ts.txt`, `cross-review-probe.txt`: deliberately retained **pre-fix** counterexample for final
  report fabrication/malformed rows. Its unsafe output is historical evidence, not the final behavior. Current
  maintained regressions in `src/scripts/verify-scribe-clinical.ts` assert those cases are now rejected.

## Reproduction

Run application commands from the `careon-dashboard` repository root with installed lockfile dependencies:

```powershell
$env:CAREON_ASSISTANT_LIVE = "0"
$env:CAREON_SCRIBE_LIVE = "0"
npm run verify:ci
npm run test:e2e
```

`test:e2e` owns a fresh `.next-e2e/run-*` build directory. It restores its generated TypeScript include changes and
does not delete another server's `.next` output. The full browser suite is the final release gate.

For database checks, use a disposable **local** PostgreSQL instance; this capture used WSL localhost port 55439 and
local user `hassan`. Do not load application credentials or point these suites at production:

```sh
python3 src/scripts/verify-auth-postgres.py --port 55439 --user hassan
python3 src/scripts/verify-facturatie-postgres.py --port 55439 --user hassan
python3 src/scripts/verify-epd-postgres.py --port 55439 --user hassan
python3 src/scripts/verify-scribe-postgres.py --port 55439 --user hassan
```

The local harness excludes `0019_careon_access_token_hook.sql` because its Supabase-managed role is absent locally.
Actual Supabase claims/PostgREST, production drift, provider configuration/residency, clinician acceptance and physical
microphone/Safari/iOS behavior still require the controlled acceptance described in the main report.
