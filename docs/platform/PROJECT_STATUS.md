# Careon Pulse — Project Status & Timeline

**Last updated:** 13 August 2026 · **Companion to:** `docs/platform/PLATFORM_BLUEPRINT.md` (v2.2, authoritative)

This file tracks where the platform stands: what exists, what is in progress, and what comes next. Agents and developers update it when a milestone changes state. Section references (§) point into the blueprint.

Legend: ✅ done · 🔵 current focus · ⬜ not started

---

## 1. Repository & infrastructure state (today)

### `careonpulse` (this repo) — Module 1: Pulse dashboard — ✅ live

- Next.js 16 / React 19 dashboard app (`src/`), deployed on Vercel; mobile-first, installable PWA
- Supabase (EU) schema in `supabase/migrations/`: org tenancy (`organizations`, `organization_members` with `org_admin`/`member`, platform superadmin), audit events, login rate limiting, auth security hardening (through 26 Jul 2026), the access-token hook `0019` (namespaced `careon` claim), and the facturatie schema `0020` (four tables + the private Storage bucket `facturen`, 9 Aug 2026) plus `0021` (invoice mail log + `mail` quota scope, 13 Aug 2026)
- AI-assistent on the hardened OpenAI regime (pinned snapshot, fail-closed moderation, eval suites) — see `AI_OPERATIONS.md`
- Post-login module launcher at `/modules` (27 Jul 2026) — web precursor of the shell tile launcher (§5): Careon Pulse Directie live; YAAZ becomes live through `NEXT_PUBLIC_YAAZ_URL`, with local SSO verified on 31 Jul 2026; registry in `src/data/careon/careon-modules.ts`. The launcher, `/dashboard/beheer` gebruikersbeheer, the wachtwoord-link flow and migration `0014_rename_org_tgc.sql` are committed and pushed (`main`)
- Superadmin dashboard brought up to its own spec (29 Jul 2026): role mutations (promote/demote, membership add/remove, account delete), organisation rename/delete, composable audit-log filters (org / user / action / period) with pagination, per-org detail view, and explicit error states instead of silent empty ones — see `docs/AUDIT_2026-07-29.md`
- Facturatie module live at `/facturatie` (9 Aug 2026, D19): admin-only invoicing inside this repo with its own module shell and menu (invoice list, editor with live PDF preview, contacts incl. employee union, template library), schema `0020` + private Storage bucket `facturen`, access limited to `org_admin` + superadmins with org membership on four layers — spec in `agent-handoff/15-facturatie.md`. **Phase B (e-mail dispatch) built 13 Aug 2026**: send an issued invoice as a Resend transactional mail (owner decision 13 Aug, deviating from the EU-sovereign proposal — D19 amendment) with the archived PDF attached, one mail-log row per attempt (`0021`, RLS select-only), rate-limited on the `mail` quota scope — **fail-closed until the DPA**: with the `CAREON_MAIL_` keys empty the route answers 503 and nothing can be sent
- Quality gates: `verify:ci` suites, Playwright e2e + WCAG-AA audits, `RELEASE_GATES.md`, production readiness audit (24 Jul 2026)
- Platform docs: `docs/platform/PLATFORM_BLUEPRINT.md` (v2.2) + this status file; `AGENTS.md` platform section

### Sibling repositories (blueprint §8) — 🔵 in progress (30 Jul 2026)

| Repo | Purpose | Status |
|---|---|---|
| `careonpulse-shell` | Flutter shell app: login, launcher, push, native Jitsi | ⬜ |
| `humhub-meeting-modules` | `meeting-core` / `meeting-recordings` / `meeting-intelligence` | ⬜ |
| `platform-deploy` | Hetzner/Coolify Compose stack, env templates, backups, `VERSIONS.md` | 🔵 scaffolded 30 Jul 2026; on GitHub since 9 Aug 2026 (`Mbongaa/platform-deploy`, incl. careon-sso/careon-demo/careon-ui + branding) — compose for HumHub 1.18.4 + MariaDB 11.8 + Redis 8.0, `VERSIONS.md`, Spike-A plan in `docs/identity-spike.md` |

### External services

| Service | Status |
|---|---|
| Supabase project (EU) — identity + dashboard data | ✅ live; OAuth 2.1 server enabled, ES256 signing active, HumHub confidential client verified locally |
| Vercel — dashboard hosting | ✅ live |
| Hetzner VPS — comms plane | ✅ provisioned 9 Aug 2026: CPX22 `yaaz-comms-1` (nbg1, Ubuntu 24.04, firewall 22/80/443, Hetzner backups on), YAAZ live at `https://157-90-231-67.sslip.io` (temp host until the platform domain lands). **Coolify deferred — deviation from D11**: deploys run over SSH + `compose.yml`+`compose.tls.yml` (image's own Caddy terminates TLS); revisit Coolify when staging + operator self-service are needed |
| JaaS (8x8), Cloudflare R2, Vertex AI (Gemini) | ⬜ accounts not created |
| Apple / Google developer accounts (client-owned) | ⬜ blocked on legal-entity decision (§25 Q2) |

---

## 2. Timeline

### ✅ Done

- **Pulse dashboard built, hardened, and live** — full KPI screens, AI-assistent, org-scoped auth, production audit passed (24 Jul 2026), auth hardening landed (26 Jul 2026); role-based financial confidentiality added 28 Jul 2026 (members see no financial data anywhere — pages, widgets, data APIs, AI-assistent; org_admins unchanged; see RELEASE_GATES.md)
- **Platform design finalized** — v1.0 blueprint (26 Jul: HumHub + JaaS + Gemini single-app design, hosting and vendor research, JaaS pricing verified) → multi-module pivot → **v2.0 blueprint (27 Jul)**: shell + Supabase identity hub + module registry; decision log locked D1–D18
- **Umbrella docs added to this repo** — blueprint v2.0, AGENTS platform section, this status file

### 🔵 Where we are now

**Deliverable 1 (the Pulse dashboard) is complete — both operator actions are closed.** A multi-agent audit on 29 Jul 2026 (`docs/AUDIT_2026-07-29.md`) produced 40 confirmed findings; all code-fixable ones are fixed and verified (see RELEASE_GATES.md, "Auditronde 29-07-2026"). The two items that were not closable by code:

1. ✅ **Done (29 Jul 2026): migrations `0015_financieel_rls.sql` and `0016_login_account_throttle.sql` are applied to careon-zsg** and functionally verified in the database — a TGC `member` now reads zero rows from the financial tables and only redacted agenda data, while `org_admin` is unaffected. A same-day schema-drift audit (`docs/SQL_DRIFT_2026-07-29.md`) confirms every other migration is applied, RLS is enabled on all 17 tables, and there is no reverse drift. **Deploy the matching code** — the agenda route reads the new view (it falls back to the base table if the view were missing, so ordering is safe).
2. ✅ **Done (9 Aug 2026): Supabase DPA settled** — confirmed by the owner on 9 Aug 2026 (see `PRODUCTION_MODE.md` §"Vereisten vóór publieke hosting van echte data"). This was the last remaining blocker for deliverable 1.

On the platform side, design is closed and **Phase 0 — Audit & Foundations (§22) started on 30 Jul 2026**: `platform-deploy` is scaffolded (see the sibling-repo table above) with the pinned compatibility matrix (`VERSIONS.md`) and the Spike-A plan — and, same day, **the comms stack runs locally**: Docker CE installed in WSL, `docker compose` boots HumHub 1.18.4 + MariaDB 11.8 + Redis 8.0, `scripts/provision.sh` completes non-interactively, the CareonTheme (palette ported from the dashboard's careon design tokens) compiles and is active, the Messenger (`mail` 3.4.3) module is enabled, and login → dashboard is verified end-to-end at http://localhost. The repo is on GitHub since 9 Aug 2026 (`Mbongaa/platform-deploy`).

**31 Jul 2026 — YAAZ demo-ready:** (1) role mapping live (see Spike A below); (2) the organisation network "TGC Groep" exists — created by the org admin through the real space-create UI (space creation is Administrators-only, verified 200/403 per role) — with `auto_add_new_members` on and a seeded Dutch demo timeline (11 posts, 9 comments, 22 likes, 5 fictional practitioner accounts named after the dashboard's behandelaren, initials avatars; seeder = `careon-demo` console module in `platform-deploy/humhub/modules-custom/`); (3) **full CareonPulse rebrand 1:1 with the dashboard's careon theme**: navy-glass look as the single theme mode (CE 1.18 has no runtime dark-mode switch, and the dashboard's careon mode is fixed-dark anyway), Geist self-hosted, gradient logo lockup + favicon + login background generated from the exact handoff SVG/tokens (`platform-deploy/humhub/branding/`, installed by `scripts/sync-humhub-assets.sh`, which now also flushes the `theme.var.*` settings that would otherwise override `variables.scss`), default language `nl`, timezone Europe/Amsterdam. "Powered by HumHub" remains (removal = PE whitelabel module, quote needed).

**9 Aug 2026 — YAAZ public preview live** at `https://157-90-231-67.sslip.io` (Hetzner CPX22 `yaaz-comms-1`, nbg1). The verified local instance was migrated wholesale (DB dump + uploads), so the TGC Groep network, all accounts, the CareonTheme rebrand and NL settings are byte-identical to the 31 Jul demo state. SSO chain verified end-to-end against production: HumHub → Supabase authorize (PKCE, new redirect URI registered on the `careon` client) → consent on `https://careonpulse.vercel.app` (Supabase `site_url` fixed from its dev value; `/oauth/consent` confirmed deployed). Mercure hairpin passes, queue workers + scheduler run, Messenger pinned at 3.4.3 (marketplace served 3.3.12 — replaced to match the imported migrations). Ops gotcha recorded in `platform-deploy/docs/coolify-deploy.md`: `/data/config/common.php` (authclient class-swap + secrets) is NOT in the repo and must be copied per environment. Remaining for the tile: set `NEXT_PUBLIC_YAAZ_URL` in Vercel; later: real domain, R2 backups + restore drill before real rollout.

Phase-0 research produced **five corrections to blueprint §4/§13/§19 — each proposed, none applied to the blueprint yet** (full findings + revised spike checklist in `platform-deploy/docs/identity-spike.md`; topology also in `platform-deploy/VERSIONS.md`):

1. The **Supabase OAuth 2.1 server's GA status is ambiguous** (re-checked live 30 Jul 2026): the docs guide no longer carries beta wording, but Supabase's feature-status page still labels it "Public Beta" (beta opened Nov 2025; §4's "left beta late 2025" remains unconfirmed either way). Confirm GA/SLA/pricing directly during Spike A.
2. **We must build the consent screen ourselves** (a route in our own app; Supabase ships no consent UI), and the identity project must first migrate to **asymmetric JWT signing keys** — its own change window, blast radius beyond OAuth.
3. **No OIDC logout/revocation/introspection exists**: single logout must be an application-level fan-out, and §4 "deactivation locks the user out at next token refresh" holds only with a short `jwt_exp` (300–900 s). §22 Phase-0 "logout" and Phase-1 "deactivation locks a test account out of everything" acceptance wording need the same nuance.
4. **Custom claims cannot go in ID tokens** (closed struct) and `app_metadata` is not exposed by userinfo — §4's "ID tokens carry … role and tile entitlements" must become access-token claims or the entitlements-endpoint variant; never mirror roles into user-writable `user_metadata`.
5. **§13/§19 comms topology is stale**: the official HumHub image is a single FrankenPHP container (supervisord runs web + cron + queue workers) — no separate nginx/worker/cron services; D9's substance is unchanged. Also §19's `/health` + `/health/queue` endpoints don't exist in HumHub — recorded as a Phase-1 build task.

Nothing exists yet for the shell or the meeting modules. The one decision currently blocking an external clock: which legal entity owns the developer accounts (§25 Q2) — enrollment is the longest lead time in the plan.

Known residual, deliberately deferred to the second organisation's onboarding: the app's customer identity ("TGC Groep") is still hardcoded in audited page copy and demo constants. Public/unauthenticated surfaces (meta, OpenGraph, login page) no longer leak it, but making branding session-driven changes audited copy and must be done together with an update of the audit documents.

**9 Aug 2026 — facturatie module BUILT (D19).** The client requested an invoicing tool as a separate admin-only module; the owner answered the 21 inventory questions on logic-based defaults and instructed to build in parallel with Phase 0 (recorded exception in blueprint §22). Implemented same day per `agent-handoff/15-facturatie.md`: standalone module `/facturatie` with its own shell + menu (list, editor with live blob-PDF preview via `@react-pdf/renderer`, contacts incl. employee union, settings), migration `0020` (four tables, RLS on `app.mag_facturatie_zien`, atomic number+status RPC, immutability triggers, concept-prune RPC, private Storage bucket `facturen`), four-layer admin gating, full client-side demo path (Playwright runs demo-only), and two deliberate CSP changes (`frame-src 'self' blob:`, `'wasm-unsafe-eval'`). Gates: check/typecheck clean, `verify:careon` 969, `verify:runtime` 60, facturatie e2e subset green; docs updated (blueprint v2.1 + D19, RELEASE_GATES, PRODUCTION_MODE, DISASTER_RECOVERY, AGENTS). Same day, on client request: settings became a **template library** (multiple sender profiles per organization, per-invoice template choice, per-template numbering freeze and logo) and the PDF layout was rebuilt 1:1 to the client's imported "Factuur Careon Group" design (claude.ai/design, brand-gradient top bar/wordmark/TOTAAL band; built-in `careongroup` template with bundled logo). **Phase B (e-mail dispatch) is deliberately not built** — provider choice (EU-sovereign preferred) + DPA first *(superseded 13 Aug 2026 — built fail-closed, see below)*. Real company data (KvK/IBAN/address/logo) is runtime settings the admin fills in; client validation of the inventory answers still advised.

**13 Aug 2026 — M365 direction confirmed (D20, blueprint → v2.2) + YAAZ modules live.** The owner confirmed **hybrid authentication**: Entra ID federates into the Supabase hub as upstream provider, "Inloggen met Microsoft" becomes the primary path for TGC employees, e-mail/password stays for platform administration, demo/e2e, and break-glass; per-org enforcement is a later explicit phase. Recorded as **D20** in blueprint v2.2 (+ §25 questions 13–15; Q9 answered for TGC). Track B (implementation) blocks on the TGC-IT app registration — the draft request message is ready in `agent-handoff/16-office365-yaaz-modules.md` §8. Track A executed the same day: **calendar 1.8.16, polls 1.4.5, tasks 1.9.6** installed and enabled on local + production YAAZ (marketplace versions matched — no parity fix needed), versions pinned in `VERSIONS.md`; demo agenda seeded on both environments (`yii careon-demo/agenda`: 5 events congruent with the demo posts incl. 4 RSVPs and a weekly recurring intervisie; `agenda-check` proves recurrence expansion; ICS feed verified valid on both, sabre/vobject clean); CareonTheme extended with module coverage (FullCalendar/tasks/polls hard-coded light styles overridden to navy-glass — commit `9d41193`). A platform-wide **Office 365 integration assessment** (per module: config vs off-the-shelf vs custom vs advise-against, adversarially verified against primary sources) is recorded in handoff 16 §10 — headline: everything the client reasonably means by "integrate with Office 365" is feasible; custom build is limited to four small, contained pieces; two-way calendar sync, Teams meeting interop, and SCIM are explicitly not viable/not worth it. Ops notes: `/opt/platform-deploy` on the server is a file copy, not a git checkout; calendar ICS feed tokens never expire (module bug — `jwtExpiration`/`jwtExpire` mismatch), revocation = rotate `jwtKey`.

**13 Aug 2026 — facturatie gap-audit + fixronde.** A 23-agent audit of the built module against its blueprint (`agent-handoff/15-facturatie.md`) confirmed 268 implemented requirements and found 12 real gaps; all twelve were closed the same day — among them the art. 35a sub h basis line in the totals block, full validation before a credit invoice is inserted, server-side "Te laat"/"Openstaand" filtering with correct pagination, and a complete contact form (all fields editable). Gates after the round: `verify:careon` **989/0**, `verify:runtime` **72/0**, typecheck + Biome clean, contacten-e2e green; a live smoke suite for the server path (`verify:facturatie:live` against careon-zsg) now exists — see `RELEASE_GATES.md` and handoff 15 §0.4.

**13 Aug 2026 — facturatie phase B (e-mail) built.** Sending an issued invoice by e-mail now exists end to end: migration `0021_careon_facturatie_mail.sql` (applied to careon-zsg and verified against `pg_policy`/`pg_constraint`/`pg_proc`) adds `careon_facturatie_maillog` — one row per send attempt, RLS select-only via `app.mag_facturatie_zien`, writes service-role only, excluded from every prune (7-year administration) — plus the `mail` quota scope in `careon_consume_assistant_quota` (CHECK constraint *and* function allowlist). Provider is **Resend** (owner decision 13 Aug 2026, deviating from the EU-sovereign V17 proposal — consequences recorded in the D19 amendment; platform-wide per D19); the mail body carries only invoice number, total, due date and sender name/IBAN (enforced in `verify:careon`), the archived PDF rides along as attachment, and the audit event `facturatie.factuur.send` deliberately omits the e-mail address. **Fail-closed until the DPA**: while `CAREON_MAIL_RESEND_API_KEY` / `_AFZENDER_EMAIL` / `_AFZENDER_NAAM` are empty the route answers 503, so there is no send risk before the processing agreement. Deliberate deltas from the phase-B design: synchronous sending with no queue worker (the cron only marks stuck attempts as failed — automatic retry would risk double-sending a legal document) and a reserved `gebounced` status without a bounce webhook. Gates: `verify:careon` **995/0**, `verify:runtime` **80/0**, typecheck + Biome clean, e2e demo send test, live smoke extended with the fail-closed 503 check and maillog-RLS probes (it never sends real mail). Go-live checklist in `PRODUCTION_MODE.md`; detail in handoff 15 §0.5.

### ⬜ Next — Phase 0: Audit & Foundations (gates before any feature code)

1. ⏳ Create the sibling repositories — `platform-deploy` scaffolded locally 30 Jul 2026 (AGENTS.md in place; commit + push to GitHub pending); `careonpulse-shell` and `humhub-meeting-modules` not started
2. ✅ (31 Jul 2026) Supabase **OAuth 2.1 server mode enabled** on careon-zsg (owner approved skipping the throwaway step; signing keys were already ES256 so no migration was needed); HumHub registered as confidential client; consent screen live at `/oauth/consent` in the dashboard; full authorize→consent→token protocol verified by script (valid ES256 id_token). Shell (PKCE public client) still to register in Phase 1.
3. **Spike A — identity (gate):** 🔵 largely passed 31 Jul 2026 — HumHub "Inloggen met Careon" wired (core OpenIdConnect, auto-provisioning open); real-browser first login and repeat visit both pass from the YAAZ launcher tile without a login, registration, or consent click (repeat verified after ending only the HumHub session, so the existing-grant path was exercised); Keycloak fallback (§4) not needed so far. **Role mapping is DONE (31 Jul 2026, later same day):** migration `0019_careon_access_token_hook.sql` puts a namespaced `careon` claim (`org_id`/`org_slug`/`org_role`/`superadmin`, read live from `organization_members`/`platform_admins`) in every access token via the GoTrue custom-access-token hook (SECURITY DEFINER; `lock_timeout` guard because `WHEN OTHERS` does not catch `query_canceled` — a lock wait would otherwise fail ALL token issuance), and the HumHub module `careon-sso` (`platform-deploy/humhub/modules-custom/careon-sso/`, subclassing `OpenIdConnect`) verifies the token against the hub's JWKS on every login and syncs Administrators-group membership both ways (org-bound: `org_admin` counts only for the installation's own org; superadmin is platform-wide; missing/invalid claim = no change; last-admin demotion refused). E2E-verified headlessly: promotion on first login, member stays member, demotion after role change, plus name sync (`SyncAttributes` from `user_metadata.full_name` — the id-token `name` falls back to the e-mail address and silently breaks auto-provisioning on HumHub's required 20-char firstname). Remaining: app-level logout fan-out, `jwt_exp` decision. Detail: `platform-deploy/docs/identity-spike.md`
4. **Spike B — meetings (gate):** shell WebView ↔ native Jitsi bridge proof
5. ⏳ Provision Hetzner + Coolify; deploy a skeleton HumHub to staging — ✅ compatibility matrix recorded (`platform-deploy/VERSIONS.md`, 30 Jul 2026); provisioning not started
6. Decide the developer-account legal entity and **start Apple/Google enrollment immediately**
7. Local dev prerequisites on the dev machine: install Docker (WSL Debian, commands in `platform-deploy/docs/local-dev.md`) and authenticate `gh`

**Phase 0 acceptance:** both spikes pass (or fallback invoked); pinned versions install cleanly end to end; push-to-deploy works on both planes.

### ⬜ Phase 1 — Shell + Base Platform (§22)

Shell app v1 (login, launcher + server-driven registry, entitlements, push, deep links) · Pulse dashboard tile via session handoff · HumHub installed, Careon-themed, Spaces + Mail configured, OIDC integrated with role mapping · store submissions under client accounts (no mic/camera permissions) · admin onboarding · backups, monitoring, restore drill.

**Acceptance:** all employees onboarded via the identity hub; SSO into both modules on web and in the app; tiles match entitlements with server-side enforcement; deactivation locks a test account out of everything; push + deep links on iOS and Android; Space isolation; restore drill passed; both apps approved.

### ⬜ Phase 2 — Calling module (§22)

`meeting-core`, JaaS web embed, JWTs on the Supabase `sub`, invitations, native Jitsi screen in the shell, webhooks, permissions, shell update release. Scope stays push → tap → join (D5).

### ⬜ Phase 3 — Recording & AI module (§22)

`meeting-recordings` + R2 archive, pipeline jobs, `meeting-intelligence` (Gemini, Vertex EU), report review/approval, usage metering, retention automation — with healthcare access defaults: recordings, transcripts, and reports visible only to organizer + administrators until explicitly shared (§12, §18).

---

## 3. Open items needing a human decision

Full list: blueprint §25. Currently most urgent:

1. Developer-account legal entity (Careon entity vs TGC Groep) — blocks store enrollment
2. Platform domain
3. Recording-consent notice wording (client's counsel; healthcare context) — needed before Phase 3, drafted best during Phase 1
4. Comms-module branding: removing the "Powered by HumHub" footer/email links requires the HumHub **Professional Edition** `whitelabel` module (recurring cost, price via HumHub's configurator) — affects the §21 recurring structure; also confirm the module's client-facing product name (launcher tile currently says "YAAZ")
5. Facturatie e-mail go-live: **DPA incl. SCCs with Resend** (owner; US provider — owner decision 13 Aug, D19 amendment) + **sender domain incl. DKIM/SPF** (waits on the platform-domain decision, item 2), then the three `CAREON_MAIL_` keys in Vercel — the build is ready and fail-closed until then (13 Aug 2026, handoff 15 §0.5; checklist in `PRODUCTION_MODE.md`). Per D19 Resend is the platform-wide choice, shared with HumHub's `SMTP_*` in `platform-deploy` on the same sender domain
6. Facturatie **UBL/Peppol** (client answer V7): only needed once municipalities/government bodies are invoiced directly — today iWmo/iJw message traffic runs outside the module. The EN 16931 column semantics keep that door cheap; decide when a public-sector recipient actually appears
