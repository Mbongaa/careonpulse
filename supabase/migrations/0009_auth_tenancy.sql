-- Careon Pulse — echte authenticatie & multi-tenant fundament (handoff 13, fase 1).
-- Uitvoeren in de Supabase SQL-editor (of via de Management API).
--
-- Introduceert het tenancy-model: organisaties → leden (gebruikers) met een rol,
-- plus platformbeheerders (superadmin) als aparte, bewust kleine tabel — géén
-- lidmaatschapsrij, zodat platformrechten nooit per ongeluk via org-beheer
-- ontstaan. Profielen zijn 1:1 met auth.users en worden via een trigger
-- aangemaakt. RLS-helpers staan in het schema `app` (security definer, zodat
-- policy-checks niet in hun eigen RLS recursen).
--
-- Datatoegang voor gewone gebruikers verloopt vanaf fase 2 met hun eigen JWT
-- (anon-key + user-token richting PostgREST); de service-role key blijft
-- gereserveerd voor beheer, cross-org superadmin-reads en audit-inserts.

-- ── Schema voor RLS-helpers ─────────────────────────────────────────────────

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- ── Kern: organisaties, profielen, lidmaatschappen, platformbeheer ──────────

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$')
);

-- 1:1 met auth.users; aangemaakt door trigger on_auth_user_created.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('org_admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists organization_members_user_idx on public.organization_members (user_id);

-- Superadmin = rij in deze tabel; bewust géén boolean op profiles.
create table if not exists public.platform_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ── RLS-helpers (security definer: lezen buiten RLS om, dus geen recursie) ──

create or replace function app.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  );
$$;

create or replace function app.is_org_member(check_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.org_id = check_org
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function app.is_superadmin() from public;
revoke all on function app.is_org_member(uuid) from public;
grant execute on function app.is_superadmin() to authenticated, service_role;
grant execute on function app.is_org_member(uuid) to authenticated, service_role;

-- ── Profiel-trigger: elke nieuwe auth-gebruiker krijgt een profielrij ───────

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function app.handle_new_user();

-- ── RLS: leden lezen alleen hun eigen organisatie(s); schrijven kan niemand
--    client-side — beheer loopt uitsluitend via de service-role (admin-UI) ───

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.platform_admins enable row level security;

revoke all on table public.organizations from anon;
revoke all on table public.profiles from anon;
revoke all on table public.organization_members from anon;
revoke all on table public.platform_admins from anon;

grant select on table public.organizations to authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.organization_members to authenticated;
grant select on table public.platform_admins to authenticated;

grant all on table public.organizations to service_role;
grant all on table public.profiles to service_role;
grant all on table public.organization_members to service_role;
grant all on table public.platform_admins to service_role;

drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select on public.organizations
  for select to authenticated
  using (app.is_org_member(id) or app.is_superadmin());

drop policy if exists profiles_own_select on public.profiles;
create policy profiles_own_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or app.is_superadmin());

drop policy if exists organization_members_own_select on public.organization_members;
create policy organization_members_own_select on public.organization_members
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_superadmin());

drop policy if exists platform_admins_own_select on public.platform_admins;
create policy platform_admins_own_select on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── Seed: de twee organisaties uit handoff 13 (ZSG = klant, Demo = demoaccount
--    zodat user1/demo1234 blijft bestaan voor demo's en tests) ───────────────

insert into public.organizations (name, slug)
values
  ('ZSG', 'zsg'),
  ('Demo', 'demo')
on conflict (slug) do nothing;
