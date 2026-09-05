# Fresh production browser verification — 5 September 2026

The owner asked for a fresh browser pass using **Sign in with Microsoft**. The coordinator operated the existing production Edge tab, clicked **Uitloggen**, observed the login page, clicked **Inloggen met Microsoft**, and returned to Modules without a password prompt. The resulting identity has Careon organization-administrator access and YAAZ administrator access; it is not a Careon platform superadmin.

This pass navigated **78 distinct Careon URL cases**, covering all **31 source page patterns** (28 fixed plus 3 dynamic), including all **46 valid KPI IDs**. Checks used rendered DOM, completed asynchronous loading, representative screenshots and browser error logs. This is page/authorization verification, not proof of every business transaction or every possible record ID.

## Careon fixed routes

| Route | Observed result |
|---|---|
| `/` | Redirect to Modules |
| `/modules` | Three entitled modules rendered |
| `/dashboard` | Redirect to Directiecockpit |
| `/dashboard/directiecockpit` | Production KPI cards, charts and provenance rendered |
| `/dashboard/signaleringen` | Severity groups and corrected expired BIG alerts rendered; existing worker outage visible |
| `/dashboard/patienten` | Patient, waiting-list, contact and population sections rendered |
| `/dashboard/planning` | Appointment, hours, occupancy and forward-planning sections rendered |
| `/dashboard/behandelaren` | 24 practitioner rows and team/resource summaries rendered |
| `/dashboard/dossiercontrole` | Completeness metrics and 10 control rows rendered |
| `/dashboard/dossiers-productie` | Production, dossier and population sections rendered |
| `/dashboard/kwaliteit` | Quality metrics rendered with source/demo labels |
| `/dashboard/financieel` | Authorized financial cards, charts, ageing and declaration summaries rendered |
| `/dashboard/hr` | Current manual values and two expired plus one upcoming BIG registration rendered |
| `/dashboard/middelen` | Central employee/resource and inventory tables rendered |
| `/dashboard/databron` | All five current EPD exports rendered; unavailable worker correctly reported |
| `/dashboard/beheer` | Entra directory and organization account tables loaded |
| `/dashboard/assistent` | Existing live-AI state and empty composer rendered; no prompt submitted |
| `/facturatie` | Empty invoice ledger rendered |
| `/facturatie/contacten` | Empty contact ledger and employee contact-source table rendered |
| `/facturatie/instellingen` | Templates/readiness rendered; missing legal fields and inactive mail reported |
| `/auth/v1/login` | Fresh logged-out login and Microsoft action succeeded; authenticated visit redirects to Modules |
| `/auth/v1/wachtwoord-instellen` | Authenticated visit redirects to Modules |
| `/oauth/consent` | Missing authorization context redirects to Modules; real module SSO also succeeded |
| `/admin` | Organization account redirected to cockpit |
| `/admin/organisaties` | Organization account redirected to cockpit |
| `/admin/gebruikers` | Organization account redirected to cockpit |
| `/admin/activiteit` | Organization account redirected to cockpit |
| `/admin/ai-gesprekken` | Organization account redirected to cockpit |

## Dynamic routes

All 46 `/dashboard/details/[kpiId]` pages produced their correct heading and table after hydration, with no captured alert or application-error message:

```text
actief, aanmeldingen, gesloten, noshow, zondervervolg, dossiersnc,
omzetverz, omzetinfo, omzettotaal, omzetrmo, outreach, tevredenheid,
wachtlijst-intake, wachtlijst-behandeling, zonder-behandelaar,
contact30, contact60, crisis, afspraken, geannuleerd, bezetting,
uren-beschikbaar, uren-productief, uren-behandel, uren-indirect,
wachttijd, ohw, openstaand, afgekeurd, omzet-client, omzet-traject,
declaraties90, verzuim, verloop, vacatures, opleidingen, intervisie,
werkdruk, incidenten, klachten, dossierkwaliteit, productie-uren,
productiviteit, wachtlijst-totaal, wachtlijst-urgent, dossier-compliance
```

`/dashboard/details/verification-invalid-kpi` displayed the expected not-found page. Both `/facturatie/verification-invalid-invoice` and `/facturatie/00000000-0000-4000-8000-000000000001` completed loading with **Deze factuur bestaat niet (meer) voor deze organisatie.** The previously false database-outage message did not recur. `/admin/organisaties/00000000-0000-4000-8000-000000000001` redirected to cockpit before organization-record access.

Positive platform-superadmin rendering requires a platform account. Positive invoice-record rendering requires an existing authorized invoice; the production ledger is empty. No record was created merely to satisfy this browser pass.

## YAAZ and Microsoft pages

Careon Modules → YAAZ completed real SSO with the same identity. The following 25 distinct resulting page paths were inspected; some received multiple visits or query variants:

```text
/s/diagnostiek/                      (/dashboard lands in the last active Space)
/spaces
/people
/mail/mail/index
/calendar
/tasks/global/index
/microsoft-365
/admin/user/list                    (/admin and /admin/user/index redirect here)
/admin/space
/admin/module/list                  (/admin/module redirects here)
/admin/setting/basic                (/admin/setting redirects here)
/admin/information
/admin/authentication
/admin/user-profile
/admin/group
/admin/user-people
/s/diagnostiek/home
/s/diagnostiek/tasks/list
/s/diagnostiek/about
/u/[current-user]/
/careon-ui/chat/group               (GET form only)
/microsoft-365/message              (existing invitation; inert-text detail)
/microsoft-365/event                (existing event; edit form only)
/microsoft-365/team                 (existing authorized team)
/microsoft-365/channel              (all three channels in that team)
```

The document-folder query variant also rendered. The integrated Calendar completed its Outlook overlay, and **Week**, **Dag**, **Lijst** and **Maand** controls worked; month view was restored. Screenshots confirmed the calendar and invoice settings after loading. Initial route error-log reads were empty. The final log read retained one Mercure error from **19:29:50 UTC**, before the follow-up deployment; no new error appeared during the post-deployment session-renewal check. Hidden form-validation containers were distinguished from visible errors; the maintenance-mode explanation and available HumHub update notice are informational UI, not failed page requests.

All three inspected Teams channels were empty, so there was no existing thread link to open. No message, event, document, account, role, invoice or setting was submitted or changed. No call/meeting was started, no download performed and no disabled capability activated. Dedicated calling/provider transactions and exhaustive HumHub framework/module settings are not claimed by the Careon page-pattern coverage.

## Follow-up findings from this pass

1. **Existing G07 outage confirmed:** the import worker is unavailable; last heartbeat remains 3 September. This browser pass did not restart ingestion.
2. **Unplanned Calendar upgrade fixed:** the Modules page displayed Calendar **1.8.17**, contradicting the earlier release statement that runtime dependencies remained unchanged. Read-only host verification found 1.8.16 in pre-release backup `20260905-174219` and 1.8.17 in the current module manifest. The image startup script unconditionally executed `module/update-all`; the release restart therefore changed a dependency implicitly. Commit `01af713` deploys a read-only startup override that preserves initialization and migrations without marketplace upgrades. CI now verifies the actual 1.8.17 artifact. A real isolated restart and the production restart both preserved every marketplace module byte. No downgrade was performed.
3. **Expired-background-request renewal fixed:** the unwanted `/admin/authentication` → `/user/auth/login` behavior was observed twice after lease expiry while Careon remained authenticated. The exact executable regression proved that the expired AJAX request cleared identity, then a subsequent protected GET fell through to the local login route. SSO 1.4.1 in `01af713` retains only a bounded routing hint after identity removal; HumHub's access rules send the next protected HTML navigation through normal Careon OIDC. JSON/API requests and draft-creating GET actions remain 401; denied callbacks and explicit logout cancel continuation. The 300-second authorization lease is unchanged. Fresh deployed SSO and the real timed browser recheck both passed, as recorded below.

## Follow-up release evidence

Exact platform commit **`01af713fb447f079c58ae74200ee5a4adf5c5912`** is pushed and deployed. Remote [Microsoft CI](https://github.com/Mbongaa/platform-deploy/actions/runs/33987843299), [Space governance CI](https://github.com/Mbongaa/platform-deploy/actions/runs/33987843274) and [production smoke](https://github.com/Mbongaa/platform-deploy/actions/runs/33987843273) all succeeded before activation.

| Finding | Files changed in `platform-deploy` | Executed regression / verification | Status |
|---|---|---|---|
| Automatic dependency upgrade on restart | `compose.yml`, `ops/humhub/startup.sh`, `scripts/verify-humhub-startup.py`, `scripts/verify-humhub-restart.sh`, exact Calendar installer/guard, both integration workflows, version/deployment docs | 8 executable startup cases; 5 artifact guards; real disposable restart with unchanged module hashes; 481 Microsoft checks and 42+42 Space checks on Calendar 1.8.17; production restart preserves all marketplace files, image and capability configuration | CLOSED |
| Expired XHR leads to local login | SSO `Events.php`, `services/SessionRenewal.php`, `authclient/CareonClient.php`, `module.json`, README and both session/framework tests | 44 identity, 216 hook/client, 40 real HumHub framework checks; 17 PHP files linted. Exact expiry→XHR→guest→protected-page sequence, public routes, JSON/API/draft protection, denial/logout and safe-target cases. All 300 SSO checks also passed against deployed source; actual production browser navigation after 340 seconds returned to the requested admin page with the same identity | CLOSED |

Executed commands from `platform-deploy` included `python3 scripts/verify-humhub-startup.py` (8 cases), `python3 scripts/verify-ci-calendar.py` (5 guards), `bash scripts/verify-humhub-restart.sh` (disposable-container restart and file parity) and `bash scripts/verify-sso.sh` (300 checks). The linked remote workflows record their complete isolated integration setup and results. Production activation used the reviewed archive deployment script with its independent before/after hashes; the restart regression was not pointed at production.

Fresh verified production backup: **`20260905-192756`**. Exact archive SHA-256: `ada81d6ccd1e4a6e7039c7ccde1037b925ef0d08c6a8399a9d459f5295719b3a`. Deployed SSO source/runtime hash: `4bff0cf51e2d69f2f7e9b1aac328c46e078a2efb84d8970b0a361178ccee5ba4`. Runtime checks proved the read-only executable startup mount, completed cache/migration initialization, unchanged marketplace module bytes, unchanged image/environment, **22/22 capabilities**, **2 log-hardening targets**, and full health with **4 workers**. The localhost password verifier correctly refused production; no password transaction occurred. Capability/health checks were completed separately and actual employee Microsoft browser sign-in was used instead.

The retained-source rollback restores only prior SSO code and keeps the startup guard, avoiding another automatic marketplace upgrade. It was reviewed and syntax-checked, not executed against the healthy release. After deployment the browser revisited Spaces, Members, Conversations, Calendar, Tasks, Microsoft 365 and Modules administration: no login form or visible error, and Calendar still **1.8.17**. Fresh SSO returned to the requested admin page with the same identity at **19:45:51 UTC**.

**Timed production browser regression: PASS.** The admin page remained open with its ordinary background polling for **340 seconds**, measured by the browser session's wall clock. Navigating again to `/admin/authentication` after the 300-second lease returned through SSO to that exact route. The rendered heading was **Gebruikers-instellingen.**, the same signed-in identity was present, and the DOM contained **zero password fields**. No time manipulation, cookie/token inspection, account change or role mutation was used. This reproduces the elapsed-time navigation that failed before the fix; controlled role-demotion and cross-account acceptance remain separate.

The [release ledger](./RELEASE_VERIFICATION_2026-09-05.md) contains the engineering/regression evidence; this file records the owner's additional fresh-browser request and does not replace the remaining controlled acceptance gates.
