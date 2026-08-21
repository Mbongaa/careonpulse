-- G09 / D15: service-only mobile push-device registry.
--
-- Raw FCM registration tokens never enter this database. The application
-- stores an AES-256-GCM ciphertext plus a keyed SHA-256 digest used only for
-- deduplication. Normal users cannot inspect or mutate device rows, including
-- their own. The API authenticates the dedicated public shell client before
-- calling these service-role-only functions.

create table public.careon_mobile_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  installation_id uuid not null,
  platform text not null,
  token_hash text not null,
  token_ciphertext text not null,
  app_version text not null,
  locale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  constraint careon_mobile_push_devices_user_installation_key
    unique (user_id, installation_id),
  constraint careon_mobile_push_devices_platform_check
    check (platform in ('android', 'ios')),
  constraint careon_mobile_push_devices_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint careon_mobile_push_devices_ciphertext_check
    check (
      char_length(token_ciphertext) between 80 and 6144
      and token_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    ),
  constraint careon_mobile_push_devices_version_check
    check (app_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  constraint careon_mobile_push_devices_locale_check
    check (locale is null or locale ~ '^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,2}$'),
  constraint careon_mobile_push_devices_revocation_check
    check (
      (revoked_at is null and revoked_reason is null)
      or (revoked_at is not null and revoked_reason in ('sign_out', 'rotated', 'reassigned', 'offboarded', 'invalid'))
    )
);

create unique index careon_mobile_push_devices_active_token_idx
  on public.careon_mobile_push_devices (token_hash)
  where revoked_at is null;
create index careon_mobile_push_devices_user_fk_idx
  on public.careon_mobile_push_devices (user_id);
create index careon_mobile_push_devices_org_fk_idx
  on public.careon_mobile_push_devices (org_id);
create index careon_mobile_push_devices_active_delivery_idx
  on public.careon_mobile_push_devices (org_id, user_id, last_seen_at desc)
  where revoked_at is null;

alter table public.careon_mobile_push_devices enable row level security;
alter table public.careon_mobile_push_devices force row level security;
revoke all on table public.careon_mobile_push_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.careon_mobile_push_devices to service_role;

comment on table public.careon_mobile_push_devices is
  'Service-only encrypted FCM registration-token registry for the native Careon shell.';

create or replace function public.careon_register_mobile_push_device(
  p_user_id uuid,
  p_org_id uuid,
  p_installation_id uuid,
  p_platform text,
  p_token_hash text,
  p_token_ciphertext text,
  p_app_version text,
  p_locale text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_device_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_user_id is null
    or p_org_id is null
    or p_installation_id is null
    or p_platform not in ('android', 'ios')
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_token_ciphertext is null
    or char_length(p_token_ciphertext) not between 80 and 6144
    or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    or p_app_version is null
    or p_app_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
    or (p_locale is not null and p_locale !~ '^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,2}$')
  then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  if not exists (
    select 1
    from auth.users u
    join public.organization_members om on om.user_id = u.id
    where u.id = p_user_id
      and om.org_id = p_org_id
      and (u.banned_until is null or u.banned_until <= v_now)
  ) then
    return jsonb_build_object('status', 'membership_missing');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('careon_push_installation:' || p_installation_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('careon_push_token:' || p_token_hash, 0)
  );

  -- A rotated/reassigned FCM token can never remain active for the previous
  -- installation or account. This prevents cross-account notification drift.
  update public.careon_mobile_push_devices d
  set revoked_at = v_now,
      revoked_reason = case
        when d.installation_id = p_installation_id then 'reassigned'
        else 'rotated'
      end,
      updated_at = v_now
  where d.revoked_at is null
    and (d.installation_id = p_installation_id or d.token_hash = p_token_hash)
    and not (
      d.user_id = p_user_id
      and d.org_id = p_org_id
      and d.installation_id = p_installation_id
    );

  insert into public.careon_mobile_push_devices (
    user_id,
    org_id,
    installation_id,
    platform,
    token_hash,
    token_ciphertext,
    app_version,
    locale,
    created_at,
    updated_at,
    last_seen_at,
    revoked_at,
    revoked_reason
  ) values (
    p_user_id,
    p_org_id,
    p_installation_id,
    p_platform,
    p_token_hash,
    p_token_ciphertext,
    p_app_version,
    p_locale,
    v_now,
    v_now,
    v_now,
    null,
    null
  )
  on conflict on constraint careon_mobile_push_devices_user_installation_key
  do update set
    org_id = excluded.org_id,
    platform = excluded.platform,
    token_hash = excluded.token_hash,
    token_ciphertext = excluded.token_ciphertext,
    app_version = excluded.app_version,
    locale = excluded.locale,
    updated_at = excluded.updated_at,
    last_seen_at = excluded.last_seen_at,
    revoked_at = null,
    revoked_reason = null
  returning id into v_device_id;

  return jsonb_build_object('status', 'registered', 'device_id', v_device_id);
end;
$$;

create or replace function public.careon_unregister_mobile_push_device(
  p_user_id uuid,
  p_org_id uuid,
  p_installation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_org_id is null or p_installation_id is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  update public.careon_mobile_push_devices d
  set revoked_at = clock_timestamp(),
      revoked_reason = 'sign_out',
      updated_at = clock_timestamp()
  where d.user_id = p_user_id
    and d.org_id = p_org_id
    and d.installation_id = p_installation_id
    and d.revoked_at is null;
  get diagnostics v_count = row_count;

  return jsonb_build_object('status', 'unregistered', 'count', v_count);
end;
$$;

create or replace function public.careon_revoke_mobile_push_devices_for_user(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_user_id is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  update public.careon_mobile_push_devices d
  set revoked_at = clock_timestamp(),
      revoked_reason = 'offboarded',
      updated_at = clock_timestamp()
  where d.user_id = p_user_id and d.revoked_at is null;
  get diagnostics v_count = row_count;

  return jsonb_build_object('status', 'revoked', 'count', v_count);
end;
$$;

revoke all on function public.careon_register_mobile_push_device(uuid, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.careon_register_mobile_push_device(uuid, uuid, uuid, text, text, text, text, text)
  to service_role;
revoke all on function public.careon_unregister_mobile_push_device(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.careon_unregister_mobile_push_device(uuid, uuid, uuid)
  to service_role;
revoke all on function public.careon_revoke_mobile_push_devices_for_user(uuid)
  from public, anon, authenticated;
grant execute on function public.careon_revoke_mobile_push_devices_for_user(uuid)
  to service_role;

comment on function public.careon_register_mobile_push_device(uuid, uuid, uuid, text, text, text, text, text) is
  'Registers one encrypted FCM token for a current Careon organization member.';
comment on function public.careon_unregister_mobile_push_device(uuid, uuid, uuid) is
  'Revokes the current account binding for one native installation on sign-out.';
comment on function public.careon_revoke_mobile_push_devices_for_user(uuid) is
  'Revokes every native push target for one offboarded Careon user.';
