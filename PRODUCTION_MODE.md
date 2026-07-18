# Productie-modus (ZSG-cliëntendata)

Naast de geauditeerde demo-modus kent Careon Pulse een **productie-modus**: op
de Databron-pagina importeer je de volledige ZSG-cliëntendata-export (één rij
per cliënt) en berekent het dashboard de cliëntgebonden KPI's uit echte
EPD-data. Widgets zonder EPD-bron blijven demo-data tonen en zijn als zodanig
gemarkeerd.

## Architectuur

```
ZSG-export (CSV) ──▶ parse-export.ts ──▶ ClientRecord[] (gepseudonimiseerd)
                                              │
                     localStorage ◀── opslag ─┼─▶ Supabase (optioneel, env-gated)
                                              │
filters (vestiging) ─▶ compute-snapshot.ts ──▶ ProductionSnapshot ─▶ pagina's
                                              provenance.ts ───────▶ badges
```

- `src/lib/careon-production/parse-export.ts` — parser voor het exacte
  ZSG-formaat (`;`-separator, `dd-mm-jjjj`, `-` als leeg, multi-value velden,
  hoofdletter-normalisatie, BOM). **Pseudonimisering aan de grens**: naam,
  geboortedatum, verzekeringsnummer en postcode worden nooit gelezen.
- `src/lib/careon-production/compute-snapshot.ts` — pure aggregaties
  (deterministisch bij gegeven referentiedatum, dus testbaar): instroom/
  uitstroom/caseload per maand, wachtlijst en wachttijden, populatie-
  verdelingen, caseloads, live signaleringen, dossiercontroles.
- `src/lib/careon-production/provenance.ts` — het herkomst-register: per
  widget `live` / `proxy` / `demo`. De UI (badges, paginabanners, tellers)
  leest uitsluitend dit register.
- `CareonProvider` (`_components/careon/careon-provider.tsx`) — bron-modus
  `productie`, snapshot via `useMemo`, hydratatie uit localStorage en
  (indien geconfigureerd) Supabase.

## Gedragsverschillen t.o.v. demo-modus

| Aspect | Demo | Productie |
|---|---|---|
| Locatiefilter | schaalt KPI's (0,44/0,34/0,22) | **filtert echt** op vestiging; banner meldt actieve cliënten zonder vestigingslabel |
| Periodefilter | zichtbaar (geauditeerd gedrag) | verborgen — vensters liggen vast (12 volle maanden; maand-KPI's = laatste volle maand, benoemd in de subtekst) |
| Teamfilter | SGGZ/BGGZ/FACT/Ouderen | verborgen (alle EPD-trajecten zijn SGGZ) |
| Sidebar-alertbadge | vast (3 kritiek) | berekend uit live signaleringen (volgt het locatiefilter, consistent met de pagina) |
| Delta's ("vorige maand") | vaste waarden | echt berekend; snapshot-velden zonder historie tonen "eerste meting"; kwartaalvensters heten "vorig kwartaal" |
| Vraagt-aandacht-lijst | namen (demo) | Cliënt-ID's + deeplink naar het EPD-dossier (alleen https-links) |

## Herkomst per widget

- **Live** — direct uit de export berekend (instroom, caseload, wachtlijst,
  populatie, dossiercontroles diagnose/typering/verwijzer, …).
- **Afgeleid (proxy)** — gedocumenteerde benadering, toelichting in de tooltip:
  outreach = ZPM-setting S04 (bevestiging klant gevraagd); urgent = >60 dagen
  wachtend; dossiers-niet-compleet = alleen de drie ondersteunde controles.
- **Demo** — wacht op aanvullende exports: **afspraken/agenda** (no-show,
  Planning, contact-signaleringen), **declaraties** (Financieel, omzet),
  **urenregistratie** (productiviteit), **HR** (verzuim, BIG), ROM/MIC
  (Kwaliteit). Zodra een export beschikbaar is: tabel + aggregatie toevoegen
  en de betreffende widgets in `provenance.ts` omzetten naar `live`.

## Supabase (optioneel, aanbevolen voor gedeeld gebruik)

Zonder configuratie blijft de import in de browser (localStorage). Met
Supabase wordt elke import als **snapshot-run** centraal bewaard (nooit
overschreven → historie voor maand-op-maand-vergelijkingen) en zien alle
gebruikers dezelfde data.

1. Maak een Supabase-project in een **EU-regio** (AVG) en sluit een
   verwerkersovereenkomst af.
2. Voer `supabase/migrations/0001_careon_production.sql` uit.
3. Zet `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` én
   `NEXT_PUBLIC_CAREON_SYNC_TOKEN` in `.env.local` en herstart. Zonder
   sync-token blijft de route uitgeschakeld (501).

Er is bewust géén `@supabase/supabase-js`-dependency: de server-routes
(`src/app/api/careon/production/route.ts`) praten via PostgREST-fetch met de
service-role key. RLS staat aan zonder policies, dus anon-clients kunnen
niets lezen.

Robuustheid van de synchronisatie:

- De import-kaart meldt het resultaat van zowel de browseropslag (quota) als
  de centrale push — een mislukte push is zichtbaar, niet stil.
- Een half-mislukte upload (run zonder records) wordt server-side opgeruimd;
  de GET-route negeert bovendien onvolledige runs (records ≠ `total_rows`),
  zodat een kapotte laatste run nooit de vorige goede run verduistert.
- Praktische groottegrens: boven ± 5.000–7.000 cliëntrijen kan de
  browseropslag (± 5 MB) of de request-bodylimiet van de host de persistentie
  breken; de UI meldt dat dan expliciet. De huidige export (± 1.000 rijen)
  zit daar ruim onder.

### Toegangsdrempel ≠ authenticatie

De route eist het sync-token in de `x-careon-sync`-header. Dat token staat in
de client-bundle en weert dus alleen scanners en toevallige bezoekers — het is
**geen** vervanging voor echte auth (zie hieronder). De pseudonieme dataset in
localStorage en Supabase (behandelaar- en verwijzernamen + diagnosegroep +
woonplaats + leeftijd per cliënt-ID) is bovendien voor kleine teams realistisch
herleidbaar: behandel de browseropslag als vertrouwelijk en wis die op
gedeelde werkplekken ("Herstel demo-data" of uitloggen + opslag wissen).

## ⚠️ Vereisten vóór publieke hosting van echte data

1. **Echte authenticatie.** De demo-login (`user1`/`demo1234`) is geauditeerd
   demo-gedrag en géén beveiliging. Het sync-token op
   `/api/careon/production` is een drempel, geen auth: het staat in de
   client-bundle. Voordat een deployment met echte EPD-data publiek
   bereikbaar wordt: Supabase Auth (of SSO) toevoegen en de routes achter een
   échte sessie-check zetten. Tot die tijd: Supabase-variabelen alleen
   invullen op niet-publiek bereikbare omgevingen.
2. **Echte exports nooit committen.** `.gitignore` bevat
   `cli_ntendata_export*.csv` en `*export*.csv`; bewaar exports buiten de
   repo en verwijder ze na import.
3. De committed fixture (`src/scripts/fixtures/zsg-clienten-fixture.csv`) is
   volledig synthetisch.

## Verificatie

- `npm run verify:production` — 120+ assertions: parser-gedrag op de fixture
  én op inline randgevallen (meerregelige quoted cellen, dubbele kolomkoppen,
  niet-bestaande kalenderdagen, geweigerde niet-https-deeplinks), alle
  snapshot-aggregaties (vaste referentiedatum 14-07-2026, UTC), venster- en
  herkomstlabels, degeneraat-gedrag bij een leeg locatiefilter,
  provenance-register-drift, en — wanneer de echte export lokaal aanwezig is —
  een sanity-pass met onafhankelijk berekende verwachtingen (959 rijen, 767
  actief, wachtlijst 72, 27 zonder vestiging, enz.).
- `npm run verify:careon` — de 104 geauditeerde demo-assertions blijven
  ongewijzigd van kracht; demo-modus is pixel- en gedrags-identiek gebleven.
