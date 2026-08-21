# Careon Pulse / YAAZ — Platform Gap Register

**Last updated:** 21 August 2026
**Status:** Active delivery register
**Authoritative architecture:** [`PLATFORM_BLUEPRINT.md`](./PLATFORM_BLUEPRINT.md)
**Live milestone status:** [`PROJECT_STATUS.md`](./PROJECT_STATUS.md)

This register preserves the product-readiness audit outside any single chat and turns it into a cross-session delivery backlog. It tracks the remaining distance between the current platform and the target: **employees can perform their normal work through Careon Pulse / YAAZ without navigating across disconnected systems**.

## Working rules

1. Every future implementation session reads the blueprint, project status and this register before changing platform behavior.
2. Confirmed blueprint decisions are not changed silently. A proposed change records its security, scope and operational consequences before implementation.
3. A gap becomes `Done` only after code/configuration, production deployment, role/security checks, failure-state checks and user-facing acceptance are evidenced.
4. Counts in the `Current reality` column are point-in-time observations and must be refreshed during acceptance.
5. Least privilege remains mandatory. Being present in a customer directory proves identity/eligibility; it does not automatically grant administrative roles or access to confidential modules.

Status legend: `Open` · `Proposed` · `In progress` · `Blocked externally` · `Done`

## Active goal

Close and track the Careon Pulse/YAAZ professional-platform gaps across sessions, beginning with secure Entra-driven employee onboarding and then resolving each documented product, rollout, Microsoft 365, EPD, navigation, mobile, meetings, branding, offboarding, source-control, backup and operational-readiness gap with verified production-ready changes.

## Gap inventory

| ID | Area | Current reality (21 Aug 2026) | Consequence | Target outcome | Priority | Status |
|---|---|---|---|---|---|---|
| G01 | Employee onboarding | Entra contains about 65 users, while TGC has 5 Careon memberships, 4 real YAAZ users and 1 employee with a delegated Graph connection. | This is not yet a company-wide rollout; account creation and access assignment do not scale. | Entra-gated, audited employee provisioning with safe default access, clear role ownership and reliable offboarding. | P0 | In progress |
| G02 | Outlook mail | YAAZ shows recent mail metadata only; opening a message leaves YAAZ and sending is disabled. | Employees still need Outlook for normal mail work. | A deliberately scoped mail experience, including read/detail/reply/send where privacy, consent and UX are accepted. | P1 | Open |
| G03 | Outlook calendar | Outlook events are a read-only overlay; create and edit are disabled. | Employees still need Outlook Calendar for scheduling work. | Create/edit/cancel and conflict-safe calendar behavior, or an explicitly accepted handoff boundary. | P1 | Open |
| G04 | Microsoft Teams | YAAZ lists joined teams and channels but has no channel messages, chat or meeting workflow; some links are placeholders. | Teams communication cannot be completed in the platform. | Real channel navigation and approved messaging/meeting surfaces using the minimum Graph permissions. | P1 | Open |
| G05 | SharePoint / shared documents | `All Company/Gedeelde documenten` is connected but empty; upload is off; Office files still open in Microsoft 365. | Shared-document work is discoverable but not operational in YAAZ. | Populate/govern the canonical library, enable accepted write actions, and make editing/handoff behavior coherent. | P1 | Open |
| G06 | EPD clinical work | Careon consumes five read-only exports; notes, dossiers, appointments and clinical transactions cannot be written back. | Clinical staff must still work in the EPD. | Define the safe integration boundary with the EPD vendor; add supported write/deep-link workflows without pretending Careon is the legal dossier. | P0 | Open |
| G07 | EPD data refresh | Production refresh is a weekly Windows browser/Task Scheduler automation. | A workstation/session dependency can make management data stale. | Vendor API or hardened centrally operated ingestion with alerts, ownership, retry and freshness SLA. | P0 | Open |
| G08 | Unified platform navigation | The module launcher opens a separate YAAZ product without persistent module/back navigation. | The experience feels like connected products rather than one workplace. | A consistent shell, global navigation, identity/session behavior and return path across modules. | P1 | Open |
| G09 | Mobile workplace | Native shell, push notifications, deep links and native app delivery do not exist. | Mobile staff do not have a complete or app-like workflow. | Ship the approved shell/PWA strategy with notifications, deep links, session safety and store/MDM deployment. | P1 | Open |
| G10 | Calls and meetings | JaaS calling, recording, transcription and meeting intelligence are not built. | Calls and meeting follow-up happen elsewhere. | Secure meeting lifecycle with consent, roles, retention, recordings and approved AI documentation. | P2 | Open |
| G11 | Organization structure | YAAZ has one company-wide Space, empty tasks and no real departmental/private-space model. | Collaboration lacks the structure and confidentiality of the actual company. | Mirror real teams/departments, owners, private spaces, task workflows and retention rules. | P1 | Open |
| G12 | Facturatie readiness | Company details and contacts are incomplete; drafts include anonymous test data; mail remains fail-closed. | The module is built but not ready for real invoice operations. | Enter and validate legal data, clean demo records, complete mail/DPA activation and run invoice acceptance. | P0 | Open |
| G13 | Production content/data | Five fictional people and seeded July demo posts remain in YAAZ. | Users may mistake demo material for company information; the launch feels unfinished. | Separate demo and production content, import approved real structure/content and label or remove fixtures. | P0 | Open |
| G14 | Brand and language | Temporary `sslip.io` host, HumHub footer/default guidance, missing YAAZ tile logo and mixed Dutch/English remain. | The platform does not yet present as a finished company product. | Real domain, complete white-label presentation, supplied assets and reviewed Dutch copy throughout. | P1 | Open |
| G15 | Offboarding/session revocation | Disabling an Entra account does not immediately revoke Supabase sessions or the YAAZ Graph connection; logout fan-out is incomplete. | A former employee may retain platform access until separate controls act. | Automated eligibility reconciliation, immediate Careon block/session revocation, Graph disconnect and evidenced SLA. | P0 | Open |
| G16 | Reproducible source and deployment | Both repositories are clean and equal to `origin/main`; the reviewed D20–D22 sources are deployed from commits `51bf605` (Careon) and `35d7124` (YAAZ/platform). | The former overwrite/reconstruction risk is closed; future production changes still require the same commit-first discipline. | Commit/review all intended changes, remove drift, pin versions/config and prove a clean-source deployment. | P0 | Done |
| G17 | Backups, monitoring and operations | No completed restore drill; R2/off-site YAAZ backups and secondary invoice-storage backup are incomplete; no final-domain external monitor; Entra secrets expire 16 Feb 2027. | Recovery and expiry incidents can become extended outages or data loss. | Tested restore runbooks, off-site backups, external monitoring/on-call ownership and scheduled secret rotation. | P0 | Open |

## G01 — Entra-driven employee onboarding

### Recommendation

Use a **split source-of-truth model**:

- **Microsoft Entra ID is authoritative for employee identity and platform eligibility.** With TGC's current licensing, TGC-IT assigns approved employees directly to app role `Careon.User`; after P1/P2 is licensed for the eligible workforce, a dedicated `Careon Pulse — Users` security group can replace the direct list.
- **Careon remains authoritative for organization membership details, Careon roles and module entitlements.** Directory membership never grants `org_admin`, superadmin, financial or clinical privileges automatically.
- **Normal employees do not need a Careon invitation or password.** Their first successful Microsoft login creates or links the Supabase identity and creates a default TGC `member` membership, but only if all eligibility checks pass.
- **A personal Microsoft 365/Graph data connection remains per-user.** Tenant-wide admin consent can remove the consent prompt, but delegated Outlook/Teams/SharePoint access still requires the employee to authenticate once; it must not be fabricated or impersonated in the background.

This is safer than treating all roughly 65 tenant directory objects as employees. A tenant can also contain guests, shared mailboxes, service identities, contractors and dormant accounts.

**Tenant prerequisite:** Microsoft documents group-based enterprise-application assignment as requiring Entra ID P1 or P2. Verify TGC's licensing before G01-A. If it is unavailable, retain the same safe JIT design but use direct app assignments as the interim eligibility list (or add the required licence); do not fall back to authorizing the entire tenant. See [Microsoft — manage users and groups assignment to an application](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal).

### Confirmed sign-in/provisioning flow (D22)

1. TGC-IT assigns an approved employee to app role `Careon.User` (directly under the current licence, later through `Careon Pulse — Users`); the enterprise application has **user assignment required** enabled.
2. The employee chooses **Inloggen met Microsoft**. Entra enforces the tenant's MFA and Conditional Access.
3. Supabase creates a new auth identity or automatically links the Azure identity to an existing user only when the verified e-mail matches.
4. The Careon callback validates, server-side, the Azure provider, exact configured tenant ID (`tid`), tenant-member claim (`acct=0`), verified-email claim (`xms_edov`) and normalized e-mail.
5. In one audited transaction, Careon creates the missing TGC membership as role `member`; it never promotes automatically.
6. The employee lands in the module launcher. Existing module entitlement rules determine visible modules.
7. On first YAAZ launch, the existing Careon OIDC flow provisions the regular YAAZ identity. The employee connects Microsoft 365 once when personal Graph data is needed.

### Directie employee-management experience

Add an admin-only **Microsoft medewerkers** view to Careon Directie, alongside the current membership manager. It should reconcile the configured Entra eligibility source—not indiscriminately import the entire tenant—and show at least:

| Field | Meaning |
|---|---|
| Entra status | Active/disabled and present/absent from the approved group |
| Careon status | Not started, active, blocked, role and module entitlements |
| YAAZ status | OIDC account provisioned or not yet opened |
| Microsoft 365 status | Personal Graph connection present, absent, expired or revoked |
| Last activity | Last Careon login and last successful reconciliation |
| Required action | Ready, first login pending, role review, disconnect or offboard |

For a read-only interactive directory view, Microsoft Graph's user/group APIs can be called with delegated administrator permissions. For a reliable background source of truth and offboarding, use a **separate provisioning connector/app (or SCIM if the chosen identity components support it)** rather than reusing either the identity-only D20 registration or the personal-data D21 registration. This preserves their intentionally separate failure domains and permissions.

### Delivery phases

| Phase | Scope | Result |
|---|---|---|
| G01-A | Curated app-role assignment source, tenant/verified-email validation, assignment-gated just-in-time `member` creation, audit event and tests. | New eligible employees need no Careon invite; first Microsoft login provisions safe default access. |
| G01-B | Admin-only Entra/Careon/YAAZ reconciliation page with status filters and explicit role/entitlement actions. | Management can see rollout coverage and resolve exceptions from Careon Directie. |
| G01-C | Scheduled/delta or SCIM-style reconciliation, disable/remove handling, Supabase session revocation and YAAZ Graph disconnect. | Entra eligibility changes reliably propagate to the full platform. |

### Security invariants

- Never authorize by e-mail domain alone.
- Require the configured tenant ID, `acct=0`, verified e-mail and approved app-role eligibility.
- Never infer Careon administrative roles from broad Entra directory roles.
- Do not expose Graph directory tokens to the browser or reuse the D21 personal-data token store.
- Keep current membership/session checks fail-closed during rollout.
- Log provisioning, group mismatch, role change, blocking, session revocation and Graph disconnect events.
- Retain break-glass/platform-admin access outside the customer tenant as established in D20.

### Blueprint decision

**Approved by the owner on 21 August 2026 and recorded as confirmed D22 in blueprint v2.4.** D22 amends D20's former administrator-only/no-JIT provisioning rule while leaving the hybrid login architecture and break-glass paths intact.

Accepted consequences of the proposed change would be:

- **Benefit:** no manual invitation/password lifecycle for ordinary TGC employees and a scalable path from about 5 memberships to the eligible workforce.
- **Security change:** Entra group administration becomes a production authorization dependency, so group owners, change auditing and emergency removal must be explicit.
- **Permissions/scope:** the eventual admin inventory and automated reconciliation require additional directory/group read capability in a separate least-privilege connector.
- **Licensing:** group-based enterprise-app assignment requires Entra ID P1 or P2; direct user assignment is the safe fallback if TGC does not have it.
- **Engineering:** atomic JIT provisioning, idempotency, concurrency tests, audit logs, reconciliation and offboarding work are required; a simple bulk import is insufficient.

### Acceptance criteria

- An eligible new TGC employee signs in with Microsoft and receives exactly one Supabase identity, one TGC `member` membership and one YAAZ identity without a Careon invitation.
- An unassigned same-tenant user, guest, wrong-tenant user and unverified/mismatched e-mail all fail closed and receive no membership.
- Existing password accounts link only on exact verified-e-mail equality; duplicates are not created.
- Concurrent first logins remain idempotent and cannot create duplicate membership or audit records.
- No provisioning path can create `org_admin`, superadmin or confidential module access automatically.
- Removing/disablement meets the agreed revocation SLA across Careon, Supabase sessions and YAAZ Graph tokens.
- The Directie view reconciles observed Entra eligibility with Careon/YAAZ state and exposes no directory data to ordinary members.
- Production evidence covers success, denial, linking, duplicate prevention, role isolation, offboarding and audit visibility.

## Cross-session update template

When work starts or finishes, update the relevant row and append concise evidence here:

```text
Date:
Gap / phase:
Status change:
Code/config deployed:
Verification evidence:
Remaining external action / owner:
Decision reference:
```

## Evidence log

- **21 Aug 2026 — register created:** consolidated the professional-readiness audit and recorded G01's group-gated JIT recommendation. No authentication behavior or confirmed blueprint decision was changed.
- **21 Aug 2026 — G01 approved and started:** owner approved the group/app-role-gated JIT design. Blueprint v2.4 records confirmed D22; G01-A implementation started fail-closed pending migration, Entra app-role assignment and verification.
- **21 Aug 2026 — G01-A database boundary installed dormant:** Supabase migration `20260821131342_entra_jit_membership` is registered in the live EU project. The RPC is `SECURITY DEFINER`, has an empty search path and grants execute only to `service_role`. A rollback-only live transaction proved one eligible tenant member creates exactly one `member` membership and one audit event, a repeat is idempotent, a guest (`acct=1`) creates nothing, and `authenticated` cannot execute the RPC. No JIT environment flag has been enabled.
- **21 Aug 2026 — G01-B application and cross-plane surface built:** an org-admin-only `/api/org/entra-members` route and Directie `Microsoft-medewerkers` panel reconcile the configured eligibility group with Careon identity/membership, YAAZ account/last login and personal Microsoft 365 connection presence. The Entra connector is separate from D20/D21, app-only, group-scoped, read-only and fail-closed. YAAZ `careon-m365` v0.3 exposes only a bounded OIDC/account status projection through a separate bearer-protected endpoint; it never selects provider tokens and degrades independently. Verification: Careon full CI green (998 product, 412 production, 145 assistant, 98 runtime-hardening and 34 queue checks), npm audit zero vulnerabilities, **130/130** browser tests; YAAZ **110/110** rollback checks plus live local 503-disabled, 401-wrong-bearer and 200-correct-bearer probes. The code is deployed on both planes but stays unavailable until its separate production configuration is deliberately activated. Module-entitlement columns and tenant activation remain.
- **21 Aug 2026 — Entra inventory and first activation step:** the existing dynamic security group `Alle gebruikers` contains 66 direct users and its rule is effectively “All Users”; it is therefore not an acceptable Careon eligibility source. After D22 approval, the enabled Users/Groups app role `Careon.User` was created successfully on the existing single-tenant `Careon Pulse — login` registration; this did not assign or grant access to any employee. Pending tenant actions are a dedicated curated group/direct assignment list, optional ID-token claim `acct`, assignment-required policy, explicit assignments and denied/success acceptance accounts.
- **21 Aug 2026 — G16 closed and G01 fail-closed production baseline deployed:** Careon commit `51bf605` and platform commits `c21da22` + LF portability fix `35d7124` are pushed; both working trees equal `origin/main`. Vercel's Git integration built `51bf605` as Ready/Production in 1m03s, with Microsoft login still enabled and all three new JIT/directory flags absent. YAAZ `careon-m365` 0.3.0 was deployed from the tracked archive after a verified backup at `/opt/platform-deploy/backups/code-20260821T134803Z-pre-c21da22.tar.gz`; host/runtime module manifests both hash to `d187521c491306a9133eec69eff7fae80889c62cad68221f7b63bc71b82e578a`, all containers are healthy, Graph read health is green with writes off, the normal module route redirects to login and `/microsoft-365/internal-directory` returns the intended disabled `503`.
- **21 Aug 2026 — TGC licensing and identity reconciliation:** live Entra inventory shows 46 Microsoft 365 Business Standard licences and 1 Business Premium licence. Microsoft requires Entra ID P1/P2 for group-based enterprise-app assignment, so using one group for the broader workforce is not licence-compliant today; direct app-role assignments are the approved D22 fallback. Exact comparison found Hicham, Wida and Zairo as matching Entra members, while `hassan@tgcgroep.nl` has no Entra object and retains Careon password access. Zairo already had `Default Access`; no new assignments have been submitted yet.
- **21 Aug 2026 — Directie connector adapted to current licensing:** the fail-closed read connector now accepts either the future group source or direct assignments to the one configured service principal/app-role. The direct mode reads `/servicePrincipals/{id}/appRoleAssignedTo` with application `Application.Read.All`, filters the exact role and resolves only assigned users through Graph batches capped at 20; `User.Read.All` supplies their status. Pagination is restricted to the exact configured Graph path, bearer-carrying requests reject redirects and no write methods exist. Full CI, production build and an isolated mocked token → assignments → batch test are green.
