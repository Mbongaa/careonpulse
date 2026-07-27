-- Careon Pulse auth hardening.
-- Safe to apply after 0009-0013. No business, financial, or KPI data changes.

-- An owner may only update chat rows while still belonging to the row's org.
-- WITH CHECK validates the new org_id as well, closing cross-tenant moves.
drop policy if exists assistant_threads_owner_update on public.assistant_threads;
create policy assistant_threads_owner_update on public.assistant_threads
  for update to authenticated
  using (user_id = (select auth.uid()) and app.is_org_member(org_id))
  with check (user_id = (select auth.uid()) and app.is_org_member(org_id));

drop policy if exists assistant_messages_owner_update on public.assistant_messages;
create policy assistant_messages_owner_update on public.assistant_messages
  for update to authenticated
  using (user_id = (select auth.uid()) and app.is_org_member(org_id))
  with check (user_id = (select auth.uid()) and app.is_org_member(org_id));

-- Default table grants were broader than the RLS policy surface. Keep only
-- the operations the application actually uses.
revoke all on table public.organizations from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.organization_members from anon, authenticated;
revoke all on table public.platform_admins from anon, authenticated;
grant select on table public.organizations to authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.organization_members to authenticated;
grant select on table public.platform_admins to authenticated;

revoke all on table public.assistant_threads from anon, authenticated;
revoke all on table public.assistant_messages from anon, authenticated;
grant select, insert, update, delete on table public.assistant_threads to authenticated;
grant select, insert, update, delete on table public.assistant_messages to authenticated;
revoke all on sequence public.assistant_messages_id_seq from anon;
grant usage, select on sequence public.assistant_messages_id_seq to authenticated;

-- Trigger functions never need to be callable through PostgREST.
revoke all on function app.handle_new_user() from public, anon, authenticated;

-- Index every foreign-key access path flagged by the database advisor.
create index if not exists assistant_messages_org_idx
  on public.assistant_messages (org_id);
create index if not exists careon_assistant_events_org_idx
  on public.careon_assistant_events (org_id);
create index if not exists careon_assistant_events_user_idx
  on public.careon_assistant_events (user_id);
create index if not exists careon_assistant_rate_limits_org_idx
  on public.careon_assistant_rate_limits (org_id);
