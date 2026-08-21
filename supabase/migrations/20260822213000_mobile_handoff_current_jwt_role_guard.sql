-- G09 / D14: current PostgREST exposes the signed role through auth.jwt().
-- Keep the service_role-only grants as the primary boundary and use this
-- current claims container as defense in depth inside both handoff functions.

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
    'public.careon_create_mobile_handoff(text,uuid,uuid,text,text)',
    'public.careon_consume_mobile_handoff(text)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'required Careon mobile handoff function is missing: %', v_signature;
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

revoke all on function public.careon_create_mobile_handoff(text, uuid, uuid, text, text) from public;
revoke all on function public.careon_create_mobile_handoff(text, uuid, uuid, text, text)
  from anon, authenticated;
grant execute on function public.careon_create_mobile_handoff(text, uuid, uuid, text, text)
  to service_role;

revoke all on function public.careon_consume_mobile_handoff(text) from public;
revoke all on function public.careon_consume_mobile_handoff(text) from anon, authenticated;
grant execute on function public.careon_consume_mobile_handoff(text) to service_role;
