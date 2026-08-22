-- Careon Pulse — metadata-only Facturatie off-site backup monitoring.
--
-- The operator publishes only success/failure metadata. The Vercel monitor
-- derives healthy/stale/failed/unknown and uses the existing durable outbox.
-- No bucket name, object path, invoice field, backup key or credential enters
-- either table. All writes and reads remain service-role-only.

alter table public.careon_operations_alert_outbox
  add column source text not null default 'tgc_worker';

alter table public.careon_operations_alert_outbox
  drop constraint careon_operations_alert_outbox_worker_state_valid,
  drop constraint careon_operations_alert_outbox_previous_state_valid,
  drop constraint careon_operations_alert_outbox_age_bucket_valid,
  drop constraint careon_operations_alert_outbox_event_pair_valid;

alter table public.careon_operations_alert_outbox
  add constraint careon_operations_alert_outbox_source_valid
    check (source in ('tgc_worker', 'facturatie_backup')),
  add constraint careon_operations_alert_outbox_worker_state_valid
    check (
      (source = 'tgc_worker' and worker_state in ('available', 'offline', 'unknown'))
      or
      (source = 'facturatie_backup' and worker_state in ('healthy', 'failed', 'stale', 'unknown'))
    ),
  add constraint careon_operations_alert_outbox_previous_state_valid
    check (
      previous_state is null
      or (source = 'tgc_worker' and previous_state in ('available', 'offline', 'unknown'))
      or (source = 'facturatie_backup' and previous_state in ('healthy', 'failed', 'stale', 'unknown'))
    ),
  add constraint careon_operations_alert_outbox_age_bucket_valid
    check (
      age_bucket in (
        'under_2m', '2m_15m', '15m_1h', '1h_plus',
        '1h_24h', '24h_36h', '36h_plus', 'unknown'
      )
    ),
  add constraint careon_operations_alert_outbox_event_pair_valid
    check (
      (
        source = 'tgc_worker'
        and (
          (event_type = 'incident' and worker_state in ('offline', 'unknown'))
          or
          (event_type = 'recovery' and worker_state = 'available' and previous_state in ('offline', 'unknown'))
        )
      )
      or
      (
        source = 'facturatie_backup'
        and (
          (event_type = 'incident' and worker_state in ('failed', 'stale', 'unknown'))
          or
          (
            event_type = 'recovery'
            and worker_state = 'healthy'
            and previous_state in ('failed', 'stale', 'unknown')
          )
        )
      )
    );

create table public.careon_facturatie_backup_status (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  last_result text not null,
  last_attempt_at timestamptz not null,
  last_success_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now(),
  constraint careon_facturatie_backup_status_result_valid
    check (last_result in ('healthy', 'failed')),
  constraint careon_facturatie_backup_status_error_valid
    check (
      last_error_code is null
      or last_error_code in (
        'backup_failed', 'configuration', 'network', 'remote_verification', 'source_verification'
      )
    ),
  constraint careon_facturatie_backup_status_state_shape_valid
    check (
      (
        last_result = 'healthy'
        and last_error_code is null
        and last_success_at = last_attempt_at
      )
      or
      (
        last_result = 'failed'
        and last_error_code is not null
        and (last_success_at is null or last_success_at <= last_attempt_at)
      )
    ),
  constraint careon_facturatie_backup_status_time_valid
    check (
      last_attempt_at <= updated_at + interval '30 seconds'
      and (last_success_at is null or last_success_at <= updated_at + interval '30 seconds')
    )
);

alter table public.careon_facturatie_backup_status enable row level security;
alter table public.careon_facturatie_backup_status force row level security;

revoke all on table public.careon_facturatie_backup_status from public, anon, authenticated, service_role;
grant select, insert, update on table public.careon_facturatie_backup_status to service_role;

create or replace function public.careon_record_facturatie_backup_attempt(
  p_org_slug text,
  p_success boolean,
  p_error_code text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_now timestamptz := statement_timestamp();
begin
  if p_org_slug is null
    or p_org_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$'
    or p_success is null
    or (p_success and p_error_code is not null)
    or (
      not p_success
      and (
        p_error_code is null
        or p_error_code not in (
          'backup_failed', 'configuration', 'network', 'remote_verification', 'source_verification'
        )
      )
    ) then
    raise exception 'invalid backup attempt metadata' using errcode = '22023';
  end if;

  select org.id
  into v_org_id
  from public.organizations org
  where org.slug = p_org_slug;

  if v_org_id is null then
    raise exception 'backup organization not found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('careon_facturatie_backup_attempt:' || v_org_id::text, 0)
  );

  insert into public.careon_facturatie_backup_status (
    org_id,
    last_result,
    last_attempt_at,
    last_success_at,
    last_error_code,
    updated_at
  ) values (
    v_org_id,
    case when p_success then 'healthy' else 'failed' end,
    v_now,
    case when p_success then v_now else null end,
    case when p_success then null else p_error_code end,
    v_now
  )
  on conflict (org_id) do update
  set last_result = excluded.last_result,
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = case
        when excluded.last_result = 'healthy' then excluded.last_success_at
        else public.careon_facturatie_backup_status.last_success_at
      end,
      last_error_code = excluded.last_error_code,
      updated_at = excluded.updated_at;

  return jsonb_build_object('status', 'completed');
end;
$$;

create or replace function public.careon_record_operation_transition(
  p_org_id uuid,
  p_source text,
  p_state text,
  p_age_bucket text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_event public.audit_events%rowtype;
  v_resource text;
  v_action_prefix text;
  v_previous text;
  v_event_type text;
  v_alert_id uuid;
  v_changed boolean;
  v_alert_status text := 'not_alertable';
begin
  if p_org_id is null
    or p_source is null
    or p_source not in ('tgc_worker', 'facturatie_backup')
    or p_state is null
    or not (
      (p_source = 'tgc_worker' and p_state in ('available', 'offline', 'unknown'))
      or
      (p_source = 'facturatie_backup' and p_state in ('healthy', 'failed', 'stale', 'unknown'))
    )
    or p_age_bucket is null
    or p_age_bucket not in (
      'under_2m', '2m_15m', '15m_1h', '1h_plus',
      '1h_24h', '24h_36h', '36h_plus', 'unknown'
    ) then
    raise exception 'invalid operation transition metadata' using errcode = '22023';
  end if;

  if p_source = 'tgc_worker' then
    v_resource := 'careon_tgc_sync_workers';
    v_action_prefix := 'tgc_worker';
  else
    v_resource := 'careon_facturatie_backup_status';
    v_action_prefix := 'facturatie_backup';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('careon_operation_transition:' || p_source || ':' || p_org_id::text, 0)
  );

  select event.*
  into v_source_event
  from public.audit_events event
  where event.org_id = p_org_id
    and event.resource = v_resource
    and event.action = any (
      case p_source
        when 'tgc_worker' then array[
          'tgc_worker.available', 'tgc_worker.offline', 'tgc_worker.unknown'
        ]::text[]
        else array[
          'facturatie_backup.healthy', 'facturatie_backup.failed',
          'facturatie_backup.stale', 'facturatie_backup.unknown'
        ]::text[]
      end
    )
  order by event.created_at desc, event.id desc
  limit 1;

  v_previous := case
    when v_source_event.action like v_action_prefix || '.%'
      then substring(v_source_event.action from char_length(v_action_prefix) + 2)
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
      v_action_prefix || '.' || p_state,
      v_resource,
      jsonb_build_object(
        'source', p_source,
        'state', p_state,
        'previous', v_previous,
        'ageBucket', p_age_bucket
      )
    )
    returning * into v_source_event;
  end if;

  if v_source_event.id is null then
    return jsonb_build_object(
      'status', 'completed',
      'changed', false,
      'alertQueue', 'not_alertable'
    );
  end if;

  if coalesce(
      v_source_event.detail ->> 'source',
      case when p_source = 'tgc_worker' then 'tgc_worker' else null end
    ) is distinct from p_source
    or v_source_event.detail ->> 'state' is distinct from p_state
    or v_source_event.detail ->> 'ageBucket' is null
    or v_source_event.detail ->> 'ageBucket' not in (
      'under_2m', '2m_15m', '15m_1h', '1h_plus',
      '1h_24h', '24h_36h', '36h_plus', 'unknown'
    ) then
    raise exception 'stored operation transition metadata is invalid' using errcode = '22023';
  end if;

  v_previous := v_source_event.detail ->> 'previous';
  if not (
    v_previous is null
    or (p_source = 'tgc_worker' and v_previous in ('available', 'offline', 'unknown'))
    or (p_source = 'facturatie_backup' and v_previous in ('healthy', 'failed', 'stale', 'unknown'))
  ) then
    raise exception 'stored previous operation state is invalid' using errcode = '22023';
  end if;

  if (p_source = 'tgc_worker' and p_state in ('offline', 'unknown'))
    or (p_source = 'facturatie_backup' and p_state in ('failed', 'stale', 'unknown')) then
    v_event_type := 'incident';
  elsif (p_source = 'tgc_worker' and p_state = 'available' and v_previous in ('offline', 'unknown'))
    or (
      p_source = 'facturatie_backup'
      and p_state = 'healthy'
      and v_previous in ('failed', 'stale', 'unknown')
    ) then
    v_event_type := 'recovery';
  end if;

  if v_event_type is not null then
    insert into public.careon_operations_alert_outbox (
      org_id,
      source_event_id,
      source,
      event_type,
      worker_state,
      previous_state,
      age_bucket,
      observed_at
    ) values (
      p_org_id,
      v_source_event.id,
      p_source,
      v_event_type,
      p_state,
      v_previous,
      v_source_event.detail ->> 'ageBucket',
      v_source_event.created_at
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

create or replace function public.careon_record_tgc_worker_transition(
  p_org_id uuid,
  p_state text,
  p_age_bucket text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.careon_record_operation_transition(
    p_org_id,
    'tgc_worker',
    p_state,
    p_age_bucket
  );
$$;

create or replace function public.careon_record_facturatie_backup_transition(
  p_org_id uuid,
  p_state text,
  p_age_bucket text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.careon_record_operation_transition(
    p_org_id,
    'facturatie_backup',
    p_state,
    p_age_bucket
  );
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
      'source', v_alert.source,
      'eventType', v_alert.event_type,
      'state', v_alert.worker_state,
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
      'source', v_alert.source,
      'eventType', v_alert.event_type,
      'state', v_alert.worker_state,
      'attempts', v_alert.attempts
    )
  );

  return true;
end;
$$;

revoke all on function public.careon_record_facturatie_backup_attempt(text, boolean, text)
  from public, anon, authenticated;
revoke all on function public.careon_record_operation_transition(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.careon_record_facturatie_backup_transition(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.careon_record_facturatie_backup_attempt(text, boolean, text) to service_role;
grant execute on function public.careon_record_operation_transition(uuid, text, text, text) to service_role;
grant execute on function public.careon_record_facturatie_backup_transition(uuid, text, text) to service_role;
