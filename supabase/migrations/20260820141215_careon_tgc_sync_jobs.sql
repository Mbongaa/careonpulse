-- Careon Pulse — TGC export queue for the Databron page and Careon AI.
--
-- The web app only queues metadata. The browser automation and its TGC
-- credential stay on the trusted on-premise worker. Every status/event field
-- is operational metadata and must never contain exported patient rows.

create table if not exists public.careon_tgc_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  requested_via text not null default 'databron',
  status text not null default 'queued',
  stage text not null default 'queued',
  message text not null default 'Update staat in de wachtrij.',
  progress smallint not null default 0,
  events jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  worker_id text,
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint careon_tgc_sync_jobs_requested_via_valid
    check (requested_via in ('databron', 'assistant', 'scheduled')),
  constraint careon_tgc_sync_jobs_status_valid
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  constraint careon_tgc_sync_jobs_progress_valid
    check (progress between 0 and 100),
  constraint careon_tgc_sync_jobs_attempts_valid
    check (attempts between 0 and 5),
  constraint careon_tgc_sync_jobs_stage_length
    check (char_length(stage) between 1 and 48),
  constraint careon_tgc_sync_jobs_message_length
    check (char_length(message) between 1 and 500),
  constraint careon_tgc_sync_jobs_error_length
    check (error is null or char_length(error) <= 1000),
  constraint careon_tgc_sync_jobs_worker_length
    check (worker_id is null or char_length(worker_id) <= 120),
  constraint careon_tgc_sync_jobs_events_array
    check (jsonb_typeof(events) = 'array'),
  constraint careon_tgc_sync_jobs_result_object
    check (jsonb_typeof(result) = 'object')
);

create index if not exists careon_tgc_sync_jobs_org_created_idx
  on public.careon_tgc_sync_jobs (org_id, created_at desc);
create index if not exists careon_tgc_sync_jobs_requested_by_idx
  on public.careon_tgc_sync_jobs (requested_by)
  where requested_by is not null;
create unique index if not exists careon_tgc_sync_jobs_one_active_per_org_uidx
  on public.careon_tgc_sync_jobs (org_id)
  where status in ('queued', 'running');

alter table public.careon_tgc_sync_jobs enable row level security;

revoke all on table public.careon_tgc_sync_jobs from anon, authenticated;
grant select, insert on table public.careon_tgc_sync_jobs to authenticated;
grant select, insert, update, delete on table public.careon_tgc_sync_jobs to service_role;

drop policy if exists careon_tgc_sync_jobs_member_select on public.careon_tgc_sync_jobs;
create policy careon_tgc_sync_jobs_member_select on public.careon_tgc_sync_jobs
  for select to authenticated
  using ((select app.is_org_member(org_id)) or (select app.is_superadmin()));

drop policy if exists careon_tgc_sync_jobs_admin_insert on public.careon_tgc_sync_jobs;
create policy careon_tgc_sync_jobs_admin_insert on public.careon_tgc_sync_jobs
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and (select app.is_org_member(org_id))
  );
