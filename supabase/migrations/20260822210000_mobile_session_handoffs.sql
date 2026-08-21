-- G09 / D14: short-lived, single-use native-shell -> WebView session handoff.
--
-- Only a SHA-256 digest of the random capability is stored. The raw value is
-- returned once to the native shell and is never placed in a URL. Mint and
-- consume are service-role-only functions; normal users cannot inspect or
-- mutate the capability table, even for their own rows.

create table public.careon_mobile_handoffs (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  module_id text not null,
  target_url text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint careon_mobile_handoffs_token_hash_format check (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint careon_mobile_handoffs_module_id_format check (
    module_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'
  ),
  constraint careon_mobile_handoffs_target_url_format check (
    char_length(target_url) between 9 and 2048
    and target_url ~ '^https://'
  ),
  constraint careon_mobile_handoffs_expiry_window check (
    expires_at > created_at
    and expires_at <= created_at + interval '2 minutes'
  ),
  constraint careon_mobile_handoffs_consumed_after_creation check (
    consumed_at is null or consumed_at >= created_at
  )
);

create index careon_mobile_handoffs_user_fk_idx
  on public.careon_mobile_handoffs (user_id);
create index careon_mobile_handoffs_org_fk_idx
  on public.careon_mobile_handoffs (org_id);
create index careon_mobile_handoffs_expiry_idx
  on public.careon_mobile_handoffs (expires_at);
create index careon_mobile_handoffs_active_user_idx
  on public.careon_mobile_handoffs (user_id, expires_at)
  where consumed_at is null;

alter table public.careon_mobile_handoffs enable row level security;
alter table public.careon_mobile_handoffs force row level security;
revoke all on table public.careon_mobile_handoffs from public, anon, authenticated;
grant select, insert, update, delete on table public.careon_mobile_handoffs to service_role;

comment on table public.careon_mobile_handoffs is
  'Service-only hash ledger for 60-second, single-use native shell session handoffs.';

create or replace function public.careon_create_mobile_handoff(
  p_token_hash text,
  p_user_id uuid,
  p_org_id uuid,
  p_module_id text,
  p_target_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_user_id is null
    or p_org_id is null
    or p_module_id is null or p_module_id !~ '^[a-z0-9][a-z0-9-]{0,79}$'
    or p_target_url is null
    or char_length(p_target_url) not between 9 and 2048
    or p_target_url !~ '^https://'
  then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  if not exists (
    select 1
    from public.organization_members om
    where om.user_id = p_user_id and om.org_id = p_org_id
  ) then
    return jsonb_build_object('status', 'membership_missing');
  end if;

  -- One active capability per user keeps replay surface bounded. The advisory
  -- lock makes simultaneous opens deterministic without holding a row lock
  -- across any external request.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('careon_mobile_handoff:' || p_user_id::text, 0)
  );
  delete from public.careon_mobile_handoffs h
  where h.expires_at < v_now - interval '1 day'
     or (h.user_id = p_user_id and h.consumed_at is null);

  v_expires_at := v_now + interval '60 seconds';
  insert into public.careon_mobile_handoffs (
    token_hash,
    user_id,
    org_id,
    module_id,
    target_url,
    created_at,
    expires_at
  ) values (
    p_token_hash,
    p_user_id,
    p_org_id,
    p_module_id,
    p_target_url,
    v_now,
    v_expires_at
  );

  return jsonb_build_object('status', 'created', 'expires_at', v_expires_at);
end;
$$;

create or replace function public.careon_consume_mobile_handoff(p_token_hash text)
returns table (
  user_id uuid,
  org_id uuid,
  module_id text,
  target_url text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  return query
  update public.careon_mobile_handoffs h
  set consumed_at = clock_timestamp()
  where h.token_hash = p_token_hash
    and h.consumed_at is null
    and h.expires_at > clock_timestamp()
  returning h.user_id, h.org_id, h.module_id, h.target_url;
end;
$$;

revoke all on function public.careon_create_mobile_handoff(text, uuid, uuid, text, text) from public;
revoke all on function public.careon_create_mobile_handoff(text, uuid, uuid, text, text)
  from anon, authenticated;
grant execute on function public.careon_create_mobile_handoff(text, uuid, uuid, text, text)
  to service_role;

revoke all on function public.careon_consume_mobile_handoff(text) from public;
revoke all on function public.careon_consume_mobile_handoff(text) from anon, authenticated;
grant execute on function public.careon_consume_mobile_handoff(text) to service_role;

comment on function public.careon_create_mobile_handoff(text, uuid, uuid, text, text) is
  'Creates one 60-second hash-only module capability for an exact organization member.';
comment on function public.careon_consume_mobile_handoff(text) is
  'Atomically consumes one unexpired mobile handoff; concurrent/replayed requests return no row.';
