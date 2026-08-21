-- G01-A: group/app-role-gated Entra just-in-time membership.
--
-- The normal browser session deliberately has no write access to
-- organization_members. This narrowly exposed RPC is callable only with the
-- server-side service role and independently verifies the Azure identity in
-- auth.identities before it creates the least-privileged `member` row.
--
-- IMPORTANT: deploying this function does not enable JIT. The application
-- remains fail-closed until CAREON_ENTRA_JIT_ENABLED=1 and every required
-- server-side setting is present.

create or replace function public.careon_provision_entra_member(
  p_user_id uuid,
  p_org_slug text,
  p_tenant_id text,
  p_required_app_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_email text;
  v_full_name text;
  v_identity jsonb;
  v_custom_claims jsonb;
  v_claim_email text;
  v_claim_tenant text;
  v_account_type text;
  v_claim_verified boolean := false;
  v_roles jsonb;
  v_has_role boolean := false;
  v_created boolean := false;
begin
  -- Defense in depth alongside REVOKE/GRANT below. PostgREST places the JWT
  -- role in this setting; direct authenticated/anon calls must never cross
  -- this boundary even if a future grant is changed accidentally.
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  if p_user_id is null
    or p_org_slug is null
    or p_org_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$'
    or p_tenant_id is null
    or p_tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_required_app_role is null
    or char_length(p_required_app_role) not between 1 and 120
  then
    return jsonb_build_object('status', 'invalid_configuration');
  end if;

  select o.id
  into v_org_id
  from public.organizations o
  where o.slug = p_org_slug
  limit 1;

  if v_org_id is null then
    return jsonb_build_object('status', 'organization_not_found');
  end if;

  -- Fast idempotent path for a concurrent callback that already completed.
  if exists (
    select 1
    from public.organization_members om
    where om.org_id = v_org_id
      and om.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'existing', 'org_id', v_org_id);
  end if;

  -- One account must not silently acquire a second customer context. The
  -- current session model intentionally selects one membership.
  if exists (
    select 1
    from public.organization_members om
    where om.user_id = p_user_id
      and om.org_id <> v_org_id
  ) then
    return jsonb_build_object('status', 'existing_other_organization');
  end if;

  select lower(trim(u.email)),
         coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), '')
  into v_email, v_full_name
  from auth.users u
  where u.id = p_user_id
    and u.email_confirmed_at is not null;

  if v_email is null then
    return jsonb_build_object('status', 'user_not_verified');
  end if;

  select i.identity_data
  into v_identity
  from auth.identities i
  where i.user_id = p_user_id
    and i.provider = 'azure'
  order by i.created_at desc
  limit 1;

  if v_identity is null then
    return jsonb_build_object('status', 'azure_identity_missing');
  end if;

  v_custom_claims := case
    when jsonb_typeof(v_identity -> 'custom_claims') = 'object'
      then v_identity -> 'custom_claims'
    else '{}'::jsonb
  end;
  v_claim_tenant := lower(trim(coalesce(v_custom_claims ->> 'tid', v_identity ->> 'tid', '')));
  v_account_type := trim(coalesce(v_custom_claims ->> 'acct', v_identity ->> 'acct', ''));
  v_claim_email := lower(trim(coalesce(
    v_identity ->> 'email',
    v_custom_claims ->> 'email',
    v_identity ->> 'preferred_username',
    ''
  )));
  v_claim_verified := lower(coalesce(
    v_custom_claims ->> 'xms_edov',
    v_identity ->> 'xms_edov',
    'false'
  )) in ('true', '1');

  if v_claim_tenant <> lower(p_tenant_id) then
    return jsonb_build_object('status', 'tenant_mismatch');
  end if;
  if v_account_type <> '0' then
    return jsonb_build_object('status', 'guest_or_account_type_unverified');
  end if;
  if not v_claim_verified then
    return jsonb_build_object('status', 'email_not_verified');
  end if;
  if v_claim_email = '' or v_claim_email <> v_email then
    return jsonb_build_object('status', 'email_mismatch');
  end if;

  v_roles := coalesce(v_custom_claims -> 'roles', v_identity -> 'roles', '[]'::jsonb);
  if jsonb_typeof(v_roles) = 'array' then
    select exists (
      select 1
      from jsonb_array_elements_text(v_roles) role_name
      where role_name = p_required_app_role
    ) into v_has_role;
  elsif jsonb_typeof(v_roles) = 'string' then
    v_has_role := trim(both '"' from v_roles::text) = p_required_app_role;
  end if;

  if not v_has_role then
    return jsonb_build_object('status', 'required_app_role_missing');
  end if;

  -- The auth-user trigger normally created this row already. The upsert makes
  -- JIT self-healing if an older/imported identity predates that trigger.
  insert into public.profiles (id, full_name)
  values (p_user_id, v_full_name)
  on conflict (id) do nothing;

  insert into public.organization_members (org_id, user_id, role)
  values (v_org_id, p_user_id, 'member')
  on conflict (org_id, user_id) do nothing
  returning true into v_created;

  if coalesce(v_created, false) then
    insert into public.audit_events (org_id, user_id, action, resource, resource_id, detail)
    values (
      v_org_id,
      p_user_id,
      'org.user.jit_provision',
      'organization_members',
      p_user_id::text,
      jsonb_build_object(
        'provider', 'azure',
        'role', 'member',
        'tenant_id', lower(p_tenant_id),
        'required_app_role', p_required_app_role
      )
    );
  end if;

  return jsonb_build_object(
    'status', case when coalesce(v_created, false) then 'created' else 'existing' end,
    'org_id', v_org_id
  );
end;
$$;

revoke all on function public.careon_provision_entra_member(uuid, text, text, text) from public;
revoke all on function public.careon_provision_entra_member(uuid, text, text, text) from anon, authenticated;
grant execute on function public.careon_provision_entra_member(uuid, text, text, text) to service_role;

comment on function public.careon_provision_entra_member(uuid, text, text, text) is
  'G01-A: service-role-only, app-role-gated Entra JIT provisioning as ordinary organization member.';
