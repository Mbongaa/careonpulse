-- Remove exposed SECURITY DEFINER boundaries without weakening behavior.
--
-- 1. The agenda projection becomes a SECURITY INVOKER view over an internal,
--    non-exposed SECURITY DEFINER function. The function keeps the exact
--    membership filter and financial redaction required to bypass the more
--    restrictive base-table RLS; PostgREST exposes only the invoker view.
-- 2. Invoice issuance gets a new service-role-only RPC. The route has already
--    performed requireOrgAdmin(), but the database also revalidates the actor
--    before bypassing concept-only RLS. Direct authenticated RPC issuance is
--    removed in the follow-up migration after the application switches over.

create or replace function app.careon_agenda_state_public_rows()
returns table (
  id uuid,
  org_id uuid,
  saved_at timestamptz,
  operation_id uuid,
  state jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.org_id,
    s.saved_at,
    s.operation_id,
    case
      when app.mag_financieel_zien(s.org_id) then s.state
      else app.redigeer_agenda_financieel(s.state)
    end as state
  from public.careon_agenda_state s
  where app.is_org_member(s.org_id) or app.is_superadmin();
$$;

revoke all on function app.careon_agenda_state_public_rows() from public, anon;
grant execute on function app.careon_agenda_state_public_rows() to authenticated, service_role;

create or replace view public.careon_agenda_state_public
with (security_barrier = true, security_invoker = true) as
select rows.id, rows.org_id, rows.saved_at, rows.operation_id, rows.state
from app.careon_agenda_state_public_rows() rows;

revoke all on table public.careon_agenda_state_public from anon, authenticated;
grant select on table public.careon_agenda_state_public to authenticated;

create or replace function public.careon_factuur_definitief_maken_service(
  p_actor uuid,
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
  if p_actor is null or not (
    exists (
      select 1
      from public.platform_admins pa
      where pa.user_id = p_actor
    )
    or exists (
      select 1
      from public.organization_members m
      where m.org_id = p_org
        and m.user_id = p_actor
        and m.role = 'org_admin'
    )
  ) then
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
      definitief_door = p_actor,
      updated_at = now()
  where f.id = p_factuur and f.org_id = p_org;

  return query select v_volgnummer, v_nummer;
end;
$$;

revoke all on function public.careon_factuur_definitief_maken_service(
  uuid, uuid, uuid, text, smallint, integer, text, date, date
) from public, anon, authenticated;
grant execute on function public.careon_factuur_definitief_maken_service(
  uuid, uuid, uuid, text, smallint, integer, text, date, date
) to service_role;

notify pgrst, 'reload schema';
