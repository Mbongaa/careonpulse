-- Careon Pulse — HR (handmatige personeelsregistratie, handoff 12).
-- Uitvoeren in de Supabase SQL-editor (of via supabase db push).
--
-- Ontwerp identiek aan careon_middelen_state (0002 + hardening 0006): elke
-- opslag is een volledige snapshot-rij (append-only, nooit overschreven) — de
-- GET van /api/careon/hr leest de nieuwste revisie. Zo ontstaat gratis historie
-- en kan een misgelopen schrijfactie de vorige goede stand nooit vernietigen.
-- Inhoud: alleen HR-kerncijfers, de verzuimtrend en BIG-registraties
-- (naam + functie + verloopdatum) — geen cliëntgegevens.

create table if not exists public.careon_hr_state (
  id uuid primary key default gen_random_uuid(),
  saved_at timestamptz not null default now(),
  -- HrState (zie src/lib/careon-hr/types.ts).
  state jsonb not null,
  revision bigint not null,
  base_revision bigint,
  operation_id uuid,
  change_source text,
  change_summary jsonb not null default '{}'::jsonb,
  actor_hash text,
  constraint careon_hr_state_revision_positive check (revision > 0),
  constraint careon_hr_state_base_revision_nonnegative check (base_revision is null or base_revision >= 0),
  constraint careon_hr_state_change_source_valid check (change_source is null or change_source in ('assistant', 'manual'))
);

create index if not exists careon_hr_state_saved_at_idx on public.careon_hr_state (saved_at desc);
create unique index if not exists careon_hr_state_revision_uidx on public.careon_hr_state (revision);
create unique index if not exists careon_hr_state_operation_uidx
  on public.careon_hr_state (operation_id)
  where operation_id is not null;

-- RLS aan zonder client-policies: alleen de service-role key (server-side route
-- handlers) kan lezen/schrijven; anon- en authenticated-clients niets.
alter table public.careon_hr_state enable row level security;

revoke all on table public.careon_hr_state from anon, authenticated;
grant select, insert, update, delete on table public.careon_hr_state to service_role;
