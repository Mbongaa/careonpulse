# Facturatie readiness — 12 September 2026

Owner scope: prepare invoices and download/export their PDFs. Email activation is separate.

## Confirmed defects and repairs

- **Creating a contact:** the live contact form submits `id: ""`; POST incorrectly required the
  persisted-record validator before the database assigned an ID. This reproduced “Ongeldig contact”
  for the owner's requested name, TGC. Creation now validates the same bounded business fields
  without requiring server-owned ID/timestamp fields. The database generates the identity and the
  authenticated session supplies organization/creator. Editing and stored-record validation remain strict.
- **Duplicate submits:** the form disables its inputs during saving and guards repeated submit events;
  a failure preserves the entered values for retry. Email remains optional.
- **Final PDF:** centrally issued invoices now preview and download the private archived bytes. They
  no longer render a fresh client PDF whose fonts/logo/layout could differ from the original archive.
  An absent object offers regeneration even when an old `pdfPad` is present; load errors have retry.
- **Draft PDF:** rendering errors are visible and recoverable, and download waits for the current render.
- **Finalization:** autosave and issuance share a serialized save sequence. A failed/conflicting save
  prevents issuance. A pending save completes before newer edits are saved and a number is requested.

No authorization, immutable-invoice, mail activation or legal field checks were removed. No schema
migration is required. No real invoice is issued, credited or emailed by this verification.

## Production configuration audit

Read-only check on 12 September: TGC's latest sender settings, saved at 11:48 UTC, contain the required
name, full address, KvK, bank/account-holder and VAT fields. This supersedes G12's older seven-missing-fields
observation. It is a field-presence/format check, not external verification of the organization's details.
At audit time there were zero contacts, one draft and zero issued invoices; the Storage bucket was private.

## Verification and release boundary

The release is prepared from clean `d948236`, with invoice code/tests and the already prepared dependency
security fixes (Next 16.3.4, Sharp 0.35.4 and the corresponding lockfile). Unreleased Careon AI/Scribe
application code, migrations and activation changes are excluded.

- Full `verify:ci` passes on the isolated release candidate, including 21 invoice atomic scenarios,
  37 new contact route scenarios and zero reported dependency vulnerabilities.
- The contact suite executes actual POST/GET/PATCH handlers with intercepted I/O. Restoring only the
  original POST guard in memory makes the new TGC assertion fail with HTTP 400; the corrected route passes.
- Final isolated optimized build and all **16 invoice browser scenarios pass without retries**.
  Browser verification covers the existing demo lifecycle plus controlled central API responses for
  contact persistence/retry, exact archive bytes, absent-object recovery, failed/conflicting last saves
  and edits during an in-flight save. Central browser fixtures do not claim real Storage/DB issuance.
- Four synthetic [screenshots](./audits/facturatie-2026-09-12/) cover desktop dark and mobile light.
  The action bar stays below the fields and finalized PDF controls appear first on mobile.
- Actual server rendering with bundled Geist fonts produces a valid one-page, 46,986-byte synthetic
  PDF. Text extraction confirms F2026-0001 and the expected subtotal/VAT/total; visual inspection
  is clean. No network calls or live records are involved.
- Production publication and authenticated acceptance are recorded below after completion.

G12 remains In progress until the client's controlled real invoice lifecycle is accepted. Download-only
use does not require the separately gated mail provider. G17's off-site backup ownership remains separate.

## Production acceptance

- `845d105` was pushed to `main`; its committed tree exactly equals the isolated verified release.
  [Vercel deployment](https://vercel.com/hassans-projects-a393ace3/careonpulse/2La9Si6g99XBUU1oRTkC96JXxWQ3)
  reports success and the canonical site displays the new draft preview/actions.
- Authenticated Edge acceptance created the explicitly requested **TGC** organization contact with
  optional email blank. It returned without an error and remained present after a hard reload.
  No billing address was guessed or copied from an unrelated sender profile.
- Downloaded the owner's existing draft through the live **Pdf downloaden** button. The local download
  is 827,277 bytes with a valid PDF header/trailer. The browser connector's download event timed out,
  but the actual newly written file confirmed completion. No invoice content was changed or finalized.
- The existing draft requires recipient billing details and service-period dates before finalization;
  those inputs have been requested from the owner. This is distinct from the repaired contact defect.
- Remote database-regressions, quality (including build/SBOM) and CodeQL passed for this release.
  The full remote browser run passed 136 cases; the remaining demo-download assertion captured an
  automatic headless PDF iframe preview download. The test now waits for the action to be enabled
  and observes the explicitly named invoice download, retaining the strict filename assertion.
  Five consecutive local finalization/download runs pass with the corrected event selection;
  formatting passes.
- Final verification of follow-up `38218b8`: [CI](https://github.com/Mbongaa/careonpulse/actions/runs/34698226132)
  passes database regressions, quality/build/SBOM and **137/137 browser checks**, with no retries
  or failures. The numbered demo-invoice download passes in 3.0 seconds.
  [CodeQL](https://github.com/Mbongaa/careonpulse/actions/runs/34698226112) and
  [Vercel](https://vercel.com/hassans-projects-a393ace3/careonpulse/DPovaqg4yNyAoX8L1gQjt2DoiMw3)
  also succeed. This follow-up changes only the download-event test and acceptance documentation;
  the deployed application implementation is unchanged from `845d105`.
