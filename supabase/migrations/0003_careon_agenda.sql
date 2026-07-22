-- Careon Pulse — aanvullende EPD-exports: agenda-aggregaat en verwijzernetwerk.
-- Uitvoeren in de Supabase SQL-editor (of via supabase db push).
--
-- Ontwerp: zelfde patroon als careon_middelen_state — elke opslag is een
-- volledige snapshot-rij (append-only), de GET leest de nieuwste rij.
-- Inhoud agenda: uitsluitend geaggregeerde afspraakcijfers per maand/vestiging/
-- behandelaar plus contactfeiten per cliënt-ID — nooit losse afspraakregels,
-- namen, memo's of BSN.
-- Inhoud verwijzers: zakelijke praktijkgegevens (AGB, plaats, rol, Zorgmail)
-- met cliëntaantallen — geen e-mailadressen of cliëntkenmerken.

create table if not exists public.careon_agenda_state (
  id uuid primary key default gen_random_uuid(),
  saved_at timestamptz not null default now(),
  -- AgendaFacts (zie src/lib/careon-production/types.ts).
  state jsonb not null
);

create index if not exists careon_agenda_state_saved_at_idx on public.careon_agenda_state (saved_at desc);

alter table public.careon_agenda_state enable row level security;

create table if not exists public.careon_verwijzers_state (
  id uuid primary key default gen_random_uuid(),
  saved_at timestamptz not null default now(),
  -- VerwijzersFacts (zie src/lib/careon-production/types.ts).
  state jsonb not null
);

create index if not exists careon_verwijzers_state_saved_at_idx on public.careon_verwijzers_state (saved_at desc);

-- RLS aan zonder policies: alleen de service-role key (server-side routes)
-- kan lezen/schrijven; anon- en authenticated-clients niets.
alter table public.careon_verwijzers_state enable row level security;
