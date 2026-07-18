-- Careon Pulse — productie-modus opslag.
-- Uitvoeren in de Supabase SQL-editor (of via supabase db push).
--
-- Ontwerp: elke import van de ZSG-cliëntendata-export wordt als volledige
-- snapshot-run bewaard (nooit overschreven) zodat er historie ontstaat voor
-- maand-op-maand-vergelijkingen. Records zijn gepseudonimiseerd vóór upload:
-- geen namen, geboortedatums, verzekeringsnummers of postcodes.

create table if not exists public.careon_import_runs (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  imported_at timestamptz not null default now(),
  total_rows integer not null default 0
);

create table if not exists public.careon_import_records (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.careon_import_runs (id) on delete cascade,
  -- Gepseudonimiseerd ClientRecord (zie src/lib/careon-production/types.ts).
  record jsonb not null
);

-- Zelfherstellend bij een oudere tabel zonder total_rows ("create table if not
-- exists" voegt geen kolommen toe). Runs die vóór deze kolom zijn opgeslagen
-- houden total_rows 0 en worden door de GET-volledigheidscontrole overgeslagen:
-- importeer daarna eenmalig opnieuw.
alter table public.careon_import_runs add column if not exists total_rows integer not null default 0;

create index if not exists careon_import_records_run_id_idx on public.careon_import_records (run_id);

-- RLS aan zonder policies: alleen de service-role key (server-side route
-- handlers) kan lezen/schrijven; anon- en authenticated-clients niets.
alter table public.careon_import_runs enable row level security;
alter table public.careon_import_records enable row level security;
