# AGENTS.md

## Project overview

Studio Admin is a responsive admin dashboard built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, and shadcn/ui.

This repository uses the shadcn `radix-nova` style. The shadcn CLI reports `base: "radix"`, which refers to Radix UI. Always inspect the local components in `src/components/ui/` because individual wrappers may use different primitives.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## shadcn skill

Use the shadcn skill for all work involving shadcn/ui components, styling, composition, registries, presets, or `components.json`.

If the skill is not available, install it with:

```bash
npx skills add shadcn/ui
```

The skill contains the component, styling, composition, accessibility, and CLI rules. Do not duplicate those rules here. Always inspect the local component source before using it.

Do not modify files inside `src/components/ui/` or `src/components/calendar/`. Keep these components intact and apply styling or customization where they are used.

## Setup

This project uses npm.

```bash
npm install
npm run dev
```

Available commands:

```bash
npm run build
npm run lint
npm run format
npm run check          # Biome lint + format (read-only)
npm run check:fix
npm run typecheck      # tsc via tsconfig.typecheck.json
npm run generate:presets
```

Validation suites (all read-only except `test:e2e`, which builds an isolated artifact):

```bash
npm run verify:careon        # geauditeerde waarden, schaalregel, CSV-parser, routing
npm run verify:production    # EPD-snapshot, aggregaten, redactie
npm run verify:assistant     # AI-assistent-regime
npm run verify:runtime       # runtime-hardening incl. SQL↔TS-redactiepariteit
npm run verify:data-hygiene  # geen echte exports of secrets in de tracked tree
npm run verify:ci            # alle bovenstaande + audit:production, in één keer
npm run test:e2e             # Playwright: functionele flows + axe WCAG-AA
```

WSL-kanttekening: de repo-config zet `core.worktree` op een Windows-pad (git draait normaal vanuit PowerShell). Suites die git aanroepen (`verify:data-hygiene`, dus ook `verify:ci`) hebben onder WSL `GIT_WORK_TREE="$PWD"` in de omgeving nodig; anders faalt `git ls-files` met "cannot chdir to C:/…".

Release-gate status staat in `RELEASE_GATES.md`. Draai `verify:ci` vóór je werk afrondt; `test:e2e` duurt ~12 minuten en is de laatste poort.

## Migraties toepassen op careon-zsg

**De service-role-sleutel kan géén DDL.** PostgREST voert alleen queries uit tegen tabellen en functies; `create view`, `create policy` en `alter table` zijn er niet mee te bereiken. Daarvoor is het **Supabase Management API-token** nodig: `SUPABASE_ACCESS_TOKEN` (begint met `sbp_`) staat in `.env.local` en is beschreven in `.env.example`. Het is account-breed geldig — het opent élk Supabase-project van de eigenaar, dus gebruik het uitsluitend tegen de project-ref hieronder.

- Project-ref careon-zsg: `jdxvrczwelxlgtzyisea` (eu-west-1)
- Endpoint: `POST https://api.supabase.com/v1/projects/<ref>/database/query` met `Authorization: Bearer $SUPABASE_ACCESS_TOKEN` en body `{"query": "<sql>"}`

Hetzelfde token maakt de dingen zichtbaar die PostgREST principieel niet toont: `pg_policies`, `pg_class.relrowsecurity`, `pg_indexes`, `pg_constraint`. Zonder token is een driftcontrole per definitie onvolledig — zie `docs/SQL_DRIFT_2026-07-29.md`.

Er is **geen migratieregister**: niets legt vast wat is toegepast. Controleer de stand dus altijd tegen de database zelf in plaats van tegen de bestandenlijst, en let op twee migraties die niet meer letterlijk herhaalbaar zijn: `0010` (zoekt `slug = 'zsg'`, door `0014` hernoemd naar `tgc`) en `0008` (zijn scope-CHECK kent `login` niet, terwijl die rijen bestaan).

## Facturatiemodule (handoff 15)

Nieuwe lokale conventies sinds 09-08-2026:

- **Rolpredicaat-paar**: elke laag leidt facturatie-toegang af van `magFacturatieZien()` (`src/lib/careon-facturatie-rol.ts`) resp. `app.mag_facturatie_zien()` (SQL, 0020) — nooit een eigen rolvergelijking. Superadmins zonder org-lidmaatschap vallen buiten de module.
- **Concept-only clients**: caller-JWT-writes op `careon_facturatie_facturen` kunnen uitsluitend concepten raken (RLS `status='concept' and nummer is null`); nummer + statusovergang lopen via de RPC `careon_factuur_definitief_maken`, administratieve vervolgstappen via de service-role ná `requireOrgAdmin()`.
- **Storage**: bucket `facturen` is privaat zonder client-policies; alle toegang via route handlers met de service-role. Nooit publieke of signed Storage-URL's in de UI. DB-back-ups dekken Storage niet — zie `DISASTER_RECOVERY.md`.
- **CSP**: `frame-src 'self' blob:` en `'wasm-unsafe-eval'` zijn bewuste facturatie-wijzigingen (zie `RELEASE_GATES.md`); verder blijft de policy dicht.
- **Demo-pad (B12)**: de e2e-suite draait demo-only, dus facturatie heeft een volwaardige localStorage-implementatie (`storage.client.ts`, sleutel `careon-facturatie-v1`, onvoorwaardelijk in `wisCareonCaches()`), inclusief de client-side nummerteller — de enige, gedocumenteerde uitzondering op "nummering is DB-werk".


## Careon Scribe (handoff 20)

Nieuwe lokale conventies sinds 07-09-2026 (`agent-handoff/20-clinical-scribe.md`; blueprint **D24 — voorgesteld**):

- **Rolpredicaat-paar**: elke laag leidt scribe-toegang af van `magScribeGebruiken()` / `magScribeBeheren()`
  (`src/lib/careon-scribe-rol.ts`) resp. `app.mag_scribe_gebruiken()` / `app.mag_scribe_beheren()` (SQL,
  `20260907120000`) — nooit een eigen rolvergelijking. Anders dan bij facturatie heeft de SQL-kant **geen kale
  `app.is_superadmin() or …`-tak**: het lidmaatschap is altijd een conjunct, dus een platformbeheerder zonder
  lidmaatschap valt volledig buiten de module. Toegang loopt bovendien per **gemachtigde behandelaar**
  (`careon_scribe_gemachtigden`), niet per rol alleen.
- **Eigen-sessie-policy**: inhoudstabellen (segmenten, staat, notities, taken) dragen naast het rolpredicaat de helper
  `app.scribe_eigen_sessie(sessie_id, org_id)` in **using én with check**. Voeg nooit een kale, rolblinde policy toe
  naast deze policies — permissieve policies worden ge-OR'd en één zo'n policy neutraliseert de eigenaarsafscherming
  (de enige bewuste uitzondering is de select op `careon_scribe_instellingen`).
- **Statusovergangen en retentie zijn DB-werk**: de client zet nooit `status` of een `*_verwijder_na`-kolom.
  Alles loopt via de RPC's (`careon_scribe_status_zetten`, `careon_scribe_notitie_bewerken`,
  `careon_scribe_voeg_segmenten_toe`) — **`security invoker`**, dus RLS geldt onverkort — en de
  bevriestriggers, die de bevroren kolommen alleen doorlaten met de GUC `careon.scribe_rpc` of onder de service-role.
  De bypass zit dus in die GUC plus de eigen rechten van de aanroeper, niet in definer-privilege. Retentie wordt in de
  database berekend uit de laatste instellingenrevisie, nooit uit een door de client meegegeven datum.
  Schrijf hier nooit een `security definer`-RPC in `public` met execute voor `authenticated`: `verify-auth-postgres.py`
  en `verify-scribe-postgres.py` falen daarop. Pruning en de beheerdersacties verwijderen/vrijgeven gebruiken
  uitsluitend service-role-RPC's; die beheerdersacties valideren de actuele, server-geauthenticeerde actor opnieuw.
  De additieve migratie `20260910120000_scribe_audit_integrity.sql` trekt de oude revisievrije goedkeurings-RPC
  en directe inhoudswrites in. Notitiewrites vereisen `bewerkRevisie`, binden goedkeuring aan de actuele
  staat/transcriptbron en serialiseren met statusovergangen. De oorspronkelijke toegepaste migratie blijft intact.
- **Correcties op de klinische staat lopen via `PATCH …/sessies/[id]/staat`** (N6/S7): "Intrekken", zelf aanvullen en
  de overgenomen EPD-lijst sturen één mutatie per feit met de **versie** die de client las (optimistische
  concurrency; 409 bij drift). Elke mutatie merkt de rij `doorBehandelaar: true` en een latere analysepas laat haar
  staan; een ingetrokken feit blijft doorgehaald zichtbaar in plaats van te verdwijnen. De geplakte EPD-lijst verlaat
  de browser niet — alleen de deterministisch herkende feiten gaan mee.
- **Beheerdersvlak**: `/scribe/instellingen` draagt naast de moduleschakelaar de **activatievoorwaarden** (N21 — DPIA
  met datum en eigenaar, bevestigde verwerkersovereenkomst, goedgekeurde toestemmingstekst; zolang er één ontbreekt
  blijft `ingeschakeld: true` geblokkeerd, in de UI én in de PUT-route), de **machtigingen** per behandelaar (S12) en
  de twee schakelaars voor **externe verwerking** (N19 — `transcriptieAan`, `aiAnalyseAan`, beide standaard uit).
  `/scribe/logboek` (N20) geeft de org_admin het eigen scribe-auditbeeld, metadata-only: nooit transcripttekst,
  verslaginhoud of dossierreferentie. Beide pagina's staan achter `requireScribeBeheerPage()` en de routes erachter
  achter `requireOrgAdmin()` plus RLS.
- **Opt-in AI, drie sloten**: een provideraanroep vraagt `CAREON_SCRIBE_LIVE=1` **én** de organisatieschakelaar
  (`transcriptieAan` voor de audioroute, `aiAnalyseAan` voor de analyse/verslaggeneratie) **én** een volledig
  geconfigureerde provider. Ontbreekt er één, dan werkt de module deterministisch; automatische extractie ondersteunt
  Nederlands. Het lokale Engelse pad bewaart exacte gesprekscitaten en ondersteunt een beperkte reeks letterlijke
  feiten uit expliciet door de behandelaar bevestigde sprekersregels; alle Engelse secties blijven afzonderlijk
  te beoordelen, ongewijzigde gesprekscitaten vereisen bewerking en klinische beoordelingen blijven handmatig.
  Dit is geen klinische of productieacceptatie; zie `docs/platform/SCRIBE_ENGINE_ACCEPTANCE_2026-09-11.md`.
  Een onvolledig
  geconfigureerde transcriptieprovider faalt closed met 503 en handmatige invoer. Server-side env, nooit
  `NEXT_PUBLIC_`.
- **Audio wordt nooit opgeslagen**: geen Storage-bucket, geen tijdelijk bestand, en nooit audio-bytes of
  transcripttekst in `console.*`, telemetrie of audit-events.
- **Harde navigatie de module in**: `Permissions-Policy: microphone=(self)` geldt alleen op `/scribe*` en per document,
  dus elke ingang naar `/scribe` is een `<a href>` of `window.location.assign` — nooit `next/link`. Binnen `/scribe`
  mag clientnavigatie wel.
- **Demo-pad (B12)**: volwaardige localStorage-implementatie (`storage.client.ts`, sleutel `careon-scribe-v1`),
  onvoorwaardelijk in **beide** wispaden — `wisCareonCaches()` én de uitlogflow van `careon-auth.ts`.
- **Shell-tegel achtergehouden**: het moduleregister houdt `shellReady: false`, dus `enabled: false` en
  `launchUrl: null`; zet die niet aan tot het D12-fase-2-microfoonprofiel in de shell staat (`verify:mobile` bewaakt
  het).


## Co-location-based structure

Keep feature code close to the route that owns it.

- Dashboard routes: `src/app/(main)/dashboard/<screen>/page.tsx`
- Screen-specific components, data, and schemas: `src/app/(main)/dashboard/<screen>/_components/`
- Shared dashboard components: `src/app/(main)/dashboard/_components/`
- Shared application components: `src/components/`
- Local shadcn components: `src/components/ui/`
- Shared hooks and utilities: `src/hooks/` and `src/lib/`
- Theme presets: `src/styles/presets/`

Keep a component inside its route until it is reused by another feature. Do not move screen-specific code into a shared directory preemptively.

## Creating or extending a screen

1. Inspect the closest current screen before writing code. Finance, Infrastructure, CRM, and Analytics are useful references. Do not use routes under `(legacy)` as references for new screens unless maintaining a legacy route.
2. When reproducing a UI from a screenshot or image, follow its visual direction closely, including layout, hierarchy, spacing, component structure, and important details. Implement it with the project's existing components and semantic theme tokens rather than copying raw color values. If the design needs a color that is not available through the existing theme tokens, or the user explicitly requests a non-theme color, use a named color from Tailwind's default palette. Do not use arbitrary hex, RGB, HSL, or OKLCH values.
3. Reuse the existing dashboard shell, local components, layout controls, and theme tokens.
4. Break each new page into focused components inside the route's `_components/` directory. Keep `page.tsx` small and focused on composing those pieces.
5. Keep `page.tsx` as a Server Component by default. Move interactive or browser-dependent code into a dedicated Client Component.
6. Add the screen to `src/navigation/sidebar/sidebar-items.ts` when it should appear in the dashboard navigation.
7. Decide the information hierarchy before choosing widgets. Let the content determine the page structure.
8. Keep the established visual rhythm where it fits: compact spacing, clear typography hierarchy, responsive action rows, and grids that collapse cleanly on smaller screens.
9. Widget selection is not a fixed formula. Try different arrangements of cards, resource rows, meters, charts, tabs, empty states, and actions, then keep the version that communicates the content clearly and feels consistent with the project.
10. Match nearby screens in card density, borders, radius, spacing, content width, and responsive behavior.
11. Use semantic theme tokens so new screens work with light mode, dark mode, and the existing theme presets.
12. Handle relevant loading, empty, error, disabled, and overflow states.
13. Keep screens accessible with semantic HTML, keyboard support, visible focus states, labels, and appropriate ARIA attributes.

## Code conventions

- TypeScript strict mode is enabled. Use precise types and avoid `any`.
- Use the existing `@/` import aliases.
- Follow the Biome configuration: double quotes, semicolons, two-space indentation, sorted imports, and a 120-character line width.
- Avoid unnecessary dependencies.
- Keep changes focused and do not refactor unrelated files.

## Contributions

- Use conventional commit prefixes such as `feat:`, `fix:`, `refactor:`, `docs:`, and `chore:`.
- Include screenshots for new screens and material visual changes. Include mobile and dark-theme states when relevant.
- Explain new reusable patterns or dependencies in the pull request.
- Follow `CONTRIBUTING.md` for the contribution workflow.

## Platform context (Careon Pulse)

This repository is one module of the **Careon Pulse** multi-module platform: a Flutter shell app + a Supabase identity hub (OAuth 2.1 / OIDC) + independent modules (this dashboard and the HumHub communication platform with Microsoft ACS/Teams calling). JaaS remains a disabled fallback; native calling and recording/AI retain their release gates.

Platform-level architecture, the decision log (D1–D24, of which D24 is proposed), the roadmap, and cross-repo rules live in `docs/platform/PLATFORM_BLUEPRINT.md`. Read it before any work that touches authentication, organizations/roles, tile entitlements, the OAuth 2.1 server configuration, Microsoft Entra/Graph, or integration with other modules. Decisions marked **Confirmed** there must not be changed silently — propose alternatives explicitly with consequences.

Current platform state, phase progress, and next milestones are tracked in `docs/platform/PROJECT_STATUS.md` — update it when a milestone changes state. The cross-session product-readiness backlog, consequences and acceptance evidence live in `docs/platform/PLATFORM_GAP_REGISTER.md`; read it before platform-gap work and update the relevant item whenever work starts or its status changes.

Sibling repositories: `careonpulse-shell` (Flutter shell app), `humhub-meeting-modules` (meeting-core / meeting-recordings / meeting-intelligence), `platform-deploy` (Hetzner/Coolify Compose stack). Each has its own AGENTS.md for local conventions; all defer to the umbrella blueprint for platform-level decisions.

This file continues to govern local dashboard conventions (structure, shadcn rules, Biome, commits) exactly as above.
