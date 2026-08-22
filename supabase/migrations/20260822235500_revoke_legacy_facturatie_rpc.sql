-- Apply only after the application uses careon_factuur_definitief_maken_service.
-- The legacy RPC trusted an authenticated caller directly and therefore
-- remained an exposed SECURITY DEFINER function. The validated server route is
-- now the sole issuance entry point.

revoke all on function public.careon_factuur_definitief_maken(
  uuid, uuid, text, smallint, integer, text, date, date
) from public, anon, authenticated, service_role;

drop function public.careon_factuur_definitief_maken(
  uuid, uuid, text, smallint, integer, text, date, date
);

notify pgrst, 'reload schema';
