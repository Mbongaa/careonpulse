-- F05/F06: validated invoice contents and issuance share one transaction.
-- Deploy this migration with the routes that call careon_factuur_uitreiken_atomic.
-- Duplicate historical full credits must be reconciled before the unique index
-- can be installed; this migration deliberately does not alter issued documents.

alter table public.careon_facturatie_facturen
  add column revision bigint not null default 1;

create function app.careon_factuur_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Caller-supplied updated_at/revision cannot hide a concurrent concept edit.
  new.revision := old.revision + 1;
  return new;
end;
$$;
revoke all on function app.careon_factuur_revision() from public, anon, authenticated, service_role;
create trigger careon_factuur_revision
  before update on public.careon_facturatie_facturen
  for each row execute function app.careon_factuur_revision();

create unique index careon_facturatie_one_issued_full_credit
  on public.careon_facturatie_facturen (gecrediteerde_factuur_id)
  where soort = 'creditfactuur' and status <> 'concept';

-- The old allocator remains an internal implementation detail. Neither a
-- caller JWT nor an API service call may bypass the new revision/content gate.
revoke all on function public.careon_factuur_definitief_maken_service(
  uuid, uuid, uuid, text, smallint, integer, text, date, date
) from public, anon, authenticated, service_role;

create function public.careon_factuur_uitreiken_atomic(
  p_actor uuid,
  p_org uuid,
  p_factuur uuid,
  p_expected_revision bigint,
  p_snapshot jsonb,
  p_reeks text,
  p_jaar smallint,
  p_start integer,
  p_formaat text,
  p_credit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.careon_facturatie_facturen%rowtype;
  v_payload public.careon_facturatie_facturen%rowtype;
  v_factuur_id uuid;
begin
  if p_credit is null or p_actor is null or not exists (
    select 1
    from auth.users u
    join public.organization_members m on m.user_id = u.id and m.org_id = p_org
    where u.id = p_actor
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and (m.role = 'org_admin' or exists (
        select 1 from public.platform_admins pa where pa.user_id = p_actor
      ))
  ) then
    raise exception 'facturatie: niet toegestaan' using errcode = '42501';
  end if;

  -- Credits serialize on their shared original, not on two newly created rows.
  select f.* into v_source
  from public.careon_facturatie_facturen f
  where f.id = p_factuur and f.org_id = p_org
  for update;
  if not found or v_source.soort <> 'factuur' then
    raise exception 'facturatie: ongeldige factuur' using errcode = '40001';
  end if;

  if p_credit then
    select f.id into v_factuur_id
    from public.careon_facturatie_facturen f
    where f.org_id = p_org and f.gecrediteerde_factuur_id = p_factuur
      and f.soort = 'creditfactuur' and f.status <> 'concept';
    if found then
      -- Recover a pre-migration partial original-status update without issuing
      -- another credit. This branch also handles retries after response loss.
      if v_source.status <> 'gecrediteerd' then
        update public.careon_facturatie_facturen set status = 'gecrediteerd', updated_at = now()
        where id = p_factuur and org_id = p_org;
      end if;
      return jsonb_build_object('factuur_id', v_factuur_id, 'already_issued', true);
    end if;
    if v_source.status not in ('definitief', 'verzonden', 'betaald') then
      raise exception 'facturatie: niet crediteerbaar' using errcode = '40001';
    end if;
  elsif v_source.status <> 'concept' then
    return jsonb_build_object('factuur_id', v_source.id, 'already_issued', true);
  end if;

  if p_expected_revision is distinct from v_source.revision then
    raise exception 'facturatie: revisie gewijzigd' using errcode = '40001';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or not (p_snapshot ?& array[
      'factuurdatum', 'prestatie_van', 'prestatie_tot', 'vervaldatum', 'betaaltermijn_dagen',
      'contact_id', 'afnemer', 'afzender', 'uw_kenmerk', 'order_referentie', 'regels',
      'btw_totalen', 'vrijstelling_tekst', 'subtotaal_cent', 'btw_cent', 'totaal_cent', 'opmerking'
    ])
  then
    raise exception 'facturatie: onvolledige snapshot' using errcode = '22023';
  end if;
  v_payload := jsonb_populate_record(null::public.careon_facturatie_facturen, p_snapshot);
  if v_payload.factuurdatum is null or v_payload.vervaldatum is null
    or v_payload.afnemer is null or v_payload.afzender is null
    or jsonb_typeof(v_payload.regels) <> 'array' or jsonb_array_length(v_payload.regels) = 0
    or v_payload.totaal_cent is distinct from (v_payload.subtotaal_cent + v_payload.btw_cent)
  then
    raise exception 'facturatie: ongeldige snapshot' using errcode = '22023';
  end if;
  if v_payload.contact_id is not null and not exists (
    select 1 from public.careon_facturatie_contacten c
    where c.id = v_payload.contact_id and c.org_id = p_org
  ) then
    raise exception 'facturatie: contact buiten organisatie' using errcode = '42501';
  end if;

  if p_credit then
    if (v_payload.afnemer, v_payload.contact_id, v_payload.prestatie_van, v_payload.prestatie_tot,
        v_payload.subtotaal_cent, v_payload.btw_cent, v_payload.totaal_cent)
      is distinct from
       (v_source.afnemer, v_source.contact_id, v_source.prestatie_van, v_source.prestatie_tot,
        -v_source.subtotaal_cent, -v_source.btw_cent, -v_source.totaal_cent)
    then
      raise exception 'facturatie: credit spiegelt origineel niet' using errcode = '22023';
    end if;
    insert into public.careon_facturatie_facturen (
      org_id, soort, reeks, jaar, gecrediteerde_factuur_id, created_by
    ) values (p_org, 'creditfactuur', p_reeks, p_jaar, p_factuur, p_actor)
    returning id into v_factuur_id;
  else
    v_factuur_id := p_factuur;
  end if;

  -- Only the validated invoice content is copied. Identity, org, numbering,
  -- status and storage metadata cannot be supplied through the JSON snapshot.
  update public.careon_facturatie_facturen f set
    factuurdatum = v_payload.factuurdatum,
    prestatie_van = v_payload.prestatie_van,
    prestatie_tot = v_payload.prestatie_tot,
    vervaldatum = v_payload.vervaldatum,
    betaaltermijn_dagen = v_payload.betaaltermijn_dagen,
    contact_id = v_payload.contact_id,
    afnemer = v_payload.afnemer,
    afzender = v_payload.afzender,
    uw_kenmerk = v_payload.uw_kenmerk,
    order_referentie = v_payload.order_referentie,
    regels = v_payload.regels,
    btw_totalen = v_payload.btw_totalen,
    vrijstelling_tekst = v_payload.vrijstelling_tekst,
    subtotaal_cent = v_payload.subtotaal_cent,
    btw_cent = v_payload.btw_cent,
    totaal_cent = v_payload.totaal_cent,
    opmerking = v_payload.opmerking,
    updated_at = now()
  where f.id = v_factuur_id and f.org_id = p_org;

  -- The security-definer owner can call the revoked allocator internally;
  -- errors roll back snapshot, new credit, counter and original status alike.
  perform * from public.careon_factuur_definitief_maken_service(
    p_actor, p_org, v_factuur_id, p_reeks, p_jaar, p_start, p_formaat,
    v_payload.factuurdatum, v_payload.vervaldatum
  );
  if p_credit then
    update public.careon_facturatie_facturen set status = 'gecrediteerd', updated_at = now()
    where id = p_factuur and org_id = p_org;
  end if;
  return jsonb_build_object('factuur_id', v_factuur_id, 'already_issued', false);
end;
$$;

revoke all on function public.careon_factuur_uitreiken_atomic(
  uuid, uuid, uuid, bigint, jsonb, text, smallint, integer, text, boolean
) from public, anon, authenticated;
grant execute on function public.careon_factuur_uitreiken_atomic(
  uuid, uuid, uuid, bigint, jsonb, text, smallint, integer, text, boolean
) to service_role;

notify pgrst, 'reload schema';
