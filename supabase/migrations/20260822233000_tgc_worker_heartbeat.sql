-- Careon Pulse — metadata-only availability heartbeat for the trusted TGC
-- export worker. The portal credential and patient exports stay off-platform.

create table if not exists public.careon_tgc_sync_workers (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  worker_version text not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint careon_tgc_sync_workers_version_valid
    check (worker_version ~ '^[A-Za-z0-9._-]{1,32}$')
);

alter table public.careon_tgc_sync_workers enable row level security;
alter table public.careon_tgc_sync_workers force row level security;

revoke all on table public.careon_tgc_sync_workers from public, anon, authenticated, service_role;
grant select on table public.careon_tgc_sync_workers to authenticated, service_role;

drop policy if exists careon_tgc_sync_workers_member_select on public.careon_tgc_sync_workers;
create policy careon_tgc_sync_workers_member_select on public.careon_tgc_sync_workers
  for select to authenticated
  using ((select app.is_org_member(org_id)) or (select app.is_superadmin()));

create or replace function public.careon_tgc_worker_heartbeat(
  p_org_id uuid,
  p_worker_version text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_org_id is null or p_worker_version !~ '^[A-Za-z0-9._-]{1,32}$' then
    raise exception 'invalid worker heartbeat' using errcode = '22023';
  end if;

  insert into public.careon_tgc_sync_workers (
    org_id,
    worker_version,
    last_seen_at
  ) values (
    p_org_id,
    p_worker_version,
    v_now
  )
  on conflict (org_id) do update
  set worker_version = excluded.worker_version,
      last_seen_at = excluded.last_seen_at;

  return v_now;
end;
$$;

revoke all on function public.careon_tgc_worker_heartbeat(uuid, text) from public, anon, authenticated;
grant execute on function public.careon_tgc_worker_heartbeat(uuid, text) to service_role;
