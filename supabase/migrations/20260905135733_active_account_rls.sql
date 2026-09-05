-- F02: authorization is based on current account state, even with a retained JWT.
-- Keep this check in the database: an application session check does not protect
-- direct PostgREST requests. Service-role jobs retain their explicit boundary.
create or replace function app.is_active_user()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid())
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= statement_timestamp())
  );
$$;
revoke all on function app.is_active_user() from public, anon;
grant execute on function app.is_active_user() to authenticated, service_role;

create or replace function app.is_superadmin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_active_user() and exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
  );
$$;

create or replace function app.is_org_member(check_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_active_user() and exists (
    select 1 from public.organization_members m
    where m.org_id = check_org and m.user_id = (select auth.uid())
  );
$$;

create or replace function app.mag_financieel_zien(check_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_active_user() and (
    app.is_superadmin() or exists (
      select 1 from public.organization_members m join auth.users u on u.id = m.user_id
      where m.org_id = check_org and m.user_id = (select auth.uid())
        and (m.role = 'org_admin' or lower(btrim(u.email)) = 'user1@careon-demo.nl')
    )
  );
$$;

create or replace function app.mag_facturatie_zien(check_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_active_user() and (
    app.is_superadmin() or exists (
      select 1 from public.organization_members m join auth.users u on u.id = m.user_id
      where m.org_id = check_org and m.user_id = (select auth.uid())
        and (m.role = 'org_admin' or lower(btrim(u.email)) = 'user1@careon-demo.nl')
    )
  );
$$;

-- Restrictive policies are ANDed with existing tenant/owner policies. This also
-- covers direct auth.uid() owner policies (profiles, chats, membership rows),
-- without broadening their grants or changing their tenant/financial rules.
-- New exposed tables must carry this same policy; the DB regression checks it.
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format('drop policy if exists careon_active_account on public.%I', t.relname);
    execute format(
      'create policy careon_active_account on public.%I as restrictive for all to authenticated
       using ((select app.is_active_user())) with check ((select app.is_active_user()))', t.relname);
  end loop;
end $$;

-- The agenda projection uses the helpers above inside its definer function,
-- so its deliberate financial-redaction bypass also fails closed when banned.
notify pgrst, 'reload schema';
