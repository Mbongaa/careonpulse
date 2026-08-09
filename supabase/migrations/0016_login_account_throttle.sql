-- Careon Pulse — rate-limit-scope per doelaccount (audit 2026-07-29).
--
-- Waarom: migratie 0013 remt inlogpogingen per gehasht bezoekers-IP. Dat stopt
-- één bron, maar een gespreide aanval op één bekend account (botnet, wisselende
-- mobiele IP's) passeert die rem volledig — er bestond geen enkel plafond per
-- account. Deze migratie voegt daarvoor de scope 'login_account' toe; de
-- actor-hash is een gezouten HMAC van het opgegeven e-mailadres, zodat het
-- adres zelf nergens in de limietopslag terechtkomt.
--
-- De drempels staan in de route (src/app/api/auth/login/route.ts) en zijn
-- bewust ruim: een harde accountvergrendeling is zelf een DoS-middel.
--
-- Volgorde: pas deze migratie toe VOORDAT de bijbehorende code live gaat. De
-- route degradeert open zolang de scope nog niet bestaat (de IP-rem blijft dan
-- de enige laag), zodat een verkeerde volgorde geen inlogstoring veroorzaakt.

alter table public.careon_assistant_rate_limits
  drop constraint if exists careon_assistant_rate_limits_scope_valid;
alter table public.careon_assistant_rate_limits
  add constraint careon_assistant_rate_limits_scope_valid
    check (scope in ('assistant', 'audit', 'login', 'login_account'));

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
  if p_scope not in ('assistant', 'audit', 'login', 'login_account')
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
