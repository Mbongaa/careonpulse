-- G01/G15: use the current PostgREST JWT claims container for service-role
-- verification. Recent PostgREST versions expose the signed claims through
-- `request.jwt.claims` (and Supabase's `auth.jwt()` helper), while the legacy
-- per-claim `request.jwt.claim.role` setting can be empty. The EXECUTE grants
-- below remain the primary least-privilege boundary; this in-function check is
-- defense in depth.

do $migration$
declare
  v_signature text;
  v_function regprocedure;
  v_definition text;
  v_legacy_expression constant text :=
    'coalesce(current_setting(''request.jwt.claim.role'', true), '''')';
  v_current_expression constant text :=
    'coalesce(auth.jwt() ->> ''role'', '''')';
begin
  foreach v_signature in array array[
    'public.careon_provision_entra_member(uuid,text,text,text)',
    'public.careon_reconcile_entra_snapshot(text,jsonb,integer)',
    'public.careon_finalize_entra_lifecycle_action(text,uuid,text,boolean,text,text)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'required Careon function is missing: %', v_signature;
    end if;

    v_definition := pg_get_functiondef(v_function);
    if strpos(v_definition, v_legacy_expression) = 0 then
      raise exception 'legacy role guard not found in %', v_signature;
    end if;

    v_definition := replace(v_definition, v_legacy_expression, v_current_expression);
    execute v_definition;

    v_definition := pg_get_functiondef(v_function);
    if strpos(v_definition, v_legacy_expression) > 0
      or strpos(v_definition, v_current_expression) = 0
    then
      raise exception 'current JWT role guard was not installed in %', v_signature;
    end if;
  end loop;
end;
$migration$;

revoke all on function public.careon_provision_entra_member(uuid, text, text, text) from public;
revoke all on function public.careon_provision_entra_member(uuid, text, text, text) from anon, authenticated;
grant execute on function public.careon_provision_entra_member(uuid, text, text, text) to service_role;

revoke all on function public.careon_reconcile_entra_snapshot(text, jsonb, integer) from public;
revoke all on function public.careon_reconcile_entra_snapshot(text, jsonb, integer) from anon, authenticated;
grant execute on function public.careon_reconcile_entra_snapshot(text, jsonb, integer) to service_role;

revoke all on function public.careon_finalize_entra_lifecycle_action(text, uuid, text, boolean, text, text)
  from public;
revoke all on function public.careon_finalize_entra_lifecycle_action(text, uuid, text, boolean, text, text)
  from anon, authenticated;
grant execute on function public.careon_finalize_entra_lifecycle_action(text, uuid, text, boolean, text, text)
  to service_role;

