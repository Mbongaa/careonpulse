# Careon Pulse ↔ CareCheck integration boundary

**Status:** implemented read/deep-link boundary; vendor contract pending

**System of record:** CareCheck at `https://tgc.zsg.nl`

**Careon role:** management information, signals and safe navigation — not the legal clinical dossier

## Current production boundary

Careon imports five deliberately minimized, read-only CareCheck exports:

1. client/care-process data;
2. agenda appointments;
3. referrers;
4. declared surcharges;
5. declaration totals.

The client export also contains `Ga naar dossier`. Careon treats that value as
untrusted input and retains it only for these exact HTTPS route shapes on the
TGC CareCheck origin:

- `/dossier/zpm/<opaque-id>/<opaque-id>`;
- `/dossier/uninsured/<opaque-id>`.

Credentials, query strings, fragments, unknown paths, non-HTTPS schemes and
every other host are discarded during import. The UI applies the same policy
again before rendering a link. A valid link opens CareCheck in a separate
browser context; authentication, authorization and dossier visibility remain
CareCheck's responsibility.

## Authority model

| Concern | Authoritative system | Careon behavior |
|---|---|---|
| Clinical notes, treatment plans and signatures | CareCheck | Never stores or writes them through the export boundary |
| Appointment transaction | CareCheck until a supported write API is contracted | Reads the minimized export; does not automate portal forms |
| Management KPIs and signals | Careon, derived from versioned imports | Shows provenance and import freshness |
| Employee identity | Microsoft Entra + Careon membership/entitlements | Does not infer CareCheck clinical access from a Careon role |
| Dossier access | CareCheck ACL/session | Opens only an allowlisted deep link; no embedded session or token transfer |
| Audit trail for clinical changes | CareCheck | Careon must not claim a clinical write succeeded without vendor acknowledgement |

## Non-negotiable safety rules

- Do not frame CareCheck, copy its browser cookies or pass Careon/Supabase
  tokens to it.
- Do not perform clinical writes with Playwright, a browser extension, DOM
  automation or other screen scraping. Portal markup is not a transactional
  API and cannot provide a reliable audit, concurrency or authorization
  contract.
- Do not give a background service broader clinical access than the initiating
  employee.
- Do not store free-text dossier content, BSN, contact details or CareCheck
  credentials merely to make the dashboard feel integrated.
- Keep every future read/write permission separate and fail closed. A deep link
  is not evidence that an API write is allowed.
- CareCheck remains the legal dossier unless the controller, vendor contract
  and compliance assessment explicitly establish a different boundary.

## Vendor-supported path to deeper integration

Before Careon adds clinical reads or writes, TGC IT/vendor must provide a
written contract for all applicable items below:

1. **Stable deep links:** documented route shapes, identifier lifetime, SSO
   behavior and permitted return URL.
2. **Authentication:** supported OIDC or SAML SSO and/or an OAuth service/API
   client; tenant, audience, scopes, token lifetime and revocation behavior.
3. **Authorization:** per-user delegated access or an equally auditable
   treatment-relationship model. A broad shared portal account is not
   acceptable.
4. **API surface:** documented REST/FHIR endpoints for clients, appointments,
   dossier notes, plans and signatures, including which operations are read or
   write.
5. **Transaction safety:** immutable vendor record ID, idempotency keys,
   ETag/version conflict handling and authoritative success/error responses.
6. **Audit:** attribution to the initiating employee, timestamp, before/after
   or event record, correlation ID and an exportable audit trail.
7. **Change delivery:** webhooks or a delta cursor, retry rules, ordering and
   deletion/offboarding behavior.
8. **Operations and compliance:** sandbox, rate limits, SLA/support, processing
   agreement, subprocessor/region details, retention and incident procedure.

## Staged delivery and acceptance

| Stage | Capability | Activation gate |
|---|---|---|
| A — current | Minimized exports + exact TGC dossier links | Implemented and regression-tested |
| B | Vendor-supported SSO/deep-link contract | Contract, employee access-isolation test and logout/offboarding test |
| C | Read API/delta sync | Field-level minimization, RLS, freshness/retry monitoring and reconciliation |
| D | Narrow write workflow, for example appointment mutation | Explicit scope approval, per-user attribution, conflict/idempotency tests and vendor audit evidence |
| E | Any dossier-note/treatment-plan write | Separate clinical, privacy and legal approval plus signed end-to-end acceptance |

Every stage must remain useful when the next stage is unavailable. Failure of
Careon must never block access to the authoritative CareCheck application, and
failure of CareCheck must never be presented as a successful clinical change in
Careon.

## Current external action

TGC IT/vendor must return the items in the vendor checklist and identify an
acceptance tenant/user. Until then, the professional boundary is analytics and
signals in Careon with a tightly validated handoff to the exact CareCheck
dossier—not unsupported clinical write automation.
