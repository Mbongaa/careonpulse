-- Careon Pulse — facturatiemodule (handoff 15). Vereist 0009 (app-helpers) en
-- 0015 (financiële rolregel als voorbeeldpatroon). Uitvoeren via de Management
-- API. Idempotent: alles is if-not-exists / or-replace / drop-if-exists.
--
-- Waarom: de facturatietool is een beheerdersmodule (org_admin + superadmin
-- mét org-lidmaatschap). Route- en UI-gates zijn niet voldoende — de anon-key
-- en project-URL zitten per ontwerp in de clientbundle, dus een gewoon lid kan
-- met zijn eigen JWT PostgREST rechtstreeks bevragen (audit 29-07-2026,
-- blocker 3). Alle facturatietabellen krijgen daarom policies op alle vier de
-- verbs met app.mag_facturatie_zien().
--
-- WAARSCHUWING: voeg nooit een kale app.is_org_member(org_id)-selectpolicy toe
-- naast deze policies. Permissieve policies worden ge-OR'd; één rolblinde
-- policy neutraliseert de hele afscherming (zelfde valkuil als 0015:124-126).
--
-- Ontwerp (handoff 15 §3):
--   * careon_facturatie_instellingen — append-only snapshot (hr/middelen-
--     patroon): afzendergegevens die op elke factuur bevroren worden.
--   * careon_facturatie_contacten — relationele rijen; hard delete alleen
--     zolang geen factuur verwijst (FK on delete restrict), anders archief.
--   * careon_facturatie_facturen — relationele rijen, regels als jsonb,
--     bedragen in centen. Clients (authenticated) kunnen uitsluitend
--     CONCEPTEN schrijven: insert/update eisen status='concept' en nummer
--     null. Nummer + statusovergang naar definitief lopen uitsluitend via de
--     atomaire RPC careon_factuur_definitief_maken; administratieve
--     vervolgstappen (verzonden/betaald/gecrediteerd, pdf- en mailmetadata)
--     lopen via de service-role ná requireOrgAdmin() in de route.
--   * careon_facturatie_nummers — teller per (org, reeks, jaar); alleen de
--     RPC schrijft erin. Nooit max(volgnummer)+1 in applicatiecode.
--   * Uitgereikte facturen zijn onwijzigbaar (bevries-trigger) en
--     onverwijderbaar (geen-delete-trigger): art. 35a + bewaarplicht 7 jaar.
--     Deze tabellen NIET aansluiten op careon_prune_runtime_data; alleen
--     verlaten concepten mogen ooit worden opgeruimd.
--   * Storage-bucket `facturen` (privaat, GEEN client-policies): definitieve
--     pdf's, pad {org_id}/{jaar}/{nummer}.pdf + {org_id}/branding/logo.png.
--     Alle toegang via route handlers met de service-role ná rolcheck
--     (audit_events-huisstijl).

-- ── Helper: mag deze gebruiker de facturatiemodule van deze org gebruiken ───
-- Spiegelt magFacturatieZien() (src/lib/careon-facturatie-rol.ts): org_admin,
-- platformbeheerder of het vaste demoaccount — binnen een organisatie waar de
-- aanvrager (voor het demoaccount) daadwerkelijk lid van is. Eigen functie
-- naast app.mag_financieel_zien zodat per-account entitlements (blueprint
-- §5/D13) hier kunnen landen zonder de financiële rolregel te raken.

create or replace function app.mag_facturatie_zien(check_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.is_superadmin()
    or exists (
      select 1
      from public.organization_members m
      where m.org_id = check_org
        and m.user_id = (select auth.uid())
        and m.role = 'org_admin'
    )
    -- Vast demoaccount, zie CAREON_HOSTED_DEMO_EMAIL in
    -- src/lib/careon-demo-account.ts.
    or exists (
      select 1
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      where m.org_id = check_org
        and m.user_id = (select auth.uid())
        and lower(btrim(u.email)) = 'user1@careon-demo.nl'
    );
$$;

revoke all on function app.mag_facturatie_zien(uuid) from public, anon;
grant execute on function app.mag_facturatie_zien(uuid) to authenticated, service_role;

-- ── Instellingen: append-only snapshot ──────────────────────────────────────

create table if not exists public.careon_facturatie_instellingen (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  saved_at timestamptz not null default now(),
  -- FacturatieInstellingen (zie src/lib/careon-facturatie/types.ts).
  state jsonb not null,
  revision bigint not null,
  base_revision bigint,
  operation_id uuid,
  change_source text,
  change_summary jsonb not null default '{}'::jsonb,
  actor_hash text,
  constraint careon_facturatie_instellingen_revision_positive check (revision > 0),
  constraint careon_facturatie_instellingen_base_revision_nonnegative
    check (base_revision is null or base_revision >= 0),
  constraint careon_facturatie_instellingen_change_source_valid
    check (change_source is null or change_source in ('manual'))
);

create index if not exists careon_facturatie_instellingen_org_saved_idx
  on public.careon_facturatie_instellingen (org_id, saved_at desc);
create unique index if not exists careon_facturatie_instellingen_org_revision_uidx
  on public.careon_facturatie_instellingen (org_id, revision);
create unique index if not exists careon_facturatie_instellingen_operation_uidx
  on public.careon_facturatie_instellingen (operation_id) where operation_id is not null;

-- ── Contacten ───────────────────────────────────────────────────────────────

create table if not exists public.careon_facturatie_contacten (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  soort text not null default 'organisatie'
    check (soort in ('organisatie', 'particulier', 'verzekeraar', 'gemeente', 'medewerker')),
  bron text not null default 'handmatig' check (bron in ('handmatig', 'medewerker')),
  -- Zachte koppeling naar het medewerkersregister (naamstring is daar de
  -- sleutel, er bestaat geen stabiel id) — bewust géén FK.
  medewerker_naam text check (char_length(medewerker_naam) <= 160),
  medewerker_user_id uuid references public.profiles (id) on delete set null,
  naam text not null check (char_length(btrim(naam)) between 1 and 160),
  contactpersoon text check (char_length(contactpersoon) <= 120),
  email text check (char_length(email) <= 254),
  telefoon text check (char_length(telefoon) <= 40),
  adres_regel1 text check (char_length(adres_regel1) <= 160),
  adres_regel2 text check (char_length(adres_regel2) <= 160),
  postcode text check (char_length(postcode) <= 12),
  plaats text check (char_length(plaats) <= 80),
  land text not null default 'NL' check (char_length(land) = 2),
  kvk_nummer text check (kvk_nummer ~ '^[0-9]{8}$'),
  btw_id text check (char_length(btw_id) <= 20),
  uzovi text check (uzovi ~ '^[0-9]{4}$'),
  agb_code text check (char_length(agb_code) <= 12),
  betaaltermijn_dagen smallint check (betaaltermijn_dagen between 0 and 180),
  referentie text check (char_length(referentie) <= 80),
  notitie text check (char_length(notitie) <= 500),
  archief boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

create index if not exists careon_facturatie_contacten_org_naam_idx
  on public.careon_facturatie_contacten (org_id, lower(naam));
create index if not exists careon_facturatie_contacten_org_soort_idx
  on public.careon_facturatie_contacten (org_id, soort, archief);
create index if not exists careon_facturatie_contacten_created_by_idx
  on public.careon_facturatie_contacten (created_by);
create index if not exists careon_facturatie_contacten_medewerker_idx
  on public.careon_facturatie_contacten (medewerker_user_id);

-- ── Facturen ────────────────────────────────────────────────────────────────

create table if not exists public.careon_facturatie_facturen (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  status text not null default 'concept'
    check (status in ('concept', 'definitief', 'verzonden', 'betaald', 'gecrediteerd')),
  soort text not null default 'factuur' check (soort in ('factuur', 'creditfactuur')),
  reeks text not null default 'F' check (reeks ~ '^[A-Z]{1,4}$'),
  jaar smallint not null check (jaar between 2020 and 2100),
  volgnummer integer check (volgnummer > 0),
  nummer text check (char_length(nummer) between 1 and 40),
  gecrediteerde_factuur_id uuid references public.careon_facturatie_facturen (id) on delete restrict,

  factuurdatum date,
  prestatie_van date,
  prestatie_tot date,
  vervaldatum date,
  betaaltermijn_dagen smallint check (betaaltermijn_dagen between 0 and 180),

  contact_id uuid references public.careon_facturatie_contacten (id) on delete restrict,
  -- Bevroren snapshots (FactuurPartij / FactuurAfzender in types.ts).
  afnemer jsonb,
  afzender jsonb,
  uw_kenmerk text check (char_length(uw_kenmerk) <= 80),
  order_referentie text check (char_length(order_referentie) <= 80),

  regels jsonb not null default '[]'::jsonb,
  btw_totalen jsonb not null default '[]'::jsonb,
  vrijstelling_tekst text check (char_length(vrijstelling_tekst) <= 400),
  subtotaal_cent bigint not null default 0,
  btw_cent bigint not null default 0,
  totaal_cent bigint not null default 0,
  valuta text not null default 'EUR' check (valuta = 'EUR'),
  opmerking text check (char_length(opmerking) <= 1000),
  betaald_op date,

  pdf_pad text,
  pdf_sha256 text,
  pdf_bytes integer,
  pdf_gegenereerd_op timestamptz,

  mail_status text not null default 'niet_verzonden'
    check (mail_status in ('niet_verzonden', 'in_wachtrij', 'verzonden', 'mislukt')),
  mail_verzonden_op timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  definitief_door uuid references public.profiles (id) on delete set null,
  definitief_op timestamptz,

  constraint careon_facturatie_facturen_definitief_compleet check (
    status = 'concept'
    or (nummer is not null and volgnummer is not null and factuurdatum is not null and definitief_op is not null)
  ),
  constraint careon_facturatie_facturen_credit_verwijst check (
    soort = 'factuur' or gecrediteerde_factuur_id is not null
  )
);

create unique index if not exists careon_facturatie_facturen_org_nummer_uidx
  on public.careon_facturatie_facturen (org_id, nummer) where nummer is not null;
create unique index if not exists careon_facturatie_facturen_org_reeks_volg_uidx
  on public.careon_facturatie_facturen (org_id, reeks, jaar, volgnummer) where volgnummer is not null;
create index if not exists careon_facturatie_facturen_org_status_idx
  on public.careon_facturatie_facturen (org_id, status, factuurdatum desc);
create index if not exists careon_facturatie_facturen_org_created_idx
  on public.careon_facturatie_facturen (org_id, created_at desc);
create index if not exists careon_facturatie_facturen_contact_idx
  on public.careon_facturatie_facturen (org_id, contact_id);
create index if not exists careon_facturatie_facturen_credit_idx
  on public.careon_facturatie_facturen (gecrediteerde_factuur_id);
create index if not exists careon_facturatie_facturen_created_by_idx
  on public.careon_facturatie_facturen (created_by);
create index if not exists careon_facturatie_facturen_definitief_door_idx
  on public.careon_facturatie_facturen (definitief_door);

-- ── Nummerteller ────────────────────────────────────────────────────────────

create table if not exists public.careon_facturatie_nummers (
  org_id uuid not null references public.organizations (id) on delete cascade,
  reeks text not null,
  jaar smallint not null,
  laatste integer not null default 0 check (laatste >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, reeks, jaar)
);

-- ── Vormvalidatie van regels (DB-tegenhanger van isFactuurRegel) ────────────
-- Bewust lichter dan de TS-guard: de route valideert volledig; dit blokkeert
-- rechtstreekse PostgREST-writes met wezensvreemde jsonb.

create or replace function app.careon_facturatie_regels_geldig(regels jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(regels) = 'array'
    and jsonb_array_length(regels) <= 100
    and not exists (
      select 1
      from jsonb_array_elements(regels) as r(regel)
      where jsonb_typeof(regel) <> 'object'
        or jsonb_typeof(regel -> 'omschrijving') <> 'string'
        or char_length(regel ->> 'omschrijving') > 300
        or jsonb_typeof(regel -> 'aantal') <> 'number'
        or jsonb_typeof(regel -> 'stukprijsCent') <> 'number'
        or coalesce(regel ->> 'btwTarief', '') not in ('vrijgesteld', '0', '9', '21')
        or coalesce(regel ->> 'btwCategorie', '') not in ('E', 'Z', 'S', 'AE')
    );
$$;

revoke all on function app.careon_facturatie_regels_geldig(jsonb) from public, anon;
grant execute on function app.careon_facturatie_regels_geldig(jsonb) to authenticated, service_role;

alter table public.careon_facturatie_facturen
  drop constraint if exists careon_facturatie_facturen_regels_vorm;
alter table public.careon_facturatie_facturen
  add constraint careon_facturatie_facturen_regels_vorm
  check (app.careon_facturatie_regels_geldig(regels));

-- ── Onveranderlijkheid van uitgereikte facturen ─────────────────────────────

create or replace function app.careon_facturatie_bevries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'concept' then
    return new;
  end if;
  -- Na uitreiking zijn alleen administratieve velden nog wijzigbaar
  -- (statusvoortgang, betaald_op, pdf- en mailmetadata, updated_at).
  if (new.regels, new.afnemer, new.afzender, new.contact_id, new.nummer, new.volgnummer,
      new.factuurdatum, new.prestatie_van, new.prestatie_tot, new.vervaldatum,
      new.uw_kenmerk, new.order_referentie, new.subtotaal_cent, new.btw_cent,
      new.totaal_cent, new.btw_totalen, new.vrijstelling_tekst, new.soort, new.reeks,
      new.jaar, new.org_id, new.created_by, new.definitief_door, new.definitief_op)
     is distinct from
     (old.regels, old.afnemer, old.afzender, old.contact_id, old.nummer, old.volgnummer,
      old.factuurdatum, old.prestatie_van, old.prestatie_tot, old.vervaldatum,
      old.uw_kenmerk, old.order_referentie, old.subtotaal_cent, old.btw_cent,
      old.totaal_cent, old.btw_totalen, old.vrijstelling_tekst, old.soort, old.reeks,
      old.jaar, old.org_id, old.created_by, old.definitief_door, old.definitief_op) then
    raise exception 'Een uitgereikte factuur kan niet meer worden gewijzigd; maak een creditfactuur.';
  end if;
  return new;
end;
$$;

drop trigger if exists careon_facturatie_facturen_bevries on public.careon_facturatie_facturen;
create trigger careon_facturatie_facturen_bevries
  before update on public.careon_facturatie_facturen
  for each row execute function app.careon_facturatie_bevries();

create or replace function app.careon_facturatie_geen_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'concept' then
    raise exception 'Een uitgereikte factuur kan niet worden verwijderd.';
  end if;
  return old;
end;
$$;

drop trigger if exists careon_facturatie_facturen_geen_delete on public.careon_facturatie_facturen;
create trigger careon_facturatie_facturen_geen_delete
  before delete on public.careon_facturatie_facturen
  for each row execute function app.careon_facturatie_geen_delete();

-- ── Atomaire uitreiking: nummer + statusovergang in één transactie ──────────
-- B9: geen gaten (rij eerst vergrendelen en status controleren, dán pas de
-- teller ophogen — faalt er daarna iets, dan rollbackt ook de teller) en
-- race-vrij (on conflict do update onder rijvergrendeling). De teller seedt
-- bij de eerste toekenning met p_start (aansluiten op een bestaande reeks).
-- Security definer: de update passeert de concept-only policy bewust — deze
-- functie is de enige toegestane weg naar 'definitief'.

create or replace function public.careon_factuur_definitief_maken(
  p_org uuid,
  p_factuur uuid,
  p_reeks text,
  p_jaar smallint,
  p_start integer,
  p_formaat text,
  p_factuurdatum date,
  p_vervaldatum date
)
returns table (volgnummer integer, nummer text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_regels jsonb;
  v_volgnummer integer;
  v_nummer text;
  v_breedte integer;
begin
  if not app.mag_facturatie_zien(p_org) then
    raise exception 'facturatie: niet toegestaan voor deze gebruiker';
  end if;
  if p_reeks !~ '^[A-Z]{1,4}$' or p_jaar not between 2020 and 2100 or coalesce(p_start, 0) < 1 then
    raise exception 'facturatie: ongeldige nummerreeks';
  end if;

  select f.status, f.regels into v_status, v_regels
  from public.careon_facturatie_facturen f
  where f.id = p_factuur and f.org_id = p_org
  for update;
  if v_status is null then
    raise exception 'facturatie: factuur niet gevonden';
  end if;
  if v_status <> 'concept' then
    raise exception 'facturatie: factuur is al uitgereikt';
  end if;
  if jsonb_typeof(v_regels) <> 'array' or jsonb_array_length(v_regels) = 0 then
    raise exception 'facturatie: factuur zonder regels';
  end if;

  insert into public.careon_facturatie_nummers as n (org_id, reeks, jaar, laatste)
  values (p_org, p_reeks, p_jaar, p_start)
  on conflict (org_id, reeks, jaar)
    do update set laatste = n.laatste + 1, updated_at = now()
  returning n.laatste into v_volgnummer;

  v_breedte := coalesce(nullif(substring(p_formaat from '\{nummer:(\d)\}'), '')::integer, 4);
  v_nummer := replace(replace(p_formaat, '{reeks}', p_reeks), '{jaar}', p_jaar::text);
  v_nummer := regexp_replace(v_nummer, '\{nummer(:\d)?\}', lpad(v_volgnummer::text, v_breedte, '0'));

  update public.careon_facturatie_facturen f
  set status = 'definitief',
      reeks = p_reeks,
      jaar = p_jaar,
      volgnummer = v_volgnummer,
      nummer = v_nummer,
      factuurdatum = p_factuurdatum,
      vervaldatum = p_vervaldatum,
      definitief_op = now(),
      definitief_door = (select auth.uid()),
      updated_at = now()
  where f.id = p_factuur and f.org_id = p_org;

  return query select v_volgnummer, v_nummer;
end;
$$;

revoke all on function public.careon_factuur_definitief_maken(uuid, uuid, text, smallint, integer, text, date, date)
  from public, anon;
grant execute on function public.careon_factuur_definitief_maken(uuid, uuid, text, smallint, integer, text, date, date)
  to authenticated, service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────

-- Instellingen: append-only (select + insert, nooit update/delete).
alter table public.careon_facturatie_instellingen enable row level security;
revoke all on table public.careon_facturatie_instellingen from anon;
revoke update, delete, truncate on table public.careon_facturatie_instellingen from authenticated;
grant select, insert on table public.careon_facturatie_instellingen to authenticated;
grant all on table public.careon_facturatie_instellingen to service_role;

drop policy if exists careon_facturatie_instellingen_select on public.careon_facturatie_instellingen;
create policy careon_facturatie_instellingen_select on public.careon_facturatie_instellingen
  for select to authenticated
  using (app.mag_facturatie_zien(org_id));
drop policy if exists careon_facturatie_instellingen_insert on public.careon_facturatie_instellingen;
create policy careon_facturatie_instellingen_insert on public.careon_facturatie_instellingen
  for insert to authenticated
  with check (app.is_org_member(org_id) and app.mag_facturatie_zien(org_id));

-- Contacten: volledige CRUD voor facturatie-gerechtigde leden.
alter table public.careon_facturatie_contacten enable row level security;
revoke all on table public.careon_facturatie_contacten from anon;
grant select, insert, update, delete on table public.careon_facturatie_contacten to authenticated;
grant all on table public.careon_facturatie_contacten to service_role;

drop policy if exists careon_facturatie_contacten_select on public.careon_facturatie_contacten;
create policy careon_facturatie_contacten_select on public.careon_facturatie_contacten
  for select to authenticated
  using (app.mag_facturatie_zien(org_id));
drop policy if exists careon_facturatie_contacten_insert on public.careon_facturatie_contacten;
create policy careon_facturatie_contacten_insert on public.careon_facturatie_contacten
  for insert to authenticated
  with check (app.is_org_member(org_id) and app.mag_facturatie_zien(org_id));
drop policy if exists careon_facturatie_contacten_update on public.careon_facturatie_contacten;
create policy careon_facturatie_contacten_update on public.careon_facturatie_contacten
  for update to authenticated
  using (app.is_org_member(org_id) and app.mag_facturatie_zien(org_id))
  -- Beide kanten: blokkeert cross-tenant verplaatsing van een rij.
  with check (app.is_org_member(org_id) and app.mag_facturatie_zien(org_id));
drop policy if exists careon_facturatie_contacten_delete on public.careon_facturatie_contacten;
create policy careon_facturatie_contacten_delete on public.careon_facturatie_contacten
  for delete to authenticated
  using (app.is_org_member(org_id) and app.mag_facturatie_zien(org_id));

-- Facturen: clients schrijven uitsluitend concepten zonder nummer; de RPC en
-- de service-role (administratieve statusvelden) doen de rest.
alter table public.careon_facturatie_facturen enable row level security;
revoke all on table public.careon_facturatie_facturen from anon;
grant select, insert, update, delete on table public.careon_facturatie_facturen to authenticated;
grant all on table public.careon_facturatie_facturen to service_role;

drop policy if exists careon_facturatie_facturen_select on public.careon_facturatie_facturen;
create policy careon_facturatie_facturen_select on public.careon_facturatie_facturen
  for select to authenticated
  using (app.mag_facturatie_zien(org_id));
drop policy if exists careon_facturatie_facturen_insert on public.careon_facturatie_facturen;
create policy careon_facturatie_facturen_insert on public.careon_facturatie_facturen
  for insert to authenticated
  with check (
    app.is_org_member(org_id) and app.mag_facturatie_zien(org_id)
    and status = 'concept' and nummer is null and volgnummer is null
  );
drop policy if exists careon_facturatie_facturen_update on public.careon_facturatie_facturen;
create policy careon_facturatie_facturen_update on public.careon_facturatie_facturen
  for update to authenticated
  using (app.is_org_member(org_id) and app.mag_facturatie_zien(org_id) and status = 'concept')
  with check (
    app.is_org_member(org_id) and app.mag_facturatie_zien(org_id)
    and status = 'concept' and nummer is null and volgnummer is null
  );
drop policy if exists careon_facturatie_facturen_delete on public.careon_facturatie_facturen;
create policy careon_facturatie_facturen_delete on public.careon_facturatie_facturen
  for delete to authenticated
  using (app.is_org_member(org_id) and app.mag_facturatie_zien(org_id) and status = 'concept');

-- Nummerteller: alleen lezen voor clients (de UI toont het volgende nummer);
-- schrijven kan uitsluitend via de security-definer-RPC.
alter table public.careon_facturatie_nummers enable row level security;
revoke all on table public.careon_facturatie_nummers from anon;
revoke insert, update, delete, truncate on table public.careon_facturatie_nummers from authenticated;
grant select on table public.careon_facturatie_nummers to authenticated;
grant all on table public.careon_facturatie_nummers to service_role;

drop policy if exists careon_facturatie_nummers_select on public.careon_facturatie_nummers;
create policy careon_facturatie_nummers_select on public.careon_facturatie_nummers
  for select to authenticated
  using (app.mag_facturatie_zien(org_id));

-- ── Storage: private bucket voor definitieve pdf's + organisatielogo ────────
-- Bewust GEEN policies voor anon/authenticated op storage.objects: alle
-- toegang loopt via route handlers met de service-role, ná een expliciete
-- rolcheck. De service-role omzeilt RLS, dus policies zijn hier niet nodig —
-- en juist het ontbreken ervan houdt elke rechtstreekse client-toegang dicht.

insert into storage.buckets (id, name, public)
values ('facturen', 'facturen', false)
on conflict (id) do nothing;

-- PostgREST kent de nieuwe tabellen en functies pas na een schema-reload.
notify pgrst, 'reload schema';
