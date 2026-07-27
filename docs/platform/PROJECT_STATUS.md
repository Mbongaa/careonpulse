# Careon Pulse — Project Status & Timeline

**Last updated:** 27 July 2026 · **Companion to:** `docs/platform/PLATFORM_BLUEPRINT.md` (v2.0, authoritative)

This file tracks where the platform stands: what exists, what is in progress, and what comes next. Agents and developers update it when a milestone changes state. Section references (§) point into the blueprint.

Legend: ✅ done · 🔵 current focus · ⬜ not started

---

## 1. Repository & infrastructure state (today)

### `careonpulse` (this repo) — Module 1: Pulse dashboard — ✅ live

- Next.js 16 / React 19 dashboard app (`src/`), deployed on Vercel; mobile-first, installable PWA
- Supabase (EU) schema in `supabase/migrations/`: org tenancy (`organizations`, `organization_members` with `org_admin`/`member`, platform superadmin), audit events, login rate limiting, auth security hardening (through 26 Jul 2026)
- AI-assistent on the hardened OpenAI regime (pinned snapshot, fail-closed moderation, eval suites) — see `AI_OPERATIONS.md`
- Post-login module launcher at `/modules` (27 Jul 2026) — web precursor of the shell tile launcher (§5): Careon Pulse Directie live, YAAZ coming-soon; registry in `src/data/careon/careon-modules.ts`. **Pending deploy:** the launcher, `/dashboard/beheer` gebruikersbeheer, the wachtwoord-link flow, and migration `0014_rename_org_tgc.sql` (already applied to the live database) exist in the working tree but are not yet committed/pushed — commit + push before the live app matches this list
- Quality gates: `verify:ci` suites, Playwright e2e + WCAG-AA audits, `RELEASE_GATES.md`, production readiness audit (24 Jul 2026)
- Platform docs: `docs/platform/PLATFORM_BLUEPRINT.md` (v2.0) + this status file; `AGENTS.md` platform section

### Sibling repositories (blueprint §8) — ⬜ not yet created

| Repo | Purpose | Status |
|---|---|---|
| `careonpulse-shell` | Flutter shell app: login, launcher, push, native Jitsi | ⬜ |
| `humhub-meeting-modules` | `meeting-core` / `meeting-recordings` / `meeting-intelligence` | ⬜ |
| `platform-deploy` | Hetzner/Coolify Compose stack, env templates, backups, `VERSIONS.md` | ⬜ |

### External services

| Service | Status |
|---|---|
| Supabase project (EU) — identity + dashboard data | ✅ live (OAuth 2.1 server mode ⬜ not yet enabled) |
| Vercel — dashboard hosting | ✅ live |
| Hetzner VPS + Coolify Cloud — comms plane | ⬜ not provisioned |
| JaaS (8x8), Cloudflare R2, Vertex AI (Gemini) | ⬜ accounts not created |
| Apple / Google developer accounts (client-owned) | ⬜ blocked on legal-entity decision (§25 Q2) |

---

## 2. Timeline

### ✅ Done

- **Pulse dashboard built, hardened, and live** — full KPI screens, AI-assistent, org-scoped auth, production audit passed (24 Jul 2026), auth hardening landed (26 Jul 2026)
- **Platform design finalized** — v1.0 blueprint (26 Jul: HumHub + JaaS + Gemini single-app design, hosting and vendor research, JaaS pricing verified) → multi-module pivot → **v2.0 blueprint (27 Jul)**: shell + Supabase identity hub + module registry; decision log locked D1–D18
- **Umbrella docs added to this repo** — blueprint v2.0, AGENTS platform section, this status file

### 🔵 Where we are now

Design is closed; build has not started. We are entering **Phase 0 — Audit & Foundations** (§22). Nothing exists yet for the shell, HumHub, or the meeting modules; the blueprint is the single source of truth for all of it. The one decision currently blocking an external clock: which legal entity owns the developer accounts (§25 Q2) — enrollment is the longest lead time in the plan.

### ⬜ Next — Phase 0: Audit & Foundations (gates before any feature code)

1. Create the three sibling repositories with thin AGENTS.md files pointing at the umbrella blueprint
2. Enable Supabase **OAuth 2.1 server mode**; register the shell and HumHub as OIDC clients
3. **Spike A — identity (gate):** shell PKCE login → HumHub OIDC login → auto-provisioning → role claim → deactivation propagation → logout; if blocked, invoke the Keycloak fallback (§4)
4. **Spike B — meetings (gate):** shell WebView ↔ native Jitsi bridge proof
5. Provision Hetzner + Coolify; deploy a skeleton HumHub to staging; record the compatibility matrix in `platform-deploy/VERSIONS.md`
6. Decide the developer-account legal entity and **start Apple/Google enrollment immediately**

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
