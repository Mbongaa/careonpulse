-- Facturatie Storage backup boundary.
--
-- Database backups do not contain Supabase Storage objects. These constraints
-- make the row metadata a complete integrity anchor for every archived PDF,
-- while the bucket remains private and accepts only the two server-managed
-- formats. There are deliberately no anon/authenticated storage.objects
-- policies; access stays behind role-checked server routes or service-role
-- recovery tooling.

do $$
begin
  if exists (
    select 1
    from public.careon_facturatie_facturen
    where num_nonnulls(pdf_pad, pdf_sha256, pdf_bytes, pdf_gegenereerd_op) not in (0, 4)
  ) then
    raise exception 'Facturatie PDF-metadata is gedeeltelijk; herstel drift vóór deze migratie.';
  end if;
end;
$$;

alter table public.careon_facturatie_facturen
  drop constraint if exists careon_facturatie_facturen_pdf_metadata_complete;
alter table public.careon_facturatie_facturen
  add constraint careon_facturatie_facturen_pdf_metadata_complete
  check (num_nonnulls(pdf_pad, pdf_sha256, pdf_bytes, pdf_gegenereerd_op) in (0, 4));

alter table public.careon_facturatie_facturen
  drop constraint if exists careon_facturatie_facturen_pdf_hash_valid;
alter table public.careon_facturatie_facturen
  add constraint careon_facturatie_facturen_pdf_hash_valid
  check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$');

alter table public.careon_facturatie_facturen
  drop constraint if exists careon_facturatie_facturen_pdf_bytes_valid;
alter table public.careon_facturatie_facturen
  add constraint careon_facturatie_facturen_pdf_bytes_valid
  check (pdf_bytes is null or pdf_bytes between 1 and 26214400);

alter table public.careon_facturatie_facturen
  drop constraint if exists careon_facturatie_facturen_pdf_path_scoped;
alter table public.careon_facturatie_facturen
  add constraint careon_facturatie_facturen_pdf_path_scoped
  check (
    pdf_pad is null
    or (
      split_part(pdf_pad, '/', 1) = org_id::text
      and pdf_pad ~ '^[0-9a-f-]{36}/(20[2-9][0-9]|21[0-9]{2})/[^/]+[.]pdf$'
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'facturen',
  'facturen',
  false,
  26214400,
  array['application/pdf', 'image/png']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on constraint careon_facturatie_facturen_pdf_metadata_complete
  on public.careon_facturatie_facturen is
  'Archived PDF path, SHA-256, byte count and generation timestamp are an all-or-none integrity anchor.';

notify pgrst, 'reload schema';
