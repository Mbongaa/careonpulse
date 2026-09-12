# Module launcher presentation — 10 September 2026

Client-requested presentation change, verified locally against synthetic demo data.
Production has not been deployed or activated by this change.

Employees receive these five tiles in order: Careon Dashboard, YAAZ, Careon Academie/Academy,
Careon AI and Careon Kwaliteitshandboek. The final three are inert previews marked
"Binnenkort beschikbaar". Administrators also receive Facturatie. The shared server registry
continues to enforce its existing role predicate before returning tiles to web or mobile.

Careon AI replaces Careon Scribe in visible product copy. The stable `careon-scribe` ID,
`/scribe` route, database/API identifiers, historical stored consent and existing authorization
and activation conditions remain unchanged. Preview visibility grants no clinical access.

The Flutter launcher displays version-compatible previews while its existing launch resolver
continues to reject disabled modules, missing launch URLs and unavailable module IDs.

## Visual evidence

These captures show the **administrator/demo** view, including Facturatie. The employee
five-tile list is checked using an ordinary member session in `verify-mobile-shell.ts` and
the Flutter launcher tests. Both browser sizes have no horizontal overflow or page errors.

- [Desktop, light](./desktop-light.png)
- [Desktop, Careon dark theme](./desktop-careon.png)
- [Phone, light](./mobile-light.png)
- [Phone, Careon dark theme](./mobile-careon.png)

## Verification

- `npm run verify:ci`: passed, including the actual employee/admin registry assertions and all server gates;
  dependency audit reports zero vulnerabilities.
- `npm run test:e2e`: optimized build passed; 161 scenarios passed directly and one passed on retry,
  completing all 162 scenarios. The retry was the existing "annuleren wist handmatige concepten" assertion:
  its immediate browser-storage check still saw the draft on the first attempt and passed on retry.
  No application behavior or assertion was changed to address that observation.
- `flutter test --reporter expanded`: all 77 tests passed, including five employee tiles without Facturatie,
  preview taps/deep links/notification targets, no handoff for previews, compatible versions and explicit
  disabled accessibility semantics. Focused Dart analysis and formatting passed.
- Four screenshots inspected; no page errors or horizontal overflow at 1440×1000 and 390×844.

Local verification does not imply deployment. Existing installed native clients continue hiding previews
until the updated shell is released. Clinical/provider activation remains gated under D24/G20.
