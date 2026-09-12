# Careon AI release — 12 September 2026

## Requested behavior

The owner requested publication of all remaining Careon work, then explicitly superseded the
initial Coming soon requirement with an accessible Careon AI module for testing. The web tile opens
`/scribe` with a document navigation, preserving the microphone policy. Authentication, organization
membership, clinician permissions, module activation and provider controls remain in force. The
native-shell tile remains withheld until its existing microphone profile is accepted.

The invoice repair is already live. Its exact source remains included in this release; no financial
record is issued, altered or emailed by the release procedure.

## Local testing

Run `npm run dev:local` from `careon-dashboard/`, then open
`http://127.0.0.1:3000/modules`. Use the existing demo login `user1` / `demo1234`.
An alternative port can be selected with `npm run dev:local -- --port 3001`.

This command binds to loopback and overrides only the child process environment: synthetic browser
data, inert Supabase configuration and disabled external providers. It does not edit `.env.local`,
production settings or real invoices. The ordinary `npm run dev` retains the existing configured
backend and its normal permissions. Demo testing covers the UI/manual-transcript/report workflow;
it does not perform live transcription or establish clinical acceptance.

## Database scope and initial audit

Read-only production metadata confirms that the base `20260907120000_careon_scribe.sql` exists.
The following additive migrations require verified application/schema parity before central use:

- `20260910120000_scribe_audit_integrity.sql`
- `20260911180611_scribe_conversation_context.sql`
- `20260911182326_scribe_speaker_provenance.sql`
- `20260911183823_scribe_reviewed_english_drafts.sql`

The initial audit found zero sessions, segments, notes and explicit clinician grants. TGC's module,
transcription and AI settings were all off. Organization administrators can open the module and
settings under the existing role rules; creating central consults remains subject to module settings.
The existing service-only prune RPC is compatible. All four exact reviewed migrations were subsequently applied successfully, in the listed order,
through the Supabase migration tool. Organization/provider settings were not changed.

## Release contents and verification

The pending Scribe application, existing remediation, synthetic regressions, schema sources and
documentation are included with the active web tile and local testing command. The raw Playwright
trace archive remains local; its synthetic analysis and reviewed screenshots are versioned.
Private environment files, provider credentials, dependencies and build outputs remain excluded.

- Full isolated `npm run verify:ci` passes, with zero dependency vulnerabilities.
- The optimized release build and **169/169 browser tests** pass without retries, including invoice
  contact/archive/save ordering, the Careon AI workflow, accessibility and mobile layouts.
- Real disposable PostgreSQL 15.19 suites pass **247 authorization**, **26 invoice**, **37 EPD** and
  **732 Scribe** checks. Their synthetic databases and task-owned cluster were removed afterwards.
- Supabase reports a completed physical backup at **2026-09-12 02:45:46.612 UTC**; all eight listed
  backups are completed, WAL-G is on and PITR is off. This is completion metadata, not restore proof.
  Routine rollback retains the protective additive schema and forward-fixes application defects;
  a whole-database restore would also affect newer unrelated invoice/contact changes.
- Local in-app browser acceptance signed in through the real demo login, clicked the active Careon
  AI tile and reached the consult list with `Nieuw consult` enabled. No browser errors were reported.
- Fresh TGC settings audit found no saved settings revision: new central consult creation remains
  off until authentic activation details are supplied. Local synthetic testing is immediately usable.

Publication and live acceptance will be recorded after the verified source is pushed.
