-- Careon Pulse — toeslagen-export (declared surcharges, TC-toeslagprestaties).
-- Zelfde patroon als careon_agenda_state: append-only jsonb-snapshots, de GET
-- van /api/careon/toeslagen leest de nieuwste rij.
-- Inhoud: aggregaten per (factuurmaand, verzekeringskoepel, toeslagcode) plus
-- tellingen per code — nooit cliëntnamen of losse factuurregels.

create table if not exists public.careon_toeslagen_state (
  id uuid primary key default gen_random_uuid(),
  saved_at timestamptz not null default now(),
  -- ToeslagenFacts (zie src/lib/careon-production/types.ts).
  state jsonb not null
);

create index if not exists careon_toeslagen_state_saved_at_idx on public.careon_toeslagen_state (saved_at desc);

-- RLS aan zonder policies: alleen de service-role key (server-side routes).
alter table public.careon_toeslagen_state enable row level security;
