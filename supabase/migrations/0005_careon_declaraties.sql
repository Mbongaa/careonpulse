-- Careon Pulse — declaratie-totaaloverzicht (declaration total).
-- Zelfde patroon als careon_agenda_state: append-only jsonb-snapshots, de GET
-- van /api/careon/declaraties leest de nieuwste rij.
-- Inhoud: per factuur bedrag/toegekend/gecrediteerd met koepel-label
-- (verzekeraar, gemeente of samengevoegd "Particulier") — nooit
-- persoonsnamen of debiteurennummers.

create table if not exists public.careon_declaraties_state (
  id uuid primary key default gen_random_uuid(),
  saved_at timestamptz not null default now(),
  -- DeclaratiesFacts (zie src/lib/careon-production/types.ts).
  state jsonb not null
);

create index if not exists careon_declaraties_state_saved_at_idx on public.careon_declaraties_state (saved_at desc);

-- RLS aan zonder policies: alleen de service-role key (server-side routes).
alter table public.careon_declaraties_state enable row level security;
