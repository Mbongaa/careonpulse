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
  facturen staan als de sessies; ze voeden het Toeslagen-paneel op Financieel
  maar tellen — net als in het facturatie-overzicht van de klant en de
  boekhoudkundige factuurtotalen — **niet** mee in de omzetkaarten. De export
  bevat cliëntnamen (geen ID's): die worden bij het parsen alleen geteld en
  nooit bewaard;
- het **declaratie-totaaloverzicht** (declaration total) — per factuur het
  gedeclareerde bedrag, het toegekende totaalbedrag en creditnota's. Voedt
  Openstaande declaraties, "Tekort op toekenning", Declaraties >90 dgn, de
  échte ouderdom van openstaand en het Declaratiestatus-paneel (toekennings-
  graad per debiteur) + de live signalering "Declaraties >90 dagen open".
  Particuliere debiteuren (persoonsnamen) worden samengevoegd tot
  "Particulier"; factuurnummers zijn per debiteur-administratie gesleuteld
  (de ZVW- en WMO-reeksen overlappen).

**Omzet-indeling (klantformaat FACTURATIE.xlsx, sinds 2026-07-23 — zie
`agent-handoff/10-omzet-behandelmaand-driedeling.md`)**: omzet wordt geteld
per **behandelmaand** (afspraakdatum, alleen gefactureerde sessies, excl.
toeslagen) in de driedeling van het eigen maandoverzicht van de klant:

- **Vecozo (VGZ + DSW)** — declareren rechtstreeks (opgave klant);
- **Servicebureau (Infomedics)** — alle overige verzekeringskoepels;
- **RMO/RMA** — regelingen voor asielzoekers/ontheemden, uitgevoerd door DSW,
  datagedreven herkend aan **Uzovi 3355** (gewone DSW-verzekering is 7029).

Financieel toont "Totale omzet" + de drie kanaalkaarten; de directiecockpit
draagt de Vecozo-, servicebureau- én RMO/RMA-kaart. De Omzetontwikkeling-chart
stapelt de drie reeksen per behandelmaand. Let op: een net afgesloten maand
loopt nog op totdat de facturatierun (begin volgende maand) is geweest — de
chart-voetnoot toont het nog niet gefactureerde bedrag van die maand.

**Verwachte uitbetaling (tweede kaartwaarde)**: elke omzetkaart draagt onder
de bruto-waarde een regel "Verwacht uitbetaald" — verzekeraarskanalen
(Vecozo + servicebureau) × 65% (`UITBETALING_PCT`, opgave klant, spiegelt de
onderste regel van zijn FACTURATIE.xlsx), RMO/RMA × 100%. De
omzet-drilldowns tonen de volledige berekening per behandelmaand als extra
kolom. De *gemeten* toekennings-% per koepel (uit het declaratie-overzicht)
staat ter referentie in het Declaratiestatus-paneel.

**KPI-drilldowns**: kaarten zijn overal klikbaar. Cliëntgebonden drilldowns
tonen echte pseudonieme records; agenda-/declaratie-gedreven drilldowns tonen
een live kop + trend + een geaggregeerde maand- of debiteurentabel (losse
afspraakregels worden uit privacy-oogpunt niet bewaard).

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
  trend-charts), Financieel grotendeels (gefactureerde omzet per
  behandelmaand in de driedeling Vecozo/servicebureau/RMO-RMA, per
  verzekeraar/locatie, onderhanden werk, ouderdom), échte
  contactrecentheid (">30/60 dgn geen contact" op gehouden afspraken),
  behandelaren-consulten/no-show/uren/omzet (12 mnd), en agenda-signaleringen
  (geen contact >60 dgn, no-show >5%, dossiers zonder behandelplan-sessie,
  sessies >90 dgn niet gefactureerd) plus twee dossiercontroles
  (sessieverslag ontbreekt, sessie niet ondertekend). Verwijzers-export →
  Verwijsnetwerk-paneel op Dossiers & Productie (`VERWIJZERS_PROVENANCE`).
  Facturatie loopt in batches ná de behandelmaand: de jongste maand loopt
  nog op tot de eerstvolgende factuurronde (voetnoot in de chart toont het
  nog niet gefactureerde bedrag). Met een **toekomstvenster** in de
  agenda-export komt daar bovenop (`AGENDA_TOEKOMST_PROVENANCE`): "Zonder
  vervolgafspraak" op cockpit en Patiënten (incl. drilldown met de echte
  cliëntlijst), de bijbehorende signalering, en het Vooruitblik-paneel op
  Planning (geplande sessies per komende maand).
- **Kwaliteit-proxies uit de agenda** (`AGENDA_KWALITEIT_PROVENANCE`,
  2026-07-26): drie Kwaliteit-widgets rekenen op de agenda-sessietypen —
  **Zorgplannen compleet** (aandeel actieve dossiers >30 dgn met gehouden
  behandelplan-sessie), **Evaluaties op tijd** (aandeel cliënten >6 mnd in
  zorg met gehouden "MDO met patient" in de laatste 6 mnd) en
  **Medicatiecontroles** (aandeel medicatie-cliënten met farmaco-contact in
  het laatste kwartaal — definitie ter bevestiging aan de instelling). Ze
  vereisen een agenda-aggregaat mét de MDO-/farmaco-velden: **na deze
  wijziging éénmalig de agenda-export opnieuw importeren**, anders blijven de
  widgets demo-gemarkeerd. "Dossierkwaliteit" op Dossiercontrole toont in
  productie dezelfde registratie-compleetheidsscore als de Kwaliteit-pagina
  (proxy, zonder "(audit)"-label); de BIG-signalering komt live uit de
  handmatige HR-registratie (herkomst "handmatig").
- **Demo** — wacht op resterende exports: **declaratiestatus**
  (Vecozo/afgekeurd/Infomedics — Financieel-restjes), **HR** (verzuim,
  contracturen voor echte bezetting), ROM/MIC (ROM-/PROM-compliance,
  suïcidaliteitsscreening, incidenten, klachten, tevredenheid).
  Zodra een export beschikbaar is: parser + aggregatie toevoegen en de
  betreffende widgets in het overlay-register omzetten naar `live`.
- **Locaties**: sinds de juli-2026-export bevat de cliëntendata ook de tweede
  instelling (Vurans **Veghel**); het locatiefilter toont in productie alleen
  vestigingen die echt in de data voorkomen (Tilburg, Veghel, Breda,
  Roermond).

## AI-assistent in productie-modus

Met een geconfigureerde `OPENAI_API_KEY` analyseert de live AI-assistent de
**echte EPD-import** via de Responses API. Het feitenblad is per intent
begrensd: uitsluitend relevante aggregaten; cliëntrecords, dossierlinks en
risicolijsten gaan nooit mee. Namen van behandelaren gaan alleen mee bij een
expliciete coaching-/behandelaarvraag. De handmatige middelenregistratie gaat
alleen mee bij een relevante vraag en vrije notities uitsluitend wanneer de
gebruiker expliciet om notities of asset-tags vraagt.

De route gebruikt een gedateerde modelsnapshot, `store:false`, strikte
function-schema's, een per-vraag tool-allowlist, body/contextlimieten,
moderation, timeouts/retries, rate limiting en pseudonieme operationele
events. Mutaties worden client-side als concept afgespeeld; niets wordt
opgeslagen zonder menselijke goedkeuring. Verwijderingen vereisen daarnaast
een afzonderlijk vinkje. Zie `AI_OPERATIONS.md`.

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
   verwijzersaggregaten, `supabase/migrations/0004_careon_toeslagen.sql`,
   `supabase/migrations/0005_careon_declaraties.sql` en
   `supabase/migrations/0006_assistant_production_hardening.sql`,
   `supabase/migrations/0007_careon_hr.sql` en
   `supabase/migrations/0008_runtime_operations_hardening.sql`.
3. Zet `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` én
   `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` en herstart. Voer daarna de
   resterende migraties op volgorde uit:
   - `0009`–`0012` — echte accounts, org-scoping, chats, audit (handoff 13);
   - `0013_login_rate_limit.sql` — brute-force-rem per bezoekers-IP;
   - `0014_rename_org_tgc.sql` — organisatie ZSG → TGC;
   - `20260726175252_auth_security_hardening.sql` — auth-hardening;
   - `0015_financieel_rls.sql` — financiële rolregel in RLS + de redigerende
     agenda-view (audit 29-07-2026). **Toepassen vóór de bijbehorende code
     uitrolt**; de route valt terug op de basistabel zolang de view ontbreekt,
     maar leden zien dan nog het ongeredigeerde aggregaat via PostgREST;
   - `0016_login_account_throttle.sql` — brute-force-rem per account;
   - `0017_import_runs_created_at.sql` — servertijdstempel + index voor
     EPD-import-runs (functionele audit 29-07-2026). **Toepassen vóór de
     bijbehorende code uitrolt**: beheer én de productie-GET sorteren op
     `created_at` en geven zonder deze kolom een PostgREST-400.
   - `0018_org_display_name.sql` — weergavenaam per organisatie;
   - `0019_careon_access_token_hook.sql` — `careon`-claim in access tokens
     (GoTrue custom-access-token-hook, Spike A / YAAZ-SSO);
   - `0020_careon_facturatie.sql` — facturatiemodule (handoff 15): vier
     tabellen + RLS met `app.mag_facturatie_zien`, de atomaire
     definitief-maak-RPC, de concept-prune-RPC en de private Storage-bucket
     `facturen`. **Toepassen vóór de bijbehorende code uitrolt** (de
     facturatieroutes geven anders PostgREST-404's).
   - `0021_careon_facturatie_mail.sql` — facturatie fase B (handoff 15 §0.5):
     de tabel `careon_facturatie_maillog` (één rij per verzendpoging, RLS
     select-only via `app.mag_facturatie_zien`, schrijven alleen met de
     service-role) + de quota-scope `mail` in
     `careon_consume_assistant_quota` (CHECK-constraint én functie-allowlist).
     **Toepassen vóór de bijbehorende code uitrolt**; zonder de scope
     `mail` faalt de verzendroute met `invalid quota parameters`.
   - `20260821213000_facturatie_fk_indexes.sql` — leidende indexes op de
     nullable `contact_id`-FK van facturen en `factuur_id` van het maillog;
     voorkomt volledige scans bij joins en `ON DELETE RESTRICT`-controles.

   Het oude sync-token is vervallen: toegang loopt via Supabase Auth-sessies.

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

Sinds handoff 13 praten de server-routes via PostgREST-fetch met het **JWT
van de ingelogde gebruiker** (anon-key + user-token): RLS dwingt de
organisatie-scheiding in Postgres af, óók bij een route-bug. De service-role
key is gereserveerd voor beheer (admin-API), de compenserende delete van een
mislukte import-run, audit-inserts en onderhoud. `@supabase/supabase-js` +
`@supabase/ssr` (beide puur JS) verzorgen de cookie-sessies.

Robuustheid van de synchronisatie:

- De import-kaart meldt het resultaat van zowel de browseropslag (quota) als
  de centrale push — een mislukte push is zichtbaar, niet stil.
- De middelenregistratie gebruikt monotone revisies en idempotente
  operation-ID's. Gelijktijdige edits worden niet meer stil overschreven:
  de UI pauzeert en laat de gebruiker de centrale of lokale versie kiezen.
- Schone clients pollen de centrale revisie en nemen wijzigingen van
  collega's over. Niet-gesynchroniseerde lokale wijzigingen overleven een
  herlaad en worden alleen hervat wanneer hun basisrevisie nog geldig is.
- Auditrijen bevatten uitsluitend pseudonieme actor-/request-ID's,
  toolnamen en aantallen; geen vragen, antwoorden, medewerkername of tool-args.
- Een half-mislukte upload (run zonder records) wordt server-side opgeruimd;
  de GET-route negeert bovendien onvolledige runs (records ≠ `total_rows`),
  zodat een kapotte laatste run nooit de vorige goede run verduistert.
- Import- en aanvullende snapshot-writes hebben unieke operation-ID's;
  netwerkherhalingen maken daardoor geen dubbele snapshots. Grote imports
  worden in batches geschreven en bij elke gedeeltelijke fout volledig
  teruggedraaid.
- De gedeelde AI- en auditquota worden atomisch in Postgres verbruikt. De
  dagelijkse Vercel-cron ruimt verlopen operationele events en quotarijen op;
  producthistorie wordt niet door deze onderhoudstaak verwijderd.
- Praktische groottegrens: boven ± 5.000–7.000 cliëntrijen kan de
  browseropslag (± 5 MB) of de request-bodylimiet van de host de persistentie
  breken; de UI meldt dat dan expliciet. De huidige export (± 1.000 rijen)
  zit daar ruim onder.

### Authenticatie (sinds handoff 13)

In iedere normale deployment gelden **echte accounts**: Supabase Auth met
cookie-sessies, afgedwongen in `src/proxy.ts` (pagina's) én in elke API-route
(`requireCareonSession`). Ontbrekende Supabase-configuratie faalt gesloten met
503. De lokale demo-login (`user1`/`demo1234`) bestaat alleen met de expliciete
servervlag `CAREON_DEMO_MODE=1` (Playwright/offline demo); daarnaast bestaat
`user1@careon-demo.nl` als echt Supabase-account in de aparte Demo-organisatie —
dat account ziet door RLS uitsluitend lege demo-data, nooit ZSG-data. De
pseudonieme dataset in localStorage (behandelaar- en verwijzernamen +
diagnosegroep + woonplaats + leeftijd per cliënt-ID) is voor kleine teams
realistisch herleidbaar: behandel de browseropslag als vertrouwelijk en wis
die op gedeelde werkplekken.

### Microsoft Entra-login en YAAZ Office 365 (D20/D21)

Beide integraties zijn gebouwd maar blijven **fail-closed** totdat TGC-IT de
tenantregistraties oplevert. Het zijn twee aparte apps:

- `Careon Pulse — login`: identity-only Entra → Supabase, met `xms_edov`,
  exacte e-mail/UPN-koppeling en `CAREON_MICROSOFT_LOGIN_ENABLED=1` pas na de
  no-JIT/membership-acceptatietest;
- `Careon Pulse — YAAZ Microsoft 365`: delegated Graph per medewerker,
  server-side versleutelde tokens en read-only eerste pilot. Writes blijven
  uit tot een afzonderlijk consentbesluit.

Go-live vereist: veilig ontvangen tenant/client/secret + vervaldatum/eigenaar,
exacte redirect-URI's, tenant admin consent, een aangewezen SharePoint
drive/folder, Conditional Access-test, twee gebruikers met verschillende
Microsoft-rechten (negatieve ACL-test), disconnect/revocation-test en een
offboardingrunbook dat zowel Careon-sessies als de YAAZ Graph-koppeling
intrekt. Volledige permission matrix en checklist: `agent-handoff/17-microsoft365-yaaz-deliverable.md`.

## ⚠️ Vereisten vóór publieke hosting van echte data

1. **Echte authenticatie — GEREGELD (2026-07-26, handoff 13).** Supabase
   Auth vervangt de demo-login; alle routes eisen een sessie en datatoegang
   loopt onder RLS per organisatie. Resterend vóór publieke hosting:
   wachtwoordbeleid/hygiëne bij accountuitgifte (handmatige provisioning),
   optioneel TOTP voor de superadmin, en de Supabase-DPA (punt hieronder).
1b. **✅ GEREGELD (2026-08-09) — Supabase-DPA (verwerkersovereenkomst).** De
   DPA is geregeld; door de eigenaar bevestigd op 9 aug 2026. Daarmee is de
   laatste blocker voor "deliverable 1 afgerond" gesloten. Nog open uit
   dezelfde ronde (niet-blokkerend): Supabase leaked-password protection
   aanzetten en een besluit over TOTP voor de superadmin.
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

- `npm run verify:production` — 398 assertions: parser-gedrag op de fixture
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
- `npm run verify:careon` — de geauditeerde demo-/actie-assertions (995 per 13-08-2026) blijven
  ongewijzigd van kracht; demo-modus is pixel- en gedrags-identiek gebleven.
- `npm run verify:assistant` — deterministische controles op strict
  schemas, tool-routing, privacyredactie en intent-specifieke productiefacts.
- `npm run verify:assistant:live` — provider-eval op de production build:
  runtime-status, read-only isolatie, bulkdekking, tellingen, compositie en
  dienstverbandactie.
- `npm run verify:data-hygiene` — blokkeert gevolgde productie-exportbestanden.
- `npm run verify:runtime` — foutinjectie voor mislukte/onvolledige/misvormde
  providerstreams, fail-closed moderation, proxy-inferentie en bodylimieten.
- `npm run test:e2e` — functionele, responsive, PWA-, logout-cache- en WCAG-AA-tests.

## Facturatie (handoff 15)

- **Bewaartermijn**: uitgereikte facturen en hun pdf's vallen onder de fiscale
  bewaarplicht van **7 jaar** (10 jaar bij onroerende zaken/OSS). Ze zijn
  daarom uitgesloten van élke opschoonroutine; de DB weigert wijzigen en
  verwijderen via triggers. Alleen **verlaten concepten** worden opgeruimd
  (aparte RPC `careon_prune_facturatie_concepten`, default 180 dagen,
  instelbaar via `CAREON_FACTURATIE_CONCEPT_RETENTION_DAYS`).
- **AVG — nieuwe verwerking (klantbesluit 09-08-2026)**: de contactenlijst
  bewaart namen, adressen én e-mailadressen van factuurontvangers — een
  bewuste uitzondering op de dataminimalisatie elders (verwijzer-e-mails
  worden niet bewaard; particuliere debiteuren zijn gereduceerd tot een
  label). Deze verwerking **staat in de verwerkingsinventaris** (blueprint
  §18, AVG-punt "Facturatie (D19)") — niet opnieuw toevoegen. Het
  ontvanger-e-mailadres dat fase B in `careon_facturatie_maillog` vastlegt
  valt onder diezelfde bestaande facturatie-verwerking (contactgegevens
  inclusief e-mail, klantakkoord V18) — geen nieuwe regel in het
  verwerkingsregister nodig. De AI-assistent heeft geen lees- of schrijftools
  op facturatiedata.
- **Storage**: de private bucket `facturen` valt búíten de Supabase-DB-back-ups
  (die dekken geen Storage-objecten) — zie `DISASTER_RECOVERY.md`.

### Facturatie fase B — e-mailverzending (go-live-checklist)

De verzendfunctie is gebouwd (13-08-2026, handoff 15 §0.5) maar staat
**fail-closed**: zolang de drie `CAREON_MAIL_`-sleutels leeg zijn geeft de
verzendroute 503 en kan er niets verstuurd worden. Vóór activering:

1. **Sub-verwerker Resend (VS) — verwerkersovereenkomst incl. SCC's VEREIST.** Eigenaarskeuze 13-08-2026, in afwijking van het EU-soevereine voorstel (consequenties in blueprint D19: VS-jurisdictie, DPF/SCC-afhankelijkheid — de factuur-pdf impliceert bij particulieren GGZ-zorg). De DPA wordt
   door de **eigenaar** gesloten; zonder getekende DPA blijft de verzending
   uit. Resend is per D19 (amendement) de platformbrede transactionele mailprovider
   (dashboard nu, HumHubs `SMTP_*` in `platform-deploy` later).
2. **Afzenderdomein kiezen en DKIM/SPF bij Resend verifiëren.** Hangt aan de nog
   openstaande platformdomein-beslissing (`docs/platform/PROJECT_STATUS.md`
   §3) — hetzelfde afzenderdomein geldt straks ook voor HumHub.
3. **De drie sleutels in de Vercel-secret-store zetten**:
   `CAREON_MAIL_RESEND_API_KEY`, `CAREON_MAIL_AFZENDER_EMAIL` en
   `CAREON_MAIL_AFZENDER_NAAM` — server-side, **nooit** met een
   `NEXT_PUBLIC_`-voorvoegsel. Optioneel:
   `CAREON_MAIL_RATE_LIMIT_PER_MINUTE` (5) en `_PER_DAY` (100).
4. **Daarna één testverzending naar een eigen adres** vanaf een uitgereikte
   testfactuur, en controleer het maillog (verzendhistorie op de factuur) plus
   het audit-event `facturatie.factuur.send` — dat event bevat bewust géén
   e-mailadres; het adres staat alleen in `careon_facturatie_maillog`, onder
   RLS.
5. Bounce-afhandeling is **niet** gebouwd (de status `gebounced` is
   gereserveerd) en er is bewust **geen automatische herverzending**: een
   hangende poging wordt door de onderhoudscron als mislukt gemarkeerd en de
   beheerder gebruikt "Opnieuw versturen" (dubbel-verzendrisico).

## Careon Scribe (handoff 20)

- **AVG — nieuwe verwerking (voorgesteld besluit D24, 07-09-2026).** De scribe
  legt woordelijke consulttekst vast: transcriptsegmenten en de daaruit
  afgeleide klinische staat, verslagversies en vervolgacties. Die tekst is
  **bijzondere-categoriedata (art. 9 AVG)** en kan direct identificerend zijn —
  een naam, geboortedatum of adres kan hardop worden uitgesproken. Dit is een
  bewuste, gedocumenteerde uitzondering op de pseudonimiseringslijn van het
  dashboard en op de "geen vrije tekst"-regel van
  `docs/CARECHECK_INTEGRATION_BOUNDARY.md`, en geldt uitsluitend voor de
  tijdelijke werkkopie. De sessiemetadata draagt alleen een korte,
  gevalideerde **dossierreferentie** (gebruik geen BSN, geboortedatum of naam) plus de
  bevroren toestemmingstekst, de bijbehorende instellingenrevisie en het
  tijdstip.
  De validator blokkeert BSN-/datumvormen en ongeldige tekens, maar kan een
  persoonsnaam niet betrouwbaar van een alfanumerieke referentie onderscheiden.
- **Audio wordt niet opgeslagen.** De browser stuurt korte, op zichzelf staande
  fragmenten naar een eigen route; de server geeft ze door aan de
  transcriptieprovider en gooit ze weg. Geen Storage-bucket, geen tijdelijk
  bestand, en nooit audio of transcripttekst in een logregel.
- **Bewaartermijn (instelbaar per organisatie, standaard kort).** Transcript en
  klinische staat volgen altijd de kortste termijn: **direct** gewist bij
  "Overgenomen in het EPD" en bij annuleren, anders na
  `transcriptRetentieDagen` (standaard 30). Verslag en sessiemetadata
  verdwijnen bij de dagelijkse opschoning, uiterlijk 24 uur na de termijn
  (standaard 30 dagen na overname; 0 = direct). Audit-events blijven 365 dagen,
  inhoudsloze providertelemetrie 90 dagen.
- **Wie leest wat.** De inhoud is **eigenaar-gebonden**: alleen de behandelaar
  die het consult voerde leest transcript, staat, verslag en taken. Een
  `org_admin` ziet de consultlijst als metadata **zonder** dossierreferentie en
  consulttype, mag een consult verwijderen (geauditeerd, met rol) en mag
  eenmalig en geauditeerd het **goedgekeurde verslag** — nooit het transcript —
  vrijgeven aan één aangewezen collega (offboarding). Superadmins zonder
  lidmaatschap van de organisatie vallen volledig buiten de module.
- **De organisatie beslist zelf over externe verwerking.** Naast de platformvlag
  `CAREON_SCRIBE_LIVE` staan in `/scribe/instellingen` twee schakelaars die
  bepalen of gespreksinhoud het platform verlaat: "Audiofragmenten laten
  transcriberen" (`transcriptieAan`) en "AI-analyse van het transcript
  inschakelen" (`aiAnalyseAan`). Beide staan **standaard uit**. Er gaat pas een
  fragment of transcript naar een verwerker als de platformvlag áán staat, de
  organisatieschakelaar áán staat én de provider volledig geconfigureerd is;
  ontbreekt er één, dan draait de module deterministisch en voert de
  behandelaar gesprekstekst handmatig in. De twee schakelaars onder "Klinische
  ondersteuning" gaan uitsluitend over wat het scherm toont en raken geen
  enkele verwerking.
- **Activatievoorwaarden staan in het product, niet alleen in dit document.**
  `/scribe/instellingen` legt de DPIA-datum met eigenaar (een functie of
  afdeling, nooit een persoonsgegeven van een cliënt), de bevestigde
  verwerkersovereenkomst en de datum waarop de toestemmingstekst is goedgekeurd
  vast. Zolang er één ontbreekt, blijft de moduleschakelaar uit — in de UI én in
  de PUT-route, die de overgang naar `ingeschakeld: true` met 400 weigert en de
  ontbrekende punten noemt.
- **De organisatie ziet haar eigen logboek.** `/scribe/logboek` geeft de
  `org_admin` de scribe-auditregels van de eigen organisatie (wie opende welk
  consult, wat is geëxporteerd, wat verwijderde of gaf een beheerder vrij), met
  filters op handeling en periode en een CSV-download — nodig voor NEN 7513 en
  een inzageverzoek (art. 15 AVG), zonder tussenkomst van de
  Careon-superadmin. De regels zijn **metadata-only**: nooit transcripttekst,
  verslaginhoud of dossierreferentie.
- **Correcties op de klinische staat blijven van de behandelaar.** Een verkeerd
  geëxtraheerd feit wordt ingetrokken (het blijft doorgehaald zichtbaar, het
  verdwijnt niet stil), ontbrekende medicatie of allergieën vult de behandelaar
  zelf aan, en de actuele EPD-lijst kan geplakt worden — die tekst verlaat de
  browser niet, alleen de deterministisch herkende feiten gaan mee. Elke
  correctie gaat via `PATCH /api/careon/scribe/sessies/[id]/staat` met de
  versie die de behandelaar las (409 bij drift) en wordt als
  `doorBehandelaar` gemarkeerd, zodat een latere analysepas haar niet
  terugdraait.
- **Zoeken op dossierreferentie.** De consultlijst heeft een zoekveld op (een
  deel van) de dossierreferentie plus een periodefilter. De zoekterm gaat door
  dezelfde validator als de invoer: een BSN- of datumvormige term wordt
  geweigerd en gaat nooit als filter mee, zodat zo'n reeks niet in een
  querylog of PostgREST-filter belandt.
- **Verwerkers.** OpenAI voor extractie, verslag en (optioneel) transcriptie;
  uitsluitend bij providerkeuze `gemini` daarnaast Google Cloud (Vertex AI,
  EU-regio) als **nieuwe verwerker met een eigen verwerkersovereenkomst**.
  Beide zijn inert zolang `CAREON_SCRIBE_LIVE` niet op `1` staat. Consultaudio
  en -tekst zijn nieuw materiaal ten opzichte van de bestaande
  assistent-verwerking, dus de bewaartermijn voor API-invoer moet per
  verwerker schriftelijk geregeld zijn.
- **Het EPD blijft het juridische dossier.** Careon schrijft niets in CareCheck
  en automatiseert geen portaalformulier: de behandelaar kopieert of downloadt
  het goedgekeurde verslag zelf en bevestigt "Overgenomen in het EPD". Een
  gedownload bestand valt buiten de bewaartermijn van Careon — de UI zegt dat
  ook.

### Careon Scribe — go-live-checklist

De module is gebouwd maar **opt-in en fail-closed**: zonder
`CAREON_SCRIBE_LIVE=1` vindt er geen enkele provideraanroep plaats en draait de
werkstroom deterministisch. Automatische deterministische extractie ondersteunt
Nederlands; bij Engels moeten de verslagsecties expliciet door de behandelaar
worden ingevoerd en beoordeeld. De lokale auditfixes en hun verificatie staan in
`docs/platform/SCRIBE_REMEDIATION_2026-09-10.md`; de nieuwe migratie is nog niet in
productie toegepast. Vóór activering:

1. **Voorgesteld besluit D24 door de eigenaar bevestigen** (blueprint §2 en
   §11), inclusief het amendement op D17 dat transcriptie via Gemini op Vertex
   AI (EU) toestaat naast OpenAI.
2. **Verwerkersovereenkomst per actieve provider sluiten**, expliciet inclusief
   de **bewaartermijn voor API-invoer**: zero data retention en uitsluiting van
   abuse-logging schriftelijk vastgelegd. Zonder die clausule blijft de module
   uit — "wordt nergens bewaard" geldt anders alleen voor Careon, niet voor de
   verwerker.
3. **DPIA vaststellen** voor de consulttranscriptverwerking, met eigenaar en
   datum, en beide vastleggen onder "Activatievoorwaarden" in
   `/scribe/instellingen`. Dit is blokkerend voor productie-activatie.
4. **Toestemmingstekst laten goedkeuren** door de raadsman van de klant en in
   `/scribe/instellingen` vastleggen, met de goedkeuringsdatum bij de
   activatievoorwaarden; de sessie bevriest de letterlijke tekst en de revisie
   per consult. De tekst draagt de plaatshouder
   `{transcriptRetentieDagen}`, die bij het voorlezen wordt ingevuld met de
   werkelijke termijn van de organisatie.
5. **De `org_admin` zet de module aan en machtigt behandelaren** in
   `/scribe/instellingen`, en kiest de retentietermijnen van de organisatie.
   De moduleschakelaar blijft geblokkeerd tot alle vier activatievoorwaarden
   (DPIA-datum, DPIA-eigenaar, bevestigde verwerkersovereenkomst, goedgekeurde
   toestemmingstekst) zijn vastgelegd; de UI noemt wat er ontbreekt en de
   PUT-route weigert de overgang. Zonder machtiging krijgt een lid geen
   toegang — ook niet via PostgREST. Organisatiebeheerders hebben volgens het
   bestaande rolbeleid zelf gebruiksrecht; deze uitzondering moet bij de
   organisatieacceptatie bewust worden beoordeeld. Wil de organisatie dat gespreksinhoud
   daadwerkelijk verwerkt wordt, dan zet zij daarnaast bewust
   "Audiofragmenten laten transcriberen" en/of "AI-analyse van het transcript
   inschakelen" aan onder "Externe verwerking" — anders blijft de module
   deterministisch, ook met `CAREON_SCRIBE_LIVE=1`.
6. **`CAREON_SCRIBE_LIVE=1` plus de providervariabelen in de Vercel-secret-store
   zetten** (`CAREON_SCRIBE_TRANSCRIPTION_PROVIDER`,
   `CAREON_SCRIBE_TRANSCRIPTION_MODEL` en, voor `gemini`, de vier
   `CAREON_SCRIBE_VERTEX_*`/`CAREON_SCRIBE_GEMINI_MODEL`-waarden) — server-side,
   **nooit** met een `NEXT_PUBLIC_`-voorvoegsel. Optioneel de quota
   `CAREON_SCRIBE_RATE_LIMIT_PER_MINUTE` / `_PER_DAY` /
   `CAREON_SCRIBE_RATE_LIMIT_ORG_PER_DAY`.
7. **`npm run verify:scribe:live` draaien** tegen de omgeving met sleutels
   (handmatige poort, nooit in CI) en daarna één echt proefconsult afronden:
   toestemming, transcriptie, door de behandelaar geschreven
   beoordelingssecties, goedkeuring per sectie, overname in het EPD en de
   controle dat het transcript daarna verdwenen is.
8. **De shell-tegel blijft achtergehouden**: het moduleregister houdt
   `shellReady: false`, dus de mobiele tegel is uitgeschakeld zonder
   launch-URL tot het D12-fase-2-microfoonprofiel in de shell staat. Activeer
   die tegel niet handmatig.
