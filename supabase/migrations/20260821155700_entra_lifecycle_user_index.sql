-- G15: support auth-user deletion and lifecycle lookups by the nullable
-- Careon user foreign key. The existing unique index starts with org_id and
-- therefore cannot cover this foreign-key access pattern.

create index if not exists careon_entra_lifecycle_user_idx
  on public.careon_entra_lifecycle (careon_user_id)
  where careon_user_id is not null;

