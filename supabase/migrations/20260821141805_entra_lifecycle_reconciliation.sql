-- G01-C / G15: fail-closed Entra eligibility reconciliation and offboarding.
--
-- The table is intentionally service-only. It records only lifecycle metadata
-- needed to prove that an ordinary Careon member was previously observed as
-- eligible. A successful Graph read is required before the snapshot RPC can
-- increment absence counters; transient Graph failures therefore never block
-- anybody. Platform administrators and organization administrators are always
-- marked exempt from automatic lifecycle actions.

create table public.careon_entra_lifecycle (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  entra_object_id uuid not null,
  careon_user_id uuid references auth.users (id) on delete set null,
  email text not null,
  user_type text not null check (user_type in ('Member', 'Guest', 'Unknown')),
  account_enabled boolean,
  eligible boolean not null default false,
  management_state text not null default 'observing'
    check (management_state in ('observing', 'managed', 'exempt')),
  first_seen_at timestamptz not null default now(),
  last_seen_eligible_at timestamptz,
  last_reconciled_at timestamptz not null default now(),
  missing_runs integer not null default 0 check (missing_runs between 0 and 1000000),
  offboarded_at timestamptz,
  offboard_reason text check (offboard_reason is null or char_length(offboard_reason) <= 80),
  last_action_at timestamptz,
  last_action_error text check (last_action_error is null or char_length(last_action_error) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint careon_entra_lifecycle_org_object_unique unique (org_id, entra_object_id),
  constraint careon_entra_lifecycle_email_format check (
    char_length(email) between 3 and 320
    and email = lower(trim(email))
    and email like '%@%'
  )
);

create unique index careon_entra_lifecycle_org_user_unique
  on public.careon_entra_lifecycle (org_id, careon_user_id)
  where careon_user_id is not null;
create index careon_entra_lifecycle_candidates_idx
  on public.careon_entra_lifecycle (org_id, management_state, offboarded_at, missing_runs);

alter table public.careon_entra_lifecycle enable row level security;
alter table public.careon_entra_lifecycle force row level security;
revoke all on table public.careon_entra_lifecycle from public, anon, authenticated;
grant select, insert, update on table public.careon_entra_lifecycle to service_role;

comment on table public.careon_entra_lifecycle is
  'Service-only Entra eligibility observations and Careon/YAAZ offboarding state; never an application role source.';

create or replace function public.careon_reconcile_entra_snapshot(
  p_org_slug text,
  p_snapshot jsonb,
  p_missing_threshold integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_run_at timestamptz := clock_timestamp();
  v_item jsonb;
  v_entra_object_id uuid;
  v_email text;
  v_user_type text;
  v_account_enabled boolean;
  v_eligible boolean;
  v_careon_user_id uuid;
  v_org_role text;
  v_management_state text;
  v_seen_ids uuid[] := array[]::uuid[];
  v_offboard jsonb := '[]'::jsonb;
  v_reactivate jsonb := '[]'::jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_org_slug is null or p_org_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$'
    or p_missing_threshold is null
    or p_missing_threshold not between 2 and 24
    or p_snapshot is null
    or jsonb_typeof(p_snapshot) <> 'array'
    or jsonb_array_length(p_snapshot) > 1000
  then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  select o.id into v_org_id
  from public.organizations o
  where o.slug = p_org_slug
  limit 1;
  if v_org_id is null then
    return jsonb_build_object('status', 'organization_not_found');
  end if;

  -- Prevent overlapping cron/manual runs for the same organization. The lock
  -- is transaction-scoped, so it is always released on commit or rollback.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('careon_entra_lifecycle:' || v_org_id::text, 0)
  );

  for v_item in select value from jsonb_array_elements(p_snapshot)
  loop
    begin
      v_entra_object_id := nullif(trim(v_item ->> 'entraObjectId'), '')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('status', 'invalid_input');
    end;
    v_email := lower(trim(coalesce(v_item ->> 'email', '')));
    v_user_type := coalesce(nullif(trim(v_item ->> 'userType'), ''), 'Unknown');
    if jsonb_typeof(v_item -> 'accountEnabled') = 'boolean' then
      v_account_enabled := (v_item ->> 'accountEnabled')::boolean;
    elsif v_item -> 'accountEnabled' = 'null'::jsonb or not (v_item ? 'accountEnabled') then
      v_account_enabled := null;
    else
      return jsonb_build_object('status', 'invalid_input');
    end if;
    if jsonb_typeof(v_item -> 'eligible') <> 'boolean' then
      return jsonb_build_object('status', 'invalid_input');
    end if;
    v_eligible := (v_item ->> 'eligible')::boolean;

    if v_entra_object_id is null
      or v_entra_object_id = any(v_seen_ids)
      or char_length(v_email) not between 3 and 320
      or v_email not like '%@%'
      or v_user_type not in ('Member', 'Guest', 'Unknown')
    then
      return jsonb_build_object('status', 'invalid_input');
    end if;
    v_seen_ids := array_append(v_seen_ids, v_entra_object_id);

    select u.id into v_careon_user_id
    from auth.users u
    where lower(trim(u.email)) = v_email
    order by u.created_at
    limit 1;

    v_org_role := null;
    if v_careon_user_id is not null then
      select om.role into v_org_role
      from public.organization_members om
      where om.org_id = v_org_id and om.user_id = v_careon_user_id;
    end if;

    v_management_state := case
      when v_careon_user_id is not null and (
        v_org_role = 'org_admin'
        or exists (
          select 1 from public.platform_admins pa where pa.user_id = v_careon_user_id
        )
      ) then 'exempt'
      when v_careon_user_id is not null and v_org_role = 'member' then 'managed'
      else 'observing'
    end;

    insert into public.careon_entra_lifecycle (
      org_id,
      entra_object_id,
      careon_user_id,
      email,
      user_type,
      account_enabled,
      eligible,
      management_state,
      last_seen_eligible_at,
      last_reconciled_at,
      missing_runs,
      updated_at
    ) values (
      v_org_id,
      v_entra_object_id,
      v_careon_user_id,
      v_email,
      v_user_type,
      v_account_enabled,
      v_eligible,
      v_management_state,
      case when v_eligible then v_run_at else null end,
      v_run_at,
      case when v_eligible and v_account_enabled is true and v_user_type = 'Member' then 0 else 1 end,
      v_run_at
    )
    on conflict (org_id, entra_object_id) do update set
      careon_user_id = coalesce(excluded.careon_user_id, careon_entra_lifecycle.careon_user_id),
      email = excluded.email,
      user_type = excluded.user_type,
      account_enabled = excluded.account_enabled,
      eligible = excluded.eligible,
      management_state = excluded.management_state,
      last_seen_eligible_at = case
        when excluded.eligible then v_run_at
        else careon_entra_lifecycle.last_seen_eligible_at
      end,
      last_reconciled_at = v_run_at,
      missing_runs = case
        when excluded.eligible and excluded.account_enabled is true and excluded.user_type = 'Member' then 0
        else least(careon_entra_lifecycle.missing_runs + 1, 1000000)
      end,
      updated_at = v_run_at;
  end loop;

  -- Objects deleted from the tenant are absent from the full inventory. They
  -- use the same consecutive-success threshold as a removed app-role.
  update public.careon_entra_lifecycle cel
  set eligible = false,
      account_enabled = null,
      missing_runs = least(cel.missing_runs + 1, 1000000),
      last_reconciled_at = v_run_at,
      updated_at = v_run_at
  where cel.org_id = v_org_id
    and cel.last_reconciled_at <> v_run_at;

  select coalesce(jsonb_agg(jsonb_build_object(
    'entraObjectId', cel.entra_object_id,
    'careonUserId', cel.careon_user_id,
    'email', cel.email,
    'reason', case
      when cel.account_enabled is false then 'account_disabled'
      when cel.user_type <> 'Member' then 'not_tenant_member'
      else 'eligibility_removed'
    end
  ) order by cel.email), '[]'::jsonb)
  into v_offboard
  from public.careon_entra_lifecycle cel
  where cel.org_id = v_org_id
    and cel.management_state = 'managed'
    and cel.careon_user_id is not null
    and cel.offboarded_at is null
    and (
      cel.account_enabled is false
      or cel.user_type <> 'Member'
      or (not cel.eligible and cel.missing_runs >= p_missing_threshold)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'entraObjectId', cel.entra_object_id,
    'careonUserId', cel.careon_user_id,
    'email', cel.email,
    'reason', 'eligibility_restored'
  ) order by cel.email), '[]'::jsonb)
  into v_reactivate
  from public.careon_entra_lifecycle cel
  where cel.org_id = v_org_id
    and cel.management_state = 'managed'
    and cel.careon_user_id is not null
    and cel.offboarded_at is not null
    and cel.eligible
    and cel.account_enabled is true
    and cel.user_type = 'Member';

  return jsonb_build_object(
    'status', 'ready',
    'org_id', v_org_id,
    'observed', jsonb_array_length(p_snapshot),
    'offboard', v_offboard,
    'reactivate', v_reactivate,
    'run_at', v_run_at
  );
end;
$$;

create or replace function public.careon_finalize_entra_lifecycle_action(
  p_org_slug text,
  p_entra_object_id uuid,
  p_action text,
  p_success boolean,
  p_reason text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_row public.careon_entra_lifecycle%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_org_slug is null or p_org_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$'
    or p_entra_object_id is null
    or p_action is null
    or p_action not in ('offboard', 'reactivate')
    or p_success is null
    or char_length(coalesce(p_reason, '')) > 80
    or char_length(coalesce(p_error, '')) > 240
  then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  select o.id into v_org_id from public.organizations o where o.slug = p_org_slug limit 1;
  if v_org_id is null then
    return jsonb_build_object('status', 'organization_not_found');
  end if;

  select * into v_row
  from public.careon_entra_lifecycle cel
  where cel.org_id = v_org_id and cel.entra_object_id = p_entra_object_id
  for update;
  if v_row.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_row.management_state <> 'managed' then
    return jsonb_build_object('status', 'exempt');
  end if;

  update public.careon_entra_lifecycle cel
  set offboarded_at = case
        when p_success and p_action = 'offboard' then v_now
        when p_success and p_action = 'reactivate' then null
        else cel.offboarded_at
      end,
      offboard_reason = case
        when p_success and p_action = 'offboard' then nullif(trim(p_reason), '')
        when p_success and p_action = 'reactivate' then null
        else cel.offboard_reason
      end,
      missing_runs = case when p_success and p_action = 'reactivate' then 0 else cel.missing_runs end,
      last_action_at = v_now,
      last_action_error = case when p_success then null else nullif(left(trim(coalesce(p_error, 'failed')), 240), '') end,
      updated_at = v_now
  where cel.id = v_row.id;

  if p_success then
    insert into public.audit_events (org_id, user_id, action, resource, resource_id, detail)
    values (
      v_org_id,
      v_row.careon_user_id,
      case when p_action = 'offboard' then 'org.user.entra_offboard' else 'org.user.entra_reactivate' end,
      'careon_entra_lifecycle',
      p_entra_object_id::text,
      jsonb_build_object(
        'email', v_row.email,
        'reason', coalesce(nullif(trim(p_reason), ''), p_action),
        'careon_user_id', v_row.careon_user_id
      )
    );
  end if;

  return jsonb_build_object('status', case when p_success then 'completed' else 'retry_pending' end);
end;
$$;

revoke all on function public.careon_reconcile_entra_snapshot(text, jsonb, integer) from public;
revoke all on function public.careon_reconcile_entra_snapshot(text, jsonb, integer) from anon, authenticated;
grant execute on function public.careon_reconcile_entra_snapshot(text, jsonb, integer) to service_role;

revoke all on function public.careon_finalize_entra_lifecycle_action(text, uuid, text, boolean, text, text) from public;
revoke all on function public.careon_finalize_entra_lifecycle_action(text, uuid, text, boolean, text, text)
  from anon, authenticated;
grant execute on function public.careon_finalize_entra_lifecycle_action(text, uuid, text, boolean, text, text)
  to service_role;

comment on function public.careon_reconcile_entra_snapshot(text, jsonb, integer) is
  'Service-only full-directory reconciliation; returns bounded offboard/reactivate candidates after safe observations.';
comment on function public.careon_finalize_entra_lifecycle_action(text, uuid, text, boolean, text, text) is
  'Service-only lifecycle completion and audit marker after Careon Auth and YAAZ actions finish.';
