-- Careon Pulse — middelen & inventaris (handmatige registratie, handoff 09).
-- Uitvoeren in de Supabase SQL-editor (of via supabase db push).
--
-- Ontwerp: elke opslag is een volledige snapshot-rij (append-only, nooit
-- overschreven) — de GET van /api/careon/middelen leest de nieuwste rij.
-- Zo ontstaat gratis historie ("wie had welk middel vorige maand") en kan
-- een misgelopen schrijfactie nooit de vorige goede stand vernietigen.
-- Inhoud: alleen medewerkersnamen, middelen-tags en inventarisaantallen —
-- geen cliëntgegevens.

create table if not exists public.careon_middelen_state (
  id uuid primary key default gen_random_uuid(),
  saved_at timestamptz not null default now(),
  -- MiddelenState (zie src/lib/careon-middelen/types.ts).
  state jsonb not null
);

create index if not exists careon_middelen_state_saved_at_idx on public.careon_middelen_state (saved_at desc);

-- RLS aan zonder policies: alleen de service-role key (server-side route
-- handlers) kan lezen/schrijven; anon- en authenticated-clients niets.
alter table public.careon_middelen_state enable row level security;
