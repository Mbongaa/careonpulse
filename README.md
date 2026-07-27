# Careon Pulse — Zorgdashboard TGC Groep

A Dutch medical/healthcare KPI dashboard: a functional clone of the audited "Careon Pulse" dashboard, rebuilt inside the [next-shadcn-admin-dashboard](https://github.com/arhamkhnz/next-shadcn-admin-dashboard) template. It supports both the audited demo dataset and privacy-minimized production imports with EU Supabase persistence, organization-scoped authentication, and a server-side AI assistant.

## Quickstart

```bash
npm install
npm run dev          # http://localhost:3000
```

Hosted demo credentials: **`user1`** / **`demo1234`**. This is a real Supabase Auth account in the isolated `Demo` organization and can sign in through the public login from any browser or network. Multiple testers can use it concurrently; logout ends only the current browser session. It is not a production-auth bypass.

For isolated local development and automated tests only, `CAREON_DEMO_MODE=1` enables the legacy session-storage fallback. Never set that flag in the hosted environment.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run check` / `npm run check:fix` | Biome lint + format |
| `npm run verify:careon` | Assertions of the Careon business logic against the audited source values (deltas, formats, scaling, CSV parser, alert routing, color thresholds) |
| `npm run verify:production` | Production-mode data core: EPD-parsers (cliëntendata, agenda, verwijzers) incl. privacy-canaries, snapshot-aggregaties, provenance-registers en sanity-passes op de echte exports wanneer lokaal aanwezig |
| `npm run verify:assistant` | Deterministic AI boundary checks: strict tool schemas, least-privilege routing, note redaction and intent-scoped production facts |
| `npm run verify:runtime` | Fault injection for provider-stream failures, fail-closed moderation, sensitive proxy inference and bounded request bodies |
| `npm run verify:assistant:live` | Live Responses API evaluation against the running production build |
| `npm run verify:data-hygiene` | Fails when a real-looking export is tracked outside the synthetic fixture folder |
| `npm run verify:ci` | Local equivalent of the deterministic CI quality gate |
| `npm run push:production` | Server-side verversing van de centrale Supabase-opslag met de drie exports uit `Exports EPD/` (nieuwe import-run + agenda-/verwijzersaggregaat) |
| `npm run test:e2e` | Playwright suite: functional flows + axe-core WCAG-AA audit in light, dark and Careon modes (desktop + mobile; run `npm run build` first) |

Release-gate status and iteration history: [RELEASE_GATES.md](RELEASE_GATES.md).

## What's inside

Ten audited dashboard sections under `/dashboard/…` (Dutch route names, `/` and `/dashboard` redirect to the cockpit):

Directiecockpit · Signaleringen · Patiënten · Planning · Behandelaren · Dossiercontrole · Kwaliteit · Financieel · HR · Databron

Plus **Dossiers & productie** (`/dashboard/dossiers-productie`, client-requested): dossiers, afsluitingen en productie-uren per medewerker with population analytics — diagnoses, geslacht, leeftijd, verwijzers, woonplaats, regiebehandelaar, verzekeringskoepel and wachtlijst — topped by Careon Insights, with a compact summary on the Directiecockpit. Its mock data reconciles with the audited constants (see `src/data/careon/careon-dossiers-productie.ts`).

Plus an **AI-assistent** (`/dashboard/assistent`): an assistant-ui chat workspace with a privacy-default session history and an artifact canvas (KPI tiles, charts, rank lists, claims, and source references). In production mode, facts and visual evidence come from the same filtered production snapshot.

The assistant supports **live AI** through the OpenAI Responses API: set `OPENAI_API_KEY` in `.env.local` (see `.env.example`) or as a hosting secret. The server route uses a pinned model snapshot, strict function schemas, per-intent tool allowlists, atomic shared quotas, bounded retries, fail-closed moderation, terminal stream validation, pseudonymous telemetry and `store:false`. Tool calls only build a local concept; the user must apply it, with additional confirmation for removals and high-impact bulk changes. Unsupported inference of language/origin from names or appearance is blocked before provider/tool execution. Without a key the assistant uses deterministic demo answers ("Demo-AI" badge). See [AI_OPERATIONS.md](AI_OPERATIONS.md).

The app is **mobile-first and installable as a PWA**: every page has a compact phone layout (bottom navigation in all themes, filter popover, card-list tables) without changing the desktop design, and `manifest.ts` + `public/sw.js` make it installable from the browser (Android: install prompt; iOS: Deel → Zet op beginscherm) with a branded offline fallback. Mobile and PWA behavior are gated by `e2e/mobile.spec.ts` and `e2e/pwa.spec.ts`.

Cross-cutting behavior:

- **Global filters** (Periode / Locatie / Team) persist across pages; location scaling multiplies scalable KPIs by audited factors (Tilburg 0.44, Breda 0.34, Roermond 0.22).
- **Signaleringen badge** shows the number of *critical* alerts (3), not the total (10).
- **Databron source modes**: demo → CSV-import (client-side parser, `kpi;huidig;vorige_maand`, `;` or `,` separators, decimal commas; recognized KPI ids override the cockpit) → API live (mock sandbox connection); "Herstel demo-data" resets.

## Architecture

- `src/app/(main)/dashboard/<screen>/page.tsx` + colocated `_components/` per screen; `page.tsx` stays small and exports per-page metadata.
- Shared Careon components: `src/app/(main)/dashboard/_components/careon/` (KPI card, chart card, alert row, filter bar, provider/state components, `CareonProvider` context for filters/source/overrides).
- Audited mock data: `src/data/careon/` (typed constants; provenance is the `zorg-dashboard-audit/` folder in the parent workspace).
- Formatting/delta logic: `src/lib/careon-format.ts`; demo auth helpers: `src/lib/careon-auth.ts`.
- shadcn/ui primitives in `src/components/ui/` are the template's component library — compose them, don't edit them (single documented exception: a focusable table scroll region for keyboard accessibility).

## Scope guardrails

- Keep the hosted demo account isolated in its own organization and preserve local demo-mode behavior for tests; never expose another organization's production data to the demo account.
- Use the template's design system; do not recreate the original dashboard's neon/glass styling.
- All KPI values, alerts, table rows, and chart series come verbatim from the audit — don't invent data.
