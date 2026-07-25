-- Careon Pulse production runtime hardening.
-- - Atomic, cross-instance assistant/audit quotas.
-- - Idempotency keys for import and auxiliary snapshot writes.
-- - Explicit least-privilege grants for every application table.
-- - A bounded maintenance RPC for scheduled telemetry/quota cleanup.

create table if not exists public.careon_assistant_rate_limits (
  scope text not null,
  actor_hash text not null,
  minute_bucket timestamptz not null,
  minute_count integer not null default 0,
  day_bucket date not null,
  day_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope, actor_hash),
  constraint careon_assistant_rate_limits_scope_valid
    check (scope in ('assistant', 'audit')),
  constraint careon_assistant_rate_limits_counts_nonnegative
    check (minute_count >= 0 and day_count >= 0)
);

alter table public.careon_assistant_rate_limits enable row level security;

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
  if p_scope not in ('assistant', 'audit')
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

alter table public.careon_import_runs
  add column if not exists operation_id uuid;
create unique index if not exists careon_import_runs_operation_uidx
  on public.careon_import_runs (operation_id)
  where operation_id is not null;

alter table public.careon_agenda_state add column if not exists operation_id uuid;
alter table public.careon_verwijzers_state add column if not exists operation_id uuid;
alter table public.careon_toeslagen_state add column if not exists operation_id uuid;
alter table public.careon_declaraties_state add column if not exists operation_id uuid;

create unique index if not exists careon_agenda_state_operation_uidx
  on public.careon_agenda_state (operation_id)
  where operation_id is not null;
create unique index if not exists careon_verwijzers_state_operation_uidx
  on public.careon_verwijzers_state (operation_id)
  where operation_id is not null;
create unique index if not exists careon_toeslagen_state_operation_uidx
  on public.careon_toeslagen_state (operation_id)
  where operation_id is not null;
create unique index if not exists careon_declaraties_state_operation_uidx
  on public.careon_declaraties_state (operation_id)
  where operation_id is not null;

create or replace function public.careon_prune_runtime_data(
  p_event_retention_days integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events integer;
  v_quotas integer;
begin
  if p_event_retention_days < 7 or p_event_retention_days > 365 then
    raise exception 'retention must be between 7 and 365 days';
  end if;

  delete from public.careon_assistant_events
  where created_at < now() - make_interval(days => p_event_retention_days);
  get diagnostics v_events = row_count;

  delete from public.careon_assistant_rate_limits
  where updated_at < now() - interval '2 days';
  get diagnostics v_quotas = row_count;

  return jsonb_build_object('events_deleted', v_events, 'quota_rows_deleted', v_quotas);
end;
$$;

revoke all on table public.careon_import_runs from PUBLIC, anon, authenticated;
revoke all on table public.careon_import_records from PUBLIC, anon, authenticated;
revoke all on table public.careon_middelen_state from PUBLIC, anon, authenticated;
revoke all on table public.careon_hr_state from PUBLIC, anon, authenticated;
revoke all on table public.careon_agenda_state from PUBLIC, anon, authenticated;
revoke all on table public.careon_verwijzers_state from PUBLIC, anon, authenticated;
revoke all on table public.careon_toeslagen_state from PUBLIC, anon, authenticated;
revoke all on table public.careon_declaraties_state from PUBLIC, anon, authenticated;
revoke all on table public.careon_assistant_events from PUBLIC, anon, authenticated;
revoke all on table public.careon_assistant_rate_limits from PUBLIC, anon, authenticated;

revoke all on function public.careon_consume_assistant_quota(text, text, integer, integer)
  from PUBLIC, anon, authenticated;
revoke all on function public.careon_prune_runtime_data(integer)
  from PUBLIC, anon, authenticated;

grant select, insert, update, delete on table public.careon_import_runs to service_role;
grant select, insert, update, delete on table public.careon_import_records to service_role;
grant select, insert, update, delete on table public.careon_middelen_state to service_role;
grant select, insert, update, delete on table public.careon_hr_state to service_role;
grant select, insert, update, delete on table public.careon_agenda_state to service_role;
grant select, insert, update, delete on table public.careon_verwijzers_state to service_role;
grant select, insert, update, delete on table public.careon_toeslagen_state to service_role;
grant select, insert, update, delete on table public.careon_declaraties_state to service_role;
grant select, insert, update, delete on table public.careon_assistant_events to service_role;
grant select, insert, update, delete on table public.careon_assistant_rate_limits to service_role;

grant execute on function public.careon_consume_assistant_quota(text, text, integer, integer) to service_role;
grant execute on function public.careon_prune_runtime_data(integer) to service_role;
