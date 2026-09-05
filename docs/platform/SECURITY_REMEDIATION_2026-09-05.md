# Security remediation — 5 September 2026

**Current deployment status:** the owner subsequently approved release and the three production migrations. Dashboard/database and YAAZ server changes are now deployed; shell source is pushed with green Android and unsigned iOS CI. The [release verification ledger](./RELEASE_VERIFICATION_2026-09-05.md) is authoritative for current revisions, latest totals, production browser evidence and remaining acceptance. The detailed sections below retain the initial remediation-phase evidence and its then-undeployed state.

**Follow-up verification and release preparation.** The owner subsequently authorized pushing and deploying these changes. Independent verification found and fixed additional F01/F04 framework integration gaps: SSO is mandatory and its authorization handler precedes ordinary HumHub request handlers. Actual pinned HumHub/Yii tests now supplement the doubles. Further F09/F11 tests close delayed camera/video callbacks, overlapping incoming/outgoing calls, cancellation during native initialization and declined confirmation leaving the web UI busy. Latest totals are **44 identity + 121 session + 26 real-framework checks**, **22 web calling tests**, **5 isolated Chromium calling checks**, and **72 Flutter tests** with clean analysis. Native calling remains disabled.

The hands-on local page walkthrough also reproduced two display defects: receivables ageing percentages contradicted the unchanged €96,400 total / €21,300 older-than-90-days amount, and expired BIG registrations disappeared from alerts. The chart now derives the supported 77.9% / 22.1% split; alerts and assistant responses retain explicitly labelled expired registrations. Thirteen regression checks increase the product suite to **1018**. The original validation ledger below remains the initial remediation record; final deployment and browser acceptance are recorded separately in the platform status/gap documents.

This report records the authorized remediation of F01, F02, F03, F04, F05, F06, F08, F09, F10, F11, F12, F13 and F14 across the dashboard, deployment repository and Flutter shell. Its initial evidence describes the pre-release working tree. **The initial engineering phase made no production changes; the subsequently authorized deployment is recorded in the release ledger linked above.** No production business transaction or feature activation was used to manufacture regression evidence.

**CLOSED** means the engineering defect has a fix and relevant passing local behavioral evidence. It does not mean production acceptance, release, device acceptance or an unrelated platform gap is complete. **PARTIALLY CLOSED** identifies remaining implementation acceptance evidence. Counts below are suite totals, shared by several findings; they must not be added once per finding.

## Scope and evidence boundaries

The canonical workspace is `C:/Users/HP/Desktop/Erbil project/ZSG dashoard`. File paths below are relative to the named repository beneath that root:

| Repository label | Absolute root |
|---|---|
| Dashboard | `C:/Users/HP/Desktop/Erbil project/ZSG dashoard/careon-dashboard` |
| Platform | `C:/Users/HP/Desktop/Erbil project/ZSG dashoard/platform-deploy` |
| Shell | `C:/Users/HP/Desktop/Erbil project/ZSG dashoard/careonpulse-shell` |

Existing modifications were preserved, including the dashboard package files, platform status/gap documents, TGC export documentation, synchronization/verifier work and the existing untracked declaration-history module. This report does not attribute those baseline changes wholesale to this remediation. No commit, push or deployment was performed by the remediation work.

PostgreSQL tests used PostgreSQL 15.19 in a disposable, loopback-only local cluster and synthetic accounts, organizations, invoices and EPD records. Each runner created and removed its own randomly named database; the cluster was stopped after final verification. They never loaded application `.env` files or contacted Supabase. Minimal Supabase schemas/roles were emulated by `Dashboard/src/scripts/lib/local_postgres.py`; relevant real repository migrations were applied. This is actual SQL/RLS/transaction execution, but not a substitute for deployment-environment compatibility and migration-drift checks against Supabase PostgreSQL 17.

The native-calling flag remains disabled. JaaS/Jitsi fallback, recording/AI, backup activation, mail activation and other disabled capabilities were not enabled. No authorization scope or confirmed platform decision was silently broadened.

## Findings and initial remediation evidence

| Finding | Engineering status | Initial local evidence | State at end of initial engineering phase |
|---|---|---|---|
| F01 — stale HumHub identity after account switch | CLOSED | PHP session/identity and Flutter cleanup regressions | Not deployed |
| F02 — banned/deleted account retains direct database authorization | CLOSED | 207 PostgreSQL checks, including old behavior reproduction | Not deployed |
| F03 — organization admin controls shared global identity | CLOSED | 11 route behavioral checks | Not deployed |
| F04 — HumHub authorization survives role change indefinitely | CLOSED | PHP lease, demotion and fail-closed request regressions | Not deployed |
| F05 — concurrent full credits and interrupted issuance | CLOSED | 26 PostgreSQL and 14 invoice route checks; concurrent requests and injected rollback | Not deployed |
| F06 — invoice snapshot races issuance | CLOSED | Same billing suites; stale revision and complete snapshot checks | Not deployed |
| F08 — native message contract and iOS expiry mismatch | PARTIALLY CLOSED | Web/Flutter contract tests and Android compilation; new iOS tests unrun | Not deployed |
| F09 — asynchronous native work revives closed session | PARTIALLY CLOSED | Flutter lifecycle regressions and Android compilation; iOS/device acceptance pending | Not deployed |
| F10 — failed hangup loses the live call handle | CLOSED | Web call lifecycle regressions | Not deployed |
| F11 — duplicate asynchronous call-agent initialization | CLOSED | Web initialization/teardown interleaving regressions | Not deployed |
| F12 — mixed EPD generations during publication and reads | CLOSED | 37 PostgreSQL + 19 manifest/publisher/client/cache checks | Not deployed |
| F13 — PDF regression fixture violates current metadata constraint | CLOSED | Old invalid write rejected; replacement valid write accepted locally | Not deployed; live suite intentionally unrun |
| F14 — platform documents contradict implemented boundaries | CLOSED | Source/document reconciliation; D1–D23 decision rows unchanged against Git HEAD | Not deployed; documentation-only work |

### F01 — stale HumHub identity after account switch

**Root cause and files.** `Platform/humhub/modules-custom/careon-sso/Events.php` could route an already authenticated HumHub user away from the external-login entry before a new hub identity was established. `controllers/MobileController.php` also reused the logged-in local account. Consequently, signing out of hub account A and entering through hub account B could retain HumHub A. Shell sign-out did not consistently clear the embedded module's independent browser session.

**Solution.** Explicit web/mobile entry starts a fresh hub OIDC flow after clearing the local account, including direct entry and extra/reordered query parameters. Only an ordinary GET with nonempty scalar state and exactly one code/error reaches the callback guard; malformed, AJAX and POST external-auth requests fail with 400 before the core handler. The callback retains exact-subject identity binding; it is not treated as a fresh entry. `services/LoginTarget.php` preserves bounded one-time return navigation, including guest mobile/reauth entry. The shell adds `lib/auth/module_session_cleaner.dart`, calls it from `lib/state/shell_controller.dart` before sign-in/account replacement and during sign-out, and disposes the module screen. Embedded cookies, local storage and cache are cleared without clearing the system browser's separate SSO session.

**Regression and result.** The real PHP event/client/controller paths execute against offline Yii/HumHub doubles in `tests/verify-session.php`; the existing identity suite is `tests/verify.php`. Shell `test/module_session_cleanup_test.dart` proves cleanup ordering and failure behavior. Commands are PHP-SSO and SHELL in the validation ledger. PHP totals are **44/44 identity predicates + 89/89 actual-hook behavioral checks**, including strengthened entry/callback classification. All **15 PHP files** pass syntax checks. Flutter has **68** passing tests.

**Limitations/status.** Engineering CLOSED; not deployed. Real HumHub browser cookies and the controlled A → logout → B → YAAZ acceptance flow have not been exercised against the running provider during this work. That remains a release acceptance check.

### F02 — banned/deleted account retains direct database authorization

**Root cause and files.** Earlier helpers in the dashboard migrations authorized a retained `auth.uid()` through membership, platform-admin or owner policies without consulting current `auth.users.banned_until`/`deleted_at`. Application session checks did not protect direct PostgREST requests with an otherwise valid token. Owner-only profile/chat policies were a separate route around membership-only corrections.

**Solution.** `Dashboard/supabase/migrations/20260905135733_active_account_rls.sql` adds `app.is_active_user()`, updates membership/platform/financial/billing predicates and installs a restrictive active-account policy on existing exposed RLS tables. Existing tenant, ownership and financial predicates continue to apply. New generation tables carry the same active-account restriction. Service jobs retain their explicit service-role boundary.

**Regression and result.** `Dashboard/src/scripts/verify-auth-postgres.py` reproduces the old retained-token defect before applying the corrective migration, then checks active, banned, soft-deleted, physically deleted and expired-ban users; members/admins/platform admins; tenant isolation; owner-only profiles/chats; views; anonymous denial and explicit service behavior. DB-AUTH passes **207/207** real PostgreSQL checks. It applies the available migration set except unrelated `0019` token-hook owner configuration, which requires a Supabase-specific owner role.

**Limitations/status.** Engineering CLOSED; not deployed. This denies subsequent database statements for inactive accounts. It does not invalidate bytes already delivered to a client or claim retroactive cancellation of an already running statement. Future exposed tables must retain the active-account policy; actual Supabase schema drift remains a rollout check.

### F03 — organization admin controls shared global identity

**Root cause and files.** `Dashboard/src/app/api/org/members/route.ts` scoped the target membership to the caller's organization, but then used global Auth operations for password reset, recovery/invite links and ban/unban. A user can belong to multiple organizations, so one organization's administrator could change credentials or availability for all memberships. A membership-count check would also race a new membership. Provisioning rollback could globally delete an identity linked elsewhere meanwhile.

**Solution.** The PATCH route rejects non-platform administrators before privileged I/O for all global identity actions. Ordinary organization provisioning does not return a global recovery credential or globally delete the identity on membership-insert failure. Platform-authorized administration retains existing target membership and protected-platform-user checks. `canManageIdentity` is exposed by the GET route and consumed by `src/app/(main)/dashboard/beheer/_components/beheer-content.tsx`, `member-actions.tsx`, `member-create-form.tsx` and `src/app/(main)/dashboard/middelen/_components/middelen-medewerkers-card.tsx` so the UI reflects the server boundary.

**Regression and result.** `Dashboard/src/scripts/verify-org-identity-boundary.mjs` executes the actual route with external I/O stubbed. IDENTITY passes **11** checks: all four actions fail before I/O in either tenant context, provisioning yields no recovery token, failed membership creation does not delete a shared identity, and platform-authorized administration still works.

**Limitations/status.** Engineering CLOSED; not deployed. Global password/account administration is now a platform responsibility. A failed non-platform provisioning membership insertion can leave an identity requiring platform cleanup; it is reported rather than deleting a potentially shared account.

### F04 — HumHub authorization survives role change indefinitely

**Root cause and files.** `Platform/humhub/modules-custom/careon-sso/authclient/CareonClient.php` synchronized the hub role at OIDC login while the local HumHub session could continue much longer. The last-local-admin safeguard also needed to deny the session when a requested demotion could not be applied.

**Solution.** `services/AuthorizationLease.php` issues a server-side lease after successful identity and administrator-group synchronization, bound to the local user and exactly one Careon subject. It expires after at most **300 seconds**, capped by verified token expiry; ordinary requests cannot extend it. `Events.php` gates protected requests: expired/missing lease causes fresh OIDC on normal GET and 401 on POST/AJAX without replaying writes. Failed synchronization and last-admin demotion deny the session. `services/BreakGlassPolicy.php` permits only explicitly configured, unlinked local recovery administrators. `.env.example` and `compose.yml` carry the configuration boundary; production configuration was not changed.

**Regression and result.** PHP-SSO covers exact expiry, no extension, subject mismatch, missing leases, role demotion, POST/AJAX denial, last-admin rejection and explicit recovery-account conditions in the actual request/client path. Both PHP suites pass **44 + 89** checks, with all **15 PHP files** syntax-clean.

**Limitations/status.** Engineering CLOSED; not deployed. Role-change exposure is bounded by the remaining lease, up to 300 seconds, rather than claimed instantaneous revocation. Before rollout, verify an independent unlinked local recovery administrator and `CAREON_SSO_BREAK_GLASS_USER_IDS`; otherwise a last-admin demotion correctly fails closed without providing an operational recovery route. Provider/browser acceptance remains unrun.

### F05 — concurrent full credits and interrupted issuance

**Root cause and files.** The credit route separately inserted a credit concept, issued it and marked the original credited. Concurrent requests could each create a full credit, and a failure between steps could leave an issued credit without the original status update.

**Solution.** The atomic invoice migration described in F06 locks the shared original before deciding whether a full credit already exists. It validates mirrored source identity/amount fields and issues the new credit plus original-status change in one transaction. A unique partial index enforces one issued full credit per original. Repeated/concurrent requests return the existing credit, including a response-loss retry with no current template/snapshot. The ordinary issuance branch rejects credit rows, preventing a manually created credit concept from bypassing the original lock. `Dashboard/src/app/api/careon/facturatie/facturen/[factuurId]/credit/route.ts` uses this helper and archives only a newly issued credit.

**Regression and result.** DB-INVOICE injects failure after credit issuance but before the original update, proving rollback of the credit, number and original status. Two real concurrent requests return one credit and consume one number. The unique index rejects a second issued full credit; authenticated calls and direct service calls to the old allocator are denied. Actual service-role execution of the replacement RPC succeeds. INVOICE-ROUTES checks concurrent/retry behavior. Shared totals remain **26 + 14** passing checks.

**Limitations/status.** Engineering CLOSED; not deployed. Existing duplicate issued full credits intentionally block creation of the unique index. They require reviewed reconciliation before rollout; this migration does not rewrite or delete historical issued documents. This is a full-credit invariant, not a newly introduced partial-credit product flow.

### F06 — invoice snapshot races issuance

**Root cause and files.** The definitive-invoice route previously read and validated a draft, patched prepared content separately, and then invoked a numbering/status RPC. A concurrent autosave could interleave, allowing the issued document and stored totals/snapshot to diverge from what was validated.

**Solution.** `Dashboard/supabase/migrations/20260905135739_invoice_atomic_issuance.sql` adds a database-incremented revision and a service-only atomic issuance RPC. It locks the invoice, checks the expected revision and stores the complete whitelisted prepared snapshot together with numbering/status in one transaction. A caller cannot hide an edit by preserving `updated_at` or submitting its own revision. `src/lib/careon-facturatie/uitreiking.server.ts` makes one RPC call; `facturatie.server.ts` reads the revision. The definitive route validates the draft and computes totals before this atomic call. The old allocator is revoked from API roles and remains an internal implementation detail.

**Regression and result.** DB-INVOICE executes a real autosave/issuance interleaving while the row is locked: stale issuance fails with 40001, preserves the edited concept and consumes no number. It also proves two simultaneous issue calls return the same issued document and consume one number. INVOICE-ROUTES executes actual route/helper code, validates the complete snapshot/totals and proves no intermediate REST mutation. Shared billing totals: **26 PostgreSQL checks and 14 route checks**, all passing.

**Limitations/status.** Engineering CLOSED; not deployed. An expected-revision conflict returns 409 so the user must refresh. PDF generation/storage happens after the committed invoice transaction and retains the existing missing-PDF recovery path; it is not claimed to be transactionally coupled to PostgreSQL. Roll out the migration and calling routes together because the migration revokes the old externally callable allocator.

### F08 — native message contract and iOS expiry mismatch

**Root cause and files.** The web native-call producer emitted `remoteMicrosoftUserIds` alongside a native-v1 contract whose Dart parser accepts an exact singular `remoteMicrosoftUserId` shape. Native initialization therefore failed contract validation. The Swift coordinator's date parser also rejected fractional-second expiry timestamps emitted by Dart.

**Solution.** `Platform/humhub/modules-custom/careon-m365/call-client/src/native-contract.js` constructs the exact native-v1 payload, consumed by `src/call.js` and the rebuilt `resources/js/m365-call.js`. A shared fixture exists in the web test tree and `Shell/test/fixtures/native-v1.json`. Native-v1 explicitly rejects multiple recipients while the web path retains group recipients. `Shell/ios/Runner/TeamsCallingCoordinator.swift` accepts valid ISO-8601 expiry with and without fractional seconds; its expiry bounds remain enforced. Contract documentation is updated in `Shell/docs/WEBVIEW_CONTRACT.md` and `docs/TEAMS_CALLING.md`.

**Regression and result.** WEB-CALL passes **15/15** tests; SHELL passes **68/68** with no analyzer issues; ANDROID compiles. `Shell/test/native_web_contract_test.dart` exercises the producer fixture and exact parser boundary. `ios/RunnerTests/RunnerTests.swift` contains new expiry regression cases in the existing Xcode test target/build phase, but they have not been executed here.

**Limitations/status.** PARTIALLY CLOSED; not deployed. New iOS XCTest execution and real iOS/Android Microsoft/ACS device acceptance remain required. Native calling stays disabled. Historical iOS compilation is not evidence that these newly edited Swift tests passed.

### F09 — asynchronous native work revives closed session

**Root cause and files.** A Dart confirmation/initialization continuation could resume after the bridge was closed. Native start/accept callbacks could return a live call after its page/session had already been replaced or disposed.

**Solution.** `Shell/lib/teams/native_teams_call_bridge.dart` gives closure a terminal state and checks generation after asynchronous boundaries. Reset/close invalidate pending work; event emission is restricted to the current session. `method_channel_teams_calling_launcher.dart` and `lib/screens/module_webview_screen.dart` tie resource cleanup to navigation/disposal. Android `TeamsCallingCoordinator.kt` and iOS `TeamsCallingCoordinator.swift` reject stale callbacks and hang up a late returned call instead of retaining it. Account exit disposes the module alongside F01's session cleanup.

**Regression and result.** `Shell/test/native_teams_call_bridge_test.dart` exercises confirmation completion and initialization after close/reset plus stale events. SHELL passes **68/68** and analysis; ANDROID compiles. The web lifecycle suite separately covers analogous late work during page teardown.

**Limitations/status.** PARTIALLY CLOSED; not deployed. New native asynchronous paths still require iOS compilation/XCTest and real Android/iOS call start, accept, navigation, logout and delayed callback/device acceptance. Compilation and fake launchers do not prove device SDK behavior. Native calling remains disabled.

### F10 — failed hangup loses the live call handle

**Root cause and files.** `Platform/humhub/modules-custom/careon-m365/call-client/src/call.js` cleaned up the active call in a `finally` path even if the SDK rejected hangup. The UI could lose ownership and retry controls while the call remained active.

**Solution.** Failed hangup retains the active handle and exposes retry. Cleanup follows the authoritative disconnected state or successful lifecycle completion. Events from an older handle cannot clear a newer current call. The distributed `resources/js/m365-call.js` bundle was rebuilt from source.

**Regression and result.** `call-client/test/call-lifecycle.test.cjs` runs the production call client with controlled SDK/DOM doubles, including rejected hangup followed by retry and disconnect. WEB-CALL passes **15/15** tests; bundle generation is available as WEB-BUILD.

**Limitations/status.** Engineering CLOSED; not deployed. Real microphone/camera/Teams media acceptance is not included in the local test result and remains part of the existing ACS release matrix.

### F11 — duplicate asynchronous call-agent initialization

**Root cause and files.** `Platform/humhub/modules-custom/careon-m365/call-client/src/call.js` guarded on the completed agent rather than the in-flight initialization. Overlapping entry points could both obtain tokens and create agents; late initialization could outlive page teardown.

**Solution.** A shared initialization promise makes overlapping callers await one operation. Generation/closed checks invalidate its continuations; pagehide aborts outstanding token requests and disposes late resources. Late accepted calls are hung up, and late work cannot attach itself to a replaced session. The shipped browser bundle is regenerated.

**Regression and result.** WEB-CALL uses deferred promises to interleave automatic and user-triggered initialization and teardown, checking that only one agent is created and late resources are disposed. **15/15** shared lifecycle tests pass.

**Limitations/status.** Engineering CLOSED; not deployed. This closes the local lifecycle ownership race; real-provider resource/media behavior still needs the existing controlled ACS acceptance run.

### F12 — mixed EPD generations during publication and reads

**Root cause and files.** `Dashboard/src/scripts/push-production.ts` previously published production, agenda, referrers, surcharges and declarations through separate writes. Readers selected their latest slices separately, and independent client cache writes could also preserve a mixed set. A partial sync, concurrent publisher or read interleaving could therefore combine different generations.

**Solution.** `src/lib/careon-production/epd-generation.ts` completes five exclusive file copies before atomically switching a manifest containing generation identity, source time and content hashes; a same-name retry cannot overwrite the preceding generation. The push script validates the complete manifest and all five files before publishing. `supabase/migrations/20260905135745_epd_atomic_generations.sql` adds the generation marker with five foreign keys and one service-only publication transaction. Tenant serialization plus expected-generation checking rejects concurrent stale publication; same-id/hash replay is idempotent. A single invoker read RPC returns one MVCC snapshot while preserving tenant and finance RLS. Legacy individual writes and appends to published run records are blocked after adoption; other manual organizations retain their existing path. The snapshot route/helper, `remote.client.ts`, `epd-snapshot.ts`, `storage.client.ts` and `careon-provider.tsx` consume/validate/store a complete bundle, with one localStorage commit and a financial-role marker. Invalid generated bundles cannot fall back to potentially mixed individual slices. Production/auxiliary cleanup, logout and owner changes clear the generated cache, and session replacement cancels late remote adoption.

**Regression and result.** `src/scripts/verify-epd-postgres.py` passes **37** actual PostgreSQL checks: injected failure at each slice/record/marker rolls everything back; two publishers on the same expected generation have exactly one winner; identical retry adds nothing; changed-payload and older-source attempts fail; a reader sees the previous complete generation while a writer is paused and the new complete generation after commit. Member financial redaction, cross-tenant/banned denial, service-only publishing and managed-versus-manual insert policies pass. An actual authenticated append to a published run is denied and its snapshot remains unchanged; a new manual run plus record in the other tenant still succeeds. `node src/scripts/verify-epd-client-atomicity.mjs` passes **19/19** offline behavioral checks against the actual manifest, push entry point, client and provider. It proves one RPC write with stable replay body, safe failed/successful manifest transitions, one read/state/cache transition, previous-generation preservation on quota or malformed-response failure, exact generated-bundle validation, cleanup and cancelled late adoption. Full TypeScript checking and scoped Biome checks on eight files pass.

**Limitations/status.** Engineering CLOSED; not deployed. Existing organizations have no published marker until their first complete new-generation push. Install the database, publisher and reader changes as a coordinated release; do not infer that old exports have a valid manifest or publish production data as part of this remediation report. Local client tests use synthetic files, storage and external-I/O doubles; the database behavior is independently verified by the real PostgreSQL suite. G19 remains In progress for the undeployed release and controlled acceptance.

### F13 — PDF regression fixture violates current metadata constraint

**Root cause and files.** `Dashboard/src/scripts/e2e-facturatie-live.ts` tried to preserve a non-null hash while nulling `pdf_pad` and `pdf_bytes`, conflicting with the current all-or-none archive metadata constraint (which also includes `pdf_gegenereerd_op`). The fixture ignored the PATCH response and could proceed without having established the state the test claimed to exercise.

**Solution.** The hash-preservation fixture now changes only the hash while retaining all four metadata fields. All three relevant metadata fixture PATCHes assert successful writes before continuing. Issuance/credit repeat expectations also reflect the new idempotent responses.

**Regression and result.** DB-INVOICE proves the old partial-metadata write fails with 23514 and the replacement wrong-hash-but-complete-metadata write succeeds and persists. These are included in the **26** passing SQL checks; they validate the real constraint, not source-text inclusion.

**Limitations/status.** Engineering CLOSED; not deployed. `npm run verify:facturatie:live` was intentionally **not run** because it exercises external Auth, database, Storage and invoice lifecycle operations. This report does not claim live PDF download, re-render, storage or mail acceptance.

### F14 — platform documents contradict implemented boundaries

**Root cause and files.** Umbrella text and local guidance retained contradictions about identity scopes, planned-versus-existing repositories, Coolify topology versus the accepted direct-Compose deployment, calendar-only versus active capability-specific Microsoft writes, and iOS compilation history. Readers could mistake stale architectural statements for the current security boundary or infer acceptance from historical compilation.

**Solution.** The coordinator reconciled `Dashboard/docs/platform/PLATFORM_BLUEPRINT.md`, `PROJECT_STATUS.md`, `PLATFORM_GAP_REGISTER.md`, `docs/TGC_EXPORT_AUTOMATION.md` and the workspace-root `AGENTS.md` with current source, accepted decisions and this report. Current guidance distinguishes ordinary signed user JWTs/RLS and exact-client server boundaries from assumed custom scopes; records the existing repositories and accepted direct-Compose/TLS operating path; describes independently active Microsoft capabilities; and separates historical iOS compilation from the newly edited unrun XCTest/device acceptance. G19 explicitly keeps production release and controlled acceptance In progress.

**Regression/result.** The coordinator compared current documentation with the verified source/behavior and Git HEAD: confirmed decision rows D1–D23 remain byte-for-byte unchanged. Targeted searches verified removal of the stale current-state identity-scope, calendar-only, iOS-pending and topology claims; historical dated acceptance remains distinguishable. The actual `Platform/compose.tls.yml` exists and matches the recorded direct-TLS Compose path. This is a source/document reconciliation, not a newly invented test that merely mirrors prose. Reproduction uses `git show HEAD:docs/platform/PLATFORM_BLUEPRINT.md`, the current file/diff and the behavioral commands in this report.

**Limitations/status.** Engineering CLOSED; no deployment performed. Documentation reconciliation does not enable a feature, change live topology or amend a confirmed decision. G19 remains In progress until the coordinated release and acceptance evidence are recorded.

## Validation ledger

Run each command from the named repository. `python3`/`php` refer to the local WSL runtimes used during this work, not a production container. The three database runners accept only an explicit loopback test port and create their own synthetic database; the reported run used user `hassan`, port `55439`. The helper never reads application credentials.

| ID | Repository and command | Observed result |
|---|---|---|
| DB-AUTH | Dashboard: `python3 src/scripts/verify-auth-postgres.py --port 55439 --user hassan` | 207/207; synthetic DB removed |
| DB-INVOICE | Dashboard: `python3 src/scripts/verify-facturatie-postgres.py --port 55439 --user hassan` | 26 passed; synthetic DB removed |
| DB-EPD | Dashboard: `python3 src/scripts/verify-epd-postgres.py --port 55439 --user hassan` | 37 passed; synthetic DB removed |
| INVOICE-ROUTES | Dashboard: `npm run verify:facturatie-atomic` | 14 passed |
| IDENTITY | Dashboard: `npm run verify:identity` | 11 passed |
| PHP-SSO | Platform: `CAREON_SSO_SELF_TEST=1 php humhub/modules-custom/careon-sso/tests/verify.php` and same command for `verify-session.php`; `php -l` on all module PHP files | 44/44 predicates + 89/89 real-hook behavior; 15 files syntax-clean |
| WEB-CALL | Platform, `humhub/modules-custom/careon-m365/call-client`: `npm test` | 15/15 passed |
| WEB-BUILD | Same call-client directory: `npm run build` | Browser bundle regenerated by owning agent |
| SHELL | Shell: `flutter test --no-pub`; `flutter analyze --no-pub` | 68/68 passed; no analyzer issues |
| ANDROID | Shell/android: `./gradlew --offline :app:compileDebugKotlin` | Compilation succeeded |
| IOS | Shell: new `ios/RunnerTests/RunnerTests.swift` plus edited coordinator | XCTest/current iOS build/device tests not run in this environment |
| RUNTIME | Dashboard: `npm run verify:runtime` | 106 passed |
| TYPES | Dashboard: `tsc --noEmit --incremental false -p tsconfig.typecheck.json` | Passed, including final client/provider changes |
| FORMAT | Dashboard Biome and scoped source-tree `git diff --check` | 413 dashboard files clean; source-tree diff checks passed, excluding existing generated ACS third-party template whitespace |
| EPD-CLIENT | Dashboard: `node src/scripts/verify-epd-client-atomicity.mjs` | 19/19 passed; actual manifest/publisher/client/provider with offline synthetic data |
| FULL-CHECK | Dashboard: `npm run verify:ci` | Passed after final edits, exit 0: Biome 413 files clean; typecheck passed; Careon 1005; production 423; assistant 145; runtime 106; mobile 70; storage 64; queue 122; identity 11; invoice routes 14; EPD client 19; synthetic TGC passed; hygiene 580 tracked files; audit 0 vulnerabilities. |
| BUILD | Dashboard: `npm run build` under the isolated `test:e2e` environment | Passed: 17.6 s compilation, 11.3 s types, 109 routes |
| BROWSER | Dashboard: `npm run test:e2e` | Passed, exit 0: 130/130 Playwright tests in 2.7 minutes against the isolated local demo build |
| LIVE-INVOICE | Dashboard: `npm run verify:facturatie:live` | Intentionally unrun |
| LIVE-PROVIDERS | Supabase/HumHub/Microsoft/ACS and production acceptance | Not run; no deployment performed |

The new database regressions are wired into `Dashboard/.github/workflows/ci.yml` using a disposable PostgreSQL service. `Dashboard/package.json` adds the identity, atomic invoice and atomic EPD checks to `verify:ci`; `src/scripts/verify-runtime-hardening.ts` reconciles existing checks with the new paths. Source-level runtime checks supplement the behavioral suites; they are not the evidence for race prevention or transaction rollback. `Platform/scripts/verify-sso.sh` contains the two PHP suites plus its existing running-HumHub checks, but that container/production script was not used as a substitute for local offline tests here. `Platform/.github/workflows/m365-module-ci.yml` also runs the call-client tests/build and checks generated-bundle drift. The SSO registration in `humhub/modules-custom/careon-sso/config.php` and its new `README.md` document and wire the request lease. Ban comments in both dashboard identity-administration routes now describe the database gate.

## Rollout sequence and acceptance boundaries

The coordinated deployment and preflight steps below were subsequently completed as recorded in the release ledger. Controlled account-switch, role-demotion, invoice/EPD transaction and native-device acceptance remain separately tracked; a prepared rollout step is not evidence that its live acceptance was exercised.

1. Review the exact working-tree changes against the preserved dirty baseline and the completed local gates above, then produce the intended release artifacts. Passing this report's local tests does not authorize an unreviewed production operation.
2. Establish a concrete recovery route before the HumHub lease release. A separately verified unlinked local administrator with explicit `CAREON_SSO_BREAK_GLASS_USER_IDS` is one option; this release instead used a verified backup and retained-source SSH rollback, preserving the existing empty allowlist. Existing sessions without a lease need fresh OIDC on their next protected request. A local-password check is not a confirmed architecture requirement.
3. Preflight the actual database migration state and existing issued full credits. The new unique index cannot install while duplicate issued full credits exist. Stop rollout and reconcile such records under an approved accounting process; do not delete or rewrite issued documents to force the migration through. Historical schema drift and Supabase PostgreSQL 17 compatibility also require verification.
4. Coordinate the database/application cutover. Apply the corrective migrations in order: `20260905135733_active_account_rls.sql`, `20260905135739_invoice_atomic_issuance.sql`, `20260905135745_epd_atomic_generations.sql`. The invoice migration revokes the old allocator, so use a controlled write cutover with the matching routes; an old route must not remain the active writer after revocation.
5. Release the complete EPD writer/manifest/reader/client set before resuming scheduled generation publication. The first authorized publication must have all five verified files and a complete manifest. Once an organization has a generation, individual-slice writes correctly fail. Do not roll back only the new reader or only the publication policy and reintroduce mixed generations; prefer a reviewed forward correction.
6. Release the HumHub PHP changes and rebuilt web calling bundle together with their exact configuration prerequisites. Run isolated account-switch, bounded-role-change, failed-hangup/retry and initialization/teardown acceptance. Do not infer production behavior from the local doubles alone.
7. Run macOS/iOS build and XCTest plus controlled Android/iOS device acceptance for F08/F09. Keep the native feature disabled until the existing release matrix is accepted. No fallback, recording/AI, mail or backup flag is enabled by this sequence.
8. After an explicitly authorized deployment, record actual versions, migration evidence and controlled acceptance separately in the platform status/gap documents. Only then change a deployment-status cell from **Not deployed**. Retain the distinction between engineering closure, deployment and product acceptance.
