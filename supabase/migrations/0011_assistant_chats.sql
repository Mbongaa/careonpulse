-- Careon Pulse — AI-gesprekken per gebruiker (handoff 13, fase 3).
-- Vereist 0009/0010. Uitvoeren via de SQL-editor of de Management API.
--
-- De assistent bewaart gesprekken vanaf nu centraal, per gebruiker:
--  - assistant_threads: één rij per gesprek (id = client-gegenereerd, dus
--    tekst; primaire sleutel is (user_id, id) zodat gebruikers elkaars id's
--    nooit kunnen claimen).
--  - assistant_messages: één rij per repository-item van @assistant-ui
--    (payload jsonb met parentId + volledige message incl. tool-calls);
--    laden reconstrueert de repository exact.
-- RLS: de eigenaar heeft volledige rechten op eigen gesprekken (verwijderen
-- mag — privacy), de superadmin mag alles lezen (inzage, zie de AVG-melding
-- op de assistentpagina), org_admins bewust niets. Retentie: 30 dagen via de
-- bestaande onderhoudsroute (geen pg_cron-afhankelijkheid).

create table if not exists public.assistant_threads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  id text not null,
  org_id uuid not null references public.organizations (id),
  title text not null default 'Nieuwe chat',
  status text not null default 'regular',
  head_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint assistant_threads_status_valid check (status in ('regular', 'archived')),
  constraint assistant_threads_id_length check (char_length(id) between 1 and 80),
  constraint assistant_threads_title_length check (char_length(title) <= 200),
  constraint assistant_threads_head_length check (head_id is null or char_length(head_id) <= 80)
);

create index if not exists assistant_threads_user_updated_idx
  on public.assistant_threads (user_id, updated_at desc);
create index if not exists assistant_threads_org_updated_idx
  on public.assistant_threads (org_id, updated_at desc);

create table if not exists public.assistant_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  org_id uuid not null references public.organizations (id),
  thread_id text not null,
  message_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, thread_id, message_id),
  constraint assistant_messages_thread_length check (char_length(thread_id) between 1 and 80),
  constraint assistant_messages_message_length check (char_length(message_id) between 1 and 80)
);

create index if not exists assistant_messages_thread_idx
  on public.assistant_messages (user_id, thread_id, id);

-- ── RLS: eigenaar = volledige rechten; superadmin = alleen lezen ────────────

alter table public.assistant_threads enable row level security;
alter table public.assistant_messages enable row level security;

revoke all on table public.assistant_threads from anon;
revoke all on table public.assistant_messages from anon;
grant select, insert, update, delete on table public.assistant_threads to authenticated;
grant select, insert, update, delete on table public.assistant_messages to authenticated;
grant all on table public.assistant_threads to service_role;
grant all on table public.assistant_messages to service_role;

drop policy if exists assistant_threads_owner_select on public.assistant_threads;
create policy assistant_threads_owner_select on public.assistant_threads
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_superadmin());

drop policy if exists assistant_threads_owner_write on public.assistant_threads;
create policy assistant_threads_owner_write on public.assistant_threads
  for insert to authenticated
  with check (user_id = (select auth.uid()) and app.is_org_member(org_id));

drop policy if exists assistant_threads_owner_update on public.assistant_threads;
create policy assistant_threads_owner_update on public.assistant_threads
  for update to authenticated
  using (user_id = (select auth.uid()) and app.is_org_member(org_id))
  with check (user_id = (select auth.uid()) and app.is_org_member(org_id));

drop policy if exists assistant_threads_owner_delete on public.assistant_threads;
create policy assistant_threads_owner_delete on public.assistant_threads
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists assistant_messages_owner_select on public.assistant_messages;
create policy assistant_messages_owner_select on public.assistant_messages
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_superadmin());

drop policy if exists assistant_messages_owner_write on public.assistant_messages;
create policy assistant_messages_owner_write on public.assistant_messages
  for insert to authenticated
  with check (user_id = (select auth.uid()) and app.is_org_member(org_id));

drop policy if exists assistant_messages_owner_update on public.assistant_messages;
create policy assistant_messages_owner_update on public.assistant_messages
  for update to authenticated
  using (user_id = (select auth.uid()) and app.is_org_member(org_id))
  with check (user_id = (select auth.uid()) and app.is_org_member(org_id));

drop policy if exists assistant_messages_owner_delete on public.assistant_messages;
create policy assistant_messages_owner_delete on public.assistant_messages
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── Retentie: 30 dagen chats, geïntegreerd in de bestaande onderhoudsfunctie.
--    De 1-args-variant vervalt eerst: een overload zou de PostgREST-RPC-call
--    ambigu maken. ────────────────────────────────────────────────────────────

drop function if exists public.careon_prune_runtime_data(integer);

create or replace function public.careon_prune_runtime_data(
  p_event_retention_days integer default 90,
  p_chat_retention_days integer default 30
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
begin
  if p_event_retention_days < 7 or p_event_retention_days > 365 then
    raise exception 'retention must be between 7 and 365 days';
  end if;
  if p_chat_retention_days < 1 or p_chat_retention_days > 365 then
    raise exception 'chat retention must be between 1 and 365 days';
  end if;

  delete from public.careon_assistant_events
  where created_at < now() - make_interval(days => p_event_retention_days);
  get diagnostics v_events = row_count;

  delete from public.careon_assistant_rate_limits
  where updated_at < now() - interval '2 days';
  get diagnostics v_quotas = row_count;

  -- Chats: eerst berichten van verlopen threads, dan de threads zelf.
  delete from public.assistant_messages m
  using public.assistant_threads t
  where t.user_id = m.user_id
    and t.id = m.thread_id
    and t.updated_at < now() - make_interval(days => p_chat_retention_days);
  get diagnostics v_messages = row_count;

  delete from public.assistant_threads
  where updated_at < now() - make_interval(days => p_chat_retention_days);
  get diagnostics v_threads = row_count;

  return jsonb_build_object(
    'events_deleted', v_events,
    'quota_rows_deleted', v_quotas,
    'chat_messages_deleted', v_messages,
    'chat_threads_deleted', v_threads
  );
end;
$$;

revoke all on function public.careon_prune_runtime_data(integer, integer)
  from PUBLIC, anon, authenticated;
grant execute on function public.careon_prune_runtime_data(integer, integer) to service_role;
