# Careon Pulse — Zorgdashboard TGC Groep

A Dutch medical/healthcare KPI dashboard: a functional clone of the audited "Careon Pulse" demo dashboard, rebuilt inside the [next-shadcn-admin-dashboard](https://github.com/arhamkhnz/next-shadcn-admin-dashboard) template. All data is fixed, audited mock data; there is **no backend, database, or real authentication** — everything runs on client state.

## Quickstart

```bash
npm install
npm run dev          # http://localhost:3000
```

Demo credentials: **`user1`** / **`demo1234`** (session-storage flag; logout via the user menu in the sidebar).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run check` / `npm run check:fix` | Biome lint + format |
| `npm run verify:careon` | Assertions of the Careon business logic against the audited source values (deltas, formats, scaling, CSV parser, alert routing, color thresholds) |
| `npm run verify:production` | Production-mode data core: EPD-parsers (cliëntendata, agenda, verwijzers) incl. privacy-canaries, snapshot-aggregaties, provenance-registers en sanity-passes op de echte exports wanneer lokaal aanwezig |
| `npm run push:production` | Server-side verversing van de centrale Supabase-opslag met de drie exports uit `Exports EPD/` (nieuwe import-run + agenda-/verwijzersaggregaat) |
| `npm run test:e2e` | Playwright suite: functional flows + axe-core WCAG-AA audit of all routes in light and dark mode (desktop + mobile projects; run `npm run build` first) |

Release-gate status and iteration history: [RELEASE_GATES.md](RELEASE_GATES.md).

## What's inside

Ten audited dashboard sections under `/dashboard/…` (Dutch route names, `/` and `/dashboard` redirect to the cockpit):

Directiecockpit · Signaleringen · Patiënten · Planning · Behandelaren · Dossiercontrole · Kwaliteit · Financieel · HR · Databron

Plus **Dossiers & productie** (`/dashboard/dossiers-productie`, client-requested): dossiers, afsluitingen en productie-uren per medewerker with population analytics — diagnoses, geslacht, leeftijd, verwijzers, woonplaats, regiebehandelaar, verzekeringskoepel and wachtlijst — topped by Careon Insights, with a compact summary on the Directiecockpit. Its mock data reconciles with the audited constants (see `src/data/careon/careon-dossiers-productie.ts`).

Plus an **AI-assistent** (`/dashboard/assistent`): an assistant-ui chat workspace with a persisted thread list and an artifact canvas (KPI tiles, charts, rank lists, claims, and source references). Answers are deterministic Dutch summaries built from the audited demo dataset — no LLM or backend is involved.

The assistant supports **live AI**: set `OPENAI_API_KEY` in `.env.local` (see `.env.example`) or as a Vercel environment variable and the assistant streams real answers from a server-side route (`src/app/api/assistant/route.ts`) that grounds the model on the demo dataset — the key never reaches the browser, and the artifact canvas stays deterministic. Without a key the assistant automatically uses its deterministic demo answers ("Demo-AI" badge).

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

- Keep it a mock/client-state demo: no backend, no database, no real auth unless explicitly requested.
- Use the template's design system; do not recreate the original dashboard's neon/glass styling.
- All KPI values, alerts, table rows, and chart series come verbatim from the audit — don't invent data.
