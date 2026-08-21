-- G12: indexeer de foreign-keykolommen als leidende kolom.
-- De bestaande organisatie-scoped indexen beginnen met org_id en kunnen
-- daardoor een lookup/cascade op alleen contact_id of factuur_id niet dragen.

create index if not exists careon_facturatie_facturen_contact_fk_idx
  on public.careon_facturatie_facturen (contact_id)
  where contact_id is not null;

create index if not exists careon_facturatie_maillog_factuur_fk_idx
  on public.careon_facturatie_maillog (factuur_id);
