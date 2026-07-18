# Release Gates — Careon Pulse Dashboard

Autonomous work-session tracker. A gate is GREEN only when verified by a real command/run in the current code state.
Scope guard: mock/client-state demo only (no real backend/auth/DB); target-base styling (no neon/glass restyle).

| # | Gate | Status | Last verified | Evidence |
|---|------|--------|---------------|----------|
| G1 | Biome static checks clean (`npm run check`) | 🟢 | 2026-07-08 it.1 | 125 files, no diagnostics |
| G2 | TypeScript clean (`npx tsc --noEmit`) | 🟢 | 2026-07-08 it.1 | exit 0 after .next clean |
| G3 | Production build passes (`npm run build`) | 🟢 | 2026-07-08 it.1 | exit 0; route table = Careon app only + robots.txt |
| G4 | Runtime routes: 10 Careon pages 200; `/` + `/dashboard` → directiecockpit; login 200; unknown routes 404 cleanly; security headers present; page titles correct | 🟢 | 2026-07-08 it.2 | prod server sweep: 11×200, both redirects → directiecockpit, root+dashboard unknowns → real 404 with Dutch copy, 4 security headers present, titles use template, robots disallow-all, 0 errors in server log |
| G5 | Audited functionality verified (04-verification-plan): auth valid/invalid/logout, filter persistence + scaling, alert routing targets, CSV parser success/failure + overrides, API mock state machine, Herstel demo-data | 🟢 | 2026-07-08 it.3 | `npm run verify:careon`: 104/104 logic assertions (deltas for every audited KPI, formats, scaling 1248→275, CSV messages, alert counts/routes, color thresholds). `npm run test:e2e`: 15/15 Playwright tests in real Chromium covering login/logout/invalid, filter persistence + scaling, KPI/alert/bell routing, behandelaren filter narrowing, full Databron API + CSV flows incl. sidebar badges and cockpit override |
| G6 | Production hardening: per-page metadata, favicon/brand, error.tsx + loading states, security headers, no stray console/logs, robots | 🟢 | 2026-07-08 it.4 | all hardening in place and runtime-verified (it.2); console sweep: only error-path logging in localStorage helper (stripped by removeConsole in prod); favicon present; no TODO/FIXME |
| G7 | Template cleanup: demo pages out of sidebar and unused template routes removed from bundle where provably safe | 🟢 | 2026-07-08 it.4 | import-graph orphan scan: deleted 11 orphan files/dirs (template sidebar chrome, calendar components, flag icons, proxy.disabled, unused hooks); shadcn ui/ primitives intentionally kept as component library; check/tsc/build/E2E all green after |
| G8 | Accessibility & theme/mobile sanity: labeled controls, keyboard focus, dark+light readable, responsive grids, no hardcoded theme-breaking colors | 🟢 | 2026-07-08 it.5 | axe-core WCAG 2.0/2.1 AA audit on all 11 routes × light+dark (cookie-applied, class-verified): 0 serious/critical violations. Fixed: unnamed LayoutControls trigger, avatar-fallback contrast, badge text colors 600→700 series, provider sub-text contrast, focusable table scroll region (minimal ui/table edit). Mobile drawer + theme cycle E2E-verified |
| G9 | Performance: route bundle sizes reviewed, no unnecessary heavy deps in Careon pages, charts render without waste | 🟢 | 2026-07-08 it.4 | removed 14 unused deps (23 packages incl. fullcalendar, dnd-kit, d3-geo/topojson, react-hook-form, tanstack-table, zod, simple-icons); total client chunks 1.9MB raw (largest 332K ≈ recharts), within budget; 15/15 E2E pass on pruned build |
| G10 | Documentation: app README (run, credentials, structure, data provenance), root README/CLAUDE.md consistent | 🟢 | 2026-07-08 it.5 | app README rewritten for Careon Pulse (quickstart, credentials, scripts incl. verification gates, architecture, scope guardrails); workspace CLAUDE.md commands updated with verify:careon/test:e2e |

## Superseding visual requirement - Careon theme mode COMPLETE (2026-07-08)

Client requested an exact Careon theme/logo mode after the functional clone passed. This is now implemented as a third theme mode next to Light and Dark:

- `theme_mode` supports `light | dark | careon`, defaults to `careon`, and boots with `html[data-theme-mode="careon"]` plus dark-mode class before hydration.
- The top-bar theme switcher exposes Light, Dark, and Careon on desktop; the settings popover exposes the same three modes.
- Careon mode has a scoped CSS layer in `src/app/globals.css`: dark navy grid background, neon/glass cards, Careon sidebar/header treatment, gradient logo wordmark, branded login card, chart/table overrides, and mobile bottom navigation.
- Light and Dark remain the shadcn/admin base themes; the Careon neon styling is scoped under `html[data-theme-mode="careon"]`.
- Final visual screenshots captured from the production build:
  - `test-results/careon-theme-login-final.png`
  - `test-results/careon-theme-desktop-cockpit-final.png`
  - `test-results/careon-theme-mobile-cockpit-final.png`
- Final verification on this code state: `npm run check` clean, `npx tsc --noEmit` clean, `npm run verify:careon` 104/104, `npm run build` clean, `npm run test:e2e` 48/48.

## Superseding feature — AI-assistent page (2026-07-08)

Client requested a clone of the assistant-ui AI assistant from their Backend/kiosk-pos project (chat + thread list + artifact canvas), adapted to the Careon domain. Delivered at `/dashboard/assistent` (sidebar: Overzicht → AI-assistent):

- `@assistant-ui/react` v0.14 local runtime; thread list persisted in localStorage (auto-titles, archive/delete) via a RemoteThreadList adapter.
- Deterministic Dutch "AI": 9 intents (keyword inference or quick-prompt hint) → plan → artifact `{visualizations, claims, sources}` built verbatim from the audited constants in `src/data/careon/careon-assistant.ts`; cockpit KPIs respect the global location scaling; Databron mode is reflected live. No LLM, no backend — consistent with the mock/client-state scope.
- Artifact canvas next to the chat: KPI tiles, month bar charts (Recharts), rank lists, donuts, status cards, tables; chips under each assistant message select artifacts into the canvas; claims ("Bewijsvoering") and source refs ("Bronnen") per artifact; Standaard/Diep answer-style toggle; print/PDF export of a conversation or artifact.
- Ported assistant-ui starter components live in `src/components/assistant-ui/` (Dutch labels).
- Verified on the final code state: `npm run check` clean (137 files), `tsc --noEmit` clean, `verify:careon` 104/104, clean `npm run build`, prod smoke 200 on all routes, and `npx playwright test` **51/51** (15 functional + 36 axe WCAG-AA over 12 routes × light/dark/careon, incl. `/dashboard/assistent`). Two contrast defects found and fixed along the way: the sidebar "new" badge (green-600 → green-700/dark:green-400) and the welcome subtitle's opacity fade (axe caught muted text mid-fade; entrance animation is now slide-only).

## Superseding requirement — Mobile-first redesign (2026-07-09)

Client requested a mobile-first design for every page without changing the desktop web design. Implemented with base-breakpoint styles only (desktop `md:`/`lg:` styles untouched; verified with a desktop screenshot diff of the cockpit):

- Charts: replaced the negative left margins with `width="auto"` y-axes in all 7 Recharts configs — this was a pre-existing clipped-labels bug that also showed on desktop; labels are now fully visible everywhere.
- Bottom navigation now renders in all three themes on mobile (token-based styling for light/dark, neon override for careon), layered under sheets/dialogs (z-40), with safe-area-inset clearance on content.
- Filter access on mobile: new "Alle filters" popover exposes Periode/Locatie/Team below `lg`; desktop keeps the three inline selects.
- Behandelaren: 10-column table becomes a per-clinician metric card list on mobile (all 9 metrics + tone colors); table unchanged from `md` up.
- Dossiercontrole: size-bar column is `md`-only so name/count/urgency fit the phone width; check names wrap.
- Signaleringen: alert count tile sits inline with the text on mobile (`sm:contents` restores the exact desktop layout).
- Assistant: mobile thread-list sheet (opens/closes via toolbar), quick prompts collapse to one scrollable row, canvas stacks under the chat in a capped row, composer clears the bottom nav, careon mobile header height feeds `--dashboard-header-height`.
- Login: tagline deduplicated below `lg`; assistant welcome heading scales down on mobile.
- Evidence: full-page iPhone-13 screenshots of all 12 routes × careon+light plus interactive states (filter popover, artifact canvas, thread sheet) reviewed one by one. New permanent gates in `e2e/mobile.spec.ts`: no-horizontal-overflow sweep across all 12 routes in careon+light, filter popover flow, assistant sheet flow. Full suite after the change: `npx playwright test` **55/55** (check clean, tsc clean, verify:careon 104/104, clean build). One test updated: the behandelaren name assertion now targets the visible table cell since the hidden mobile card list also carries the name.

## Superseding requirement — Installable PWA (2026-07-09)

Client asked for the dashboard to be installable on the phone like a native app. Implemented dependency-free:

- `src/app/manifest.ts` → `/manifest.webmanifest`: standalone display, `start_url` /dashboard/directiecockpit, Dutch lang, navy theme/background, 192/512 icons + maskable variants, shortcuts to Signaleringen and AI-assistent.
- Icon set generated from the Careon logo (gradient tile + heartbeat glyph) in `public/icons/`: 192/512 rounded-transparent, maskable full-bleed 192/512, apple-touch-icon 180.
- `public/sw.js` (hand-rolled, versioned caches): network-first for navigations with cached-page → `offline.html` fallback, cache-first for hashed `/_next/static/` assets, stale-while-revalidate for other static files; GET+same-origin only. Registered in production by `src/components/pwa/sw-register.tsx` from the root layout.
- `public/offline.html`: branded Dutch offline fallback with retry.
- Root metadata: `applicationName`, `appleWebApp` (title, black-translucent status bar), apple-touch-icon link, `viewport` theme-color #07091a + `viewport-fit=cover` (pairs with the safe-area insets from the mobile pass). `next.config.mjs` serves `/sw.js` with `must-revalidate`.
- Evidence: new `e2e/pwa.spec.ts` gates — manifest fields, sw/icons/offline served with correct headers, and a real Chromium check that the service worker activates and a navigation while offline renders "U bent offline". Full suite on the final build: `npm run check` clean (143 files), `tsc --noEmit` clean, `verify:careon` 104/104, clean `npm run build` (route table + /manifest.webmanifest), `npx playwright test` **58/58**.
- Install paths: Android/Chrome shows the install prompt automatically; iOS Safari via Deel → Zet op beginscherm. Demo login uses sessionStorage by design, so each fresh app launch starts at the login screen.

## Superseding feature — Dossiers & productie page (2026-07-09)

Client-requested analytics page (agent-handoff/07), implemented as a separate route plus a cockpit summary:

- `/dashboard/dossiers-productie` (sidebar: Zorg → "Dossiers & productie", New badge): Careon Insights banner, 6-KPI strip, dossiers/afsluitingen/productie-uren per medewerker (table ≥md, card list on mobile, filtered by locatie/team), and population panels — diagnoses, geslacht (donut), leeftijd, verwijzers, plaats, verzekeringskoepel, regiebehandelaar (norm 220 + "boven norm" badge), wachtlijst (totaal/urgent/gem. wachttijd + wachtduur-buckets + per locatie).
- Directiecockpit got a compact summary card (afsluitingen, productie-uren, wachtlijst, top diagnose, grootste verwijzer) linking to the page.
- Mock data in `src/data/careon/careon-dossiers-productie.ts` reconciles with the audited constants: every population breakdown sums to 1.248 actieve cliënten; afsluitingen per medewerker sum to 74 (= Uitstroom/Gesloten dossiers); productie-uren = declarabel + indirect per medewerker (KPI 1.329 = som); wachtlijst 70 = intake 43 + behandeling 27 (buckets and per-locatie sum to 70; Roermond 31 consistent with de Treeknorm-alert); gem. wachttijd 5,2 wkn = Planning; medewerkers/regiebehandelaren = de 10 geauditeerde behandelaren; verzekeraars = de Financieel-koepels.
- Verified: `npm run check` clean (151 files), `tsc --noEmit` clean, `verify:careon` **123/123** (19 new reconciliation assertions), clean `npm run build`, `npx playwright test` **64/64** (route added to the a11y ROUTES — axe in light/dark/careon — and the mobile no-overflow sweep; 3 new functional tests: page content, locatie-filter narrowing, cockpit-summary link). Mobile (careon+light), desktop, and cockpit-summary screenshots reviewed.

## Superseding feature — Live AI infrastructure for the assistant (2026-07-09)

Client explicitly requested real AI instead of the placeholder. Implemented with the key strictly server-side (the repo is public and auto-deploys):

- `src/app/api/assistant/route.ts`: POST streams OpenAI chat completions (default `gpt-4o-mini`, override via `OPENAI_MODEL`), grounded on a JSON context of the deterministic artifact (claims/sources/visual titles), active filters, cockpit KPIs and the deterministic reference answer; Dutch-only system prompt forbids invented numbers. GET is a health probe (`{ live }`). Guardrails: `x-careon-assistant` header check, question/context/history size caps, `max_tokens` 700, temperature 0.3, provider errors sanitized to a generic 502, no key logging.
- Client (`assistent-content.tsx`): when live, the narrative streams from the route while the artifact canvas stays deterministic; on any failure or without a key it falls back to the simulated demo answers. Status surfaced as "Live AI"/"Demo-AI" badge + footnote; live answers cite "Live AI-antwoord · cijfers uitsluitend uit de geauditeerde demo-dataset".
- Config: `OPENAI_API_KEY` via `.env.local` (gitignored, verified with `git check-ignore`) or Vercel env vars; `.env.example` documents the contract. The e2e webServer pins `CAREON_ASSISTANT_LIVE=0` so the suite stays deterministic and never calls the provider.
- Verified: route smoke-tested in all modes (dummy key → live:true + upstream failure → sanitized 502; no header → 401; disabled → 503 with live:false), Biome clean (152 files), tsc clean, verify:careon 123/123, clean build (route in the table), `npx playwright test` **65/65** (new API-mode gate in careon.spec.ts). Awaiting the real key from the client owner to activate.

## Superseding requirement — Assistant canvas mobile redesign (2026-07-09)

Client reported the assistant canvas was cramped on mobile (chat and canvas shared one phone screen in a stacked grid). Redesigned mobile-only; the desktop lg+ side-by-side layout is untouched (verified by screenshot + a programmatic dock-hidden check at 1440px):

- Below `lg` the chat keeps the full workspace height; the inline canvas pane is `hidden lg:flex`.
- The canvas now opens as a full-height (92dvh) vaul bottom drawer: drag handle, "Artefact-canvas" title, close button, safe-area clearance; same `AssistantArtifactCanvas` component inside (item chips, visuals, claims, sources, print, page link).
- New "Canvas bekijken" dock above the composer (mobile only): shows the stage while a turn runs ("Bronnen lezen en nadenken…" / "Canvas samenstellen…"), then intent label + item count; tapping it — or any artifact chip under a message — opens the drawer (`select()` checks the same 1024px media query and no-ops on desktop). Crossing to ≥lg closes the drawer.
- Print safeguard: `@media print` now forces `body { position: static }` so exporting from inside the drawer (vaul pins the body) cannot shift the print layout.
- New permanent gate in `e2e/mobile.spec.ts`: quick prompt → dock ready → inline pane hidden + no horizontal overflow → drawer opens with the artifact → closes → chip reopens it.
- Evidence: iPhone-13 screenshots reviewed in careon+light (`test-results/assistant-mobile-{careon,light}-dock.png`, `...-drawer.png`, careon `...-drawer-proof.png`, `...-dock-pending.png`) plus desktop reference `test-results/assistant-desktop-careon-canvas.png`. Full pass on the final code state: `npm run check` clean (152 files), `tsc --noEmit` clean, `verify:careon` 123/123, clean `npm run build`, `npx playwright test` **67/67**.

## Superseding requirement — Assistant page viewport containment (2026-07-09)

Client reported the assistant page itself scrolled and asked for a ChatGPT-style contained app frame. Root causes found by measurement: the workspace height was computed as `100dvh − header`, which overshoots whenever the frame adds extra height (inset-variant `m-2` margins, the careon theme's own 5.5rem content clearance, mobile URL-bar `dvh` changes) — and on mobile the careon clearance stacked with the workspace's own nav clearance (double padding ≈ 175px).

- Containment is now structural (scoped via `:has([data-careon-assistant])`, other pages untouched): `body` overflow hidden while the assistant is mounted, sidebar wrapper locked to `100dvh`, inset + content wrapper become min-height:0 flex columns with overflow hidden, and the workspace simply `flex-1`s into the remaining space. A careon-scoped override drops the theme's duplicate clearance on this page.
- Mobile footer economy (the sticky footer ate 277px of a 317px phone scrollport): artifact chips under a message are one swipeable row on phones (wrap from `sm`), the meta-badge row is hidden on phones (status lives in the top bar + thread footnote), quick prompts show on phones only while the thread is empty. Desktop footer unchanged.
- New permanent gates: desktop `careon.spec.ts` "assistant layout" test asserts no document scroll in either axis with the canvas open; the mobile drawer test now asserts vertical + horizontal containment and exercises chip-reopen after a real scroll-to-bottom.
- Evidence: measured containment `scrollW/H == innerW/H` in 4 configurations (desktop default + inset variant, mobile careon + light) on the production build with live AI active; screenshots `test-results/assistant-contained-*.png` reviewed. Full pass: `npm run check` clean, `tsc --noEmit` clean, `verify:careon` 123/123, clean `npm run build`, `npx playwright test` **68/68**.

## Superseding feature — Productie-modus op de ZSG-cliëntendata-export (2026-07-14)

Client supplied the real EPD export (`cli_ntendata_export--6-.csv`, 959 cliëntrijen — gitignored, real patient data) and asked for a production mode next to demo, with everything that remains demo clearly highlighted. Implemented per PRODUCTION_MODE.md:

- **Data core** (`src/lib/careon-production/`): parser for the exact ZSG format (";", dd-mm-jjjj, "-" nulls, multi-value fields, casing normalization, BOM) with **pseudonymization at the boundary** (naam/geboortedatum/verzekeringsnummer/postcode never read); pure snapshot aggregations at a given reference date (instroom/uitstroom/caseload per maand, wachtlijst + wachttijden, populatie-verdelingen, caseloads per (regie)behandelaar, live signaleringen, dossiercontroles); central **provenance register** (live/proxy/demo per widget) — the only source for badges and page banners.
- **UI**: Databron "Productie-modus" import card (validation report → activate; Herstel demo-data restores); per-widget Live/Afgeleid/Demo badges + per-page "Productie-data actief" banner; production filters **really filter** by vestiging (no scaling), team filter hidden (all EPD-trajecten SGGZ), sidebar/bell alert count computed from live signaleringen; snapshot fields without history show "eerste meting" instead of fake deltas; live tables (Behandelaren, Medewerker-productie) show only EPD-computable columns — no mixed-provenance rows. Assistant discloses "Analyse: demo-dataset" in production mode.
- **Persistence**: localStorage always; optional Supabase adapter (env-gated, PostgREST fetch — deliberately no new npm dependency): `supabase/migrations/0001_careon_production.sql` (RLS on, service-role only), `/api/careon/production` GET/POST, import runs kept as history. Auth requirement before public hosting documented in PRODUCTION_MODE.md.
- **Demo mode is untouched**: all constants, flows, and audited behavior identical; badges/banners render only in production mode.
- Evidence on the final code state: `npm run check` clean, `tsc --noEmit` clean, `verify:careon` **123/123** (demo unchanged), new `npm run verify:production` **123/123** (parser + inline edge-cases, all aggregations on a committed synthetic fixture at fixed reference date 14-07-2026 UTC, venster/herkomst-labels, degeneraat locatiefilter, provenance register, and a sanity pass on the real export with independently computed expectations: 959 rijen, 767 actief, wachtlijst 72, 438 zonder diagnose, Tilburg 673, 27 zonder vestiging), clean `npm run build` (incl. `/api/careon/production` met sync-token-gate), `npx playwright test` **73/73** (68 existing + 5 production gates in `e2e/production.spec.ts`: import→validatierapport→activatie, cockpit live values + Live/Afgeleid/Demo badges, echt vestiging-filteren + verborgen team- en periodefilter, reload-persistentie + herstel demo, signaleringen live + wacht-op-data-sectie).

## Previous functional pass — ALL FUNCTIONAL GATES GREEN ✅ (2026-07-08, it.6)

One uninterrupted sequence on the final code state: `npm run check` clean (119 files) → `tsc --noEmit` clean → `verify:careon` 104/104 → clean `npm run build` (route table = Careon app only) → `npx playwright test` 37/37 (15 functional + 22 axe WCAG-AA, desktop + mobile, light + dark). Production server left running on port 3000.

## Iteration log

- **It.0 (setup)**: tracker created; G1/G3 green from initial implementation pass.
- **It.5 (accessibility, G8)**: added `e2e/a11y.spec.ts` (axe-core, wcag2a+wcag2aa, 11 routes × 2 themes). First run found real defects: unnamed popover trigger (critical), 14+ contrast failures (600-series text on tinted badges, avatar fallbacks, provider sub-text), non-focusable table scroll region. All fixed; dark-mode application in tests made genuine via theme_mode cookie + class assertion. Full suite now 37/37.
- **It.4 (cleanup + performance, G6/G7/G9)**: built an import-graph orphan finder; deleted 11 unreachable template files (kept ui/ primitives as library); pruned 14 unused dependencies (−23 packages). Console/favicon/TODO sweep clean. Clean rebuild + full E2E rerun green. Client JS 1.9MB raw total.
- **It.3 (functional verification, G5)**: added `npm run verify:careon` (ts-node harness, 104 assertions against audited values — all pass first run) and a Playwright E2E suite (`npm run test:e2e`, desktop + iPhone-13 projects, 15 tests, all pass; runs against the production build via webServer). Fixed test-only issues (project grep filter, ambiguous locator). check/tsc clean incl. new files.
- **It.2 (runtime verification, G4)**: full prod-server sweep green. Found + fixed soft-404: template's `[...not-found]` catch-all returned HTTP 200 for unknown dashboard paths (and `notFound()` inside it couldn't fix the status because the streamed layout flushes 200 first) — removed the catch-all so unknown paths hit Next's real 404 handling; added in-segment `not-found.tsx`. Root 404 copy translated to Dutch with link back to the cockpit.
- **It.1 (hardening + cleanup)**: G2 verified green. G6: error boundaries, loading skeleton, robots.ts (disallow all — private demo), security headers in next.config, per-page metadata with title template, lang="nl", Dutch 404 copy. G7: removed all template demo routes (dashboard demos, legacy group, chat, mail, unauthorized, auth v2, register) — check/tsc/build all green after. Stopped stale dev server (held old .next types). Next: runtime verification pass (G4), functional re-verification (G5), orphan/dependency audit (G7/G9).

## Definition of done
All gates 🟢, then final full pass: check → tsc → build → server smoke → gates table re-verified in one go, loop stops.
