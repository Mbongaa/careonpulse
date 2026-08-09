-- 0019_careon_access_token_hook.sql
-- Careon Pulse — rolclaim in access tokens (blueprint §4; identity-spike correctie #5).
--
-- GoTrue draait deze hook bij ELKE tokenuitgifte van dit project: dashboard-sessies
-- én de OAuth 2.1-serverclients (YAAZ/HumHub, straks de shell). De hook voegt één
-- genamespacede claim toe aan het ACCESS token (id-tokens zijn een gesloten struct):
--
--   "careon": { "org_id": uuid|null, "org_slug": text|null,
--               "org_role": "org_admin"|"member"|null, "superadmin": boolean }
--
-- Semantiek spiegelt src/lib/supabase/session.server.ts: het vroegste
-- organisatielidmaatschap wint (met org_id als deterministische tiebreak);
-- superadmin = rij in platform_admins. Rollen blijven NIET in user_metadata
-- (zelf-schrijfbaar — privilege-escalatie) en NIET in app_metadata (geen tweede
-- bron naast de tabellen); deze hook leest de tabellen als single source of truth.
--
-- SECURITY DEFINER (eigenaar postgres, bypassrls) — bewust, na adversarial review:
-- als SECURITY INVOKER zou de hook door RLS heen lezen en zou een ooit gedropte
-- policy geluidloos nul rijen opleveren ⇒ een gezaghebbend-ogende maar ONJUISTE
-- claim ("superadmin": false voor een echte superadmin). Met definer bestaat die
-- faalklasse niet en zijn er géén policies/table-grants voor supabase_auth_admin
-- nodig (kleinere blast radius). Zelfde patroon als app.is_superadmin() in 0009.
--
-- FAALVEILIG, in twee lagen (adversarial review, empirisch geverifieerd):
--  1. lock_timeout '200ms' op de functie: GoTrue wikkelt de hook-aanroep in
--     `set local statement_timeout` (2s) en PL/pgSQL's WHEN OTHERS vangt
--     query_canceled (57014) NIET — een lock-wait op deze tabellen (elke latere
--     DDL-migratie!) zou anders de volledige tokenuitgifte laten falen. Met
--     lock_timeout faalt de wait als 55P03 (lock_not_available), en dát is wél
--     vangbaar → token zonder careon-claim i.p.v. login-outage.
--  2. Expliciete query_canceled-arm + WHEN OTHERS: altijd het event ongewijzigd
--     teruggeven, met RAISE LOG voor observability.
--
-- Activering staat buiten deze migratie (Management API):
--   hook_custom_access_token_enabled = true
--   hook_custom_access_token_uri = pg-functions://postgres/public/custom_access_token_hook

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '200ms'
as $$
declare
  claims jsonb;
  uid uuid;
  v_org_id uuid;
  v_org_slug text;
  v_org_role text;
  v_superadmin boolean := false;
begin
  -- Geen (object-)claims in het event ⇒ niets fabriceren, event onaangeroerd terug.
  if event is null
     or event->'claims' is null
     or jsonb_typeof(event->'claims') <> 'object' then
    return event;
  end if;
  claims := event->'claims';

  uid := nullif(event->>'user_id', '')::uuid;
  if uid is null then
    return event;
  end if;

  select om.org_id, o.slug, om.role
    into v_org_id, v_org_slug, v_org_role
    from public.organization_members om
    join public.organizations o on o.id = om.org_id
   where om.user_id = uid
   order by om.created_at, om.org_id
   limit 1;

  select exists (select 1 from public.platform_admins pa where pa.user_id = uid)
    into v_superadmin;

  return jsonb_set(event, '{claims}', jsonb_set(claims, '{careon}', jsonb_build_object(
    'org_id', v_org_id,
    'org_slug', v_org_slug,
    'org_role', v_org_role,
    'superadmin', v_superadmin
  )));
exception
  when query_canceled then
    raise log 'careon access token hook: query_canceled — claim overgeslagen voor user %', uid;
    return event;
  when others then
    raise log 'careon access token hook: % (%) — claim overgeslagen voor user %', sqlerrm, sqlstate, uid;
    return event;
end;
$$;

alter function public.custom_access_token_hook(jsonb) owner to postgres;

-- Alleen GoTrue mag deze functie aanroepen. service_role expliciet erbij:
-- default privileges op public geven functies anders EXECUTE aan alle API-rollen,
-- en met SECURITY DEFINER zou EXECUTE rolinformatie over willekeurige uids lekken.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb)
  from authenticated, anon, service_role, public;
