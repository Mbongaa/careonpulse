# Careon Pulse — Platform Blueprint

**Version:** 2.8 · **Date:** 22 August 2026 · **Status:** Approved for implementation · **Reconciles:** D23 with the owner's explicit request for Microsoft-native Teams calling inside YAAZ and D21 with the production-accepted Teams conversation renderer · **Supersedes:** v2.7 (D21 production reconciliation) · v2.6 (D14 OAuth access-token/RLS and one-time shell handoff clarification) · v2.5 (D21 calendar-write amendment) · v2.4 (D22, Entra-gated employee lifecycle and JIT membership) · v2.3 (D21, delegated Microsoft 365 data plane in YAAZ) · v2.2 (D20, hybrid authentication / Entra ID federation) · v2.1 (D19, facturatie module) · v1.0 (single-app HumHub blueprint)
**Prepared by:** Bayaan Hub · **Product:** Careon Pulse · **Current organization:** TGC Groep (multi-org-ready)

This document is the implementation source of truth for **Careon Pulse**: a multi-module employee platform in which users sign in once and open the modules their account is entitled to — the healthcare KPI dashboard (live today), the communication platform, and audio/video meetings with optional recording and AI meeting documentation. It is the **umbrella guide for AI agents and developers across all Careon Pulse repositories**; repository-local AGENTS.md files govern local conventions and defer to this document for platform-level decisions. Decisions marked **Confirmed** must not be changed silently; propose alternatives explicitly with consequences (Section 2).

---

## 1. Executive Summary

Careon Pulse is delivered as a **shell + modules** platform. A custom Flutter **shell app** (iOS/Android) provides native login, a tile launcher, push notifications, and deep links; each tile opens a module. Modules are independent applications behind one identity: users exist once, sign in once, and see only the tiles their account is entitled to.

The **identity hub** is the existing Careon Pulse Supabase project (EU): Supabase Auth extended with its OAuth 2.1 / OIDC server, reusing the organization/member/role model already in production for the dashboard. **Module 1 — Pulse dashboard** is live: a Dutch healthcare KPI dashboard (Next.js on Vercel) with organization-scoped RLS and a hardened OpenAI-based assistant. **Module 2 — Communication** is HumHub (PHP 8 / Yii2 / MariaDB) on a Hetzner VPS: feeds, chat, Spaces, files, notifications and the integrated Microsoft 365 work surfaces. **Module 3 — Meetings** now uses Microsoft Azure Communication Services (ACS) with Teams identity so employees can join scheduled Teams meetings and place or receive Teams calls inside YAAZ. The earlier JaaS/Jitsi implementation remains installed but disabled as a recoverable fallback; it is not the TGC production provider. The optional **recording + AI module** remains Phase 3 and must be redesigned against the eventual Microsoft recording/export contract before activation.

The platform is **multi-organization by design**: TGC Groep is the current organization, and further organizations can be onboarded later (each with its own memberships, entitlements, and its own HumHub installation, while identity stays central). For Microsoft 365 organizations, YAAZ additionally presents Outlook, calendar, Teams, SharePoint and shared documents through delegated Microsoft Graph access; the employee's existing Microsoft permissions remain authoritative (D21).

Delivery keeps the contracted phase structure — Phase 1 base platform, Phase 2 calling, Phase 3 recording & AI — extended in Phase 1 with the shell app and identity integration (additional scope, priced separately; Section 21). Hosting is heterogeneous by intent: Vercel for the dashboard, Supabase for identity and dashboard data, Hetzner for HumHub, and Microsoft ACS for Teams-interoperable media. R2 and Vertex remain candidate Phase-3 services only after the recording design is re-approved.

## 2. Confirmed Decisions (Decision Log)

Any change to a Confirmed decision must be proposed as an explicit alternative with consequences (cost, scope, timeline) — never applied silently. D1–D12 originate in v1.0 (D4 revised); D13–D18 were added in v2.0; D19 was added in v2.1; D20 was added in v2.2; D21 was added in v2.3 and amended in v2.5/v2.7; D22 was added in v2.4. **D23 was owner-confirmed on 22 Aug 2026 and explicitly supersedes the JaaS/Jitsi provider path in D3/D4 plus the invitation-only limit in D5 for TGC:** the active provider becomes Microsoft ACS with Teams identity, while the prepared JaaS code stays disabled and recoverable until the ACS acceptance matrix passes. The consequences are a TGC-owned Azure resource and metered ACS minutes, two additional delegated ACS permissions, short-lived call tokens in client memory, and a separate Phase-3 recording redesign.

| # | Decision | Choice (Confirmed) | Rationale | Rejected alternatives |
|---|---|---|---|---|
| D1 | Comms platform base | HumHub (PHP 8 / Yii2) | Mature module system; ~80% of the comms feature set out of the box | Building comms from scratch |
| D2 | HumHub database | MariaDB in the Compose stack | Hard HumHub requirement — no PostgreSQL support | Supabase/PostgreSQL as HumHub's DB; managed MySQL |
| D3 | Meetings — **superseded for TGC by D23** | JaaS (8x8), retained disabled as rollback only | The original provider foundation remains reproducible but is no longer the requested Microsoft-native experience | LiveKit |
| D4 | Mobile apps — **revised v2.0/v2.8** | Careon Pulse Flutter shell with native iOS/Android ACS Calling SDK adapters in Phase 2 | Microsoft publishes first-party iOS/Android SDKs but no first-party Flutter SDK; narrow platform channels preserve the shell while avoiding a meeting WebView | Native Jitsi screen (superseded for TGC); HumHub-app fork; fully native apps per module |
| D5 | Phase-2 calling scope — **expanded by D23** | WhatsApp-like in-app Teams voice/video calling and validated meeting join; active clients may receive/accept Teams calls | This is the owner-requested workplace experience. Native background ringing/CallKit/PushKit and PSTN remain separately accepted increments | Redirect-only Teams links; carrier/PSTN scope in the first release |
| D6 | Meeting AI | Gemini Flash-class multimodal via **Vertex AI, EU region**; model configurable | Structured JSON, audio+video capable, EU processing | Consumer AI Studio endpoint; hard-coded model |
| D7 | AI input strategy | Audio-first (ffmpeg); video frames only when JaaS reported screen sharing | ~10× cheaper and faster than full-MP4 uploads | Full MP4 by default |
| D8 | Recording storage | Cloudflare R2 (S3-compatible), EU jurisdiction | No egress fees, lifecycle rules, signed private downloads | Media in the database or on VPS disk |
| D9 | Queue | Redis + yii2-queue + Supervisor from Phase 1 | HumHub uses the queue anyway; avoids topology change | DB-backed queue (fallback only) |
| D10 | Comms hosting | Hetzner CX VPS + Coolify Cloud (GitHub push-to-deploy); provider-portable Compose | ~€11–17/month vs ~€30–45/month PaaS | Railway; Render |
| D11 | HumHub tenancy | One HumHub installation per organization | HumHub is not native multi-tenant; clean isolation | Shared multi-tenant HumHub |
| D12 | App distribution | Client-owned Apple/Google accounts; Phase-1 build ships **without** mic/camera permissions | Apple policy for single-company apps; faster first review | Bayaan-owned accounts |
| D13 | Platform shape | Multi-module shell + tile launcher; tiles shown per account **entitlement** | Client requirement; every future idea becomes a sellable module | Single-app platform (v1.0 shape) |
| D14 | Identity | The existing careonpulse **Supabase project (EU)** is the platform identity hub via its OAuth 2.1 / OIDC server; all modules are OIDC/first-party clients; **Keycloak is the documented fallback IdP** | Already hardened, org-scoped and EU; users exist once. Supabase OAuth access tokens are normal signed user JWTs, so least privilege is enforced through RLS plus exact-client-bound server APIs—never an assumed custom scope or a service-role credential. | Dedicated identity-only Supabase project; Keycloak as primary |
| D15 | Dashboard module | Careon Pulse dashboard stays Next.js on **Vercel**, first-party Supabase Auth unchanged | Live, gated, and production-hardened; no reason to move | Re-hosting on Coolify |
| D16 | Organizations | Multi-org from the start: TGC Groep now, more organizations onboardable later | The tenancy model already exists in production | Hard-coding a single org |
| D17 | AI vendors per module | OpenAI (pinned snapshot) stays dashboard-only; Gemini/Vertex is used only for meeting transcription & reports | Each module keeps its proven, audited AI regime | Consolidating on one vendor |
| D18 | Repositories | `careonpulse` stays a single-app repo and hosts the umbrella docs; shell, HumHub modules, and deploy live in sibling repos | The dashboard's CI gates are tuned to one Next.js app; Flutter + PHP would fight them | One physical monorepo |
| D19 | Facturatie module (v2.1) | Invoicing is a standalone route section (`/facturatie`, own module shell + menu) with its own Supabase schema **inside Module 1**, not a fifth repo or OIDC client. Access limited to `org_admin` + superadmins **with** org membership, enforced on four layers (launcher filter, server page gate, `requireOrgAdmin()` per API route, RLS `app.mag_facturatie_zien`); tile visibility is a precursor of D13 entitlements, not a replacement. No AI tools on invoice data in phase A (privacy grounds; D17 unchanged). Final PDFs live immutably in the platform's **first Supabase Storage bucket** (`facturen`, private, EU) with its own backup regime — D8 (R2) stays recordings/HumHub-backups only. E-mail dispatch is phase B; the transactional mail provider will be **one platform-wide choice** (dashboard + HumHub `SMTP_*` in `platform-deploy`, same sender domain/DKIM/SPF), settled with a DPA before the first real send. **Amendment 13 Aug 2026 (owner decision): the provider is Resend (US)**, deviating from the EU-sovereign proposal (Brevo) in client answer V17. Consequences, explicitly accepted by the owner: US jurisdiction (CLOUD Act) and DPF/SCC reliance for the recipient address and the attached invoice PDF — which for private clients implies GGZ care. Mitigations: DPA incl. SCCs signed **before** activation, dispatch fail-closed until then, and the provider isolated in one file (`mail.server.ts`) so swapping back stays a small change. The platform-wide clause (same provider for HumHub `SMTP_*`) stays in force. Full spec: `agent-handoff/15-facturatie.md`. | The CI gates are tuned to one Next.js app (D18) and hosting/auth stay unchanged (D15); D14 stays intact because invoice data lives under the dashboard plane's first-party sessions and RLS | Separate first-party Supabase app (allowed by D14 §4 but fights D18) |
| D20 | Authentication methods (v2.2, provisioning amended by D22) | **Hybrid authentication; login method is organization policy** (owner-confirmed 13 Aug 2026). The Supabase hub (D14) stays the single identity point for all modules; Microsoft **Entra ID federates into the hub as an upstream provider** (Supabase Azure provider; single-tenant app registration in the customer's tenant). Modules keep speaking OIDC to the hub and never see Entra. "Inloggen met Microsoft" is the primary path for TGC employees; e-mail/wachtwoord stays for platform administration, demo/e2e and break-glass. Identity linking requires verified-e-mail equality (UPN/primary mail must equal the account e-mail). Membership provisioning follows D22. Enforcement is phase 2: `sso_verplicht` per organization (exception: `platform_admins`), activated for TGC only after proven adoption. Full original spec: `agent-handoff/16-office365-yaaz-modules.md`. | Employees use the existing Microsoft work account and TGC's MFA/Conditional Access; ordinary employee passwords disappear from the Careon lifecycle while the Supabase hub and module OIDC contracts remain intact | Microsoft-only platform-wide (breaks superadmin outside the tenant, demo/e2e accounts, non-M365 organizations per D16, and break-glass); Entra as direct IdP per module (breaks D14, duplicates client registrations, loses the hook-0019 org/role claims) |
| D21 | Microsoft 365 data inside YAAZ (v2.3; amendments v2.5/v2.7/v2.8) | **A separate single-tenant Entra registration gives YAAZ delegated Microsoft access per employee.** The D20 login registration remains identity-only. YAAZ uses authorization code + PKCE and stores renewable tokens AES-256-GCM encrypted with per-user associated data; the Microsoft mail/UPN must exactly match the HumHub e-mail. Production `careon-m365` 0.14.0 provides Outlook mail/search/read/download and bounded send/reply, conflict-safe calendar writes plus validated Teams links, joined-team/channel navigation with corrected real-message rendering and bounded root/reply forms, ACL-aware Search, and canonical SharePoint browse/download/upload/subfolder controls. The exact capability-specific permissions and flags are active after TGC consent while the legacy all-writes switch stays off. Graph remains employee-delegated and ACL-authoritative; provider content is transient. Application permissions, tenant directory reads, Teams chats/hosted rich content/edit/delete/reactions, mail HTML/MIME/drafts/forward/reply-all/outgoing attachments, calendar bodies/attendees, file overwrite/move/delete/share/ACL changes, transparent sync and embedded Office remain excluded. | Delivers the requested workplace while preserving per-user ACLs, revocable consent and independent capability gates. | Reusing D20 login; app-only Graph; provider tokens in the browser; one all-writes switch; transparent sync; iframe embedding of Microsoft 365 |
| D22 | Entra employee lifecycle and JIT membership (v2.4) | **Entra is authoritative for employee identity and Careon eligibility; Careon remains authoritative for organization role and module/data entitlements** (owner-confirmed 21 Aug 2026). The D20 enterprise app requires assignment. TGC-IT assigns approved employees—preferably through a dedicated `Careon Pulse — Users` group—to app role `Careon.User`. On first Microsoft login, Careon validates Azure provider, exact `tid`, optional account-type claim `acct=0` (tenant member, never guest), `xms_edov`, exact normalized e-mail and the app-role claim in both application code and a service-role-only database transaction; an eligible identity receives exactly one TGC `member` row and an audit event. JIT can never create `org_admin`, superadmin or confidential module entitlements. Missing/partial configuration, missing/wrong account type, wrong tenant, absent role, guest/mismatch and concurrent duplicates fail closed. Existing break-glass/platform-admin paths remain. Directory inventory and offboarding use a third, dedicated least-privilege provisioning connector; neither D20 identity nor D21 personal-data credentials are repurposed. | Scales onboarding from manual invitations to the eligible workforce while retaining least privilege, deterministic role ownership and auditability. Normal employees need no Careon password/invite; delegated D21 Microsoft 365 access still requires one personal authentication. Group-based assignment may require Entra ID P1/P2; direct user assignment is the safe fallback. | Authorize every tenant object or e-mail domain (guests/shared/service/dormant accounts); bulk-create local passwords; map Entra directory roles to Careon admin roles; reuse D21 delegated tokens or the identity registration for directory synchronization |
| D23 | Microsoft-native Teams calling in YAAZ (v2.8) | **Use Azure Communication Services Calling SDK authenticated as the employee's Teams identity** (owner-confirmed 22 Aug 2026). A TGC-owned ACS resource performs the server-side Entra→ACS token exchange. The call client receives only a short-lived ACS token in memory and never the resource connection string/key or Microsoft refresh token. The existing D21 app may request the two Microsoft-required delegated scopes `Teams.ManageCalls` and `Teams.ManageChats` through a separately gated call consent path; no application permission exists. Web delivery starts with (1) join the already-validated Outlook `onlineMeeting.joinUrl` inside YAAZ and (2) one-to-one voice/video from Messenger contacts resolved to their Entra object IDs, followed by active-client incoming-call handling. The later shell uses Microsoft's native iOS/Android SDKs behind Flutter platform channels. The prepared JaaS/Jitsi code and flags stay disabled as fallback until the ACS matrix is accepted. | Keeps Teams identity, policies, call history and meetings authoritative while employees remain in the Careon/YAAZ experience. Microsoft officially supports Teams-user meeting join, one-to-one/group Teams calls, incoming calls, web/iOS/Android clients and customizable UI. Consequences: ACS usage is metered; every caller needs an applicable Teams license; PSTN requires Teams Phone; web incoming calls require an initialized active client; full Teams UI parity and force-closed native ringing are not implied. `Teams.ManageChats` is required by Microsoft's token exchange even when YAAZ messaging remains Graph/HumHub-based. Phase-3 recording/transcription is not inherited from JaaS and remains off until separately designed, consented and accepted. | Iframing the Teams client (unsupported); continuing redirect-only joins; activating the third-party JaaS provider against the owner's Microsoft-native request; exposing an ACS resource key or renewable Microsoft token to the browser |

## 3. System Architecture

Live WebRTC media flows through Microsoft ACS/Teams between clients — **no Careon Pulse server carries call streams**. Hetzner authenticates the YAAZ employee, obtains a resource-authenticated short-lived ACS Teams-user token, and serves the call UI; the long-lived Microsoft refresh token and ACS resource credential remain server-side. Vercel serves the dashboard and Supabase remains the platform identity authority.

<!-- diagram: architecture -->
```mermaid
flowchart LR
  subgraph Users["Employees (multi-org)"]
    SHELL["Careon Pulse shell app<br/>Flutter iOS/Android"]
    WEB["Browser / PWA"]
  end
  SUPA["Supabase (EU)<br/>identity hub: OAuth 2.1/OIDC<br/>+ dashboard data (RLS)"]
  DASH["Module 1 — Pulse dashboard<br/>Next.js on Vercel"]
  HH["Module 2 — Comms (HumHub)<br/>Hetzner · MariaDB · Redis · workers"]
  ACS["Azure Communication Services<br/>Teams voice · video · meetings"]
  R2["Cloudflare R2 (EU)"]
  GEM["Vertex AI — Gemini (EU)"]
  PUSH["FCM / APNs"]
  ENTRA["Microsoft Entra ID<br/>upstream login provider"]
  GRAPH["Microsoft Graph<br/>Outlook · Teams · SharePoint"]
  SHELL -->|OIDC login PKCE| SUPA
  SHELL -->|tiles: WebView + session handoff| DASH
  SHELL -->|tiles: WebView + session handoff| HH
  WEB --> DASH
  WEB --> HH
  DASH -->|first-party auth · RLS| SUPA
  HH -.->|OIDC client · auto-provision| SUPA
  ENTRA -->|identity-only federation D20| SUPA
  HH -->|delegated per-user Graph D21| GRAPH
  ENTRA -->|delegated call scopes D23| ACS
  HH -->|server-side Teams token exchange D23| ACS
  WEB -->|ACS Calling Web SDK| ACS
  SHELL -->|native iOS/Android ACS adapter P2| ACS
  HH -.->|Phase 3 only after redesign| R2
  HH -.->|Phase 3 only after redesign| GEM
  HH -->|notifications| PUSH --> SHELL
```

### 3.1 Runtime planes

| Plane | What runs there | Deployed via | From phase |
|---|---|---|---|
| Supabase (EU) | Supabase Auth + OAuth 2.1/OIDC server; organizations, members, roles, tile entitlements; Pulse dashboard schema (RLS) incl. facturatie (D19); audit + rate-limit tables; Storage bucket `facturen` (private — final invoice PDFs + org logo, own backup regime) | SQL migrations in `careonpulse/supabase` | live |
| Vercel | Pulse dashboard (Next.js 16), maintenance cron | Git push (Vercel) | live |
| Hetzner VPS | Nginx, HumHub (PHP-FPM) + meeting modules, MariaDB, Redis, queue worker, cron | Coolify Cloud, GitHub push-to-deploy | 1 |
| Client devices | Careon Pulse shell app (Flutter), browsers/PWA | App Store / Play (client accounts) | 1 |

### 3.2 External services

| Service | Purpose | Data exchanged | From phase | Pricing basis |
|---|---|---|---|---|
| Supabase | Identity hub + dashboard datastore + facturatie (D19: schema + private Storage bucket) | OIDC tokens, identity claims; dashboard data (RLS); invoice PDFs | live | Plan-based, EU project |
| Vercel | Dashboard hosting | HTTPS app traffic | live | Plan-based |
| Azure Communication Services | Microsoft-native Teams call/meeting media and SDKs | Short-lived Teams-user ACS token to the active client; WebRTC media/signaling | 2 | Metered ACS audio/video minutes; no separate interop fee |
| JaaS (8x8) — dormant fallback | Recoverable pre-D23 provider only | No production credential, media or billing | none while D23 is active | No subscription to activate |
| Cloudflare R2 | Recording archive; HumHub DB backups | MP4 files, SQL dumps | 1 (backups), 3 (media) | ~$0.015/GB-month; no egress fee |
| Vertex AI (Gemini) | Meeting transcription + report | Audio segments out; validated JSON in | 3 | Per-token, model configurable |
| FCM / APNs | Push to the shell app | Title + deep link only | 1 | Free |
| GitHub + Coolify Cloud | CI/CD and orchestration (Hetzner plane) | Images, config | 1 | Coolify ~$5/month |
| Hetzner | VPS + snapshots | — | 1 | ~€5.49–10/month + 20% backup add-on |
| Transactional e-mail — **Resend** (facturatie phase B) | Invoice dispatch from the dashboard; later HumHub's `SMTP_*` on the same sender domain | Recipient address, invoice number, amount, due date; the PDF as attachment | phase B — built 13 Aug 2026, **fail-closed** | **Resend selected** (owner decision 13 Aug 2026, deviating from the EU-sovereign proposal — consequences recorded in D19). US jurisdiction: DPA **incl. SCCs** required. Still one platform-wide choice per D19. Build live but dispatch disabled (route answers 503) until the DPA is signed and the sender domain incl. DKIM/SPF is verified; free tier likely sufficient |
| Microsoft Entra ID + Microsoft Graph | D20 upstream employee login; D21 delegated Outlook/calendar/Teams/SharePoint; D23 Teams-user call authorization | Identity claims to Supabase; per-user Graph responses; encrypted renewable Microsoft tokens on the YAAZ server; ACS call token minted per active client | D20/D22 identity and lifecycle live; D21 mail/calendar/files plus corrected Teams conversations are accepted; D23 web calling is active on TGC's Europe ACS resource through `careon-m365` 0.15.2, with real token exchange accepted and two-user media acceptance still pending a second connected employee | Included with applicable Microsoft 365/Teams licenses; tenant app registrations and consent owned by TGC-IT |

## 4. Identity & SSO

**Hub (Confirmed, D14).** The existing careonpulse Supabase project (EU region) is the platform's identity authority. It already provides Supabase Auth with cookie sessions, an organization/member model (`org_admin` / `member` per organization plus a platform-level superadmin), login rate limiting, and audit events — all in production. v2.0 adds two things: the **OAuth 2.1 / OIDC server** (so external modules can federate) and a per-account **tile entitlement** model (Section 5).

**Upstream provider (Confirmed, D20 + D22 — v2.4).** For organizations on Microsoft 365, **Entra ID federates into the hub as an upstream provider** (Supabase Azure provider; single-tenant app registration in the customer's tenant, redirect URI = the hub's `/auth/v1/callback`). The Entra optional claims `acct` and `xms_edov` are required before JIT activation so Careon can distinguish tenant members from guests and treat the returned e-mail as verified. The federation is invisible below the hub: modules keep speaking OIDC to the hub only. Login method is organization policy — hybrid by default (Microsoft primary for employees; e-mail/wachtwoord retained for platform administration, demo/e2e, break-glass), per-organization enforcement (`sso_verplicht`) is a later, explicit phase. D22 permits JIT creation of the least-privileged `member` row only for `acct=0`, the exact tenant and assigned `Careon.User` app role; identity linking still requires exact verified-e-mail equality. Original login spec: `agent-handoff/16-office365-yaaz-modules.md`; tracked rollout and acceptance: `docs/platform/PLATFORM_GAP_REGISTER.md` G01.

**Microsoft 365 data plane (Confirmed, D21 — v2.3; amended v2.5/v2.7/v2.8).** Office data is not an identity-token concern. YAAZ uses its own single-tenant Entra app and per-employee authorization-code + PKCE consent to call Microsoft Graph. The employee connects once after entering YAAZ; the server verifies that Graph `mail` or `userPrincipalName` exactly equals the HumHub account e-mail before storing an encrypted, renewable connection. The login registration remains identity-only, and Graph access can be revoked without breaking platform SSO. Production `careon-m365` 0.14.0 includes paged/searchable Outlook mail with inert-text detail and guarded downloads; conflict-safe calendar writes and validated Teams links; joined-team/channel navigation with real conversation rendering and bounded plain-text root/reply forms; canonical SharePoint browse/download/upload/subfolder controls; and ACL-aware Microsoft Search. Capability-specific tenant-consented mail-send, Teams-content/send and file-write gates are active while the legacy all-writes switch remains off. Microsoft content stays transient; rich hosted Teams content, broad mail/calendar payloads and destructive/share/ACL file operations remain outside the boundary. The implementation and tenant handoff are in `agent-handoff/17-microsoft365-yaaz-deliverable.md`; current evidence is in G02–G05.

**Microsoft Teams call plane (Confirmed, D23 — v2.8).** Calling is not implemented with Microsoft Graph and never uses the D20 Supabase login token. YAAZ obtains an Entra access token for the dedicated ACS resource scopes, proves tenant/user/client continuity against the existing D21 connection, and exchanges it server-side through the TGC-owned ACS resource. Only the returned short-lived Teams-user ACS token crosses to the active call page, under `no-store`; it is held in JavaScript memory and never written to MariaDB, browser storage, a URL or logs. The ACS resource credential stays in the deployment secret store. The web client uses `createTeamsCallAgent()` to join an exact validated Teams meeting link or call an exact server-authorized Entra object ID. Camera/microphone permission is requested only after the employee starts or accepts a call. Incoming-call handling is available while the call client is initialized; background-native ringing remains a later shell increment.

**Authentication flows.**

| Client | Flow |
|---|---|
| Shell app | Native OIDC authorization-code + PKCE against the Supabase authorize endpoint; tokens in secure storage; refresh handled by the shell |
| Pulse dashboard | Unchanged: first-party Supabase Auth (`@supabase/ssr` cookie sessions), enforced in `src/proxy.ts` and every API route |
| HumHub | OIDC client module against the project's discovery endpoint (`/.well-known/openid-configuration`); auto-provisions the local HumHub account on first login; `org_admin` claim maps to HumHub administrator |
| WebView tiles | The shell requests a short-lived, single-use handoff for the exact account + entitled module. The module consumes it server-to-server over HTTPS and establishes its own HttpOnly/Secure web session; access/refresh tokens never enter a URL, JavaScript, local storage, push payload or analytics. Modules never show a second login screen. |
| Future modules | Register as an OIDC client (or first-party Supabase app); appear as a tile; done |

**Claims & identifiers (v2.6/v2.8 clarification).** The Supabase `sub` remains the stable cross-module identity and HumHub external identity key. D23 call routing uses the separately verified Entra `oid` only at the Microsoft boundary; the server must never infer it from an e-mail-shaped client parameter. Standard ID-token/userinfo fields supply subject, name and e-mail. Organization/role information lives in the namespaced `careon` claim added to access tokens by migration `0019`, while the versioned module-registry/entitlement endpoint remains authoritative for launcher visibility. Custom role or entitlement data must never be placed in user-writable metadata or assumed to appear in the closed ID-token structure.

**Blast radius (technical clarification recorded 22 Aug 2026).** Supabase's OAuth 2.1 server currently exposes the standard OIDC scopes (`openid`, `email`, `profile`, `phone`) rather than custom resource scopes, and its access token is the normal signed user JWT for the project. It can therefore exercise only the rows/actions that the same user is allowed through RLS; a scope string is not an authorization boundary. The shell registry compensates explicitly: it validates JWT signature/expiry, confirms the current non-banned user, requires the exact registered public shell `client_id`, uses the anon key plus the caller's token, reads only the caller's own organization membership under RLS, returns no token and never imports the service-role key. Module APIs continue to authorize organization/role/entitlement server-side. The service-role key remains server-side in the dashboard plane only.

**Lifecycle.** Under D22, TGC-IT controls employee eligibility through the D20 enterprise-app assignment/app role while Careon administrators control roles and module/data entitlements. First eligible login may atomically create only a `member` membership. Organization role changes propagate at platform-token refresh. Disabling/removing an employee in Entra blocks the next interactive Microsoft login but does not revoke an already-issued Supabase refresh token by itself. Production offboarding therefore includes identity-hub blocking/session invalidation and D21 Graph-token deletion; the dedicated provisioning connector reconciles assignment/account state without reusing either D20 or D21 credentials. Tenant-side consent and Microsoft-session revocation remain TGC-IT controls.

**Phase-0 gate — status 22 Aug 2026.** The server-side OAuth protocol, ES256 validation, consent, HumHub OIDC, auto-provisioning, role claim, controlled deactivation, public shell client/registry boundary and one-time module-session handoff are implemented and production-verified. The native shell implements authorization-code + PKCE, secure refresh and the memory-only POST handoff; a live TGC account traversed Careon → YAAZ → consent → YAAZ callback without a second login, while replay and foreign-organization paths failed closed. The remaining identity/device acceptance is a signed physical-device system-browser → exact app callback → registry/module run plus application-level logout verification. Keycloak remains the documented fallback only if that device gate reveals a hard provider blocker; modules assume an OIDC provider, never a brand.

## 5. Shell App & Module Registry

<!-- diagram: modules -->
```mermaid
flowchart TD
  SHELL["Careon Pulse shell (Flutter) — Phase 1"] -->|authenticates| SUPA["Supabase identity hub (EU)"]
  SHELL --> DASH["Tile: Pulse dashboard (live)"]
  SHELL --> HH["Tile: Comms — HumHub (Phase 1)"]
  SHELL --> MEET["Native: Teams calling — ACS (Phase 2)"]
  REC["Recording + AI — Phase 3"] --> MEET
  DASH -.-> SUPA
  HH -.->|OIDC| SUPA
```

**Shell responsibilities (build in progress, repo `careonpulse-shell`).** Native login (Section 4); secure token storage and refresh; the **launcher**; push notifications (FCM/APNs); deep links (`careonpulse://<module>/<path>`); the WebView module container; and, from Phase 2, narrow native Swift/Kotlin adapters around Microsoft's ACS Calling SDK. The dormant Jitsi contract remains compile-time disabled until removed in a separately verified cleanup after ACS acceptance. The current branded Android/iOS foundation retains no media permission; microphone/camera declarations arrive only with the reviewed native ACS increment.

**Module registry.** The launcher is server-driven: the shell fetches a tile registry from the identity plane — per tile: id, display name, icon, type (`webview` | `native`), URL or native route, required entitlement, minimum shell version, enabled flag. Shipping a new module is a registry entry plus an entitled account, not an app release. Careon commit `4873a67` puts schema v1 live at `GET /api/mobile/v1/modules`; it is bearer-only, exact-client-bound, RLS-backed, no-store and shares the web launcher's Facturatie role predicate. Careon `a2f9b7f` adds the companion one-time handoff contract for those exact registry targets. The first public shell client has no secret and permits only its exact app callback.

**Entitlements (Confirmed, D13).** Module access is governed per account: organization role provides defaults, explicit per-account grants override. The launcher renders only entitled tiles, and **every module enforces the same entitlement server-side** — the launcher is convenience, not security. Entitlements are managed by administrators in the identity hub. The **Facturatie tile (D19)** is the first role-gated tile in the live registry — `zichtbaarVoor: "org_admin"`, filtered server-side before the registry reaches the client and re-enforced by the module itself — and is the working precursor of these per-account entitlements, not a substitute for them.

**WebView contract for modules.** One-time, short-lived session handoff instead of login screens (Section 4); responsive mobile-first layouts with safe-area support; no auth flows that require popups or new tabs; file upload/download routed through shell handlers. Handoff material must be single-use, bound to account + entitled module, consumed server-side over HTTPS and exchanged for an HttpOnly/Secure module session; it must never be placed in a launch URL, JavaScript, local storage, logs, analytics or push. The one-time Careon and YAAZ handoff is now production-accepted; native upload/download bridges and signed-device acceptance remain G09 pilot gates. **Documented exception (D19, client-approved):** the facturatie editor's embedded PDF preview is desktop-first — on small screens it opens the blob in a new tab, and once Module 1 runs as a shell tile, preview-open and PDF download must route through the shell handlers.

**Store posture.** Client-owned developer accounts (D12); the Phase-1 build ships without microphone/camera permissions, making Phase 2 a routine update. Apple's minimum-functionality rule (4.2) is satisfied by native login, launcher, push, deep links, and later the native meeting screen — the shell is an app with web content inside, not a wrapped website.

## 6. Capability Matrix

One row per capability: where it comes from and what we must do.

| Capability | Provided by | Our work | Phase |
|---|---|---|---|
| One login for everything (SSO), org roles, account lifecycle | Supabase (existing) + OAuth 2.1 server | Enable server mode; claims; spike | 1 |
| Tile launcher, per-account entitlements, push, deep links | — | **Build: shell app + registry + entitlements** | 1 |
| Healthcare KPI dashboard incl. AI-assistent | Careon Pulse dashboard (live) | Embed as tile (session handoff) | 1 |
| Invoicing (facturatie): PDF invoices with live preview, contacts, admin-only | Built inside Module 1 (D19, live) | E-mail dispatch (phase B, platform-wide mail provider) | 1 |
| Feed, announcements, comments, reactions, mentions | HumHub core | Configure | 1 |
| Private/group messaging + attachments | HumHub Mail module | Enable + configure | 1 |
| Profiles, directory, groups, Spaces, files, search, notifications | HumHub core | Configure; OIDC auto-provisioning | 1 |
| Branded comms web + PWA | HumHub theming | Custom theme (Careon brand) | 1 |
| Teams 1:1/group audio-video, meeting join, screen share, reconnection | Microsoft ACS Calling SDK | Integrate web client + native iOS/Android adapters | 2 |
| Call authorization, contact routing, invitations and sessions | YAAZ + Entra + ACS | **Build: fail-closed D23 token/call boundary** | 2 |
| Recording capture + consent indicator | Microsoft contract to be selected | Redesign and approve before activation | 3 |
| Recording archive, playback, retention | — | **Build: `meeting-recordings`** | 3 |
| Transcript, summary, decisions, action items + approval UI | Gemini (Vertex EU) | **Build: `meeting-intelligence`** | 3 |
| Usage metering + monthly export | — | Build (meeting modules) | 3 |
| Additional organizations | Supabase org model (existing) | Onboard: org row + members + HumHub install | later |
| Future modules/dashboards | — | Web app + OIDC client + registry entry | per module |
| OS-level call ringing, PSTN/SIP, action items → tasks, SSO/LDAP federation | — | Explicit future enhancements | future |

## 7. Organizational Model & Tenancy

**Source of truth** for who exists, in which organization, with which role and entitlements: the identity hub (`organizations`, `organization_members` with `org_admin`/`member`, platform superadmin). The Pulse dashboard is already organization-scoped through RLS on this model; the demo organization stays isolated per the repo's guardrails.

**Current state (Confirmed, D16).** TGC Groep is the active organization. Additional organizations can be onboarded later: a new organization row, its memberships and entitlements — and, for the comms module, a **new HumHub installation** (D11: one install per organization; on Coolify that is one additional project or server). Identity stays central; the dashboard is multi-org natively.

**Inside an organization**, the HumHub Space model from v1.0 is unchanged: a company-wide Space, a private management Space, Spaces per department/location/project, and temporary working groups, each with its own members, content, permissions, and Space administrators. Role mapping: identity-hub `org_admin` → HumHub administrator; `member` → regular user; the platform superadmin (Bayaan Hub operations) never flows into client-visible module roles automatically.

## 8. Repository & Version Strategy

Four repositories, one platform (Confirmed, D18):

| Repository | Contents | Deploys to | Notes |
|---|---|---|---|
| `careonpulse` | Pulse dashboard (Next.js) + **umbrella platform docs** (`docs/platform/`) | Vercel | Existing CI gates (`verify:ci`, release gates) stay untouched; AGENTS.md gains a pointer section to the umbrella docs |
| `careonpulse-shell` | Flutter shell app | App Store / Play (client accounts) | Own thin AGENTS.md deferring to the umbrella |
| `humhub-meeting-modules` | `meeting-core`, `meeting-recordings`, `meeting-intelligence` | Installed into HumHub | Independent semver per module |
| `platform-deploy` | Docker Compose, Nginx config, env templates, backup/restore scripts, `VERSIONS.md` | Hetzner via Coolify | `main` → production, `develop` → staging |

**Version pinning.** Phase 0 records the compatibility matrix in `platform-deploy/VERSIONS.md`: HumHub/PHP/MariaDB, Flutter/Dart, Supabase/OIDC, the ACS Calling Web SDK and the matching first-party iOS/Android ACS SDKs. The dormant `jitsi_meet_flutter_sdk` proof remains pinned only as rollback evidence and is not linked into the shipping shell. Upstream security releases are applied under maintenance with the cross-platform call matrix rerun before activation.

**Documentation rule for agents.** Platform-level decisions live in `careonpulse/docs/platform/PLATFORM_BLUEPRINT.md` (this document). Each repository's AGENTS.md governs local conventions only and links back here. The dashboard's existing conventions (Biome, co-location, shadcn rules, conventional commits) are unaffected.

**Licensing.** Detailed license analysis remains deferred by instruction and must complete before production release (HumHub CE terms, marketplace items, Flutter/npm dependencies).

## 9. Calling Integration Boundary

### 9.1 Active provider — Microsoft ACS with Teams identity

The D23 implementation lives with the existing YAAZ Microsoft boundary because it already owns the verified per-user Entra connection and validated Outlook meeting links. The call feature is independently fail-closed. It requires the two ACS delegated scopes, a TGC-owned ACS endpoint and resource credential, an exact tenant, an employee connection whose Microsoft account still matches the HumHub account, and an explicitly enabled production capability. Missing any one condition renders a useful unavailable state and performs no token exchange or media operation.

The backend exchanges a call-scoped Entra access token through ACS using the employee's verified Entra object ID and the configured client ID. The browser receives `{token, expiresOn, mode, target}` only after revalidating the requested meeting or contact. Responses are `no-store`; secrets and tokens are excluded from logs and browser storage. The resource connection string/key never crosses the server boundary.

### 9.2 Dormant `meeting-core` fallback

The installed `meeting-core` 0.1.0 and shell Jitsi contract remain disabled, credential-free and covered by their existing health/parity tests while ACS is implemented. They are rollback assets, not parallel production providers. No JaaS App ID, signing key, SDK artifact, media permission or billing account is activated. Removal is a later reversible-cleanup decision after the complete ACS web/mobile matrix passes.

### 9.3 Recording and intelligence

`meeting-recordings` and `meeting-intelligence` remain Phase-3 concepts, not active dependencies of calling. The former JaaS-specific webhook/24-hour-download assumptions are historical and must not be implemented against ACS by analogy. A Microsoft-supported recording/export source, consent behavior, retention, data region, API permissions, cost and participant-notification contract must be documented and accepted before those modules resume.

## 10. Microsoft Teams Calling in YAAZ

### 10.1 Web

YAAZ hosts a dedicated call surface using the ACS Calling JavaScript SDK. It creates a `TeamsCallAgent` from a short-lived token, asks for microphone/camera only after an employee action, and renders pre-call, ringing, connected, reconnecting and ended states in the Careon theme. A scheduled meeting uses only the server-revalidated exact Teams join URL. A direct call uses only a server-authorized `microsoftTeamsUserId`; the browser cannot supply an arbitrary Entra ID.

### 10.2 Messenger and contacts

The existing **Open chats / Contacten** switch gains voice and video actions for coworkers who are both messageable in the shared Space and resolved to an enabled, licensed Entra member. The action opens the YAAZ call surface and starts a one-to-one Teams call. HumHub chat remains HumHub and Teams chat remains Graph; the Microsoft-required `Teams.ManageChats` consent is not used as permission to silently migrate or duplicate conversations.

### 10.3 Outlook meetings

The existing **Deelnemen via Teams** control becomes **Deelnemen in YAAZ**, with the official Teams link retained as a visible fallback. The backend re-reads the Outlook event, rejects cancelled/non-Teams/lookalike URLs, and passes the validated locator to `teamsCallAgent.join()`. This creates an embedded call experience without iframing or reproducing the Teams application.

### 10.4 Incoming calls and mobile

While the web call client is initialized, `incomingCall` exposes an in-YAAZ ringing panel with accept/reject and caller identity resolved server-side where available. Reliable background/force-closed ringing belongs to the native increment: Swift and Kotlin ACS SDK adapters, CallKit/PushKit on iOS, and the reviewed Android foreground/full-screen notification contract. Flutter invokes those adapters through narrow platform channels; no resource credential or renewable Microsoft token enters Dart.

### 10.5 Supported boundary

Phase 2 includes Teams-user VoIP voice/video, scheduled/channel meeting join, active-client incoming calls, mute/unmute, device selection, video, screen sharing where the chosen SDK/platform supports it, hang-up and reconnection. It does not promise the full Teams UI, live events, joining an already-running unscheduled Teams 1:1/group call, background-native ringing in the first web release, PSTN/Teams Phone, call queues, recording, transcription or AI. Microsoft Teams policies and licensing remain authoritative.

## 11. Recording Pipeline & Storage


**Historical pre-D23 design — not approved for implementation against ACS.** The sequence below documents the dormant JaaS Phase-3 concept so earlier estimates and code can be understood. D23 requires a fresh Microsoft recording/export design before any recording credential, permission, webhook or worker is activated. The former $0.01/minute and 24-hour JaaS retrieval assumptions do not describe ACS/Teams.

<!-- diagram: sequence -->
```mermaid
sequenceDiagram
  participant O as Organizer
  participant H as HumHub (web/API)
  participant W as Queue worker
  participant J as JaaS (8x8)
  participant R as Cloudflare R2
  participant G as Gemini (Vertex)
  participant P as Participants
  O->>H: start recording (permission check)
  H->>J: startRecording()
  J-->>P: recording indicator (all clients)
  Note over H,G: meeting continues — recording stops on demand or at meeting end
  J->>H: webhook RECORDING_UPLOADED (signed · idempotencyKey · temp URL)
  H->>H: verify signature · dedupe · enqueue · HTTP 200
  H->>W: RetrieveRecording job (Redis)
  W->>J: download MP4 (link valid ≤ 24 h)
  J-->>W: MP4
  W->>W: checksum · ffmpeg audio extract · split 30–60 min
  W->>R: upload original MP4 (12-month retention)
  W->>G: Stage 1 — transcribe segments (strict JSON)
  G-->>W: transcript + speaker labels + language
  W->>G: Stage 2 — summary · decisions · action items
  G-->>W: validated report JSON
  W->>W: validate schema · save · status Completed
  W->>P: notification — AI report ready
  O->>H: review · edit · approve report
```

Workflow: (1) an authorized organizer starts recording; (2) every participant sees the indicator; (3) JaaS records; (4) JaaS sends lifecycle webhooks; (5) `RECORDING_UPLOADED` supplies a temporary authenticated link; (6) a worker downloads the MP4 immediately; (7) the checksum is verified and the file uploaded to R2; (8) metadata is saved in MariaDB; (9) the recording appears on the meeting page; (10) AI processing starts asynchronously.

**Storage (Confirmed, D8).** R2 bucket with the EU jurisdiction option; objects under `recordings/{meetingId}/{recordingId}.mp4`; nightly database dumps under `backups/`. MP4s are **never** stored in the database or on the VPS disk beyond temporary processing. The database stores: object key, file size, MIME type, duration, checksum, storage status, owner, meeting reference, created date, retention date, deletion status. Playback and download use temporary signed URLs (target TTL ≈ 15 minutes) after a permission check. A bucket lifecycle rule acts as a safety net at retention + grace period; the standard commercial retention is **12 months**.

## 12. AI Meeting Intelligence (Gemini)


**Account & endpoint (Confirmed, D6).** A paid Gemini account owned by the client or an approved production account (ownership: Open Questions), accessed through **Vertex AI with an EU processing region** (e.g. `europe-west4`, subject to model availability). The model is a current stable Gemini **Flash-class multimodal** model, selected in administration and recorded on every report — never hard-coded.

**Required output.** Full timestamped transcript; speaker labels where technically possible; detected language; meeting summary; key discussion points; decisions; action items with potential owner and mentioned deadline; important topics; open questions; relevant observations from shared screens or presentations. All output is structured JSON validated against a schema.

**Two-stage pipeline.** Nothing is requested in one uncontrolled response. *Stage 1:* long recordings are split into 30–60-minute segments; each segment yields timestamped transcript JSON with speaker labels and language; every segment is persisted and validated before proceeding. *Stage 2:* the merged transcript goes in; the final report comes out — summary, decisions, action items, de-duplicated topics — and is saved with model and prompt/schema version.

**File limitations.** Uploads to the model are temporary and size-limited, hence the audio-first strategy (D7): ffmpeg audio extraction by default, compression and segmenting as needed, and video/frame analysis only when JaaS events show screen sharing occurred. The original MP4 is always retained in R2 independent of Gemini.

**Accuracy and human control.** Diarization produces `Speaker 1`, `Speaker 2`, …; mapping voices to employee names cannot be guaranteed from the composite recording. The UI therefore allows editing speaker names, transcript text, summaries, and action items, and requires explicit organizer **approval** before a report is final. Gemini can only analyze what the recording contains; content shown too briefly or outside the recorded layout may be missed. Malformed or schema-invalid responses trigger bounded retries and then a visible `Failed` state.

**Healthcare context.** Meetings at a zorg organization can capture patient information. Recordings, transcripts, and reports are therefore treated as potentially special-category data: processing stays in EU regions end to end, access defaults to organizer + administrators (Section 18), the consent notice is mandatory before joining a recorded meeting, and the retention period is explicitly confirmed with the client.

## 13. Background Processing


Redis + a Yii-compatible queue worker under Supervisor (its own container), plus a cron scheduler. A database-backed queue is acceptable only as a temporary minimal deployment; the architecture assumes Redis from Phase 1 (D9). All jobs are **idempotent** — safe to re-run.

| Job | Purpose |
|---|---|
| ProcessJaasWebhook | Validate, dedupe, persist, and fan out webhook events |
| RetrieveRecording | Download the MP4 via the temporary link (≤ 24 h) |
| VerifyChecksum | Integrity check before storage |
| UploadToR2 | Move the MP4 to permanent object storage |
| PrepareMedia | ffmpeg audio extraction, segmentation, optional compression |
| TranscribeSegment | Stage 1 Gemini call per segment |
| AggregateReport | Stage 2 Gemini call; save final report |
| NotifyParticipants | Meeting/report notifications incl. push |
| CleanupTempFiles | Delete temporary processing files |
| RetryFailed | Re-schedule failed jobs with exponential backoff |
| ReconcileRecordings | Cron: find recordings that never completed while the 24 h window is open |
| EnforceRetention | Cron: delete recordings/reports past retention |
| ExportMonthlyUsage | Cron: produce the monthly usage export |

Processing states surfaced to users and admins: *Waiting for recording → Downloading → Uploading → Transcribing → Generating report → Completed*, with *Failed* and *Retry scheduled* branches.

## 14. Webhook Endpoint


A dedicated HTTPS-only route (e.g. `/meeting/webhook/jaas`). Requirements: verify the JaaS webhook signature and reject invalid requests; store every event's `idempotencyKey` behind a unique index and silently drop duplicates; never assume chronological delivery — the session/recording state machine tolerates out-of-order events; persist the raw payload and the original event timestamp; return a successful HTTP response quickly and queue all expensive work; keep retry and failure logs. Events consumed: room created, participant joined/left, recording started/ended/uploaded, meeting ended, usage events.

## 15. Data Model


Conventions: InnoDB, `utf8mb4`, `created_at`/`updated_at` on every table, foreign keys indexed. Yii migrations live in the owning module. HumHub users/Spaces are referenced by their existing IDs; each HumHub user additionally stores the Supabase subject UUID as its external identity key (Section 4).

**`meeting_session`** — one row per meeting.

| Field | Type | Notes |
|---|---|---|
| id | PK bigint | |
| jaas_session_id | varchar, unique | From JaaS |
| room_name | varchar, unique | Unguessable |
| space_id | FK → space, nullable | Null for direct calls |
| created_by | FK → user | |
| title | varchar | |
| status | enum | scheduled / active / ended / cancelled |
| started_at / ended_at | datetime | |
| recording_enabled | bool | |

**`meeting_participant`**

| Field | Type | Notes |
|---|---|---|
| meeting_id | FK → meeting_session | Composite index with user_id |
| user_id | FK → user | |
| jaas_participant_id | varchar | |
| joined_at / left_at | datetime | |
| role | enum | moderator / participant |

**`meeting_recording`**

| Field | Type | Notes |
|---|---|---|
| id | PK | |
| meeting_id | FK | |
| jaas_recording_id | varchar, unique | |
| object_key | varchar | R2 key |
| duration_seconds / file_size / mime_type / checksum | — | |
| processing_status | enum | See Section 13 states |
| retention_date | date, indexed | Drives EnforceRetention |
| deleted_at | datetime, nullable | Soft-delete audit |

**`meeting_transcript_segment`**

| Field | Type | Notes |
|---|---|---|
| meeting_id / recording_id | FK | |
| segment_number | int | Unique with recording_id |
| start_ts / end_ts | decimal seconds | Within the recording |
| speaker_label | varchar | e.g. "Speaker 1" |
| speaker_user_id | FK, nullable | Set when a human confirms |
| text | mediumtext | |
| language | varchar | Detected |

**`meeting_ai_report`**

| Field | Type | Notes |
|---|---|---|
| meeting_id | FK, unique | One report per meeting |
| summary / topics / decisions | JSON | Schema-validated |
| status | enum | draft / approved / failed |
| model_used | varchar | |
| prompt_schema_version | varchar | |
| approved_by / approved_at | FK / datetime, nullable | |

**`meeting_action_item`**

| Field | Type | Notes |
|---|---|---|
| meeting_id | FK | |
| description | text | |
| assigned_user_id | FK, nullable | |
| mentioned_deadline | date, nullable | As spoken, not enforced |
| completed | bool | |

**`meeting_webhook_event`**

| Field | Type | Notes |
|---|---|---|
| idempotency_key | varchar, **unique** | Dedupe guard |
| event_type | varchar, indexed | |
| jaas_timestamp | datetime | Original event time |
| payload | JSON | Raw |
| processing_status | enum | received / processed / failed |
| received_at | datetime | |

**`meeting_usage`**

| Field | Type | Notes |
|---|---|---|
| meeting_id | FK | |
| recorded_seconds / processed_seconds | int | |
| storage_bytes | bigint | |
| gemini_usage | JSON | Tokens per stage |
| billable_minutes | int | Rounded per policy |
| billing_period | char(7), indexed | e.g. "2026-09" |

Relationships: a session has many participants and recordings; a recording has many transcript segments; a session has one AI report and many action items; usage aggregates per session per billing period.

## 16. Notifications


HumHub's notification infrastructure carries comms and meeting events; mobile push is delivered through the Careon Pulse shell app (FCM/APNs — module backends send through the shell's Firebase project) with deep links into posts, messages, meetings, and reports. Push payloads contain only a title and deep link — no message or transcript content.

| Notification | Audience | Phase |
|---|---|---|
| Incoming meeting invitation | Invitees | 2 |
| Meeting starting | Participants | 2 |
| Missed invitation | Invitee | 2 |
| Recording completed | Organizer | 3 |
| Transcript processing completed | Organizer | 3 |
| Processing failure | Administrators | 3 |
| AI report ready | Authorized participants | 3 |
| Action item assigned | Assignee | 3 |

## 17. Administration


A meeting administration area provides: enabling/disabling the meeting modules globally and per Space; JaaS App ID and public/private key configuration; Gemini/Vertex configuration (project, region, model); R2/S3 configuration; recording retention setting (default 12 months); recording permissions; AI-processing and report-visibility permissions; a usage overview with monthly CSV export; a failed-jobs view with reprocessing; and deletion of recordings and reports with an audit note. Tile entitlements per account — which modules an account can open — are managed in the identity hub and enforced by every module server-side. **Secrets live in environment variables or the deployment secret store — never in ordinary database fields or source control.**

## 18. Security & Privacy Model


**Transport & access.** HTTPS everywhere with automatic certificates. Every meeting, recording, transcript, and report route enforces HumHub authentication plus membership and role checks; media is reachable only through short-lived signed URLs. Meetings are joinable only via invitation/permission — room names are unguessable and JaaS access requires our server-signed JWT.

**Keys & webhooks.** The RS256 private key exists only server-side; JWTs are short-lived; webhooks are signature-verified and idempotent (Section 14). External OIDC clients receive identity-scoped tokens only — no data-API scopes against the Supabase project — and the service-role key never leaves the dashboard's server plane. D21 Graph access is deliberately separate: delegated tokens stay server-side, are AES-256-GCM encrypted with a deployment key plus per-user associated data, and are deleted on disconnect/user deletion. The browser receives rendered results and Microsoft web links, never bearer or refresh tokens. Secrets and the encryption key live only in the deployment secret store; key rotation requires an explicit reconnect/rotation runbook.

**Data locations.** Supabase project in an EU region; Vercel for the stateless dashboard runtime; Hetzner (Germany/Finland); R2 with the EU jurisdiction option; Vertex AI in an EU region. 8x8/JaaS processing regions must be confirmed and recorded (Open Questions). Facturatie (D19): invoice rows and PDFs live in the same EU Supabase project (schema + private Storage bucket `facturen`); statutory retention is 7 years (10 for immovable property), enforced by excluding issued invoices from every prune routine.

**GDPR.**

- Recording is always visible: the JaaS indicator plus a notice text shown before joining a recorded meeting (final wording: Open Questions, with client's counsel).
- Data-processing agreements (verwerkersovereenkomsten) with 8x8, Cloudflare, and Google are the client's responsibility to execute; we supply the processing inventory (this document).
- Data minimization: push payloads carry no content; Gemini receives extracted audio, not raw video, by default.
- Microsoft 365 (D21/D23): tenant-consented capability-specific scopes permit the accepted bounded Outlook, calendar, Teams-channel and canonical SharePoint operations while the legacy all-writes switch remains off. Microsoft content stays transient and ACL-authoritative. Short-lived ACS call tokens necessarily reach active client memory, but renewable Microsoft tokens and the ACS resource credential remain server-side. Mail text, channel content, calendar subjects, filenames and call metadata can reveal health or employment context, so TGC must align YAAZ membership/offboarding and its privacy/security register with every enabled scope.
- Right to erasure: administrator deletion of recordings/reports plus automated retention deletion; deletions are audited.
- Employees are informed through the client's internal policy; the platform is an internal tool, not public.
- Facturatie (D19): storing invoice contacts **including e-mail addresses** is a new processing activity (client-approved 9 Aug 2026) — a deliberate exception to the dashboard's data-minimization line (referrer e-mails are not stored; private debtors are reduced to a label). Abandoned invoice drafts are pruned after 180 days; issued invoices are retention-locked. The AI assistant gets no read or write tools on invoice data. **Phase B (e-mail dispatch, built 13 Aug 2026):** the recipient address of every send attempt is logged in `careon_facturatie_maillog` — same processing activity as the invoice contacts (contact details incl. e-mail, client-approved V18), readable only under RLS, excluded from every prune (7-year administration), and deliberately kept **out of** the `facturatie.factuur.send` audit event. **Resend (US) is the new sub-processor — DPA incl. SCCs PENDING**, to be signed by the owner (owner decision 13 Aug 2026 deviating from the EU-sovereign proposal; transfer-risk analysis recorded in D19). Until the credentials are set the dispatch route is fail-closed (503), so no personal data reaches the provider.
- Healthcare context (TGC Groep): recordings, transcripts, and AI reports are treated as potentially special-category data — access defaults to organizer + administrators, the consent notice precedes every recorded meeting, and retention is explicitly confirmed with the client.

**Server & secrets.** SSH keys only, firewall (Hetzner Cloud firewall + host), unattended security updates, least-privilege R2 token scoped to a single bucket, database not exposed publicly, secrets via the deployment environment store. Backups are stored in R2 and the restore procedure is rehearsed as part of acceptance.

## 19. Deployment Architecture

**Three planes, deliberately heterogeneous (D10, D14, D15).**

**Vercel — dashboard.** Deploys on git push from `careonpulse`; environment per the repo's `.env.example` (Supabase keys, OpenAI, cron secret); Vercel Cron drives the maintenance route; stateless — nothing to back up beyond Supabase. **Exception (D19):** Supabase DB backups/PITR do **not** cover Storage objects — the `facturen` bucket carries a 7-year statutory obligation and needs its own backup routine (periodic server-side copy, plus PDF regeneration from the frozen row snapshots with `pdf_sha256` recheck as documented fallback); see `DISASTER_RECOVERY.md`.

**Supabase — identity + dashboard data.** EU-region project; schema managed exclusively through `careonpulse/supabase/migrations` (applied in file order); OAuth server configuration (registered clients: shell, HumHub, future modules) treated as infrastructure config and documented in the umbrella docs; backups per Supabase plan (point-in-time recovery recommended once meetings go live).

**Hetzner + Coolify — comms & pipeline.** One Hetzner CX VPS (start 4 GB, upgrade path 8 GB) runs Docker Compose — nginx, humhub-php, mariadb, redis, worker, cron — orchestrated by Coolify Cloud (~$5/month) with GitHub push-to-deploy from `platform-deploy`, automatic SSL, and a staging project on a subdomain. The Compose file stays provider-portable.

**Environment variables — Hetzner plane.**

| Variable | Purpose |
|---|---|
| DB_HOST / DB_NAME / DB_USER / DB_PASS | MariaDB connection |
| HUMHUB_BASE_URL | Canonical comms URL |
| OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET | HumHub → Supabase identity federation |
| M365_GRAPH_ENABLED / M365_GRAPH_TENANT_ID / M365_GRAPH_CLIENT_ID / M365_GRAPH_CLIENT_SECRET | D21 YAAZ delegated Graph registration (separate from D20 login) |
| M365_GRAPH_REDIRECT_URI / M365_GRAPH_TOKEN_KEY | Exact Entra callback and base64 32-byte AES-256-GCM key |
| M365_GRAPH_MAIL_WRITE_ENABLED / M365_GRAPH_CALENDAR_WRITE_ENABLED / M365_GRAPH_FILES_WRITE_ENABLED | Capability-specific delegated writes; each defaults to `0`. Only calendar is approved for TGC at v2.5 |
| M365_GRAPH_WRITE_ENABLED | Backwards-compatible all-writes switch; default `0` and not used for the calendar-only rollout |
| M365_GRAPH_SHARED_DRIVE_ID / M365_GRAPH_SHARED_FOLDER_ID | Optional SharePoint target |
| M365_GRAPH_TIMEZONE / M365_GRAPH_IANA_TIMEZONE | Matching Windows Graph-response zone and IANA PHP/YAAZ rendering zone |
| M365_ACS_CALLING_ENABLED / M365_ACS_ENDPOINT | Independent D23 kill switch and public ACS resource endpoint |
| M365_ACS_CONNECTION_STRING or managed-identity equivalent | Server-only credential for Teams-user token exchange; never returned to a client |
| M365_ACS_CALL_SCOPES | Exact `Teams.ManageCalls Teams.ManageChats` scope set; no Graph or application permission implied |
| SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_FROM | Transactional email |
| REDIS_HOST | Queue/cache |
| JAAS_* | Dormant D23 rollback configuration; remains unset/disabled for TGC |
| R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET | Object storage |
| VERTEX_PROJECT_ID / VERTEX_LOCATION / GEMINI_MODEL / GEMINI_MAX_RETRIES | Meeting AI (EU region; configurable model) |
| RECORDING_RETENTION_MONTHS | Default 12 |
| PUSH_FCM_CREDENTIALS | Service account for the shell's Firebase project |
| APP_ENV | production / staging |

Shell app configuration (Supabase URL, OIDC client id, tile-registry endpoint) is build-time config in `careonpulse-shell`; dashboard configuration stays defined by the repo's own `.env.example`. The facturatie **phase-B mail variables now exist** (provider chosen: Resend, D19 amendment): `CAREON_MAIL_RESEND_API_KEY`, `CAREON_MAIL_AFZENDER_EMAIL` and `CAREON_MAIL_AFZENDER_NAAM` (plus optional `CAREON_MAIL_RATE_LIMIT_PER_MINUTE` / `_PER_DAY`) — **server-side only, never `NEXT_PUBLIC_`**, kept in the Vercel secret store. They stay **empty until the DPA is signed and the sender domain (DKIM/SPF) is verified**; while empty the dispatch route is fail-closed (503). Go-live checklist: `PRODUCTION_MODE.md`.

**Backups & restore (Hetzner plane).** Nightly `mysqldump` + uploaded files to R2 (`backups/`), 30 daily + 12 monthly; weekly Hetzner snapshots (backup add-on, +20% of server price); the restore procedure lives in `platform-deploy` and is rehearsed once before Phase-1 acceptance.

**Operations.** Docker log rotation; health endpoints (`/health` app+DB+Redis, `/health/queue`) plus explicit ACS readiness; processing failures notify administrators; migrations run on deploy. D23 activation checklist: exact Azure subscription/resource/region and budget alert → call permissions/admin consent → personal reconnect → backend token exchange with no secret leakage → authorized contact lookup → meeting/call acceptance → revocation/offboarding → production flag. Mobile activation additionally requires native push/ringing, signed-device and store acceptance. Backup/restore gates remain unchanged.

## 20. User Journeys


**Signing in.** An employee opens the Careon Pulse app, signs in once against the identity hub, and lands on the launcher showing exactly the tiles their account is entitled to; opening a tile enters that module with no second login.

**Starting a call.** An employee opens a Messenger contact or conversation and taps voice or video. YAAZ revalidates that the contact is an enabled, licensed, messageable coworker, resolves the server-held Entra object ID, mints a short-lived ACS Teams-user token and opens the themed in-YAAZ call surface. The target rings in Teams or an initialized YAAZ client. A scheduled Outlook event follows the same surface with its revalidated Teams meeting locator.

**Recording a meeting.** Not active under D23. This journey resumes only after the Microsoft recording/export source, participant notice, permissions, retention, region and archive pipeline are separately approved and accepted.

**Receiving the AI report.** After archiving, processing starts automatically with visible status; on completion, authorized participants are notified; the report shows summary, decisions, and action items alongside the timestamped transcript; the organizer edits speaker names or text where needed and approves the final version.

## 21. Commercial Structure


**One-time development.**

| Phase | Deliverable | Price |
|---|---|---|
| 1 | Base platform — client fully live (web, PWA, branded mobile apps) | €4,000 |
| 2 | Calling module (Microsoft Teams via ACS, web + mobile) | €1,000 |
| 3 | Recording + AI documentation module | €1,000 |
| | **Total** | **€6,000** |

**Recurring (client-facing, amended by D23).** Application hosting remains **€500/year**. The JaaS subscription table below is historical and no JaaS plan is to be purchased for TGC. ACS is billed on the client's Azure subscription by metered audio/video usage; the exact forecast follows the pilot's real minute/device data.

| JaaS plan | Monthly active users | Price |
|---|---|---|
| Developer | up to 25 | Free |
| Basic — *selected (40 users)* | up to 300 | €99/month |
| Standard | up to 1,500 | €499/month |
| Business | up to 3,000 | €999/month |
| Enterprise | 3,000+ | Custom |

The former fixed total of €1,688/year is not an active TGC commitment. Active fixed platform hosting remains €500/year plus actual Microsoft ACS consumption.

**Usage-based (Phase 3).** €0.04 per recorded **and** AI-processed minute (€2.40/hour), metered by the platform (Section 15, `meeting_usage`), invoiced monthly in arrears, no minimum.

| Monthly recorded volume | Usage charge |
|---|---|
| 1 hour | €2.40 |
| 10 hours | €24 |
| 25 hours | €60 |
| 50 hours | €120 |
| 100 hours | €240 |

**Scope addition (v2.1).** The facturatie module (D19) is additional, client-requested scope inside Module 1; if it is later sold as a separate module, its tile/entitlement shape (D13) already supports that split.

**Scope addition (v2.0).** The shell app, identity integration, and dashboard-tile work are additional scope relative to this contracted structure and are quoted separately (TBD). The figures below are unchanged for the originally contracted scope.

**Internal cost basis (not client-facing).** Infrastructure ≈ €11–17/month (Hetzner CX ~€5.49–10 + 20% backup add-on + Coolify ~$5) against the €500/year fee. Per processed hour: JaaS recording $0.60 (at $0.01/min) + Gemini Flash audio-first (low single-digit cents) + R2 storage (~$0.015/GB-month) against €2.40 charged. Reference point: 8x8's own transcription add-on lists at **$0.06/minute for a transcript alone** — our €0.04/minute includes the full AI report. Each additional resold installation adds roughly €9–14/month of infrastructure (one more Hetzner server + $3 Coolify).

## 22. Implementation Roadmap

No calendar dates (Confirmed): phases are sequenced at Bayaan Hub's discretion, each ending with an acceptance gate on staging.

### Phase 0 — Audit & Foundations

- **Objective:** eliminate the two integration risks and stand up the delivery pipeline before feature code.
- **Tasks:** compatibility matrix in `VERSIONS.md`; create the sibling repositories; provision Hetzner; deploy HumHub; complete identity acceptance. The historical Jitsi spike remains evidence for the dormant fallback; D23 adds an ACS web/native SDK spike and secure Teams-user token exchange before call activation.
- **Acceptance:** both spikes pass or the fallback is invoked; pinned versions install cleanly; push-to-deploy works on both planes.
- **Recorded exception (9 Aug 2026):** the facturatie module (D19) was built in parallel with Phase 0 on explicit owner instruction — Module 1 is live and the work touches neither spike; "gates before feature code" continues to apply to the shell/comms planes.
- **Recorded exception (20 Aug 2026):** the D20 dashboard login path and D21 YAAZ Microsoft 365 module were built fail-closed on explicit owner instruction while TGC-IT tenant configuration is outstanding. No external permission or production secret was fabricated: activation remains an acceptance step after both Entra registrations and admin consent arrive.

### Phase 1 — Shell + Base Platform

- **Objective:** every TGC employee live in the shell app with two working tiles — Pulse dashboard and comms.
- **Tasks:** shell app v1 (login, launcher + registry, entitlements, push, deep links, WebView contract); dashboard tile via session handoff; HumHub installation, Careon theme, profile fields, Space structure, Mail module, notifications, OIDC integration + role mapping; store submissions under client accounts (no mic/camera permissions); admin onboarding (identity hub + entitlements + HumHub); user provisioning; backups, monitoring, restore drill.
- **Acceptance criteria:** all employees onboarded through the identity hub; SSO verified into both modules on web and in the app; tiles match entitlements and server-side enforcement is verified; deactivation locks a test account out of everything; push with deep links verified on iOS and Android; Space isolation verified; backup + restore drill passed; both apps approved.
- **Key risks:** store review friction (mitigated per D12); OAuth-server maturity (Spike A gates this).

### Phase 2 — Calling Module

- **Objective:** Microsoft Teams voice/video calls and meetings inside YAAZ on web and later the Careon Pulse mobile shell (D23).
- **Tasks:** provision a TGC-owned ACS resource; add/admin-consent `Teams.ManageCalls` and Microsoft's required `Teams.ManageChats`; implement separately gated call OAuth/token exchange; ship the themed web call surface; wire validated Outlook meeting join; map authorized Messenger contacts to Entra object IDs; add active-client incoming calls; then add native Swift/Kotlin adapters, push/ringing and reviewed media declarations.
- **Acceptance criteria:** web employee A↔B voice and video in both directions; incoming accept/reject; mute/camera/device/hang-up; scheduled Teams meeting join without redirect; unauthorized/arbitrary target rejection; revocation/offboarding; expired-token refresh; Graph/ACS throttling; network drop/reconnect; no renewable token or resource key in logs, HTML, URL or browser storage. The mobile increment adds signed web↔iOS, web↔Android, iOS↔Android and background-ringing acceptance before store activation.

### Phase 3 — Recording & AI Module

- **Objective:** recording archive plus approved AI meeting reports, fully metered, with healthcare-grade access defaults.
- **Tasks:** `meeting-recordings`; R2 integration; pipeline jobs (Section 13); `meeting-intelligence`; report review/approval UI; usage metering and export; admin sections; retention automation; consent notice text (with client's counsel).
- **Acceptance criteria:** end-to-end on staging — record → archive → transcript → report → edit → approve; failure paths tested (duplicate and out-of-order webhooks, malformed Gemini JSON, download retry, reconciliation); signed-URL authorization verified; retention deletion verified; usage export matches test meetings; a near-limit long recording processes; **access defaults verified: recordings, transcripts, and reports visible only to organizer + administrators until explicitly shared**.

## 23. Testing Plan


| Area | Representative tests |
|---|---|
| AuthN/AuthZ | Login, password reset, deactivation; permission matrix per role |
| Space isolation | Private Space content invisible to non-members (web + app + API) |
| Meetings | 1:1 and group across web/iOS/Android; device switching; moderator controls |
| Network resilience | Join on poor networks; drop and reconnect mid-call |
| Webhooks | Valid, invalid-signature, duplicate, and out-of-order events |
| Recording pipeline | Download failure → retry → reconciliation; checksum mismatch; near-6 h recording |
| Gemini | Timeout, malformed JSON, oversize segment; retry bounds; Failed state visibility |
| Queue | Idempotent re-runs; backoff; dead-letter visibility |
| Media access | Signed-URL expiry; unauthorized access attempts |
| Retention | Deletion at retention date; audit trail |
| Usage metering | Billable minutes match recorded/processed fixtures |
| Push | Delivery + deep links on both platforms, foreground/background |
| Ops | Backup created nightly; documented restore succeeds |
| SSO / identity | Shell PKCE login; HumHub OIDC login + auto-provisioning; role claim mapping; deactivation locks all modules; token refresh |
| Microsoft 365 / Graph | OAuth state + PKCE expiry/user binding; exact e-mail match; encrypted token round-trip + refresh rotation; no token in HTML/logs; permission-denied partial states; paged/searched Outlook metadata, bounded inert-text detail and guarded attachment downloads; native Calendar overlay with validated internal editor/join links and no DB copy; calendar create/edit/delete with body/attendee preservation, fresh ETag + `If-Match`, stale-form and Graph-412 conflict refusal; joined Teams/channels plus separately gated bounded message read/send; ACL-aware Search and subtree-bound SharePoint browse/download; separately gated conflict-safe canonical upload/subfolder creation; disconnect deletion; independent mail/calendar/Teams/file capability flags |
| Launcher / entitlements | Tiles match entitlements; direct module-URL access without entitlement rejected server-side; kill switch hides a tile |

## 24. Risk Register


| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Native ACS bridge or SDK support differs across web/iOS/Android | Medium | High | Web-first acceptance; thin Swift/Kotlin adapters; pinned SDK matrix; retain official Teams deep link and dormant JaaS code as recovery paths |
| App-store review rejection | Medium | Medium | Client-owned accounts; Phase 1 build without mic/camera permissions; unlisted/private distribution option |
| Phase-3 recording design incorrectly assumes JaaS behavior | Medium | High | Keep recording off; select and accept a Microsoft-supported recording/export contract before implementation |
| Malformed / invalid Gemini output | Medium | Medium | Strict JSON schema; bounded retries; two-stage pipeline; human approval |
| Speaker diarization inaccurate | High | Low | Editable speaker names; approval step; expectation set in UI |
| ACS usage or Teams licensing differs from the pilot estimate | Medium | Medium | TGC-owned Azure cost alerts; metering dashboard; pilot with licensed internal users before broad activation |
| Phase 2 scope creep toward PSTN/full Teams parity | Medium | High | D23 capability boundary; Teams Phone, queues, live events and recording remain separate increments |
| Single-server outage | Low | Medium | Nightly dumps + weekly snapshots; documented restore; acceptable RTO for an internal tool |
| Hosting price changes (Hetzner raised prices June 2026) | Medium | Low | Provider-portable Compose; Coolify re-points to any server |
| GDPR complaint about recordings | Low | High | Consent indicator + notice; retention automation; DPAs; EU processing regions |
| Supabase OAuth server immaturity (out of beta late 2025) | Medium | High | Phase-0 Spike A gates everything; Keycloak fallback documented; modules assume only "an OIDC provider" |
| Patient data present in recordings/transcripts | Medium | High | Special-category posture: organizer+admin access default, consent notice, EU-only processing, confirmed retention |
| Session/token handling across shell WebViews | Medium | Medium | One handoff contract for all modules; covered in the Phase-1 test plan; no module-specific auth hacks |
| Microsoft tenant consent or app secret unavailable/expired | Medium | High | Separate login/data registrations and failure domains; feature flags default off; health command fails closed; secret-expiry owner + rotation reminder required |
| Delegated Graph scopes expose more than a user's job needs | Medium | High | Employee-delegated access only, Microsoft ACLs authoritative, no application permissions, metadata-only mail, writes separately gated, periodic consent/scope review and immediate disconnect |
| Entra account disabled while platform/Graph refresh sessions remain valid | Medium | High | Operational offboarding revokes Careon sessions and deletes the YAAZ connection; later `/users/delta` automation; do not claim Entra disable alone is immediate global logout |
| Entra group/app-role assignment is misconfigured during JIT rollout | Medium | High | Require exact tenant + `acct=0` + `xms_edov` + exact e-mail + `Careon.User` at both app and transactional DB layers; feature flag defaults off; never grant admin roles automatically; test assigned and all denied identity classes before activation |

## 25. Open Questions (for client / owner confirmation)

1. Platform domain (product is Careon Pulse; the dashboard currently runs on its Vercel domain).
2. Which legal entity owns the Apple/Google developer accounts, given the app is branded Careon Pulse while the current organization is TGC Groep — start enrollment immediately once decided.
3. UI languages (assumption: Dutch + English).
4. Recording-consent notice wording (with client's counsel; healthcare context).
5. Confirm the 12-month recording retention with the client, explicitly in the healthcare context.
6. Who may record (default: organizers/management), and who may view transcripts and AI reports beyond the organizer + administrators default?
7. *(Superseded by D23 for Phase 2.)* No JaaS account is to be activated for TGC. Gemini/Vertex ownership remains a Phase-3 decision only.
8. *(Superseded by D23.)* Replace the 8x8 MAU question with ACS subscription ownership, resource region, budget alert and monthly-minute reporting on the TGC Azure subscription.
9. Is SSO federation to an external IdP (Azure AD, etc.) needed later for any organization? — *Answered for TGC Groep by D20 (13 Aug 2026): yes, Entra ID as upstream provider via the hub. Remains open for future organizations.*
10. Should action items later sync into HumHub task modules (future enhancement)?
11. Preferred Hetzner location (default: Falkenstein, Germany).
12. Onboarding order and timing for additional organizations beyond TGC Groep.
13. *(M365, added 13 Aug 2026 — revised 20 Aug 2026; request in `agent-handoff/17-microsoft365-yaaz-deliverable.md`)* Does TGC actually run on Microsoft 365, and which tenant? Is employees' primary e-mail equal to their UPN (e.g. `naam@tgcgroep.nl`)? — **blocking for D20 and D21 rollout**.
14. *(M365, added 13 Aug 2026)* Which Microsoft 365 license tier do frontline/care staff have (E vs F) — determines whether every employee can use Entra login.
15. *(M365, added 13 Aug 2026; product direction answered 20 Aug 2026)* Teams must be reachable from YAAZ; confirm which Teams/channels are actually used so the acceptance group reflects real work rather than demo memberships.
16. *(M365 data, added 20 Aug 2026)* Which SharePoint site/document-library is the shared-document home? TGC-IT must provide the Graph drive ID (and optional folder item ID); until then YAAZ falls back to each employee's OneDrive root and disables shared-library upload.
17. *(M365 data, answered 22 Aug 2026)* Calendar, mail-send/direct-reply, Teams channel read/send and canonical SharePoint upload/subfolder capabilities are separately consented and active; the legacy `M365_GRAPH_WRITE_ENABLED` remains `0`. Real disposable send/upload transactions retain their individual acceptance gates.
18. *(M365 data, added 20 Aug 2026)* Who owns the two Entra app registrations, secret-expiry reminders, Conditional Access policy and incident revocation procedure at TGC-IT?
19. *(Employee lifecycle, D22 — added 21 Aug 2026)* Does TGC's Entra licence include P1/P2 group-based enterprise-app assignment? If not, use direct employee assignment for G01-A until licensing is added; do not broaden eligibility to the whole tenant.
20. *(Teams calling, D23 — added 22 Aug 2026)* Which TGC Azure subscription/resource group owns ACS, which cost center receives metered charges, and which two licensed employees are approved for the first live bidirectional call acceptance?

## 26. References

- Careon Pulse dashboard repo: https://github.com/Mbongaa/careonpulse (template base: https://github.com/arhamkhnz/next-shadcn-admin-dashboard)
- Supabase Auth OAuth 2.1 / OIDC server: https://supabase.com/docs/guides/auth/oauth-server
- Supabase Azure login and verified-email setup: https://supabase.com/docs/guides/auth/social-login/auth-azure
- Microsoft identity-platform authorization-code + PKCE flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Microsoft Graph delegated-permissions reference: https://learn.microsoft.com/en-us/graph/permissions-reference
- Microsoft Search ACL behavior: https://learn.microsoft.com/en-us/graph/api/resources/search-api-overview
- Microsoft ACS Teams interoperability: https://learn.microsoft.com/en-us/azure/communication-services/concepts/teams-interop
- Teams-user ACS permissions: https://learn.microsoft.com/en-us/azure/communication-services/concepts/interop/teams-user/azure-ad-api-permissions
- Teams-user token exchange: https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/manage-teams-identity
- Teams-user Calling SDK operations: https://learn.microsoft.com/en-us/azure/communication-services/how-tos/cte-calling-sdk/manage-calls
- ACS calling platform support: https://learn.microsoft.com/en-us/azure/communication-services/how-tos/calling-sdk/manage-calls
- HumHub: https://github.com/humhub/humhub · docs: https://docs.humhub.org
- Jitsi Flutter SDK: https://github.com/jitsi/jitsi-meet-flutter-sdk · pub.dev: https://pub.dev/packages/jitsi_meet_flutter_sdk
- JaaS developer docs: https://developer.8x8.com/jaas · pricing: https://jaas.8x8.vc/#/pricing
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Vertex AI (Gemini): https://cloud.google.com/vertex-ai/generative-ai/docs
- Coolify: https://coolify.io/docs · Hetzner Cloud: https://www.hetzner.com/cloud
