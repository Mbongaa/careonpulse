# Productie-modus (ZSG-cliëntendata + agenda + verwijzers)

Naast de geauditeerde demo-modus kent Careon Pulse een **productie-modus**: op
de Databron-pagina importeer je de volledige ZSG-cliëntendata-export (één rij
per cliënt) en berekent het dashboard de cliëntgebonden KPI's uit echte
EPD-data. Sinds 2026-07-22 kunnen daarnaast twee **aanvullende exports**
gekoppeld worden (kaart "Agenda- en verwijzersexport koppelen"):

- de **agenda-/afsprakenexport** — planning, no-show, uren, gefactureerde
  omzet, contactrecentheid, sessieverslag-/ondertekencontroles;
- de **huisarts/verwijzer-export** — het verwijsnetwerk (AGB, plaats, rol,
  Zorgmail);
- de **toeslagen-export** (declared surcharges) — TC-toeslagprestaties
  (reistijd, tolk, psychodiagnostiek) die als extra regels op dezelfde
  facturen staan als de sessies; ze tellen mee in de omzetcijfers (alleen
  ongefilterd — de export draagt geen vestiging) en voeden het
  Toeslagen-paneel op Financieel. De export bevat cliëntnamen (geen ID's):
  die worden bij het parsen alleen geteld en nooit bewaard.

Widgets zonder EPD-bron blijven demo-data tonen en zijn als zodanig gemarkeerd.

## Architectuur

```
cliëntendata (CSV) ─▶ parse-export.ts ────▶ ClientRecord[] (gepseudonimiseerd)
agenda (CSV) ───────▶ parse-agenda.ts ────▶ AgendaFacts (alleen aggregaten)
verwijzers (CSV) ───▶ parse-verwijzers.ts ▶ VerwijzersFacts (praktijkgegevens)
                                              │
                     localStorage ◀── opslag ─┼─▶ Supabase (optioneel, env-gated)
                                              │
filters (vestiging) ─▶ compute-snapshot.ts ──▶ ProductionSnapshot ─▶ pagina's
                                              provenance.ts ───────▶ badges
```

- `src/lib/careon-production/parse-export.ts` — parser voor het exacte
  ZSG-formaat (`;`-separator, `dd-mm-jjjj`, `-` als leeg, multi-value velden,
  hoofdletter-normalisatie, BOM). **Pseudonimisering aan de grens**: naam,
  geboortedatum, verzekeringsnummer, postcode, BSN en adres worden nooit
  gelezen. Bij dubbele cliënt-ID's (meerdere trajecten per cliënt) wint het
  open/meest recente traject — altijd-de-eerste zou heropende cliënten als
  uitgestroomd tellen.
- `src/lib/careon-production/parse-agenda.ts` — parser voor de agenda-export
  (20k+ afspraakregels). **Aggregatie aan de grens**: er worden nooit losse
  afspraakregels bewaard — alleen aggregaten per (maand, vestiging,
  behandelaar), facturatie per factuurmaand, weekdagen en contactfeiten per
  cliënt-ID. `Client_naam`, `Memo` (vrije klinische tekst) en `BSN` worden
  nooit gelezen; alleen gehouden sessies tellen als contactmoment. Blok-rijen
  ("Afwezig") worden apart geaggregeerd als capaciteitssignaal.
  **Toekomstvenster**: rijen ná de peildatum (het importmoment) zijn geplande
  afspraken en blijven buiten alle historische aggregaten (een geplande sessie
  draagt al een geprijsde waarde maar geen factuur — meetellen zou onderhanden
  werk en no-show vervuilen); ze voeden de vooruitblik (geplande sessies per
  maand, eerstvolgende afspraak per cliënt). Daarmee wordt "Zonder
  vervolgafspraak" écht berekenbaar — vraag ZSG dus om agenda-exports met een
  einddatum in de toekomst (bijv. +12 maanden). Kanttekening uit de echte
  export: toekomstige "MDO met patient"-sessies staan vrijwel allemaal zonder
  cliënt-ID (nog niet toegewezen MDO-blokken), dus "Geen evaluatie gepland"
  blijft bewust demo.
- `src/lib/careon-production/parse-verwijzers.ts` — parser voor de
  huisarts/verwijzer-export: per verwijzer (AGB-code als sleutel) naam, rol,
  plaats, Zorgmail en het aantal unieke cliënten. E-mailadressen worden nooit
  bewaard.
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

- **Live** — direct uit de export berekend (instroom incl.
  verwijzingen-vraagkant, caseload, wachtlijst incl. fase- en taalverdeling,
  wachttijd-trend per startmaand, populatie, zorgvraagtypering-verdeling,
  behandelduur incl. kwartaaltrend en uitvalsignalen, comorbiditeit, acht
  dossiercontroles waaronder COV-/AGB-declaratierisico's, verwijzers
  gegroepeerd op AGB-code, netto groei + doorstroom, datakwaliteit-scorecard
  op Databron, …). Productie-exclusieve panelen (geen demo-tegenhanger; demo
  blijft pixel-identiek): Zorgvraagtypering, Behandelduur, Wachttijd-trend,
  Datakwaliteit.
- **Demo→productie-vervangingen** met een eerlijker label: ">30/60 dgn geen
  contact" → ">30/60 dgn geen registratie" (ondergrens-proxy),
  "Crisiscliënten" → "Hoog-risico (ZT05/ZT08)", "Zorgvorm" →
  setting-verdeling S03/S04, "Productie-uren" → cumulatief geregistreerde
  uren, kwaliteit-"Dossierkwaliteit" → registratie-compleetheid op 10.
- **Afgeleid (proxy)** — gedocumenteerde benadering, toelichting in de tooltip:
  outreach = ZPM-setting S04 (bevestiging klant gevraagd); urgent = >60 dagen
  wachtend; dossiers-niet-compleet = alleen de drie ondersteunde controles.
- **Agenda-overlay (sinds 2026-07-22)** — met een gekoppelde agenda-export
  schuiven widgets op via `AGENDA_PROVENANCE` (badges volgen de werkelijk
  aanwezige bron): Planning volledig (afspraken, no-shows, tijdig afgezegd,
  behandel-/indirecte uren, urenverdeling, no-show per 7 weekdagen — de
  praktijk draait ook weekenddiensten), cockpit no-show + omzet (incl.
  trend-charts), Financieel grotendeels (gefactureerde omzet per factuurmaand,
  per verzekeraar/locatie, onderhanden werk, ouderdom), échte
  contactrecentheid (">30/60 dgn geen contact" op gehouden afspraken),
  behandelaren-consulten/no-show/uren/omzet (12 mnd), en agenda-signaleringen
  (geen contact >60 dgn, no-show >5%, dossiers zonder behandelplan-sessie,
  sessies >90 dgn niet gefactureerd) plus twee dossiercontroles
  (sessieverslag ontbreekt, sessie niet ondertekend). Verwijzers-export →
  Verwijsnetwerk-paneel op Dossiers & Productie (`VERWIJZERS_PROVENANCE`).
  Facturatie loopt in batches: omzet-maanden met € 0 zijn maanden zonder
  factuurronde, niet zonder productie. Met een **toekomstvenster** in de
  agenda-export komt daar bovenop (`AGENDA_TOEKOMST_PROVENANCE`): "Zonder
  vervolgafspraak" op cockpit en Patiënten (incl. drilldown met de echte
  cliëntlijst), de bijbehorende signalering, en het Vooruitblik-paneel op
  Planning (geplande sessies per komende maand).
- **Demo** — wacht op resterende exports: **declaratiestatus**
  (Vecozo/afgekeurd/Infomedics — Financieel-restjes), **HR** (verzuim, BIG,
  contracturen voor echte bezetting), ROM/MIC (Kwaliteit, tevredenheid).
  Zodra een export beschikbaar is: parser + aggregatie toevoegen en de
  betreffende widgets in het overlay-register omzetten naar `live`.
- **Locaties**: sinds de juli-2026-export bevat de cliëntendata ook de tweede
  instelling (Vurans **Veghel**); het locatiefilter toont in productie alleen
  vestigingen die echt in de data voorkomen (Tilburg, Veghel, Breda,
  Roermond).

## AI-assistent in productie-modus

Met een geconfigureerde `OPENAI_API_KEY` analyseert de live AI-assistent de
**echte EPD-import**: de vragen gaan met een geaggregeerd feitenblad
(`src/lib/careon-production/assistant-facts.ts`) naar de AI-dienst — kern-KPI's,
trends, wachtlijst, populatie, controles en datakwaliteit, inclusief de
proxy-definities zodat het model ze correct benoemt. **Privacy**: uitsluitend
aggregaten; cliënt-ID's, dossierlinks en de risicolijst gaan nóóit mee
(bewaakt door `verify:production`). Behandelaar-/verwijzernamen (medewerker-
en praktijkgegevens) zitten er wél in — nodig voor caseloadvragen. Zonder
live AI valt de assistent terug op de deterministische demo-referentie en
zegt dat er eerlijk bij ("Analyse: demo-dataset").

## Supabase (optioneel, aanbevolen voor gedeeld gebruik)

Zonder configuratie blijft de import in de browser (localStorage). Met
Supabase wordt elke import als **snapshot-run** centraal bewaard (nooit
overschreven → historie voor maand-op-maand-vergelijkingen) en zien alle
gebruikers dezelfde data.

1. Maak een Supabase-project in een **EU-regio** (AVG) en sluit een
   verwerkersovereenkomst af.
2. Voer `supabase/migrations/0001_careon_production.sql` uit,
   `supabase/migrations/0002_careon_middelen.sql` voor de handmatige
   middelen- & inventarisregistratie (handoff 09),
   `supabase/migrations/0003_careon_agenda.sql` voor de agenda- en
   verwijzersaggregaten, en `supabase/migrations/0004_careon_toeslagen.sql`
   voor het toeslagen-aggregaat.
3. Zet `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` én
   `NEXT_PUBLIC_CAREON_SYNC_TOKEN` in `.env.local` en herstart. Zonder
   sync-token blijft de route uitgeschakeld (501).

Naast de browser-import is er een server-side verversing:
`npm run push:production` parseert de nieuwste export per soort uit
`Exports EPD/` en zet ze centraal (nieuwe import-run +
agenda-/verwijzers-/toeslagenaggregaat). **Regressie-bescherming**: een slice
wordt overgeslagen wanneer het bestand ontbreekt óf ouder is (mtime) dan de
centrale stand — oude bestanden die in de map achterblijven kunnen de
centrale data dus nooit terugdraaien (`-- --force` om bewust te
overschrijven). Browsers met een oudere import in localStorage nemen de
nieuwe centrale stand automatisch over — de provider vergelijkt `importedAt`
en de nieuwste wint.

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

> **E2e is geïsoleerd van Supabase**: `playwright.config.ts` leegt de
> Supabase-variabelen voor de testserver, zodat de sync-route in tests 501
> geeft. Zonder die isolatie pushen de productie-tests fixture-runs naar de
> échte centrale opslag (verdringt de echte import als "nieuwste") en
> hydrateren demo-tests productie-data — beide zijn in de praktijk gebeurd.

- `npm run verify:production` — 290+ assertions: parser-gedrag op de fixture
  én op inline randgevallen (meerregelige quoted cellen, dubbele kolomkoppen,
  niet-bestaande kalenderdagen, geweigerde niet-https-deeplinks), alle
  snapshot-aggregaties (vaste referentiedatum 14-07-2026, UTC), venster- en
  herkomstlabels, degeneraat-gedrag bij een leeg locatiefilter,
  provenance-register-drift (basis + agenda-/verwijzersoverlay), de
  agenda- en verwijzersparsers met privacy-canaries (naam/memo/BSN/e-mail
  mogen nooit in een aggregaat belanden), en — wanneer de echte exports
  lokaal aanwezig zijn — sanity-passes met onafhankelijk berekende
  verwachtingen (oude export: 959 rijen/767 actief; nieuwe exports:
  1.267 cliënten/975 actief, 15.830 sessies, 120 no-shows,
  € 3.607.109 gefactureerd, enz.).
- `npm run verify:careon` — de 104 geauditeerde demo-assertions blijven
  ongewijzigd van kracht; demo-modus is pixel- en gedrags-identiek gebleven.
