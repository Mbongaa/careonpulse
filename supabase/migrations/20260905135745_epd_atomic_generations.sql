-- F12: all five EPD slices are staged inside one transaction. The generation
-- row is the publication marker; its required FKs prove all slices exist.
create table public.careon_epd_generations (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  source_time timestamptz not null,
  published_at timestamptz not null default clock_timestamp(),
  payload_hash text not null,
  run_id uuid not null references public.careon_import_runs(id),
  agenda_id uuid not null references public.careon_agenda_state(id),
  verwijzers_id uuid not null references public.careon_verwijzers_state(id),
  toeslagen_id uuid not null references public.careon_toeslagen_state(id),
  declaraties_id uuid not null references public.careon_declaraties_state(id)
);
create index careon_epd_generations_org_published_idx
  on public.careon_epd_generations(org_id, published_at desc);
alter table public.careon_epd_generations enable row level security;
revoke all on public.careon_epd_generations from anon, authenticated;
grant select on public.careon_epd_generations to authenticated;
grant all on public.careon_epd_generations to service_role;
create policy epd_generation_member_read on public.careon_epd_generations
  for select to authenticated using (app.is_org_member(org_id) or app.is_superadmin());
create policy careon_active_account on public.careon_epd_generations
  as restrictive for all to authenticated
  using ((select app.is_active_user())) with check ((select app.is_active_user()));

create or replace function public.careon_publish_epd_generation(
  p_org uuid, p_generation uuid, p_expected_generation uuid,
  p_source_time timestamptz, p_payload jsonb
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  prior public.careon_epd_generations;
  current_generation public.careon_epd_generations;
  run_id uuid := gen_random_uuid();
  agenda_id uuid := gen_random_uuid();
  verwijzers_id uuid := gen_random_uuid();
  toeslagen_id uuid := gen_random_uuid();
  declaraties_id uuid := gen_random_uuid();
  published timestamptz;
  payload_hash text := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
begin
  -- The service role is the only grantee; advisory lock serializes publishers
  -- per tenant, including the very first generation (no row to lock yet).
  perform pg_advisory_xact_lock(hashtextextended('careon-epd:' || p_org::text, 0));
  select * into prior from public.careon_epd_generations where id = p_generation;
  if found then
    if prior.org_id <> p_org or prior.payload_hash <> payload_hash or prior.source_time <> p_source_time then
      raise exception 'generation_id_reused_with_different_payload' using errcode = '23505';
    end if;
    return prior.id;
  end if;
  select * into current_generation from public.careon_epd_generations
    where org_id = p_org order by published_at desc limit 1;
  if current_generation.id is distinct from p_expected_generation then
    raise exception 'epd_generation_conflict' using errcode = '40001';
  end if;
  if p_source_time is null or p_source_time > clock_timestamp() + interval '5 minutes'
     or p_source_time <= current_generation.source_time then
    raise exception 'stale_or_invalid_epd_source_time' using errcode = '22023';
  end if;
  if p_generation is null or p_org is null or p_payload is null
     or jsonb_typeof(p_payload->'records') is distinct from 'array'
     or jsonb_array_length(p_payload->'records') not between 1 and 20000
     or coalesce(length(p_payload->>'fileName'), 0) = 0
     or jsonb_typeof(p_payload->'agenda') is distinct from 'object'
     or jsonb_typeof(p_payload->'verwijzers') is distinct from 'object'
     or jsonb_typeof(p_payload->'toeslagen') is distinct from 'object'
     or jsonb_typeof(p_payload->'declaraties') is distinct from 'object' then
    raise exception 'incomplete_epd_generation' using errcode = '22023';
  end if;
  published := clock_timestamp();
  insert into public.careon_import_runs(id,org_id,file_name,imported_at,total_rows,created_at)
    values(run_id,p_org,p_payload->>'fileName',published,jsonb_array_length(p_payload->'records'),published);
  insert into public.careon_import_records(run_id,record)
    select run_id, value from jsonb_array_elements(p_payload->'records');
  insert into public.careon_agenda_state(id,org_id,state,saved_at)
    values(agenda_id,p_org,jsonb_set(p_payload->'agenda','{importedAt}',to_jsonb(published)),published);
  insert into public.careon_verwijzers_state(id,org_id,state,saved_at)
    values(verwijzers_id,p_org,jsonb_set(p_payload->'verwijzers','{importedAt}',to_jsonb(published)),published);
  insert into public.careon_toeslagen_state(id,org_id,state,saved_at)
    values(toeslagen_id,p_org,jsonb_set(p_payload->'toeslagen','{importedAt}',to_jsonb(published)),published);
  insert into public.careon_declaraties_state(id,org_id,state,saved_at)
    values(declaraties_id,p_org,jsonb_set(p_payload->'declaraties','{importedAt}',to_jsonb(published)),published);
  insert into public.careon_epd_generations
    values(p_generation,p_org,p_source_time,published,payload_hash,run_id,agenda_id,verwijzers_id,toeslagen_id,declaraties_id);
  return p_generation;
end;
$$;
revoke all on function public.careon_publish_epd_generation(uuid,uuid,uuid,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function public.careon_publish_epd_generation(uuid,uuid,uuid,timestamptz,jsonb) to service_role;

-- One statement and one MVCC snapshot for the dashboard. For automated orgs,
-- read the published references. Other orgs retain independent manual imports.
create or replace function public.careon_read_epd_snapshot(p_org uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  with generation as (
    select * from public.careon_epd_generations where org_id = p_org order by published_at desc limit 1
  ), run as (
    select r.* from public.careon_import_runs r
    where r.org_id = p_org and r.total_rows > 0
      and (not exists(select 1 from generation) or r.id = (select run_id from generation))
      and r.total_rows = (select count(*) from public.careon_import_records d where d.run_id = r.id)
    order by r.created_at desc limit 1
  )
  select jsonb_build_object(
    'generationId', (select id from generation),
    'production', (select jsonb_build_object('fileName',r.file_name,'importedAt',r.imported_at,
      'records',(select jsonb_agg(d.record order by d.id) from public.careon_import_records d where d.run_id = r.id)) from run r),
    'agenda', (select s.state from public.careon_agenda_state_public s where s.org_id = p_org
      and (not exists(select 1 from generation) or s.id = (select agenda_id from generation)) order by s.saved_at desc limit 1),
    'verwijzers', (select s.state from public.careon_verwijzers_state s where s.org_id = p_org
      and (not exists(select 1 from generation) or s.id = (select verwijzers_id from generation)) order by s.saved_at desc limit 1),
    'toeslagen', (select s.state from public.careon_toeslagen_state s where s.org_id = p_org
      and (not exists(select 1 from generation) or s.id = (select toeslagen_id from generation)) order by s.saved_at desc limit 1),
    'declaraties', (select s.state from public.careon_declaraties_state s where s.org_id = p_org
      and (not exists(select 1 from generation) or s.id = (select declaraties_id from generation)) order by s.saved_at desc limit 1)
  );
$$;
revoke all on function public.careon_read_epd_snapshot(uuid) from public, anon;
grant execute on function public.careon_read_epd_snapshot(uuid) to authenticated;

-- Once an org uses generations, a single-slice browser push must not claim it
-- updated the published dataset. Existing manual orgs keep their old policies.
do $$ declare t text; begin
  foreach t in array array['careon_import_runs','careon_agenda_state','careon_verwijzers_state',
                          'careon_toeslagen_state','careon_declaraties_state'] loop
    execute format('create policy epd_generation_managed_insert on public.%I as restrictive
      for insert to authenticated with check (not exists (
        select 1 from public.careon_epd_generations g where g.org_id = %I.org_id))', t, t);
  end loop;
end $$;
create policy epd_generation_frozen_records on public.careon_import_records
  as restrictive for insert to authenticated with check (not exists (
    select 1 from public.careon_epd_generations g where g.run_id = careon_import_records.run_id
  ));
notify pgrst, 'reload schema';
