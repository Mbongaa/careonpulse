-- Careon Pulse — durable metadata-only operations alert outbox.
--
-- The TGC worker monitor already records coarse state transitions in the
-- append-only audit log. This outbox binds one notification to that source
-- event, claims work atomically, and keeps external HTTP calls outside every
-- database transaction. It stores no patient, export, queue or credential
-- data and intentionally exposes no delete capability.

create table public.careon_operations_alert_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  source_event_id bigint not null references public.audit_events (id) on delete cascade,
  channel text not null default 'teams_workflow',
  event_type text not null,
  worker_state text not null,
  previous_state text,
  age_bucket text not null,
  observed_at timestamptz not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lock_token uuid,
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint careon_operations_alert_outbox_source_event_unique unique (source_event_id),
  constraint careon_operations_alert_outbox_channel_valid
    check (channel = 'teams_workflow'),
  constraint careon_operations_alert_outbox_event_type_valid
    check (event_type in ('incident', 'recovery')),
  constraint careon_operations_alert_outbox_worker_state_valid
    check (worker_state in ('available', 'offline', 'unknown')),
  constraint careon_operations_alert_outbox_previous_state_valid
    check (previous_state is null or previous_state in ('available', 'offline', 'unknown')),
  constraint careon_operations_alert_outbox_age_bucket_valid
    check (age_bucket in ('under_2m', '2m_15m', '15m_1h', '1h_plus', 'unknown')),
  constraint careon_operations_alert_outbox_event_pair_valid
    check (
      (event_type = 'incident' and worker_state in ('offline', 'unknown'))
      or
      (event_type = 'recovery' and worker_state = 'available' and previous_state in ('offline', 'unknown'))
    ),
  constraint careon_operations_alert_outbox_status_valid
    check (status in ('pending', 'sending', 'delivered')),
  constraint careon_operations_alert_outbox_attempts_valid
    check (attempts between 0 and 10000),
  constraint careon_operations_alert_outbox_error_code_valid
    check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,32}$'),
  constraint careon_operations_alert_outbox_time_order_valid
    check (
      observed_at <= created_at + interval '30 seconds'
      and next_attempt_at >= created_at
      and updated_at >= created_at
      and (delivered_at is null or delivered_at >= created_at)
    ),
  constraint careon_operations_alert_outbox_state_shape_valid
    check (
      (status = 'pending' and lock_token is null and locked_at is null and delivered_at is null)
      or
      (status = 'sending' and lock_token is not null and locked_at is not null and delivered_at is null)
      or
      (status = 'delivered' and lock_token is null and locked_at is null and delivered_at is not null)
    )
);

create index careon_operations_alert_outbox_org_idx
  on public.careon_operations_alert_outbox (org_id);
create index careon_operations_alert_outbox_pending_idx
  on public.careon_operations_alert_outbox (next_attempt_at, created_at, id)
  where status = 'pending';
create index careon_operations_alert_outbox_sending_idx
  on public.careon_operations_alert_outbox (locked_at, created_at, id)
  where status = 'sending';

alter table public.careon_operations_alert_outbox enable row level security;
alter table public.careon_operations_alert_outbox force row level security;

revoke all on table public.careon_operations_alert_outbox from public, anon, authenticated, service_role;
grant select, insert, update on table public.careon_operations_alert_outbox to service_role;

create or replace function public.careon_record_tgc_worker_transition(
  p_org_id uuid,
  p_state text,
  p_age_bucket text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.audit_events%rowtype;
  v_previous text;
  v_event_type text;
  v_alert_id uuid;
  v_changed boolean;
  v_alert_status text := 'not_alertable';
begin
  if p_org_id is null
    or p_state is null
    or p_state not in ('available', 'offline', 'unknown')
    or p_age_bucket is null
    or p_age_bucket not in ('under_2m', '2m_15m', '15m_1h', '1h_plus', 'unknown') then
    raise exception 'invalid worker transition metadata' using errcode = '22023';
  end if;

  -- Vercel documents that Cron invocations may be duplicated. Serialize only
  -- this organization's tiny transition transaction so the external outbox
  -- remains exactly one row per state change.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('careon_tgc_worker_monitor:' || p_org_id::text, 0)
  );

  select event.*
  into v_source
  from public.audit_events event
  where event.org_id = p_org_id
    and event.resource = 'careon_tgc_sync_workers'
    and event.action in ('tgc_worker.available', 'tgc_worker.offline', 'tgc_worker.unknown')
  order by event.created_at desc, event.id desc
  limit 1;

  v_previous := case
    when v_source.action in ('tgc_worker.available', 'tgc_worker.offline', 'tgc_worker.unknown')
      then substring(v_source.action from char_length('tgc_worker.') + 1)
    else null
  end;
  v_changed := v_previous is distinct from p_state;

  if v_changed then
    insert into public.audit_events (
      org_id,
      action,
      resource,
      detail
    ) values (
      p_org_id,
      'tgc_worker.' || p_state,
      'careon_tgc_sync_workers',
      jsonb_build_object(
        'state', p_state,
        'previous', v_previous,
        'ageBucket', p_age_bucket
      )
    )
    returning * into v_source;
  end if;

  if v_source.id is null then
    return jsonb_build_object(
      'status', 'completed',
      'changed', false,
      'alertQueue', 'not_alertable'
    );
  end if;

  if v_source.detail ->> 'state' is distinct from p_state
    or v_source.detail ->> 'ageBucket' is null
    or v_source.detail ->> 'ageBucket' not in ('under_2m', '2m_15m', '15m_1h', '1h_plus', 'unknown')
    or (v_source.detail ->> 'previous' is not null
      and v_source.detail ->> 'previous' not in ('available', 'offline', 'unknown')) then
    raise exception 'stored worker transition metadata is invalid' using errcode = '22023';
  end if;

  v_previous := v_source.detail ->> 'previous';
  if p_state in ('offline', 'unknown') then
    v_event_type := 'incident';
  elsif p_state = 'available' and v_previous in ('offline', 'unknown') then
    v_event_type := 'recovery';
  end if;

  if v_event_type is not null then
    insert into public.careon_operations_alert_outbox (
      org_id,
      source_event_id,
      event_type,
      worker_state,
      previous_state,
      age_bucket,
      observed_at
    ) values (
      p_org_id,
      v_source.id,
      v_event_type,
      p_state,
      v_previous,
      v_source.detail ->> 'ageBucket',
      v_source.created_at
    )
    on conflict (source_event_id) do nothing
    returning id into v_alert_id;

    if v_alert_id is not null then
      v_alert_status := 'queued';
    else
      v_alert_status := 'existing';
    end if;
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'changed', v_changed,
    'alertQueue', v_alert_status
  );
end;
$$;

create or replace function public.careon_claim_operation_alert(p_lock_token uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_alert public.careon_operations_alert_outbox%rowtype;
begin
  if p_lock_token is null then
    raise exception 'lock token is required' using errcode = '22023';
  end if;

  update public.careon_operations_alert_outbox item
  set status = 'sending',
      attempts = item.attempts + 1,
      lock_token = p_lock_token,
      locked_at = v_now,
      updated_at = v_now
  where item.id = (
    select candidate.id
    from public.careon_operations_alert_outbox candidate
    where (
      candidate.status = 'pending'
      and candidate.next_attempt_at <= v_now
    ) or (
      candidate.status = 'sending'
      and candidate.locked_at < v_now - interval '10 minutes'
    )
    order by candidate.next_attempt_at, candidate.created_at, candidate.id
    limit 1
    for update skip locked
  )
  returning item.* into v_alert;

  if v_alert.id is null then
    return jsonb_build_object('status', 'idle');
  end if;

  return jsonb_build_object(
    'status', 'claimed',
    'alert', jsonb_build_object(
      'id', v_alert.id,
      'eventType', v_alert.event_type,
      'workerState', v_alert.worker_state,
      'previousState', v_alert.previous_state,
      'ageBucket', v_alert.age_bucket,
      'observedAt', v_alert.observed_at,
      'attempt', v_alert.attempts
    )
  );
end;
$$;

create or replace function public.careon_complete_operation_alert(
  p_alert_id uuid,
  p_lock_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_alert public.careon_operations_alert_outbox%rowtype;
begin
  if p_alert_id is null or p_lock_token is null then
    raise exception 'alert and lock token are required' using errcode = '22023';
  end if;

  update public.careon_operations_alert_outbox item
  set status = 'delivered',
      lock_token = null,
      locked_at = null,
      delivered_at = v_now,
      last_error_code = null,
      updated_at = v_now
  where item.id = p_alert_id
    and item.status = 'sending'
    and item.lock_token = p_lock_token
  returning item.* into v_alert;

  if v_alert.id is null then
    return false;
  end if;

  insert into public.audit_events (
    org_id,
    action,
    resource,
    resource_id,
    detail
  ) values (
    v_alert.org_id,
    'operations.alert.delivered',
    'careon_operations_alert_outbox',
    v_alert.id::text,
    jsonb_build_object(
      'source', 'tgc_worker',
      'eventType', v_alert.event_type,
      'state', v_alert.worker_state,
      'attempts', v_alert.attempts
    )
  );

  return true;
end;
$$;

create or replace function public.careon_retry_operation_alert(
  p_alert_id uuid,
  p_lock_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_updated uuid;
begin
  if p_alert_id is null or p_lock_token is null or p_error_code is null
    or p_error_code not in ('timeout', 'network', 'http_4xx', 'http_5xx', 'unexpected_status') then
    raise exception 'invalid retry metadata' using errcode = '22023';
  end if;

  update public.careon_operations_alert_outbox item
  set status = 'pending',
      lock_token = null,
      locked_at = null,
      next_attempt_at = v_now + case
        when item.attempts <= 1 then interval '1 minute'
        when item.attempts = 2 then interval '5 minutes'
        when item.attempts = 3 then interval '15 minutes'
        when item.attempts = 4 then interval '1 hour'
        else interval '6 hours'
      end,
      last_error_code = p_error_code,
      updated_at = v_now
  where item.id = p_alert_id
    and item.status = 'sending'
    and item.lock_token = p_lock_token
  returning item.id into v_updated;

  return v_updated is not null;
end;
$$;

create or replace function public.careon_operation_alert_queue_status()
returns jsonb
language sql
security invoker
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'outstanding', count(*) filter (where status in ('pending', 'sending')),
    'due', count(*) filter (
      where (status = 'pending' and next_attempt_at <= statement_timestamp())
         or (status = 'sending' and locked_at < statement_timestamp() - interval '10 minutes')
    )
  )
  from public.careon_operations_alert_outbox;
$$;

revoke all on function public.careon_record_tgc_worker_transition(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.careon_claim_operation_alert(uuid)
  from public, anon, authenticated;
revoke all on function public.careon_complete_operation_alert(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.careon_retry_operation_alert(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.careon_operation_alert_queue_status()
  from public, anon, authenticated;

grant execute on function public.careon_record_tgc_worker_transition(uuid, text, text) to service_role;
grant execute on function public.careon_claim_operation_alert(uuid) to service_role;
grant execute on function public.careon_complete_operation_alert(uuid, uuid) to service_role;
grant execute on function public.careon_retry_operation_alert(uuid, uuid, text) to service_role;
grant execute on function public.careon_operation_alert_queue_status() to service_role;
