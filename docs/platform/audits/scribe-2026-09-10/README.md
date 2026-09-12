# Careon Scribe audit evidence — 10 September 2026

The [consolidated report](../../SCRIBE_AUDIT_2026-09-10.md) is the main deliverable. This bundle contains synthetic probes, captured outputs and demo screenshots. It contains no secrets, patient data, live audio or provider response from a real consultation.

Probe source is retained with `.txt` suffixes to keep audit artifacts outside the application's source/lint/test inventory. Run from the `careon-dashboard` root. Node accepts these files as entry scripts; the scripts use installed repository dependencies.

```powershell
node docs/platform/audits/scribe-2026-09-10/clinical/clinical-probes.cjs.txt
node docs/platform/audits/scribe-2026-09-10/ui/recorder-lifecycle.cjs.txt
node docs/platform/audits/scribe-2026-09-10/ui/draft-lifecycle.cjs.txt
node docs/platform/audits/scribe-2026-09-10/provider-probes.cjs.txt
```

The clinical harness intercepts every fetch before importing application code. Its process-only synthetic credentials/flags exercise the AI acceptance path with four mocked responses, without reaching an external service. Successful probe execution means the counterexamples ran, not that the software passed.

Browser reproductions require an **already running inert demo server** at `http://localhost:3299`. The audit's build/server environment used `CAREON_DEMO_MODE=1`, `CAREON_ASSISTANT_LIVE=0`, `CAREON_SCRIBE_LIVE=0`, `CAREON_MICROSOFT_LOGIN_ENABLED=0`, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-inert-anon-key`, an empty `SUPABASE_SERVICE_ROLE_KEY`, and isolated `NEXT_DIST_DIR=.next-e2e/audit-20260910`. Do not point the browser harness at a production environment. Running it again overwrites only the synthetic browser results/screenshots beside the script.

```powershell
node docs/platform/audits/scribe-2026-09-10/ui/browser-reproductions.cjs.txt
```

The PostgreSQL probe uses the repository's disposable database helper, targets localhost port 55439 as local user `hassan`, and takes `--repo` as the Linux path to `careon-dashboard`. It needs an existing local PostgreSQL instance and creates/removes a randomly named synthetic database; it does not load application environment files. The baseline suite is `src/scripts/verify-scribe-postgres.py --port 55439 --user hassan`. Results record that the disposable databases were removed. This is local migration behavior, not deployed Supabase catalog parity.

## Captured evidence

- [Initial CI gate](ci-initial.txt), [independent checks and dependency audit](individual-checks.txt), [isolated build and full browser suite](build-and-browser.txt).
- [Clinical counterexamples](clinical/clinical-probes-results.jsonl.txt).
- [Provider request/configuration probes](provider-probes-output.txt), [probe source](provider-probes.cjs.txt).
- [Baseline PostgreSQL suite](security/baseline-postgres-results.txt), [targeted SQL results](security/targeted-postgres-results.txt), [SQL probe source](security/targeted-postgres-probes.py).
- [Browser results](ui/browser-output.json.txt), [recorder results](ui/recorder-output.txt), [draft callback results](ui/draft-output.txt).
- [Multi-item EPD partial import](ui/multi-item-epd-partial.png), [logout residue context](ui/logout-with-draft-residue.png), [cancelled consult context](ui/cancelled-consult-draft-residue.png), [pending-input loss](ui/typing-during-submit-lost.png). Storage values are demonstrated by the JSON output; screenshots show the related UI state.
- [Audited source SHA-256 manifest](source-sha256.txt).

No production or application fixes were made by these probes.
