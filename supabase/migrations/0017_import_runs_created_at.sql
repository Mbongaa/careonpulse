-- 0017 — servertijdstempel voor EPD-import-runs.
--
-- careon_import_runs had alleen `imported_at`, en dat is de klok van de
-- importerende browser: één werkstation met een scheve klok of verkeerde
-- tijdzone zette de nieuwste import onder oudere runs, precies op de
-- beheerschermen waar support "is de nieuwste export binnen?" beantwoordt.
-- `created_at` is het moment waarop de server de run ontving en is daarmee de
-- betrouwbare sorteersleutel; `imported_at` blijft bestaan als het door de
-- browser gerapporteerde exportmoment.
--
-- Idempotent via een kolomcheck: de backfill (created_at := imported_at, de
-- beste beschikbare benadering voor bestaande runs) mag alléén draaien op het
-- moment dat de kolom wordt aangemaakt — een herhaalde run zou anders echte
-- servertijdstempels overschrijven met browserklokken.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'careon_import_runs' and column_name = 'created_at'
  ) then
    alter table public.careon_import_runs add column created_at timestamptz;
    update public.careon_import_runs set created_at = imported_at;
    alter table public.careon_import_runs alter column created_at set default now();
    alter table public.careon_import_runs alter column created_at set not null;
  end if;
end $$;

-- Zelfde vorm als careon_import_runs_org_imported_idx (0010), maar op de
-- nieuwe sorteersleutel: beheer en de productie-GET ordenen nu op created_at.
create index if not exists careon_import_runs_org_created_idx
  on public.careon_import_runs (org_id, created_at desc);
