-- Careon Pulse — organisatie-scoping van alle datatabellen (handoff 13, fase 2).
-- Vereist 0009 (organizations + app-helpers). Uitvoeren via de SQL-editor of
-- de Management API.
--
-- Elke bestaande rij is van ZSG (er wás maar één tenant); nieuwe rijen dragen
-- verplicht een org_id. Gebruikers benaderen de data vanaf nu met hun eigen
-- JWT (anon-key + user-token): RLS dwingt de org-scheiding in de database af,
-- óók als een route-handler een bug zou hebben. Append-only blijft append-only:
-- authenticated mag alleen select + insert; update/delete kan uitsluitend de
-- service-role (o.a. de compenserende delete van een mislukte import-run).

-- ── org_id toevoegen + backfillen naar ZSG ──────────────────────────────────

do $$
declare
  zsg uuid;
  t text;
begin
  select id into strict zsg from public.organizations where slug = 'zsg';
  foreach t in array array[
    'careon_import_runs',
    'careon_middelen_state',
    'careon_agenda_state',
    'careon_verwijzers_state',
    'careon_toeslagen_state',
    'careon_declaraties_state',
    'careon_hr_state'
  ] loop
    execute format('alter table public.%I add column if not exists org_id uuid references public.organizations (id)', t);
    execute format('update public.%I set org_id = %L where org_id is null', t, zsg);
    execute format('alter table public.%I alter column org_id set not null', t);
  end loop;
end $$;

-- Assistent-logboek en rate-limits: kolommen voor echte identiteit erbij
-- (nullable — oude rijen kennen alleen actor_hash; schrijven blijft
-- uitsluitend server-side via de service-role).
alter table public.careon_assistant_events
  add column if not exists org_id uuid references public.organizations (id),
  add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.careon_assistant_rate_limits
  add column if not exists org_id uuid references public.organizations (id);

-- ── Indexen: "nieuwste per organisatie" i.p.v. globaal ──────────────────────

drop index if exists careon_middelen_state_saved_at_idx;
drop index if exists careon_agenda_state_saved_at_idx;
drop index if exists careon_verwijzers_state_saved_at_idx;
drop index if exists careon_toeslagen_state_saved_at_idx;
drop index if exists careon_declaraties_state_saved_at_idx;
drop index if exists careon_hr_state_saved_at_idx;
create index if not exists careon_middelen_state_org_saved_idx on public.careon_middelen_state (org_id, saved_at desc);
create index if not exists careon_agenda_state_org_saved_idx on public.careon_agenda_state (org_id, saved_at desc);
create index if not exists careon_verwijzers_state_org_saved_idx on public.careon_verwijzers_state (org_id, saved_at desc);
create index if not exists careon_toeslagen_state_org_saved_idx on public.careon_toeslagen_state (org_id, saved_at desc);
create index if not exists careon_declaraties_state_org_saved_idx on public.careon_declaraties_state (org_id, saved_at desc);
create index if not exists careon_hr_state_org_saved_idx on public.careon_hr_state (org_id, saved_at desc);
create index if not exists careon_import_runs_org_imported_idx on public.careon_import_runs (org_id, imported_at desc);

-- Revisies zijn monotoon PER organisatie, niet meer globaal.
drop index if exists careon_middelen_state_revision_uidx;
create unique index if not exists careon_middelen_state_org_revision_uidx
  on public.careon_middelen_state (org_id, revision);
drop index if exists careon_hr_state_revision_uidx;
create unique index if not exists careon_hr_state_org_revision_uidx
  on public.careon_hr_state (org_id, revision);

-- ── RLS: leden lezen/schrijven alleen hun eigen organisatie; superadmin
--    leest alles; update/delete blijft service-role-only (append-only) ───────

do $$
declare
  t text;
begin
  foreach t in array array[
    'careon_import_runs',
    'careon_middelen_state',
    'careon_agenda_state',
    'careon_verwijzers_state',
    'careon_toeslagen_state',
    'careon_declaraties_state',
    'careon_hr_state'
  ] loop
    execute format('grant select, insert on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.is_org_member(org_id) or app.is_superadmin())',
      t || '_member_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app.is_org_member(org_id))',
      t || '_member_insert', t);
  end loop;
end $$;

-- Import-records dragen geen eigen org_id; hun organisatie is die van de run.
grant select, insert on table public.careon_import_records to authenticated;
-- De id-kolom is serial: insert door authenticated vereist sequence-usage.
grant usage on sequence public.careon_import_records_id_seq to authenticated;
drop policy if exists careon_import_records_member_select on public.careon_import_records;
create policy careon_import_records_member_select on public.careon_import_records
  for select to authenticated
  using (
    app.is_superadmin()
    or exists (
      select 1 from public.careon_import_runs r
      where r.id = run_id and app.is_org_member(r.org_id)
    )
  );
drop policy if exists careon_import_records_member_insert on public.careon_import_records;
create policy careon_import_records_member_insert on public.careon_import_records
  for insert to authenticated
  with check (
    exists (
      select 1 from public.careon_import_runs r
      where r.id = run_id and app.is_org_member(r.org_id)
    )
  );
