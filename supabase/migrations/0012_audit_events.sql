-- Careon Pulse — algemeen audit-logboek (handoff 13, fase 4).
-- Vereist 0009–0011. Uitvoeren via de SQL-editor of de Management API.
--
-- Append-only logboek van betekenisvolle acties (inloggen, state-appends,
-- imports, chatverwijdering, alle beheeracties). Metadata-only: nooit
-- chat-inhoud of registratie-inhoud — de detail-kolom draagt tellingen en
-- id's. Schrijven en lezen loopt uitsluitend server-side via de service-role
-- (het beheerdashboard leest met expliciete superadmin-check in de route);
-- clients hebben geen enkele policy. De assistent houdt daarnaast zijn eigen
-- gedetailleerde careon_assistant_events; de beheer-UI toont beide.

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  resource text,
  resource_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_action_length check (char_length(action) between 1 and 80),
  constraint audit_events_resource_length check (resource is null or char_length(resource) <= 80),
  constraint audit_events_resource_id_length check (resource_id is null or char_length(resource_id) <= 120)
);

create index if not exists audit_events_created_idx on public.audit_events (created_at desc);
create index if not exists audit_events_org_created_idx on public.audit_events (org_id, created_at desc);
create index if not exists audit_events_user_created_idx on public.audit_events (user_id, created_at desc);
create index if not exists audit_events_action_created_idx on public.audit_events (action, created_at desc);

-- RLS aan zonder client-policies: uitsluitend service-role (huisstijl 0001+).
alter table public.audit_events enable row level security;
revoke all on table public.audit_events from anon, authenticated;
grant select, insert, delete on table public.audit_events to service_role;

-- ── Retentie: 12 maanden audit, geïntegreerd in de onderhoudsfunctie
--    (2-args-variant vervalt eerst i.v.m. PostgREST-overload-ambiguïteit) ────

drop function if exists public.careon_prune_runtime_data(integer, integer);

create or replace function public.careon_prune_runtime_data(
  p_event_retention_days integer default 90,
  p_chat_retention_days integer default 30,
  p_audit_retention_days integer default 365
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events integer;
  v_quotas integer;
  v_messages integer;
  v_threads integer;
  v_audit integer;
begin
  if p_event_retention_days < 7 or p_event_retention_days > 365 then
    raise exception 'retention must be between 7 and 365 days';
  end if;
  if p_chat_retention_days < 1 or p_chat_retention_days > 365 then
    raise exception 'chat retention must be between 1 and 365 days';
  end if;
  if p_audit_retention_days < 30 or p_audit_retention_days > 1095 then
    raise exception 'audit retention must be between 30 and 1095 days';
  end if;

  delete from public.careon_assistant_events
  where created_at < now() - make_interval(days => p_event_retention_days);
  get diagnostics v_events = row_count;

  delete from public.careon_assistant_rate_limits
  where updated_at < now() - interval '2 days';
  get diagnostics v_quotas = row_count;

  delete from public.assistant_messages m
  using public.assistant_threads t
  where t.user_id = m.user_id
    and t.id = m.thread_id
    and t.updated_at < now() - make_interval(days => p_chat_retention_days);
  get diagnostics v_messages = row_count;

  delete from public.assistant_threads
  where updated_at < now() - make_interval(days => p_chat_retention_days);
  get diagnostics v_threads = row_count;

  delete from public.audit_events
  where created_at < now() - make_interval(days => p_audit_retention_days);
  get diagnostics v_audit = row_count;

  return jsonb_build_object(
    'events_deleted', v_events,
    'quota_rows_deleted', v_quotas,
    'chat_messages_deleted', v_messages,
    'chat_threads_deleted', v_threads,
    'audit_events_deleted', v_audit
  );
end;
$$;

revoke all on function public.careon_prune_runtime_data(integer, integer, integer)
  from PUBLIC, anon, authenticated;
grant execute on function public.careon_prune_runtime_data(integer, integer, integer) to service_role;
