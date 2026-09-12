-- Careon Pulse — Careon Scribe (handoff 20). Vereist 0009 (app-helpers), 0008
-- (quota-tabel) en 20260905135733 (app.is_active_user + de restrictieve
-- careon_active_account-policy). Uitvoeren via de Management API, VÓÓR de
-- code-deploy. Idempotent: alles is if-not-exists / or-replace / drop-if-exists.
--
-- Waarom deze migratie zo streng is
-- ---------------------------------
-- De scribe slaat woordelijke consulttekst op. Dat is bijzondere-categoriedata
-- die direct identificerend kan zijn (uitgesproken naam, geboortedatum, adres)
-- — de zwaarste gegevenssoort in het hele platform. De anon-key en de project-
-- URL zitten per ontwerp in de clientbundle, dus route- en UI-gates zijn geen
-- grens: een gewoon lid kan met zijn eigen JWT PostgREST rechtstreeks bevragen.
-- RLS is daarom de enige echte afscherming (handoff 20 §2.4), en de kring is
-- zo klein mogelijk gehouden:
--
--   * inhoud (transcript, staat, verslag, taken) is EIGENAAR-GEBONDEN: alleen
--     de behandelaar die het consult voerde leest en schrijft ze;
--   * een org_admin ziet uitsluitend sessiemetadata — en die metadata komt NIET
--     uit zijn eigen JWT maar uit een service-role-lezing met een vaste
--     kolomlijst zonder patient_referentie en consult_type (afwijking 3). Hij
--     mag verwijderen en mag het GOEDGEKEURDE verslag geauditeerd vrijgeven aan
--     een collega (offboarding) — nooit het transcript, nooit aan zichzelf;
--   * toegang tot de module loopt per gemachtigde behandelaar
--     (careon_scribe_gemachtigden), niet per rol alleen.
--
-- WAARSCHUWING 1 — de OR-valkuil (zelfde als 0015:124-126, 0020, 0021):
-- permissieve policies worden ge-OR'd. Voeg dus NOOIT een kale, rolblinde
-- policy toe naast de policies hieronder; één zo'n policy neutraliseert de
-- volledige eigenaarsafscherming. De enige, bewuste uitzondering is de
-- select-policy op careon_scribe_instellingen: die rij bevat geen
-- persoonsgegevens (consenttekst, standaardformaat, aan/uit) en elk
-- organisatielid moet hem kunnen lezen — er staat daarom géén striktere
-- select-policy naast waar hij overheen zou kunnen lopen.
--
-- WAARSCHUWING 2 — geen kale superadmin-tak: anders dan
-- app.mag_financieel_zien/app.mag_facturatie_zien kent app.mag_scribe_beheren
-- GEEN losse `app.is_superadmin() or …`-tak. Een platformbeheerder zonder
-- lidmaatschap van de organisatie valt volledig buiten de module (S12); binnen
-- een organisatie waar hij wél lid van is telt zijn superadminstatus mee als
-- rol. De lidmaatschapstoets is dus altijd een CONJUNCT, nooit een disjunct.
--
-- WAARSCHUWING 3 — status en bewaartermijn zijn DB-afgedwongen. De client mag
-- status/*_verwijder_na niet zetten: de bevriestriggers laten die kolommen
-- alleen door wanneer de GUC careon.scribe_rpc op '1' staat (uitsluitend gezet
-- door de RPC's hieronder) of de aanroeper de service-role is. Retentie wordt
-- door de database zelf berekend uit de laatste instellingen-revisie van de
-- organisatie (§4.7), nooit uit een door de client meegegeven datum.
--
-- Afwijking t.o.v. handoff 20 §3 (bewust, gedocumenteerd): careon_scribe_-
-- status_zetten en careon_scribe_notitie_goedkeuren zijn `security invoker` in
-- plaats van `security definer`. Reden: de bestaande gate in
-- src/scripts/verify-auth-postgres.py eist dat GEEN ENKELE security-definer-
-- functie in `public` uitvoerrecht voor `authenticated` heeft (een definer-RPC
-- omzeilt immers alle policy-checks). Deze twee RPC's hebben die omzeiling ook
-- niet nodig: de eigenaar heeft via RLS al toegang tot zijn eigen rijen, en het
-- enige wat de RPC's bijzonder maakt — het verzetten van bevroren kolommen —
-- loopt via de GUC, niet via RLS. De expliciete eigenaarscontrole met
-- auth.uid() staat gewoon in de functie. careon_prune_scribe blijft
-- `security definer` en is uitsluitend voor de service-role.
--
-- Afwijking 2 t.o.v. §3: (sessie_id, fragment_id) op careon_scribe_segmenten is
-- een gewone index, geen UNIQUE. Eén audiofragment levert per definitie
-- meerdere segmenten op (de RPC krijgt een array), wat een unieke index
-- onmogelijk maakt. De idempotentie die de spec bedoelt zit in
-- careon_scribe_voeg_segmenten_toe: die vergrendelt eerst de sessierij
-- (`for update`) en geeft bij een al verwerkt fragment de bestaande segmenten
-- terug, zodat twee gelijktijdige aanroepen serialiseren.
--
-- Afwijking 3 t.o.v. §2.4/§5.3 (C3/C10, 07-09-2026): careon_scribe_sessies_select
-- draagt GEEN `app.mag_scribe_beheren`-tak meer. RLS werkt op rijen, niet op
-- kolommen, dus met die tak kon een org_admin met zijn eigen JWT
-- `select patient_referentie, consult_type` doen op elk consult van elke
-- collega — juist de twee velden die S12/V3 belooft weg te laten. Die belofte
-- rustte daarmee op één TypeScript-destructuring in de serializer. De
-- beheerderslijst en het beheerdersdetail lopen nu via de service-role met een
-- expliciete metadata-kolomlijst ná de beheerdersgate in de route (hetzelfde
-- patroon als de vrijgave-insert, §2.3). Bewust GEEN security-definer-functie
-- met uitvoerrecht voor `authenticated`: verify-auth-postgres.py verbiedt die
-- vorm. careon_scribe_sessies_delete blijft ongewijzigd — verwijderen vraagt
-- geen leesrecht.
--
-- Afwijking 4 t.o.v. §3 (C1/C2/C9/C12/N21, 07-09-2026): vier aanscherpingen die
-- de spec zelf niet noemt — de vrijgave-tak op careon_scribe_notities draagt
-- het rolpredicaat (intrekken sluit meteen), de insert-policy op diezelfde
-- tabel pint `status = 'concept'`, careon_scribe_vrijgaven weigert een
-- zelfvrijgave met een CHECK, careon_scribe_notitie_goedkeuren schuift het
-- consult in dezelfde transactie mee naar 'goedgekeurd', en
-- app.scribe_ingeschakeld eist naast de vlag ook de vastgelegde
-- activatievoorwaarden (DPIA-datum + verwerkersovereenkomst).
--
-- Geen Storage-bucket: Careon bewaart geen audio (S5).

-- ── 1. Tabellen ─────────────────────────────────────────────────────────────
-- Eerst de tabellen (de rolpredicaten lezen careon_scribe_gemachtigden en
-- careon_scribe_sessies), daarna de functies, daarna pas de policies.

create table if not exists public.careon_scribe_sessies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  behandelaar_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'actief'
    check (status in ('actief', 'afgerond', 'goedgekeurd', 'overgenomen', 'geannuleerd')),
  -- Nooit naam, geboortedatum of BSN (S3): alleen een korte dossierreferentie.
  -- De volledige toets (BSN-vermoeden, datumpatroon) zit in isPatientReferentie;
  -- deze CHECK sluit rechtstreekse PostgREST-writes met rare tekens uit.
  patient_referentie text not null
    check (char_length(patient_referentie) between 3 and 40
      and patient_referentie ~ '^[A-Za-z0-9 ._/-]+$'),
  consult_type text not null default 'soap'
    check (consult_type in ('soap', 'aobp', 'soep', 'psychiatrie', 'verpleegkundig', 'seh', 'vervolg', 'ontslag')),
  taal text not null default 'nl' check (taal in ('nl', 'en')),
  -- Toestemming is bevroren bewijs (AVG art. 7 lid 1): de letterlijke tekst en
  -- de instellingenrevisie die de cliënt te horen kreeg, plus het tijdstip.
  consent_bevestigd_op timestamptz not null,
  consent_revisie bigint not null check (consent_revisie > 0),
  consent_tekst text not null check (char_length(btrim(consent_tekst)) between 1 and 1000),
  gestart_op timestamptz not null default now(),
  beeindigd_op timestamptz,
  goedgekeurd_op timestamptz,
  overgenomen_op timestamptz,
  duur_ms integer not null default 0 check (duur_ms >= 0),
  segment_teller integer not null default 0 check (segment_teller between 0 and 900),
  ontbrekende_fragmenten integer not null default 0 check (ontbrekende_fragmenten >= 0),
  transcriptie_provider text
    check (transcriptie_provider is null
      or transcriptie_provider in ('openai', 'gemini', 'handmatig', 'demo')),
  transcriptie_model text check (transcriptie_model is null or char_length(transcriptie_model) <= 120),
  notitie_model text check (notitie_model is null or char_length(notitie_model) <= 120),
  prompt_versie text check (prompt_versie is null or char_length(prompt_versie) <= 120),
  transcript_verwijder_na timestamptz,
  sessie_verwijder_na timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists careon_scribe_sessies_org_behandelaar_idx
  on public.careon_scribe_sessies (org_id, behandelaar_id, created_at desc);
create index if not exists careon_scribe_sessies_org_status_idx
  on public.careon_scribe_sessies (org_id, status);
create index if not exists careon_scribe_sessies_transcript_verval_idx
  on public.careon_scribe_sessies (transcript_verwijder_na)
  where transcript_verwijder_na is not null;
create index if not exists careon_scribe_sessies_sessie_verval_idx
  on public.careon_scribe_sessies (sessie_verwijder_na)
  where sessie_verwijder_na is not null;
create index if not exists careon_scribe_sessies_behandelaar_idx
  on public.careon_scribe_sessies (behandelaar_id);

create table if not exists public.careon_scribe_segmenten (
  id uuid primary key default gen_random_uuid(),
  sessie_id uuid not null references public.careon_scribe_sessies (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  behandelaar_id uuid not null references auth.users (id) on delete cascade,
  volgnummer integer not null check (volgnummer >= 1),
  -- Idempotente fragmentverwerking: hetzelfde audiofragment mag na een
  -- netwerkherhaling geen tweede keer segmenten opleveren. Eén fragment levert
  -- meerdere segmenten op, dus (sessie_id, fragment_id) kan geen UNIQUE zijn;
  -- de idempotentie wordt afgedwongen in careon_scribe_voeg_segmenten_toe,
  -- onder de vergrendelde sessierij (afwijking §3, zie de kopnotitie).
  fragment_id uuid,
  spreker text not null default 'onbekend'
    check (spreker in ('arts', 'patient', 'overig', 'onbekend')),
  -- `tekst` is het letterlijk herkende transcript en ligt vast (S9);
  -- `tekst_gecorrigeerd` draagt de correctie met herkomst ernaast.
  tekst text not null check (char_length(tekst) between 1 and 4000),
  tekst_gecorrigeerd text check (tekst_gecorrigeerd is null or char_length(tekst_gecorrigeerd) <= 4000),
  correctie_bron text check (correctie_bron is null or correctie_bron in ('ai', 'behandelaar')),
  begin_ms integer check (begin_ms is null or begin_ms >= 0),
  eind_ms integer check (eind_ms is null or eind_ms >= 0),
  bron text not null default 'live' check (bron in ('live', 'handmatig', 'demo', 'systeem')),
  created_at timestamptz not null default now(),
  constraint careon_scribe_segmenten_volgnummer_uniek unique (sessie_id, volgnummer)
);

create index if not exists careon_scribe_segmenten_fragment_idx
  on public.careon_scribe_segmenten (sessie_id, fragment_id)
  where fragment_id is not null;
create index if not exists careon_scribe_segmenten_eigenaar_idx
  on public.careon_scribe_segmenten (org_id, behandelaar_id);
create index if not exists careon_scribe_segmenten_behandelaar_idx
  on public.careon_scribe_segmenten (behandelaar_id);

create table if not exists public.careon_scribe_staat (
  sessie_id uuid primary key references public.careon_scribe_sessies (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  behandelaar_id uuid not null references auth.users (id) on delete cascade,
  staat jsonb not null,
  versie integer not null default 1 check (versie >= 1),
  laatste_segment integer not null default 0 check (laatste_segment >= 0),
  verouderd boolean not null default false,
  model text check (model is null or char_length(model) <= 120),
  bron text not null default 'deterministisch' check (bron in ('ai', 'deterministisch', 'demo')),
  updated_at timestamptz not null default now()
);

create index if not exists careon_scribe_staat_eigenaar_idx
  on public.careon_scribe_staat (org_id, behandelaar_id);
create index if not exists careon_scribe_staat_behandelaar_idx
  on public.careon_scribe_staat (behandelaar_id);

create table if not exists public.careon_scribe_notities (
  id uuid primary key default gen_random_uuid(),
  sessie_id uuid not null references public.careon_scribe_sessies (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  behandelaar_id uuid not null references auth.users (id) on delete cascade,
  versie integer not null default 1 check (versie >= 1),
  formaat text not null default 'soap'
    check (formaat in ('soap', 'aobp', 'soep', 'psychiatrie', 'verpleegkundig', 'seh', 'vervolg', 'ontslag')),
  secties jsonb not null default '[]'::jsonb,
  status text not null default 'concept' check (status in ('concept', 'goedgekeurd')),
  model text check (model is null or char_length(model) <= 120),
  bron text not null default 'deterministisch' check (bron in ('ai', 'deterministisch', 'demo')),
  goedgekeurd_op timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint careon_scribe_notities_versie_uniek unique (sessie_id, versie),
  constraint careon_scribe_notities_goedgekeurd_compleet
    check (status = 'concept' or goedgekeurd_op is not null)
);

create index if not exists careon_scribe_notities_eigenaar_idx
  on public.careon_scribe_notities (org_id, behandelaar_id);
create index if not exists careon_scribe_notities_behandelaar_idx
  on public.careon_scribe_notities (behandelaar_id);

create table if not exists public.careon_scribe_taken (
  id uuid primary key default gen_random_uuid(),
  sessie_id uuid not null references public.careon_scribe_sessies (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  behandelaar_id uuid not null references auth.users (id) on delete cascade,
  omschrijving text not null check (char_length(btrim(omschrijving)) between 1 and 300),
  soort text not null default 'overig'
    check (soort in ('lab', 'beeldvorming', 'medicatie', 'verwijzing', 'vervolgafspraak', 'communicatie', 'overig')),
  status text not null default 'voorgesteld'
    check (status in ('voorgesteld', 'goedgekeurd', 'afgewezen', 'afgerond')),
  bron_segmenten integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists careon_scribe_taken_sessie_idx
  on public.careon_scribe_taken (sessie_id, created_at);
create index if not exists careon_scribe_taken_eigenaar_idx
  on public.careon_scribe_taken (org_id, behandelaar_id);
create index if not exists careon_scribe_taken_behandelaar_idx
  on public.careon_scribe_taken (behandelaar_id);

-- Append-only snapshot per organisatie (patroon hr/facturatie): ScribeInstellingen.
create table if not exists public.careon_scribe_instellingen (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  saved_at timestamptz not null default now(),
  state jsonb not null,
  revision bigint not null,
  base_revision bigint,
  operation_id uuid,
  change_source text,
  change_summary jsonb not null default '{}'::jsonb,
  actor_hash text,
  constraint careon_scribe_instellingen_revision_positive check (revision > 0),
  constraint careon_scribe_instellingen_base_revision_nonnegative
    check (base_revision is null or base_revision >= 0),
  constraint careon_scribe_instellingen_change_source_valid
    check (change_source is null or change_source in ('manual')),
  -- Minimale vormcheck: app.scribe_ingeschakeld() leest deze sleutel, en een
  -- rij zonder bruikbare `ingeschakeld` zou de module stil open of dicht zetten.
  constraint careon_scribe_instellingen_state_vorm
    check (jsonb_typeof(state) = 'object' and jsonb_typeof(state -> 'ingeschakeld') = 'boolean')
);

create index if not exists careon_scribe_instellingen_org_saved_idx
  on public.careon_scribe_instellingen (org_id, saved_at desc);
create unique index if not exists careon_scribe_instellingen_org_revision_uidx
  on public.careon_scribe_instellingen (org_id, revision);
create unique index if not exists careon_scribe_instellingen_operation_uidx
  on public.careon_scribe_instellingen (operation_id) where operation_id is not null;

create table if not exists public.careon_scribe_gemachtigden (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  toegekend_door uuid,
  toegekend_op timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists careon_scribe_gemachtigden_user_idx
  on public.careon_scribe_gemachtigden (user_id);

create table if not exists public.careon_scribe_vrijgaven (
  id uuid primary key default gen_random_uuid(),
  sessie_id uuid not null references public.careon_scribe_sessies (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  aan_user_id uuid not null references auth.users (id) on delete cascade,
  door_user_id uuid,
  reden text check (reden is null or char_length(reden) <= 300),
  created_at timestamptz not null default now(),
  constraint careon_scribe_vrijgaven_uniek unique (sessie_id, aan_user_id)
);

-- C9 — een beheerder geeft een verslag NOOIT aan zichzelf vrij. De insert loopt
-- via de service-role (die RLS overslaat maar geen CHECK), dus deze constraint
-- is de enige echte grens onder de routecontrole. Los toegevoegd zodat een
-- bestaande tabel hem alsnog krijgt (`create table if not exists` doet dat niet).
alter table public.careon_scribe_vrijgaven
  drop constraint if exists careon_scribe_vrijgaven_niet_zelf;
alter table public.careon_scribe_vrijgaven
  add constraint careon_scribe_vrijgaven_niet_zelf
  check (door_user_id is null or aan_user_id <> door_user_id);

create index if not exists careon_scribe_vrijgaven_ontvanger_idx
  on public.careon_scribe_vrijgaven (aan_user_id);
create index if not exists careon_scribe_vrijgaven_org_idx
  on public.careon_scribe_vrijgaven (org_id, created_at desc);

-- ── 2. Rolpredicaten (SQL-spiegel van src/lib/careon-scribe-rol.ts) ─────────
-- Huisstijl 0015/0020: security definer, stable, set search_path = '',
-- (select auth.uid()), app.is_active_user() als eerste conjunct. Bewust ZONDER
-- kale app.is_superadmin()-tak (zie WAARSCHUWING 2 in de kop).

create or replace function app.mag_scribe_beheren(check_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_user() and exists (
    select 1
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.org_id = check_org
      and m.user_id = (select auth.uid())
      -- Vast demoaccount, zie CAREON_HOSTED_DEMO_EMAIL in
      -- src/lib/careon-demo-account.ts.
      and (m.role = 'org_admin' or app.is_superadmin() or lower(btrim(u.email)) = 'user1@careon-demo.nl')
  );
$$;

revoke all on function app.mag_scribe_beheren(uuid) from public, anon;
grant execute on function app.mag_scribe_beheren(uuid) to authenticated, service_role;

create or replace function app.mag_scribe_gebruiken(check_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.mag_scribe_beheren(check_org) or (
    app.is_active_user() and exists (
      select 1
      from public.organization_members m
      join public.careon_scribe_gemachtigden g on g.org_id = m.org_id and g.user_id = m.user_id
      where m.org_id = check_org
        and m.user_id = (select auth.uid())
    )
  );
$$;

revoke all on function app.mag_scribe_gebruiken(uuid) from public, anon;
grant execute on function app.mag_scribe_gebruiken(uuid) to authenticated, service_role;

-- De module staat per organisatie standaard UIT; een org_admin zet hem aan na
-- het vaststellen van de toestemmingstekst en het machtigen van behandelaren.
--
-- N21 — activatievoorwaarden staan in de DATABASE, niet alleen in de route:
-- `ingeschakeld: true` telt pas als de organisatie ook heeft vastgelegd wanneer
-- de DPIA is vastgesteld en dat de verwerkersovereenkomst met de
-- transcriptiedienst is bevestigd. Een snapshot zonder dat bewijs houdt de
-- sessie-insert-policy dicht, ook wanneer iemand de vlag rechtstreeks via
-- PostgREST zou zetten. De TS-tegenhanger is activatieVoorwaardenOntbrekend()
-- (types.ts), die PUT /instellingen met 400 laat weigeren.
create or replace function app.scribe_ingeschakeld(check_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select coalesce((i.state ->> 'ingeschakeld')::boolean, false)
      and (i.state ->> 'dpiaVastgesteldOp') is not null
      and coalesce((i.state ->> 'verwerkersovereenkomstBevestigd')::boolean, false)
    from public.careon_scribe_instellingen i
    where i.org_id = check_org
    order by i.revision desc
    limit 1
  ), false);
$$;

revoke all on function app.scribe_ingeschakeld(uuid) from public, anon;
grant execute on function app.scribe_ingeschakeld(uuid) to authenticated, service_role;

-- Inhoudspolicies eisen het EIGEN ouderconsult: een kindrij met een
-- vreemde sessie_id (of een sessie van een collega) is nooit schrijfbaar.
create or replace function app.scribe_eigen_sessie(p_sessie uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.careon_scribe_sessies s
    where s.id = p_sessie
      and s.org_id = p_org
      and s.behandelaar_id = (select auth.uid())
  );
$$;

revoke all on function app.scribe_eigen_sessie(uuid, uuid) from public, anon;
grant execute on function app.scribe_eigen_sessie(uuid, uuid) to authenticated, service_role;

-- Vrijgave bij offboarding: één aangewezen collega leest het GOEDGEKEURDE
-- verslag (nooit het transcript), geauditeerd en per sessie.
create or replace function app.scribe_vrijgegeven(p_sessie uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.careon_scribe_vrijgaven v
    where v.sessie_id = p_sessie
      and v.aan_user_id = (select auth.uid())
  );
$$;

revoke all on function app.scribe_vrijgegeven(uuid) from public, anon;
grant execute on function app.scribe_vrijgegeven(uuid) to authenticated, service_role;

-- ── 3. Vormvalidatie van de jsonb-kolommen ─────────────────────────────────
-- Bewust lichter dan de TS-guards (isKlinischeStaat / isVerslagSectie): de
-- route valideert volledig, dit blokkeert rechtstreekse PostgREST-writes met
-- wezensvreemde jsonb. De harde eis: geen sleutel `diagnose` — de module
-- ondersteunt de klinische redenering, ze stelt geen diagnose (S10).

create or replace function app.careon_scribe_staat_geldig(staat jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(staat) = 'object'
    and not (staat ? 'diagnose')
    and staat ?& array[
      'samenvatting', 'hoofdklacht', 'duur', 'beloop', 'ernst',
      'symptomen', 'begeleidendeSymptomen', 'uitlokkendeFactoren', 'verlichtendeFactoren',
      'medicatie', 'allergieen', 'voorgeschiedenis', 'familieanamnese',
      'leefstijl', 'psychisch', 'metingen', 'onderzoek',
      'overwegingen', 'plan', 'acties', 'ontbrekend', 'waarschuwingen'
    ]
    and jsonb_typeof(staat -> 'samenvatting') = 'string'
    and not exists (
      select 1
      from unnest(array[
        'symptomen', 'begeleidendeSymptomen', 'uitlokkendeFactoren', 'verlichtendeFactoren',
        'medicatie', 'allergieen', 'voorgeschiedenis', 'familieanamnese',
        'leefstijl', 'psychisch', 'metingen', 'onderzoek',
        'overwegingen', 'plan', 'acties', 'ontbrekend', 'waarschuwingen'
      ]) as k(sleutel)
      where jsonb_typeof(staat -> k.sleutel) <> 'array'
        or jsonb_array_length(staat -> k.sleutel) > 200
    );
$$;

revoke all on function app.careon_scribe_staat_geldig(jsonb) from public, anon;
grant execute on function app.careon_scribe_staat_geldig(jsonb) to authenticated, service_role;

alter table public.careon_scribe_staat
  drop constraint if exists careon_scribe_staat_vorm;
alter table public.careon_scribe_staat
  add constraint careon_scribe_staat_vorm check (app.careon_scribe_staat_geldig(staat));

create or replace function app.careon_scribe_secties_geldig(secties jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(secties) = 'array'
    and jsonb_array_length(secties) <= 12
    and not exists (
      select 1
      from jsonb_array_elements(secties) as s(sectie)
      where jsonb_typeof(s.sectie) <> 'object'
        or jsonb_typeof(s.sectie -> 'id') <> 'string'
        or jsonb_typeof(s.sectie -> 'titel') <> 'string'
        or jsonb_typeof(s.sectie -> 'vereistBehandelaar') <> 'boolean'
        or jsonb_typeof(s.sectie -> 'bron') <> 'array'
        or coalesce(s.sectie ->> 'status', '') not in ('leeg', 'concept', 'bewerkt', 'goedgekeurd')
        or jsonb_typeof(s.sectie -> 'tekst') not in ('string', 'null')
        or jsonb_typeof(s.sectie -> 'conceptTekst') not in ('string', 'null')
        or char_length(coalesce(s.sectie ->> 'tekst', '')) > 20000
        or char_length(coalesce(s.sectie ->> 'conceptTekst', '')) > 20000
    );
$$;

revoke all on function app.careon_scribe_secties_geldig(jsonb) from public, anon;
grant execute on function app.careon_scribe_secties_geldig(jsonb) to authenticated, service_role;

alter table public.careon_scribe_notities
  drop constraint if exists careon_scribe_notities_secties_vorm;
alter table public.careon_scribe_notities
  add constraint careon_scribe_notities_secties_vorm check (app.careon_scribe_secties_geldig(secties));

-- ── 4. Retentiehelpers (DB-tegenhanger van retentie.ts, §4.7) ──────────────
-- De termijn komt altijd uit de LAATSTE instellingen-revisie van de
-- organisatie, nooit uit de aanvraag. Een onleesbare of ontbrekende waarde
-- valt terug op de veilige standaard van 30 dagen.

create or replace function app.careon_scribe_retentie_dagen(check_org uuid, p_sleutel text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(365, greatest(0, coalesce((
    select case when (i.state ->> p_sleutel) ~ '^[0-9]{1,3}$' then (i.state ->> p_sleutel)::integer end
    from public.careon_scribe_instellingen i
    where i.org_id = check_org
    order by i.revision desc
    limit 1
  ), p_default)));
$$;

revoke all on function app.careon_scribe_retentie_dagen(uuid, text, integer) from public, anon;
grant execute on function app.careon_scribe_retentie_dagen(uuid, text, integer) to authenticated, service_role;

create or replace function app.careon_scribe_instelling_aan(check_org uuid, p_sleutel text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when jsonb_typeof(i.state -> p_sleutel) = 'boolean'
      then (i.state ->> p_sleutel)::boolean end
    from public.careon_scribe_instellingen i
    where i.org_id = check_org
    order by i.revision desc
    limit 1
  ), p_default);
$$;

revoke all on function app.careon_scribe_instelling_aan(uuid, text, boolean) from public, anon;
grant execute on function app.careon_scribe_instelling_aan(uuid, text, boolean) to authenticated, service_role;

-- ── 5. Bevriestriggers ─────────────────────────────────────────────────────
-- GUC-patroon: careon.scribe_rpc = '1' wordt uitsluitend door de RPC's
-- hieronder gezet (transactielokaal); daarnaast mag de service-role door
-- (huisstijl 20260821155300: de claims-container, niet de legacy-GUC).

-- Bij het aanmaken berekent de database de bewaartermijn zelf; een door de
-- client meegegeven datum wordt overschreven.
create or replace function app.careon_scribe_sessie_retentie()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.transcript_verwijder_na := now() + make_interval(
    days => greatest(1, app.careon_scribe_retentie_dagen(new.org_id, 'transcriptRetentieDagen', 30)));
  new.sessie_verwijder_na := new.transcript_verwijder_na;
  return new;
end;
$$;

revoke all on function app.careon_scribe_sessie_retentie() from public, anon, authenticated, service_role;

drop trigger if exists careon_scribe_sessie_retentie on public.careon_scribe_sessies;
create trigger careon_scribe_sessie_retentie
  before insert on public.careon_scribe_sessies
  for each row execute function app.careon_scribe_sessie_retentie();

create or replace function app.careon_scribe_sessie_bevries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rpc boolean := coalesce(current_setting('careon.scribe_rpc', true), '') = '1'
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if (new.id, new.org_id, new.behandelaar_id, new.consent_bevestigd_op, new.consent_revisie,
      new.consent_tekst, new.gestart_op, new.created_at)
     is distinct from
     (old.id, old.org_id, old.behandelaar_id, old.consent_bevestigd_op, old.consent_revisie,
      old.consent_tekst, old.gestart_op, old.created_at) then
    raise exception 'scribe: consultkenmerken en de vastgelegde toestemming zijn onwijzigbaar';
  end if;
  if not v_rpc
     and (new.status, new.beeindigd_op, new.goedgekeurd_op, new.overgenomen_op,
          new.transcript_verwijder_na, new.sessie_verwijder_na)
         is distinct from
         (old.status, old.beeindigd_op, old.goedgekeurd_op, old.overgenomen_op,
          old.transcript_verwijder_na, old.sessie_verwijder_na) then
    raise exception 'scribe: status en bewaartermijn lopen uitsluitend via careon_scribe_status_zetten';
  end if;
  return new;
end;
$$;

revoke all on function app.careon_scribe_sessie_bevries() from public, anon, authenticated, service_role;

drop trigger if exists careon_scribe_sessie_bevries on public.careon_scribe_sessies;
create trigger careon_scribe_sessie_bevries
  before update on public.careon_scribe_sessies
  for each row execute function app.careon_scribe_sessie_bevries();

create or replace function app.careon_scribe_segment_bevries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rpc boolean := coalesce(current_setting('careon.scribe_rpc', true), '') = '1'
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  -- Alleen spreker, tekst_gecorrigeerd en correctie_bron zijn wijzigbaar: het
  -- letterlijk herkende transcript blijft naast de interpretatie bestaan (S9).
  if not v_rpc
     and (new.id, new.sessie_id, new.org_id, new.behandelaar_id, new.volgnummer, new.fragment_id,
          new.tekst, new.begin_ms, new.eind_ms, new.bron, new.created_at)
         is distinct from
         (old.id, old.sessie_id, old.org_id, old.behandelaar_id, old.volgnummer, old.fragment_id,
          old.tekst, old.begin_ms, old.eind_ms, old.bron, old.created_at) then
    raise exception 'scribe: alleen spreker en correctie van een segment zijn wijzigbaar';
  end if;
  -- Een correctie van de behandelaar wordt nooit door de AI overschreven.
  if old.correctie_bron = 'behandelaar' and new.correctie_bron = 'ai' then
    raise exception 'scribe: een correctie van de behandelaar wordt niet door de AI overschreven';
  end if;
  return new;
end;
$$;

revoke all on function app.careon_scribe_segment_bevries() from public, anon, authenticated, service_role;

drop trigger if exists careon_scribe_segment_bevries on public.careon_scribe_segmenten;
create trigger careon_scribe_segment_bevries
  before update on public.careon_scribe_segmenten
  for each row execute function app.careon_scribe_segment_bevries();

create or replace function app.careon_scribe_notitie_bevries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rpc boolean := coalesce(current_setting('careon.scribe_rpc', true), '') = '1'
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  -- Een goedgekeurd verslag is het door de behandelaar vastgestelde document:
  -- daarna wijzigt niets meer, ook niet met de GUC. Wie wil corrigeren maakt
  -- een nieuwe versie.
  if old.status = 'goedgekeurd' then
    raise exception 'scribe: een goedgekeurd verslag is onwijzigbaar; maak een nieuwe versie';
  end if;
  if (new.sessie_id, new.org_id, new.behandelaar_id, new.versie, new.created_at)
     is distinct from
     (old.sessie_id, old.org_id, old.behandelaar_id, old.versie, old.created_at) then
    raise exception 'scribe: herkomst en versie van een verslag zijn onwijzigbaar';
  end if;
  if not v_rpc
     and (new.status, new.goedgekeurd_op) is distinct from (old.status, old.goedgekeurd_op) then
    raise exception 'scribe: goedkeuring loopt uitsluitend via careon_scribe_notitie_goedkeuren';
  end if;
  return new;
end;
$$;

revoke all on function app.careon_scribe_notitie_bevries() from public, anon, authenticated, service_role;

drop trigger if exists careon_scribe_notitie_bevries on public.careon_scribe_notities;
create trigger careon_scribe_notitie_bevries
  before update on public.careon_scribe_notities
  for each row execute function app.careon_scribe_notitie_bevries();

create or replace function app.careon_scribe_notitie_geen_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rpc boolean := coalesce(current_setting('careon.scribe_rpc', true), '') = '1'
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  -- Cascade vanuit de sessie mag: dan bestaat de ouderrij al niet meer. De
  -- retentie-RPC's wissen via de GUC. Wat niet mag: een goedgekeurd verslag
  -- losweken van een consult dat blijft staan.
  if not v_rpc
     and old.status = 'goedgekeurd'
     and exists (select 1 from public.careon_scribe_sessies s where s.id = old.sessie_id) then
    raise exception 'scribe: een goedgekeurd verslag kan niet los van het consult worden verwijderd';
  end if;
  return old;
end;
$$;

revoke all on function app.careon_scribe_notitie_geen_delete() from public, anon, authenticated, service_role;

drop trigger if exists careon_scribe_notitie_geen_delete on public.careon_scribe_notities;
create trigger careon_scribe_notitie_geen_delete
  before delete on public.careon_scribe_notities
  for each row execute function app.careon_scribe_notitie_geen_delete();

-- ── 6. RPC: segmenten toevoegen (atomair, idempotent) ──────────────────────
-- `security invoker`, dus RLS geldt onverkort. De sessierij wordt vergrendeld
-- zodat volgnummers en de teller nooit uiteenlopen; applicatiecode leest en
-- schrijft segment_teller NOOIT zelf.

create or replace function public.careon_scribe_voeg_segmenten_toe(
  p_sessie uuid,
  p_fragment_id uuid,
  p_segmenten jsonb,
  p_duur_ms integer default 0,
  p_ontbrekend boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sessie public.careon_scribe_sessies;
  v_aantal integer;
  v_bestaand jsonb;
  v_rijen jsonb;
begin
  if jsonb_typeof(p_segmenten) <> 'array' then
    raise exception 'scribe: segmenten moeten een array zijn' using errcode = '22023';
  end if;
  v_aantal := jsonb_array_length(p_segmenten);
  if v_aantal = 0 then
    raise exception 'scribe: geen segmenten aangeleverd' using errcode = '22023';
  end if;

  select * into v_sessie from public.careon_scribe_sessies s where s.id = p_sessie for update;
  if not found then
    raise exception 'scribe: consult niet gevonden' using errcode = '42501';
  end if;

  -- Idempotentie op (sessie_id, fragment_id): een herhaald fragment levert de
  -- bestaande segmenten terug in plaats van dubbele regels.
  if p_fragment_id is not null then
    select coalesce(jsonb_agg(to_jsonb(g) order by g.volgnummer), '[]'::jsonb) into v_bestaand
    from public.careon_scribe_segmenten g
    where g.sessie_id = p_sessie and g.fragment_id = p_fragment_id;
    if jsonb_array_length(v_bestaand) > 0 then
      return v_bestaand;
    end if;
  end if;

  -- Afrondingsvenster van 90 seconden: fragmenten die nog onderweg waren toen
  -- de behandelaar "Consult afronden" koos, mogen alsnog landen.
  if v_sessie.status <> 'actief'
     and not (v_sessie.status = 'afgerond'
       and v_sessie.beeindigd_op is not null
       and v_sessie.beeindigd_op > now() - interval '90 seconds') then
    raise exception 'scribe: dit consult neemt geen nieuwe segmenten meer aan' using errcode = '55000';
  end if;

  if v_sessie.segment_teller + v_aantal > 900 then
    raise exception 'scribe: maximaal 900 segmenten per consult' using errcode = '54000';
  end if;

  with nieuw as (
    insert into public.careon_scribe_segmenten (
      sessie_id, org_id, behandelaar_id, volgnummer, fragment_id, spreker,
      tekst, tekst_gecorrigeerd, correctie_bron, begin_ms, eind_ms, bron
    )
    select
      v_sessie.id,
      v_sessie.org_id,
      v_sessie.behandelaar_id,
      v_sessie.segment_teller + e.ord::integer,
      p_fragment_id,
      coalesce(nullif(e.segment ->> 'spreker', ''), 'onbekend'),
      coalesce(e.segment ->> 'tekst', ''),
      nullif(e.segment ->> 'tekstGecorrigeerd', ''),
      nullif(e.segment ->> 'correctieBron', ''),
      nullif(e.segment ->> 'beginMs', '')::integer,
      nullif(e.segment ->> 'eindMs', '')::integer,
      coalesce(nullif(e.segment ->> 'bron', ''), 'live')
    from jsonb_array_elements(p_segmenten) with ordinality as e(segment, ord)
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(nieuw) order by nieuw.volgnummer), '[]'::jsonb)
  into v_rijen
  from nieuw;

  update public.careon_scribe_sessies s
  set segment_teller = s.segment_teller + v_aantal,
      duur_ms = s.duur_ms + greatest(0, coalesce(p_duur_ms, 0)),
      ontbrekende_fragmenten = s.ontbrekende_fragmenten
        + case when coalesce(p_ontbrekend, false) then 1 else 0 end,
      updated_at = now()
  where s.id = v_sessie.id;

  return v_rijen;
end;
$$;

revoke all on function public.careon_scribe_voeg_segmenten_toe(uuid, uuid, jsonb, integer, boolean)
  from public, anon;
grant execute on function public.careon_scribe_voeg_segmenten_toe(uuid, uuid, jsonb, integer, boolean)
  to authenticated, service_role;

-- ── 7. RPC: statusovergang + retentie (de enige weg naar een andere status) ─
-- Valideert de overgang, eist voor `goedgekeurd` een goedgekeurde verslag-
-- versie, berekent de bewaartermijnen zelf uit de instellingen (§4.7) en wist
-- synchroon wat direct weg moet. Zie de kopnotitie over `security invoker`.

create or replace function public.careon_scribe_status_zetten(p_sessie uuid, p_status text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sessie public.careon_scribe_sessies;
  v_notitie_status text;
  v_transcript_dagen integer;
  v_notitie_dagen integer;
  v_wis_bij_overname boolean;
  v_nu timestamptz := now();
  v_transcript timestamptz;
  v_sessie_na timestamptz;
begin
  if p_status not in ('afgerond', 'goedgekeurd', 'overgenomen', 'geannuleerd') then
    raise exception 'scribe: onbekende status' using errcode = '22023';
  end if;

  perform set_config('careon.scribe_rpc', '1', true);

  select * into v_sessie from public.careon_scribe_sessies s where s.id = p_sessie for update;
  if not found then
    raise exception 'scribe: consult niet gevonden' using errcode = '42501';
  end if;
  if not (app.mag_scribe_gebruiken(v_sessie.org_id) and v_sessie.behandelaar_id = (select auth.uid())) then
    raise exception 'scribe: alleen de eigen behandelaar wijzigt de status van een consult'
      using errcode = '42501';
  end if;

  if not (
    (v_sessie.status = 'actief' and p_status in ('afgerond', 'geannuleerd'))
    or (v_sessie.status = 'afgerond' and p_status in ('goedgekeurd', 'geannuleerd'))
    or (v_sessie.status = 'goedgekeurd' and p_status in ('overgenomen', 'geannuleerd'))
  ) then
    raise exception 'scribe: overgang % -> % is niet toegestaan', v_sessie.status, p_status
      using errcode = '55000';
  end if;

  -- De behandelaar beslist: `goedgekeurd` kan alleen als de nieuwste
  -- verslagversie daadwerkelijk is vastgesteld (incl. de beoordelingssecties).
  if p_status = 'goedgekeurd' then
    select n.status into v_notitie_status
    from public.careon_scribe_notities n
    where n.sessie_id = v_sessie.id
    order by n.versie desc
    limit 1;
    if coalesce(v_notitie_status, '') <> 'goedgekeurd' then
      raise exception 'scribe: het verslag is nog niet goedgekeurd' using errcode = '55000';
    end if;
  end if;

  v_transcript_dagen := greatest(1, app.careon_scribe_retentie_dagen(v_sessie.org_id, 'transcriptRetentieDagen', 30));
  v_notitie_dagen := app.careon_scribe_retentie_dagen(v_sessie.org_id, 'notitieRetentieDagen', 30);
  v_wis_bij_overname := app.careon_scribe_instelling_aan(v_sessie.org_id, 'transcriptWissenBijOvername', true);

  if p_status = 'geannuleerd' then
    -- Transcript direct weg; de metadata verdwijnt bij de eerstvolgende opschoning.
    v_transcript := v_nu;
    v_sessie_na := v_nu + interval '1 day';
  elsif p_status = 'overgenomen' then
    v_transcript := case
      when v_wis_bij_overname then v_nu
      else least(v_nu + make_interval(days => v_transcript_dagen), v_nu + make_interval(days => v_notitie_dagen))
    end;
    v_sessie_na := v_nu + make_interval(days => v_notitie_dagen);
  else
    v_transcript := v_nu + make_interval(days => v_transcript_dagen);
    v_sessie_na := v_transcript;
  end if;

  if p_status = 'geannuleerd' or (p_status = 'overgenomen' and v_wis_bij_overname) then
    delete from public.careon_scribe_segmenten g where g.sessie_id = v_sessie.id;
    delete from public.careon_scribe_staat t where t.sessie_id = v_sessie.id;
  end if;
  if p_status = 'overgenomen' and v_notitie_dagen = 0 then
    delete from public.careon_scribe_notities n where n.sessie_id = v_sessie.id;
    v_sessie_na := v_nu;
  end if;

  update public.careon_scribe_sessies s
  set status = p_status,
      beeindigd_op = case
        when p_status in ('afgerond', 'geannuleerd') and s.beeindigd_op is null then v_nu
        else s.beeindigd_op end,
      goedgekeurd_op = case when p_status = 'goedgekeurd' then v_nu else s.goedgekeurd_op end,
      overgenomen_op = case when p_status = 'overgenomen' then v_nu else s.overgenomen_op end,
      transcript_verwijder_na = v_transcript,
      sessie_verwijder_na = v_sessie_na,
      updated_at = v_nu
  where s.id = v_sessie.id
  returning * into v_sessie;

  perform set_config('careon.scribe_rpc', '', true);
  return to_jsonb(v_sessie);
end;
$$;

revoke all on function public.careon_scribe_status_zetten(uuid, text) from public, anon;
grant execute on function public.careon_scribe_status_zetten(uuid, text) to authenticated, service_role;

-- ── 8. RPC: verslag goedkeuren ─────────────────────────────────────────────
-- Elke sectie moet goedgekeurd zijn, en beoordelingssecties (★,
-- vereistBehandelaar) moeten een niet-lege, door de behandelaar geschreven
-- tekst dragen — die worden nooit machinaal gevuld (S10). Slaagt de
-- goedkeuring, dan schuift het consult in dezelfde transactie mee naar
-- 'goedgekeurd' (C12/C34): de client hoeft daar geen tweede aanroep voor te
-- doen en er ontstaat geen tussenstand waarin de verwijderguard niet vuurt.

create or replace function public.careon_scribe_notitie_goedkeuren(p_notitie uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_notitie public.careon_scribe_notities;
  v_open integer;
  v_leeg integer;
begin
  perform set_config('careon.scribe_rpc', '1', true);

  select * into v_notitie from public.careon_scribe_notities n where n.id = p_notitie for update;
  if not found then
    raise exception 'scribe: verslag niet gevonden' using errcode = '42501';
  end if;
  if not (app.mag_scribe_gebruiken(v_notitie.org_id) and v_notitie.behandelaar_id = (select auth.uid())) then
    raise exception 'scribe: alleen de eigen behandelaar keurt het verslag goed' using errcode = '42501';
  end if;
  if v_notitie.status = 'goedgekeurd' then
    raise exception 'scribe: dit verslag is al goedgekeurd; maak een nieuwe versie' using errcode = '55000';
  end if;

  select count(*) into v_open
  from jsonb_array_elements(v_notitie.secties) as s(sectie)
  where coalesce(s.sectie ->> 'status', '') <> 'goedgekeurd';
  if v_open > 0 then
    raise exception 'scribe: nog % sectie(s) niet goedgekeurd', v_open using errcode = '55000';
  end if;

  select count(*) into v_leeg
  from jsonb_array_elements(v_notitie.secties) as s(sectie)
  where coalesce((s.sectie ->> 'vereistBehandelaar')::boolean, false)
    and char_length(btrim(coalesce(s.sectie ->> 'tekst', ''))) = 0;
  if v_leeg > 0 then
    raise exception 'scribe: de beoordeling van de behandelaar ontbreekt in % sectie(s)', v_leeg
      using errcode = '55000';
  end if;

  update public.careon_scribe_notities n
  set status = 'goedgekeurd',
      goedgekeurd_op = now(),
      updated_at = now()
  where n.id = v_notitie.id
  returning * into v_notitie;

  perform set_config('careon.scribe_rpc', '', true);

  -- C12/C34 — het consult schuift in DEZELFDE transactie mee naar
  -- 'goedgekeurd'. Voorheen deed de client dat in een tweede aanroep; viel die
  -- weg (netwerk, tabblad dicht, 429), dan bleef het consult 'afgerond' terwijl
  -- er een goedgekeurd, nog niet overgenomen verslag lag — precies de stand
  -- waarin de verwijderguard van §5.3 niet meer vuurde.
  --
  -- Twee voorwaarden houden dit veilig: alleen vanuit 'afgerond' (elke andere
  -- overgang zou 55000 werpen en de goedkeuring zelf terugdraaien) en alleen
  -- wanneer dit ook de hoogste versie is (careon_scribe_status_zetten eist dat
  -- de nieuwste versie goedgekeurd is). De aanroep staat NA de eigen
  -- set_config-reset: careon_scribe_status_zetten zet en wist de GUC zelf.
  if exists (
    select 1 from public.careon_scribe_sessies s
    where s.id = v_notitie.sessie_id and s.status = 'afgerond'
  ) and not exists (
    select 1 from public.careon_scribe_notities n2
    where n2.sessie_id = v_notitie.sessie_id and n2.versie > v_notitie.versie
  ) then
    perform public.careon_scribe_status_zetten(v_notitie.sessie_id, 'goedgekeurd');
  end if;

  return to_jsonb(v_notitie);
end;
$$;

revoke all on function public.careon_scribe_notitie_goedkeuren(uuid) from public, anon;
grant execute on function public.careon_scribe_notitie_goedkeuren(uuid) to authenticated, service_role;

-- ── 9. Opschoning (service-role) ───────────────────────────────────────────
-- Eigen RPC, bewust NIET in careon_prune_runtime_data gevlochten, zodat de
-- scribe-tabellen nooit per ongeluk in de algemene opschoning belanden.
-- (1) transcript + staat van consulten waarvan de transcripttermijn verlopen
-- is; (2) consulten waarvan de sessietermijn verlopen is (cascade);
-- (3) verlaten `actief`-consulten (>24 uur stil) worden afgerond met de
-- retentie uit de instellingen — een vergeten opname mag niet eeuwig open staan.

create or replace function public.careon_prune_scribe()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segmenten integer;
  v_staat integer;
  v_sessies integer;
  v_verlaten integer;
begin
  -- Uitvoerrecht ligt al uitsluitend bij de service-role; deze controle op de
  -- claims-container is verdediging in de diepte (huisstijl 20260821155300).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'scribe: opschonen is voorbehouden aan de service-role' using errcode = '42501';
  end if;
  perform set_config('careon.scribe_rpc', '1', true);

  delete from public.careon_scribe_segmenten g
  where exists (
    select 1 from public.careon_scribe_sessies s
    where s.id = g.sessie_id
      and s.transcript_verwijder_na is not null
      and s.transcript_verwijder_na < now()
  );
  get diagnostics v_segmenten = row_count;

  delete from public.careon_scribe_staat t
  where exists (
    select 1 from public.careon_scribe_sessies s
    where s.id = t.sessie_id
      and s.transcript_verwijder_na is not null
      and s.transcript_verwijder_na < now()
  );
  get diagnostics v_staat = row_count;

  delete from public.careon_scribe_sessies s
  where s.sessie_verwijder_na is not null and s.sessie_verwijder_na < now();
  get diagnostics v_sessies = row_count;

  with verlaten as (
    update public.careon_scribe_sessies s
    set status = 'afgerond',
        beeindigd_op = coalesce(s.beeindigd_op, s.updated_at),
        transcript_verwijder_na = now() + make_interval(
          days => greatest(1, app.careon_scribe_retentie_dagen(s.org_id, 'transcriptRetentieDagen', 30))),
        sessie_verwijder_na = now() + make_interval(
          days => greatest(1, app.careon_scribe_retentie_dagen(s.org_id, 'transcriptRetentieDagen', 30)))
    where s.status = 'actief' and s.updated_at < now() - interval '24 hours'
    returning 1
  )
  select count(*) into v_verlaten from verlaten;

  perform set_config('careon.scribe_rpc', '', true);
  return jsonb_build_object(
    'segmenten_verwijderd', v_segmenten,
    'staat_verwijderd', v_staat,
    'sessies_verwijderd', v_sessies,
    'verlaten_afgerond', v_verlaten
  );
end;
$$;

revoke all on function public.careon_prune_scribe() from public, anon, authenticated;
grant execute on function public.careon_prune_scribe() to service_role;

-- ── 10. RLS ────────────────────────────────────────────────────────────────
-- Per tabel: RLS aan, alles weg bij anon, expliciete grants, policies per verb
-- en de restrictieve careon_active_account-policy die 20260905135733 op élke
-- blootgestelde tabel eist (die migratie liep vóór deze tabellen bestonden, dus
-- ze staan hier expliciet — de DB-regressie controleert alle acht).

-- Sessies: eigenaar leest/schrijft; de vrijgave-ontvanger leest de sessierij van
-- het vrijgegeven consult; de beheerder leest NIETS onder zijn eigen JWT en mag
-- wel verwijderen (zie de select-policy hieronder, C3/C10).
alter table public.careon_scribe_sessies enable row level security;
revoke all on table public.careon_scribe_sessies from anon;
grant select, insert, update, delete on table public.careon_scribe_sessies to authenticated;
grant all on table public.careon_scribe_sessies to service_role;

drop policy if exists careon_scribe_sessies_select on public.careon_scribe_sessies;
-- C3/C10 — RLS is rij-niveau, geen kolomniveau: met `app.mag_scribe_beheren` in
-- deze policy kon een org_admin met zijn eigen JWT rechtstreeks
-- `select patient_referentie, consult_type` doen op de consulten van collega's,
-- terwijl S12/V3 juist belooft dat hij die twee velden NOOIT ziet. Die belofte
-- stond alleen in de serializer. De beheerdertak is daarom uit de policy
-- gehaald: hij leest de metadatalijst via de SERVICE-ROLE met een expliciete
-- kolomlijst (SESSIE_METADATA_SELECT, zonder patient_referentie en
-- consult_type) ná zijn beheerdersgate — hetzelfde patroon als de
-- vrijgave-insert. Zie afwijking 3 in de kop.
create policy careon_scribe_sessies_select on public.careon_scribe_sessies
  for select to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and (
      behandelaar_id = (select auth.uid())
      or app.scribe_vrijgegeven(id)
    )
  );

-- Toestemming is een harde voorwaarde: zonder bevroren tekst, revisie en een
-- tijdstip binnen de laatste 10 minuten ontstaat er geen consult (S13).
drop policy if exists careon_scribe_sessies_insert on public.careon_scribe_sessies;
create policy careon_scribe_sessies_insert on public.careon_scribe_sessies
  for insert to authenticated
  with check (
    app.mag_scribe_gebruiken(org_id)
    and app.scribe_ingeschakeld(org_id)
    and behandelaar_id = (select auth.uid())
    and status = 'actief'
    and consent_tekst is not null
    and consent_revisie is not null
    and consent_bevestigd_op between now() - interval '10 minutes' and now() + interval '1 minute'
  );

drop policy if exists careon_scribe_sessies_update on public.careon_scribe_sessies;
create policy careon_scribe_sessies_update on public.careon_scribe_sessies
  for update to authenticated
  using (app.mag_scribe_gebruiken(org_id) and behandelaar_id = (select auth.uid()))
  -- Beide kanten: blokkeert cross-tenant verplaatsing van een consult.
  with check (app.mag_scribe_gebruiken(org_id) and behandelaar_id = (select auth.uid()));

drop policy if exists careon_scribe_sessies_delete on public.careon_scribe_sessies;
create policy careon_scribe_sessies_delete on public.careon_scribe_sessies
  for delete to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and (behandelaar_id = (select auth.uid()) or app.mag_scribe_beheren(org_id))
  );

drop policy if exists careon_active_account on public.careon_scribe_sessies;
create policy careon_active_account on public.careon_scribe_sessies
  as restrictive for all to authenticated
  using ((select app.is_active_user())) with check ((select app.is_active_user()));

-- Segmenten: strikt eigenaar-gebonden. De insert-policy blijft nodig omdat
-- careon_scribe_voeg_segmenten_toe `security invoker` is.
alter table public.careon_scribe_segmenten enable row level security;
revoke all on table public.careon_scribe_segmenten from anon;
grant select, insert, update, delete on table public.careon_scribe_segmenten to authenticated;
grant all on table public.careon_scribe_segmenten to service_role;

drop policy if exists careon_scribe_segmenten_select on public.careon_scribe_segmenten;
create policy careon_scribe_segmenten_select on public.careon_scribe_segmenten
  for select to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );
drop policy if exists careon_scribe_segmenten_insert on public.careon_scribe_segmenten;
create policy careon_scribe_segmenten_insert on public.careon_scribe_segmenten
  for insert to authenticated
  with check (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );
drop policy if exists careon_scribe_segmenten_update on public.careon_scribe_segmenten;
create policy careon_scribe_segmenten_update on public.careon_scribe_segmenten
  for update to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  )
  with check (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );
drop policy if exists careon_scribe_segmenten_delete on public.careon_scribe_segmenten;
create policy careon_scribe_segmenten_delete on public.careon_scribe_segmenten
  for delete to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );

drop policy if exists careon_active_account on public.careon_scribe_segmenten;
create policy careon_active_account on public.careon_scribe_segmenten
  as restrictive for all to authenticated
  using ((select app.is_active_user())) with check ((select app.is_active_user()));

-- Consultstaat: idem eigenaar-gebonden.
alter table public.careon_scribe_staat enable row level security;
revoke all on table public.careon_scribe_staat from anon;
grant select, insert, update, delete on table public.careon_scribe_staat to authenticated;
grant all on table public.careon_scribe_staat to service_role;

drop policy if exists careon_scribe_staat_select on public.careon_scribe_staat;
create policy careon_scribe_staat_select on public.careon_scribe_staat
  for select to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );
drop policy if exists careon_scribe_staat_insert on public.careon_scribe_staat;
create policy careon_scribe_staat_insert on public.careon_scribe_staat
  for insert to authenticated
  with check (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );
drop policy if exists careon_scribe_staat_update on public.careon_scribe_staat;
create policy careon_scribe_staat_update on public.careon_scribe_staat
  for update to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  )
  with check (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );
drop policy if exists careon_scribe_staat_delete on public.careon_scribe_staat;
create policy careon_scribe_staat_delete on public.careon_scribe_staat
  for delete to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );

drop policy if exists careon_active_account on public.careon_scribe_staat;
create policy careon_active_account on public.careon_scribe_staat
  as restrictive for all to authenticated
  using ((select app.is_active_user())) with check ((select app.is_active_user()));

-- Taken: idem eigenaar-gebonden.
alter table public.careon_scribe_taken enable row level security;
revoke all on table public.careon_scribe_taken from anon;
grant select, insert, update, delete on table public.careon_scribe_taken to authenticated;
grant all on table public.careon_scribe_taken to service_role;

drop policy if exists careon_scribe_taken_select on public.careon_scribe_taken;
create policy careon_scribe_taken_select on public.careon_scribe_taken
  for select to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );
drop policy if exists careon_scribe_taken_insert on public.careon_scribe_taken;
create policy careon_scribe_taken_insert on public.careon_scribe_taken
  for insert to authenticated
  with check (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );
drop policy if exists careon_scribe_taken_update on public.careon_scribe_taken;
create policy careon_scribe_taken_update on public.careon_scribe_taken
  for update to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  )
  with check (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );
drop policy if exists careon_scribe_taken_delete on public.careon_scribe_taken;
create policy careon_scribe_taken_delete on public.careon_scribe_taken
  for delete to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );

drop policy if exists careon_active_account on public.careon_scribe_taken;
create policy careon_active_account on public.careon_scribe_taken
  as restrictive for all to authenticated
  using ((select app.is_active_user())) with check ((select app.is_active_user()));

-- Verslagen: eigenaar-gebonden, plus één leestak voor de vrijgave-ontvanger —
-- uitsluitend GOEDGEKEURDE versies, nooit concepten en nooit het transcript.
alter table public.careon_scribe_notities enable row level security;
revoke all on table public.careon_scribe_notities from anon;
grant select, insert, update, delete on table public.careon_scribe_notities to authenticated;
grant all on table public.careon_scribe_notities to service_role;

drop policy if exists careon_scribe_notities_select on public.careon_scribe_notities;
create policy careon_scribe_notities_select on public.careon_scribe_notities
  for select to authenticated
  using (
    (
      app.mag_scribe_gebruiken(org_id)
      and behandelaar_id = (select auth.uid())
      and app.scribe_eigen_sessie(sessie_id, org_id)
    )
    -- C1 — ook de vrijgave-tak draagt het rolpredicaat: trekt de beheerder de
    -- machtiging of het lidmaatschap in, dan sluit de toegang tot het
    -- vrijgegeven verslag onmiddellijk. Een vrijgave is een uitzondering, geen
    -- permanente toekenning. Bewust `app.mag_scribe_gebruiken` en niet
    -- `app.is_org_member` (§2.4: die naam hoort alleen in de
    -- instellingen-select).
    or (
      status = 'goedgekeurd'
      and app.mag_scribe_gebruiken(org_id)
      and app.scribe_vrijgegeven(sessie_id)
    )
  );
drop policy if exists careon_scribe_notities_insert on public.careon_scribe_notities;
create policy careon_scribe_notities_insert on public.careon_scribe_notities
  for insert to authenticated
  with check (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
    -- C2 — een verslag ontstaat ALTIJD als concept, net als een consult altijd
    -- als 'actief' begint (zie careon_scribe_sessies_insert). Zonder deze pin
    -- kan een behandelaar met zijn eigen JWT rechtstreeks een rij met
    -- status='goedgekeurd' inserten en daarmee de hele controle van
    -- careon_scribe_notitie_goedkeuren overslaan (S10: elke sectie goedgekeurd,
    -- ★-secties met een eigen tekst). De bevriestrigger is een BEFORE UPDATE en
    -- ziet een insert dus niet.
    and status = 'concept'
    and goedgekeurd_op is null
  );
drop policy if exists careon_scribe_notities_update on public.careon_scribe_notities;
create policy careon_scribe_notities_update on public.careon_scribe_notities
  for update to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  )
  with check (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );
drop policy if exists careon_scribe_notities_delete on public.careon_scribe_notities;
create policy careon_scribe_notities_delete on public.careon_scribe_notities
  for delete to authenticated
  using (
    app.mag_scribe_gebruiken(org_id)
    and behandelaar_id = (select auth.uid())
    and app.scribe_eigen_sessie(sessie_id, org_id)
  );

drop policy if exists careon_active_account on public.careon_scribe_notities;
create policy careon_active_account on public.careon_scribe_notities
  as restrictive for all to authenticated
  using ((select app.is_active_user())) with check ((select app.is_active_user()));

-- Instellingen: append-only (select + insert, nooit update/delete). De select
-- is BEWUST rolblind — zie WAARSCHUWING 1 in de kop: elk organisatielid moet de
-- consenttekst, het standaardformaat en `ingeschakeld` kunnen lezen, de rij
-- bevat geen persoonsgegevens en er staat geen striktere select-policy naast.
alter table public.careon_scribe_instellingen enable row level security;
revoke all on table public.careon_scribe_instellingen from anon;
revoke update, delete, truncate on table public.careon_scribe_instellingen from authenticated;
grant select, insert on table public.careon_scribe_instellingen to authenticated;
grant all on table public.careon_scribe_instellingen to service_role;

drop policy if exists careon_scribe_instellingen_select on public.careon_scribe_instellingen;
create policy careon_scribe_instellingen_select on public.careon_scribe_instellingen
  for select to authenticated
  using (app.is_org_member(org_id));
drop policy if exists careon_scribe_instellingen_insert on public.careon_scribe_instellingen;
create policy careon_scribe_instellingen_insert on public.careon_scribe_instellingen
  for insert to authenticated
  with check (app.mag_scribe_beheren(org_id));

drop policy if exists careon_active_account on public.careon_scribe_instellingen;
create policy careon_active_account on public.careon_scribe_instellingen
  as restrictive for all to authenticated
  using ((select app.is_active_user())) with check ((select app.is_active_user()));

-- Gemachtigden: de beheerder beheert de lijst; een behandelaar ziet zijn eigen
-- machtiging (de tegelomschrijving "niet gemachtigd" hangt eraan).
alter table public.careon_scribe_gemachtigden enable row level security;
revoke all on table public.careon_scribe_gemachtigden from anon;
revoke update, truncate on table public.careon_scribe_gemachtigden from authenticated;
grant select, insert, delete on table public.careon_scribe_gemachtigden to authenticated;
grant all on table public.careon_scribe_gemachtigden to service_role;

drop policy if exists careon_scribe_gemachtigden_select on public.careon_scribe_gemachtigden;
create policy careon_scribe_gemachtigden_select on public.careon_scribe_gemachtigden
  for select to authenticated
  using (app.mag_scribe_beheren(org_id) or user_id = (select auth.uid()));
drop policy if exists careon_scribe_gemachtigden_insert on public.careon_scribe_gemachtigden;
create policy careon_scribe_gemachtigden_insert on public.careon_scribe_gemachtigden
  for insert to authenticated
  with check (app.mag_scribe_beheren(org_id));
drop policy if exists careon_scribe_gemachtigden_delete on public.careon_scribe_gemachtigden;
create policy careon_scribe_gemachtigden_delete on public.careon_scribe_gemachtigden
  for delete to authenticated
  using (app.mag_scribe_beheren(org_id));

drop policy if exists careon_active_account on public.careon_scribe_gemachtigden;
create policy careon_active_account on public.careon_scribe_gemachtigden
  as restrictive for all to authenticated
  using ((select app.is_active_user())) with check ((select app.is_active_user()));

-- Vrijgaven: lezen mag de beheerder en de ontvanger; SCHRIJVEN kan uitsluitend
-- de service-role, ná requireOrgAdmin() in de route — een caller-JWT mag zich
-- nooit zelf toegang tot het verslag van een collega verlenen.
alter table public.careon_scribe_vrijgaven enable row level security;
revoke all on table public.careon_scribe_vrijgaven from anon;
revoke insert, update, truncate on table public.careon_scribe_vrijgaven from authenticated;
grant select, delete on table public.careon_scribe_vrijgaven to authenticated;
grant all on table public.careon_scribe_vrijgaven to service_role;

drop policy if exists careon_scribe_vrijgaven_select on public.careon_scribe_vrijgaven;
create policy careon_scribe_vrijgaven_select on public.careon_scribe_vrijgaven
  for select to authenticated
  using (app.mag_scribe_beheren(org_id) or aan_user_id = (select auth.uid()));
drop policy if exists careon_scribe_vrijgaven_delete on public.careon_scribe_vrijgaven;
create policy careon_scribe_vrijgaven_delete on public.careon_scribe_vrijgaven
  for delete to authenticated
  using (app.mag_scribe_beheren(org_id));

drop policy if exists careon_active_account on public.careon_scribe_vrijgaven;
create policy careon_active_account on public.careon_scribe_vrijgaven
  as restrictive for all to authenticated
  using ((select app.is_active_user())) with check ((select app.is_active_user()));

-- ── 11. Quota-scope 'scribe' ───────────────────────────────────────────────
-- De RPC heeft een gesloten allowlist in de CHECK-constraint ÉN in de functie
-- zelf (0016/0021) — beide moeten mee, anders faalt elke aanroep met
-- "invalid quota parameters". Drempels staan in de routes
-- (enforceScribeRateLimit / enforceScribeOrgRateLimit).

alter table public.careon_assistant_rate_limits
  drop constraint if exists careon_assistant_rate_limits_scope_valid;
alter table public.careon_assistant_rate_limits
  add constraint careon_assistant_rate_limits_scope_valid
    check (scope in ('assistant', 'audit', 'login', 'login_account', 'mail', 'scribe'));

create or replace function public.careon_consume_assistant_quota(
  p_scope text,
  p_actor_hash text,
  p_minute_limit integer,
  p_day_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_day date := (v_now at time zone 'UTC')::date;
  v_row public.careon_assistant_rate_limits%rowtype;
  v_allowed boolean;
  v_retry integer := 0;
begin
  if p_scope not in ('assistant', 'audit', 'login', 'login_account', 'mail', 'scribe')
    or p_actor_hash !~ '^[0-9a-f]{32}$'
    or p_minute_limit < 1
    or p_day_limit < 1
  then
    raise exception 'invalid quota parameters';
  end if;

  insert into public.careon_assistant_rate_limits (
    scope,
    actor_hash,
    minute_bucket,
    minute_count,
    day_bucket,
    day_count,
    updated_at
  )
  values (p_scope, p_actor_hash, v_minute, 1, v_day, 1, v_now)
  on conflict (scope, actor_hash) do update
  set minute_count = case
        when public.careon_assistant_rate_limits.minute_bucket = excluded.minute_bucket
          then least(public.careon_assistant_rate_limits.minute_count + 1, p_minute_limit + 1)
        else 1
      end,
      minute_bucket = excluded.minute_bucket,
      day_count = case
        when public.careon_assistant_rate_limits.day_bucket = excluded.day_bucket
          then least(public.careon_assistant_rate_limits.day_count + 1, p_day_limit + 1)
        else 1
      end,
      day_bucket = excluded.day_bucket,
      updated_at = excluded.updated_at
  returning * into v_row;

  v_allowed := v_row.minute_count <= p_minute_limit and v_row.day_count <= p_day_limit;
  if not v_allowed then
    if v_row.minute_count > p_minute_limit then
      v_retry := greatest(1, ceil(extract(epoch from ((v_minute + interval '1 minute') - v_now)))::integer);
    else
      v_retry := greatest(
        1,
        ceil(
          extract(
            epoch from (((v_day + 1)::timestamp at time zone 'UTC') - v_now)
          )
        )::integer
      );
    end if;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'retry_after_seconds', v_retry,
    'minute_count', v_row.minute_count,
    'day_count', v_row.day_count
  );
end;
$$;

-- PostgREST kent de nieuwe tabellen en functies pas na een schema-reload.
notify pgrst, 'reload schema';
