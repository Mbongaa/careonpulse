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
| G01 | Employee onboarding | Production Directie reconciles all 66 Entra identities and separately marks the 3 users assigned to `Careon.User`; eligible Microsoft login and existing-account linking are accepted, but a new employee's first-account creation is still outstanding because all 3 eligible users already existed in Careon. | The scalable identity path exists, but the broader workforce is not yet eligible or accepted for rollout. | Entra-gated, audited employee provisioning with safe default access, clear role ownership and reliable offboarding. | P0 | In progress |
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
| G15 | Offboarding/session revocation | The fail-closed hourly reconciler, Careon ban boundary and YAAZ account/Graph disconnect endpoint are deployed; the first scheduled snapshot and a controlled real-user offboarding acceptance remain. | Until live acceptance is complete, the cross-plane offboarding SLA is implemented but not operationally proven. | Automated eligibility reconciliation, immediate Careon block/session revocation, Graph disconnect and evidenced SLA. | P0 | In progress |
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

Careon Directie now includes an admin-only **Microsoft medewerkers** view alongside the current membership manager. It reads the complete Entra identity inventory for management visibility, while treating the configured `Careon.User` app-role assignment as a separate authorization fact. Seeing an identity in the inventory never grants access. Guests, disabled accounts and unassigned users remain visible but fail closed for Careon login. The view reconciles:

| Field | Meaning |
|---|---|
| Entra status | Member/guest, active/disabled and licensed/unlicensed |
| Careon eligibility | Assigned/unassigned to the exact `Careon.User` app role |
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
| G01-B | Admin-only full Entra inventory with Careon eligibility, Careon/YAAZ reconciliation and status filters; explicit assignment/entitlement writes remain a later least-privilege operator action. | Management can see every Office identity and distinguish directory presence from authorization in Careon Directie. |
| G01-C | Scheduled/delta or SCIM-style reconciliation, disable/remove handling, Supabase session revocation and YAAZ Graph disconnect. | Entra eligibility changes reliably propagate to the full platform. |

### Security invariants

- Never authorize by e-mail domain alone.
- Require the configured tenant ID, `acct=0`, verified e-mail and approved app-role eligibility.
- Never infer Careon administrative roles from broad Entra directory roles.
- Do not expose Graph directory tokens to the browser or reuse the D21 personal-data token store.
- Keep current membership/session checks fail-closed during rollout.
- Log provisioning, eligibility mismatch, role change, Careon blocking and Graph disconnect events.
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
- **21 Aug 2026 — Entra login eligibility activated:** the optional ID-token claims `acct`, `email` and `xms_edov` are configured on `Careon Pulse — login`; enterprise-application assignment is required. Hicham, Wida and Zairo are now directly assigned to the exact `Careon.User` role, replacing Zairo's former `Default Access`. This authorizes only Microsoft sign-in/JIT eligibility and never grants a Careon administrator role.
- **21 Aug 2026 — full Office identity inventory connected:** the dedicated app-only registration `Careon Pulse — directory` (`a79ef35f-a757-4b2b-a26f-759be195f560`) has only the application permissions `User.Read.All` and `Application.Read.All`, both tenant-admin consented. A live client-credentials probe returned all 66 Entra users and exactly 3 `Careon.User` assignments. Directie now maps the complete inventory and displays account, licence and Careon-eligibility state separately; its access token and client secret remain server-only.
- **21 Aug 2026 — G01-C/G15 lifecycle boundary installed:** live migration `20260821141805_entra_lifecycle_reconciliation` adds a force-RLS, service-role-only lifecycle ledger and two bounded reconciliation/finalization RPCs. Disabled/guest identities become immediate candidates; role removal or deletion requires two consecutive complete snapshots; organization/platform administrators are exempt. Rollback-only live verification proved the threshold, candidate creation, audit finalization and denial to authenticated clients. Careon bans are rechecked on every server request; an already-issued JWT is not described as cryptographically revoked before expiry.
- **21 Aug 2026 — YAAZ lifecycle 0.4.0 deployed safely:** the separate bearer-protected lifecycle endpoint can disable/reactivate the exact Careon OIDC subject and transactionally delete its encrypted personal Microsoft connection. Production is healthy with Graph reads green and writes off; a non-mutating unknown-subject probe returned `not_found`. A pre-change backup is retained at `/opt/platform-deploy/backups/code-20260821-pre-m365-0.4.0.tar.gz`, and authoritative host/runtime module trees match hash `38c745d0304b3238d51ab5658abb927ba923a341f3332daa80a69427e2766112`. The rollout detected a stale local production dotenv, restored the authoritative server copy before continuing, and added merge/parity tools to prevent recurrence.
- **21 Aug 2026 — activation gates green before Careon release:** Supabase and Vercel production configuration now contain the separate JIT, directory and lifecycle settings without reusing the personal Graph connector. Careon validation is green at **998/998** product, **412/412** production, **145/145** assistant, **102/102** runtime-hardening and **34/34** queue checks; npm audit reports zero vulnerabilities and the Next.js 16.2.11 production build succeeds. Remaining G01 acceptance is a live Careon deployment, Directie inventory inspection and one real eligible employee's first Microsoft login; controlled real-user offboarding remains G15 acceptance.
- **21 Aug 2026 — G01 production inventory and Microsoft login accepted:** Careon commit `4063f4d` and platform commit `334835a` are on `origin/main`; Vercel built `4063f4d` Ready/Production in 49 seconds. Live checks return liveness `200`, Microsoft OAuth `303` to the exact Supabase/Azure path and unauthenticated reconciliation `401`. As Zairo, a real logout → Microsoft sign-in → module-launcher flow passed; the existing `org_admin` membership was preserved and never replaced by the JIT default. The live Directie view shows 66 Microsoft identities, 3 eligible, 3 active Careon matches, 0 eligible first logins pending, 7 guests and 7 disabled accounts. Because Hicham, Wida and Zairo all pre-existed in Careon, production creation of a brand-new `member` remains an explicit acceptance item even though the transactional JIT creation path is rollback-tested.
