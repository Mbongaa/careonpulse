-- Careon Pulse — facturatie fase B: e-mailverzending (handoff 15 §7 fase B).
--
-- Twee onderdelen:
--
-- 1. `careon_facturatie_maillog`: één rij per verzendpoging (ontvanger,
--    onderwerp, status incl. bounce, provider-id, foutvelden, pogingnummer).
--    Het log hoort bij de factuuradministratie (bewijs van uitreiking per
--    e-mail) en valt daarom — net als uitgereikte facturen — BUITEN elke
--    opschoonroutine. Lezen mag voor beheerders (zelfde rolpredicaat als de
--    overige facturatietabellen); schrijven gebeurt uitsluitend server-side
--    met de service-role ná `requireOrgAdmin()` — er bestaan bewust GEEN
--    insert/update/delete-policies voor `authenticated`, zodat een caller-JWT
--    nooit een verzendregistratie kan vervalsen.
--
-- 2. Quota-scope 'mail' voor `careon_consume_assistant_quota`: de RPC heeft
--    een gesloten allowlist in de CHECK-constraint ÉN in de functie zelf
--    (0016) — beide worden hier uitgebreid, anders faalt elke aanroep met
--    "invalid quota parameters". De drempels staan in de mailroute.
--
-- WAARSCHUWING (zelfde valkuil als 0015/0020): voeg nooit een kale
-- `app.is_org_member(org_id)`-selectpolicy toe naast deze policies —
-- permissieve policies worden ge-OR'd; één rolblinde policy neutraliseert de
-- hele beheerder-afscherming.
--
-- Volgorde: toepassen VÓÓR de code-deploy (PRODUCTION_MODE.md). De mailroute
-- degradeert gesloten (503 "niet geconfigureerd") zolang provider-sleutels
-- ontbreken; deze migratie maakt alleen het datamodel klaar.

-- ── 1. Maillog ──────────────────────────────────────────────────────────────

create table if not exists public.careon_facturatie_maillog (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  factuur_id uuid not null references public.careon_facturatie_facturen (id) on delete restrict,
  ontvanger text not null check (char_length(ontvanger) between 3 and 254 and position('@' in ontvanger) > 1),
  onderwerp text not null check (char_length(onderwerp) between 1 and 200),
  status text not null default 'in_wachtrij'
    check (status in ('in_wachtrij', 'verzonden', 'mislukt', 'gebounced')),
  provider_id text check (provider_id is null or char_length(provider_id) <= 200),
  fout_code text check (fout_code is null or char_length(fout_code) <= 100),
  fout_tekst text check (fout_tekst is null or char_length(fout_tekst) <= 500),
  poging integer not null default 1 check (poging between 1 and 1000),
  verzonden_door uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists careon_facturatie_maillog_factuur_idx
  on public.careon_facturatie_maillog (org_id, factuur_id, created_at desc);

alter table public.careon_facturatie_maillog enable row level security;

revoke all on table public.careon_facturatie_maillog from anon;
revoke insert, update, delete, truncate on table public.careon_facturatie_maillog from authenticated;
-- Expliciet (niet alleen via Supabase' default privileges): lezen mag, de
-- select-policy hieronder bepaalt wélke rijen.
grant select on table public.careon_facturatie_maillog to authenticated;

drop policy if exists careon_facturatie_maillog_select on public.careon_facturatie_maillog;
create policy careon_facturatie_maillog_select on public.careon_facturatie_maillog
  for select to authenticated
  using (app.mag_facturatie_zien(org_id));

-- ── 2. Quota-scope 'mail' ───────────────────────────────────────────────────

alter table public.careon_assistant_rate_limits
  drop constraint if exists careon_assistant_rate_limits_scope_valid;
alter table public.careon_assistant_rate_limits
  add constraint careon_assistant_rate_limits_scope_valid
    check (scope in ('assistant', 'audit', 'login', 'login_account', 'mail'));

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
  if p_scope not in ('assistant', 'audit', 'login', 'login_account', 'mail')
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

notify pgrst, 'reload schema';
