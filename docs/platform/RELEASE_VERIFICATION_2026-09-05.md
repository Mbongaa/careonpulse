# Release verification — 5 September 2026

**Dashboard/database and YAAZ are deployed; shell source is pushed with green Android/iOS build CI.** The owner explicitly authorized pushing, waiting for deployment and verification, then approved the production migrations. The authenticated production walkthrough passed the main pages and all 46 KPI detail routes. Its malformed-invoice URL check identified one additional error-classification defect, which was fixed, deployed and verified by repeating the exact browser failure case.

This document records release evidence separately from engineering remediation. Finding-specific root causes, changes, behavioral regressions and remaining acceptance requirements are in [Security remediation — 5 September 2026](SECURITY_REMEDIATION_2026-09-05.md). That report retains historical pre-release statements and initial test totals; the newer release facts and latest totals below take precedence for deployment status. Passing compilation, local doubles or an isolated browser suite does not establish real-provider or device acceptance.

## Release state

| Component | Exact release/evidence | Current state |
|---|---|---|
| Dashboard security and consistency changes | `d4408de5ade3f8c640743f613f6927b7ab7814c5` — `fix(security): enforce account boundaries and atomic invoice and EPD workflows` | Committed and pushed |
| Dashboard browser regression follow-up | `af02437eab10e4e7f1a2aa8d6f6e58cdf17e0ae4` — `test(hr): cover expired registrations in browser alerts` | Committed and pushed |
| Vercel dashboard deployment | Commit `af02437`; deployment `9KiCiE6hzw3bHp9q7kZFTFNqyVpa` | **Success**, recorded by release coordinator |
| Final invoice URL correction | `44361649679a14567b86bc6cdd5c8492d216225a`; Vercel `GAFX9SfRRVq84vUnSixPm7FUqxDq` | **Deployed successfully; exact production browser recheck passed** |
| Production Supabase corrective migrations | Three approved migrations; ledger versions `20260905180058`, `20260905180110`, `20260905180119` | **Applied successfully**, recorded by release coordinator |
| Production database postchecks | 30/30 public tables have restrictive active-account policies; security advisor: 0 findings | **Passed** |
| Dashboard GitHub CI | [Run 33982759883](https://github.com/Mbongaa/careonpulse/actions/runs/33982759883), exact `af02437` | **Database, quality and 130 browser tests passed** |
| Dashboard CodeQL | [Run 33982759877](https://github.com/Mbongaa/careonpulse/actions/runs/33982759877), exact `af02437` | **Passed** |
| Final corrective commit CI | [CI 33984207314](https://github.com/Mbongaa/careonpulse/actions/runs/33984207314), [CodeQL 33984207450](https://github.com/Mbongaa/careonpulse/actions/runs/33984207450), exact `4436164` | **All passed**: database, quality, 130 browser tests in 3.7 minutes and CodeQL; 21 invoice-route checks; audit 0 vulnerabilities |
| Authenticated production dashboard | Microsoft Edge walkthrough of all main pages, 46 KPI details, filtering/pagination, admin denial and missing-context routes | **Passed**, including final malformed-invoice correction |
| Flutter shell | [`c5fdee595d2e2bd76de5e45eea4d9c6574a4f810`](https://github.com/Mbongaa/careonpulse-shell/commit/c5fdee595d2e2bd76de5e45eea4d9c6574a4f810) — `fix(shell): isolate module sessions and cancel stale native calls` | Pushed to existing `origin/main`; shell worktree clean |
| Shell GitHub Actions | [Mobile shell verification, run 33981768499](https://github.com/Mbongaa/careonpulse-shell/actions/runs/33981768499) | **Both jobs completed successfully** |
| Platform/HumHub deployment | `2acf26f19570389e13dcb8e6edbfcca3c738f231`: SSO 1.4.0, M365 0.17.1 | **Deployed**, exact source/runtime and served-bundle parity verified |
| Platform CI repair | `f1343c763533fe70b726e5c308e5baa32dc88ab4`: pin official Calendar 1.8.16 artifact and SHA-256 | Pushed; application modules identical to deployed `2acf26f` |
| Platform CI | [Microsoft 33983541505](https://github.com/Mbongaa/platform-deploy/actions/runs/33983541505), [Space governance 33983541504](https://github.com/Mbongaa/platform-deploy/actions/runs/33983541504) | **Both passed** with Calendar 1.8.16 |
| App stores / native calling activation | No submission, signing-account request or feature activation | Not performed |

The release coordinator observed the Vercel, migration and browser results; the platform and shell release owners independently verified their source parity, CI and deployed checks. No production account, patient, invoice or credential values are reproduced here.

## Database release evidence

The approved corrective source migrations are:

1. [`20260905135733_active_account_rls.sql`](../../supabase/migrations/20260905135733_active_account_rls.sql) — current-account authorization for exposed RLS paths.
2. [`20260905135739_invoice_atomic_issuance.sql`](../../supabase/migrations/20260905135739_invoice_atomic_issuance.sql) — atomic issuance/credit boundaries and revision checks.
3. [`20260905135745_epd_atomic_generations.sql`](../../supabase/migrations/20260905135745_epd_atomic_generations.sql) — complete EPD publication and one-snapshot reads.

The coordinator recorded successful live application and the three ledger versions listed above. Subsequent production checks confirmed restrictive active-account policies on **30/30 public tables**, service-only new write RPC access and revocation of the old allocator. The invoker reader retains tenant/finance authorization. The invoice revision trigger, unique partial credit index, five managed-slice insert policies and frozen-record protection are installed. Invoice/settings/counter/generation-marker counts remained **0 and unchanged** during verification. The Supabase security advisor reported **0 findings**. A missing-identity read returned an empty snapshot.

These checks establish the recorded deployed schema/access boundaries. They do not claim issuance of a real invoice, a production credit, an EPD generation publication, or a Microsoft/ACS transaction. The controlled first complete EPD publication and applicable business acceptance remain distinct from installing its schema.

## Latest local verification

Counts are suite totals and must not be added repeatedly for individual findings. Commands run from the named repository; test providers and data boundaries are described below and in the remediation report.

| Area | Command / evidence | Latest observed result |
|---|---|---|
| Dashboard product checks | `npm run verify:careon` | **1018 passed**, including the receivables-ageing and expired-registration follow-up regressions |
| Dashboard full verification | `npm run verify:ci` | Local constituent checks passed; restricted-network audit rerun separately. Exact-commit GitHub quality job subsequently passed the complete command. |
| Dependency audit | `npm run audit:production` | **0 vulnerabilities**, both network-enabled local rerun and GitHub CI |
| Dashboard isolated browser suite | Local `node node_modules/@playwright/test/cli.js test` after isolated build; CI `npm run test:e2e` | Local **130/130 in 3.1 minutes**; exact-commit CI **130/130 in 4.0 minutes** |
| Production data core | `npm run verify:production` | Local **423 passed**; CI **369 passed** in its synthetic-only scope |
| Assistant | `npm run verify:assistant` | **145 passed** |
| Runtime boundaries | `npm run verify:runtime` | **106 passed** |
| Dashboard mobile contracts | `npm run verify:mobile` | **70 passed** |
| Facturatie storage | `npm run verify:facturatie-storage` | **64 passed** |
| Synchronization queue | `npm run verify:tgc-queue` | **122 passed** |
| Synthetic TGC synchronization | `npm run verify:tgc-sync` | Passed; retained existing declaration-history work |
| Organization/global identity boundary | `npm run verify:identity` | **11 passed** against actual routes with external I/O doubles |
| Atomic invoice routes and malformed-ID follow-up | `npm run verify:facturatie-atomic` | **21 passed** (initial 14 plus 7 client/route/storage boundary checks) |
| EPD manifest/publisher/client/cache | `node src/scripts/verify-epd-client-atomicity.mjs` | **19/19 passed** |
| Database account/RLS regressions | `python3 src/scripts/verify-auth-postgres.py --port 55439 --user hassan` | **207/207 passed** |
| Database invoice/credit regressions | `python3 src/scripts/verify-facturatie-postgres.py --port 55439 --user hassan` | **26 passed** |
| Database EPD generation regressions | `python3 src/scripts/verify-epd-postgres.py --port 55439 --user hassan` | **37 passed** |
| Platform SSO | Identity, session and pinned-framework suites | **44 identity + 121 session + 26 real-framework checks passed** |
| Microsoft integration | Pinned HumHub/Calendar CI, rollback-only fixtures | **481 passed** with Calendar 1.8.16 |
| Space governance | Pinned integration CI | **42 no-write + 42 rollback checks passed** |
| Calendar artifact installer | CI-only behavioral fixture suite | **5 passed**, including corrupt-download rejection and overwrite prevention |
| Web calling lifecycle | Platform call-client: `npm test` | **22/22 passed** |
| Web calling asset | Platform call-client: `npm run build` | Regenerated with installed pinned esbuild; dependency pins unchanged |
| Calling Chromium smoke | Platform call-client: `node test/browser-smoke.cjs` using an existing Playwright installation | **5/5 passed**; zero page errors and zero real network requests |
| Shell tests | `flutter test --no-pub` | **72/72 passed**, including real WebView API cleanup doubles and native cancellation/contract regressions |
| Shell analysis | `flutter analyze --no-pub` | No issues; final pre-push rerun passed |
| Shell formatting | `dart format --output=none --set-exit-if-changed lib test` | **47 files, 0 changes** |
| Local Android source | `./gradlew --offline :app:compileDebugKotlin` | Passed; additionally superseded by complete Android CI builds below |
| Release source hygiene | Scoped diff checks and changed/new shell source scan | Passed; 14 reviewed shell files, no credential-pattern matches or tracked signing/configuration secrets |

The database regression suites executed real SQL, RLS and transactions using synthetic data in a disposable loopback-only PostgreSQL 15.19 environment. Their test databases were removed. They did not access production Supabase; production migration/postcheck evidence is recorded separately above.

The EPD tests execute the actual manifest helper, publication entry point, remote client, provider and storage helpers. They cover failed and successful complete-manifest transitions, same-name overwrite refusal, one RPC publication, stable retry identity, one remote read/state/cache adoption, role redaction, quota/malformed-response preservation, owner/logout cleanup and cancellation. These are behavioral checks, not solely text matching.

The 130-test browser result is an **isolated local** result. It must not be described as a completed 130-case production acceptance run. The real Chromium calling smoke uses local DOM plus SDK/token doubles with network requests blocked; it verifies calling controls and recovery behavior, not a live Teams media connection.

## Shell release and fresh native CI

The shell was reviewed and committed on its existing `main` branch, then pushed to `https://github.com/Mbongaa/careonpulse-shell.git`. The observed local HEAD and `origin/main` both equalled `c5fdee595d2e2bd76de5e45eea4d9c6574a4f810`, and the worktree was clean after push. No platform-deploy changes were committed by the shell release owner.

[Run 33981768499](https://github.com/Mbongaa/careonpulse-shell/actions/runs/33981768499) verified that exact commit:

| CI job | Result and evidence |
|---|---|
| [Verify Android source and APKs](https://github.com/Mbongaa/careonpulse-shell/actions/runs/33981768499/job/101348137123) | Completed **success**. Formatting: 47 files/0 changes; analyzer: no issues; tests green; debug and release APKs built; signature, manifest/permissions and packaged SDK policy checks passed. |
| [Compile iOS without signing](https://github.com/Mbongaa/careonpulse-shell/actions/runs/33981768499/job/101348137047) | Completed **success** on macOS 15/Xcode 16.4 using Flutter 3.47.1. `flutter build ios --release --no-codesign --dart-define-from-file=config/production.example.json` produced `Runner.app`. |

The Android verification log concluded:

```text
SHELL_VERIFY=OK tests=green android=26/36 acs_android=2.16.0 acs_ios=2.18.4 release_unsigned=1
```

Recorded CI artifact integrity:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Debug APK | 286288363 | `43EB74C7B607A9F4D2032A110F6B3D2261FE813EE818D5C36125D6D812F51011` |
| Unsigned release APK | 173670200 | `6F29450E010CCC272574CF2FCF66EC7923E34E92609A3C6C2CB9A208D74B8725` |

These are values recorded by the verification job, not a claim of store upload or distributable signing. The fresh macOS build resolves the earlier uncertainty about compilation of the edited Swift coordinator. The existing workflow **does not execute RunnerTests XCTest**. Its expiry tests remain included in the existing Xcode test target/build sources, but execution and real-device acceptance are still unrun.

Native calling remains disabled: `CAREON_NATIVE_TEAMS_CALLING_ENABLED` defaults to `false`; no requested native flag, permission manifest or dependency pin was changed by the release. Embedded WebView media permission requests remain denied. Module logout/account switching clears embedded cookies, local storage and cache without clearing system-browser SSO.

## Production browser walkthrough

The coordinator operated the user's Microsoft-authenticated Edge tab after Vercel reported the exact release successful. The available identity is an **organization administrator**, not a Careon platform administrator. Verification used read-only production navigation; write flows used the isolated local browser and real synthetic SQL regressions.

| Page/flow | Observed result |
|---|---|
| Modules and Directiecockpit | Expected three module links; real central EPD data and explicit provenance; charts/layout inspected visually |
| Signaleringen | Severity groups, critical badge and destinations correct; expired BIG registrations retained; worker/backup operational states visible |
| Patiënten and Planning | KPIs, waiting lists, care-form and agenda charts rendered; source limitations labelled |
| Behandelaren and Dossiers & productie | Practitioner/resource tables and population/production analyses rendered |
| Dossiercontrole and Kwaliteit | Source-supported checks, completeness metrics and demo/derived labels rendered |
| Financieel | Authorized central financial slices and charts rendered; changing the time-window radio worked |
| HR | Two expired registrations retained and labelled `verlopen`; upcoming registration visible; no production autosave was triggered |
| Medewerkers & middelen | Central employee/account, team and inventory sections rendered; no employee/resource edits |
| Databron | All five existing EPD slices hydrated; source filenames/time and unavailable worker shown; no upload, refresh job or generation publication |
| Gebruikersbeheer | Entra directory and organization account tables loaded; no invitation, identity change or role change |
| AI-assistent | Existing live-AI configuration, provenance and blank composer loaded; no prompt submitted or private conversation opened |
| Facturatie, Contacten, Instellingen | Empty invoice ledger; employee/contact controls; missing legal sender details and disabled mail correctly reported. No invoice/contact/template created or saved. |
| All 46 `/dashboard/details/[kpiId]` variants | Correct page heading and populated table after hydration; no alert or browser error. Includes all 10 finance variants. |
| Detail filtering/pagination | `actief`: Tilburg restricted rows to Tilburg; 50→100 rows via load-more; restored `Alle locaties` |
| `/admin`, `/admin/organisaties`, `/admin/gebruikers`, `/admin/activiteit`, `/admin/ai-gesprekken` | Each redirected this organization administrator to the cockpit. Positive platform-admin rendering and existing-organization detail were not claimed. |
| Invalid KPI | `Pagina niet gevonden` |
| Missing OAuth consent context | Redirected safely to Modules; no fabricated consent submitted |
| Password setup while already authenticated | Redirected to Modules; no recovery token/password submitted |
| Well-formed nonexistent invoice ID | Correct organization-scoped not-found message |
| Malformed invoice ID | Reproduced false `Supabase niet bereikbaar.` response; after deploying `4436164`, the same URL showed the correct organization-scoped not-found response, with no browser error |
| Careon Modules → YAAZ | Fresh OIDC succeeded without password input; same current identity, safe retained Space destination and appropriate YAAZ admin navigation |
| YAAZ Stream, Spaces, Members, Conversations, Calendar, Tasks, Office 365, Administration | Pages rendered with no observed browser errors. Calendar/Microsoft overview used their existing read integrations; no messages, events, files, calls or settings were changed. |
| Later direct YAAZ protected navigation | Same identity and administration remained accessible; this is not evidence of a live role-demotion or cross-account test |

No patient dossier deep links, mail bodies, private chat histories or documents were opened to prove page rendering. No production business record was written. The local walkthrough additionally exercised login failure/success, synthetic CSV activation, HR autosave/restoration, resource toggles, assistant fallback and invoice editing; the 130-case browser suite covers desktop/mobile/accessibility/PWA and synthetic invoice lifecycle behavior.

## Platform deployment verification

Exact application release `2acf26f` was copied to the established direct-Compose host and activated with atomic source exchanges. Runtime source parity was checked before/after HumHub restart; it is healthy. Production checks passed **191 SSO**, **11 anonymous HTTP boundary**, **22 capability**, and **2 log-hardening target** checks. The HTTPS-served calling bundle matched SHA-256 `c354195024f4cfd4524d2cdfbad4fbf4685bd900a3fb59ca0f08e1d1ed3a09c2`. Full M365 host/runtime source hash matched `2a0dde8660a3718ae65f6c1c145b03147ce7880c604157d00144f490e577acf2`.

Verified backup pair: `20260905-174219`. Existing recovery allowlist remains empty. The selected recovery route is verified backup plus retained-source SSH rollback, prepared and syntax-checked but not exercised against the healthy release:

```sh
bash /opt/platform-deploy/.deploy/rollback-security-2acf26f.sh
```

A known local recovery password was an inferred rollout preference, not a confirmed architecture decision. No local password, administrator or allowlist change was necessary. Native calling, JaaS/Jitsi fallback, recording/transcription/AI, backup activation and mail activation were not enabled by this release. Existing dashboard AI and Microsoft capabilities retain their previous states.

Both platform CI workflows originally failed before tests because unversioned marketplace installation returned Calendar 1.8.17. The follow-up `f1343c7` uses the exact official 1.8.16 artifact with SHA-256 verification and behavioral guards. Both fresh integration workflows passed against that pin; production dependencies were unchanged.

## Finding closure and remaining acceptance

`CLOSED` below is engineering closure backed by executable regressions and the deployed server boundaries. It does not imply an actual production accounting transaction, deliberate employee revocation or native-device/media acceptance.

| Finding | Engineering status | Deployed evidence / remaining limitation |
|---|---|---|
| F01 | CLOSED | Fresh real Careon→YAAZ SSO passed; framework/session and shell cleanup regressions passed. Controlled A→logout→B browser flow and installed-shell acceptance remain. |
| F02 | CLOSED | Active-account restriction installed on 30/30 public tables; retained-claim SQL regressions passed. No real employee was banned to manufacture a production test. |
| F03 | CLOSED | Role boundary deployed; organization admin page works and platform pages reject it; route regressions prove global-identity denial. No real global identity mutation. |
| F04 | CLOSED | Mandatory server hooks/300-second lease deployed; real-framework and demotion regressions passed. Current-identity login/admin navigation passed; controlled live role-demotion timing remains. |
| F05 | CLOSED | Unique credit index and service-only atomic RPC installed after zero-duplicate preflight; concurrent/idempotent/rollback regressions passed. Real credit transaction unrun. |
| F06 | CLOSED | Revision trigger and atomic issuance routes/RPC deployed; stale-autosave and snapshot regressions passed. Real issuance/PDF acceptance unrun. |
| F08 | PARTIALLY CLOSED | Contract/expiry fixes pushed; Android and unsigned iOS compile CI green. XCTest execution and physical-device contract acceptance remain; native flag off. |
| F09 | PARTIALLY CLOSED | Cancellation/lifecycle regressions passed and shell CI green. Native teardown/media acceptance on devices remains. |
| F10 | CLOSED | Web hang-up retry fix deployed; actual client regression plus isolated Chromium control checks pass. Real two-user failed-hangup acceptance unrun. |
| F11 | CLOSED | Shared initialization, teardown/camera/video races fixed and deployed; regression/Chromium suites pass. Actual live call lifecycle unrun. |
| F12 | CLOSED | Database/writer/reader code released; real concurrency and client atomic-adoption regressions pass. Existing data remains legacy until first authorized complete-generation publication; worker outage tracked below. |
| F13 | CLOSED | Correct metadata fixture pushed; actual database constraint regression passes. Live invoice/Storage acceptance intentionally unrun. |
| F14 | CLOSED | Remediation, deployment, CI and browser evidence reconciled; D1–D23 preserved. Remaining operational/product acceptance stays in G19 and existing gaps. |

**G07 remains open:** the TGC import worker last heartbeated on 3 September at 02:07 UTC, before this release. Its Windows task is Ready rather than Running, last exit 1; the queue is empty. The unchanged service-role heartbeat boundary remains valid. No worker restart/import was performed during verification; exact host failure cause and a managed ingestion host/SLA/owner remain outstanding. The invoice offsite-backup gate remains intentionally dormant under G17.

G19 remains In progress for the controlled acceptance above. No app-store submission, signing, actual call, real invoice/credit, EPD publication or new feature activation is implied by this report.

## Final invoice URL correction

Production browser navigation to `/facturatie/verification-invalid-invoice` reproduced a false database-outage message. The editor's remote client called the invoice GET route; `haalFactuurRij` passed the malformed ID to PostgREST's UUID column, and its 400 was incorrectly translated into the generic 502 outage response. A well-formed missing UUID already returned the correct organization-scoped not-found message.

Commit `4436164` adds a UUID syntax guard in `src/lib/careon-facturatie/facturatie.server.ts`, returning no row before database I/O and retaining the existing authorization and 404 response. `src/scripts/verify-facturatie-atomic.mjs` now exercises the actual remote-client → GET → real storage-helper flow with intercepted PostgREST: three malformed IDs require 404 and zero queries; valid missing/existing IDs, real database outage and authorization denial preserve their behavior. The old code reproduced `502 !== 404`; the corrected suite passes **21/21**. Typecheck and scoped Biome checks pass. No migration or capability change was needed.

Vercel deployment `GAFX9SfRRVq84vUnSixPm7FUqxDq` reported success for full commit `44361649679a14567b86bc6cdd5c8492d216225a`. The coordinator reopened the exact malformed production URL in the existing Microsoft-authenticated tab: it now shows `Deze factuur bestaat niet (meer) voor deze organisatie.` without a browser error. The well-formed nonexistent UUID retained that same correct response, and navigation back to the invoice list succeeded. No business records were created.

The exact corrective commit then passed its complete GitHub CI: database **207+26+37**, quality with **21 invoice-route** and **1018 product** checks, **130 browser tests in 3.7 minutes**, audit **0 vulnerabilities**, and CodeQL. The following documentation commit changes only this ledger and reconciled status/remediation documents; application source is identical to this verified code commit.
