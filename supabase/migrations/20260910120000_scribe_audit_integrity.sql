-- Careon Scribe audit SEC01-SEC09. Additive remediation; do not rewrite the
-- already applied 20260907120000 migration. Local verification is not rollout.
-- Every content mutation locks its parent FIRST. Invoker RPCs retain RLS;
-- direct content writes cannot bypass lifecycle, revision or approval checks.

alter table public.careon_scribe_sessies add column if not exists transcript_revisie integer not null default 0;
alter table public.careon_scribe_staat add column if not exists epd_lijst_beoordeeld boolean not null default false;
alter table public.careon_scribe_notities add column if not exists bewerk_revisie integer not null default 1;
alter table public.careon_scribe_notities add column if not exists bron_staat_versie integer;
alter table public.careon_scribe_notities add column if not exists bron_transcript_revisie integer;
alter table public.careon_scribe_notities add column if not exists gaten_beoordeeld integer;

-- Fail migration rather than silently choosing a recipient if historical
-- duplicate releases exist: they require an explicit operator decision.
create unique index if not exists careon_scribe_vrijgaven_een_ontvanger
  on public.careon_scribe_vrijgaven(sessie_id);

create or replace function app.scribe_activatie_geldig(p_state jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_datum text;
begin
  if jsonb_typeof(p_state) is distinct from 'object'
     or p_state->'verwerkersovereenkomstBevestigd' is distinct from 'true'::jsonb
     or jsonb_typeof(p_state->'dpiaEigenaar') is distinct from 'string'
     or length(btrim(p_state->>'dpiaEigenaar')) not between 1 and 120 then return false; end if;
  foreach v_datum in array array[p_state->>'dpiaVastgesteldOp',p_state->>'consenttekstGoedgekeurdOp'] loop
    if v_datum is null or v_datum !~ '^\d{4}-\d{2}-\d{2}(T.*)?$' then return false; end if;
    perform v_datum::timestamptz;
  end loop;
  return true;
exception when others then return false;
end; $$;
revoke all on function app.scribe_activatie_geldig(jsonb) from public, anon;
grant execute on function app.scribe_activatie_geldig(jsonb) to authenticated, service_role;

create or replace function app.scribe_ingeschakeld(check_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select i.state->'ingeschakeld' = 'true'::jsonb and app.scribe_activatie_geldig(i.state)
    from public.careon_scribe_instellingen i where i.org_id=check_org order by revision desc limit 1),false);
$$;
alter table public.careon_scribe_instellingen drop constraint if exists careon_scribe_instellingen_activatie;
alter table public.careon_scribe_instellingen add constraint careon_scribe_instellingen_activatie
  check (state->'ingeschakeld' is distinct from 'true'::jsonb or app.scribe_activatie_geldig(state)) not valid;

-- Consent is generated from the current org revision in the DB transaction.
-- The client supplies an expected revision, never authoritative consent text.
create or replace function app.careon_scribe_consent_vastleggen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_i public.careon_scribe_instellingen;
begin
  -- Settings insertion takes the same org row lock, closing revision races.
  perform 1 from public.organizations where id=new.org_id for update;
  select * into v_i from public.careon_scribe_instellingen where org_id=new.org_id order by revision desc limit 1;
  if not found or new.consent_revisie is distinct from v_i.revision then
    raise exception 'scribe: de toestemmingstekst is intussen gewijzigd' using errcode='55000';
  end if;
  if not app.scribe_ingeschakeld(new.org_id) then
    raise exception 'scribe: de activatievoorwaarden ontbreken' using errcode='42501';
  end if;
  new.segment_teller:=0; new.duur_ms:=0; new.ontbrekende_fragmenten:=0; new.transcript_revisie:=0;
  new.consent_tekst := replace(replace(v_i.state->>'consenttekst',
    '{transcriptRetentieDagen}',app.careon_scribe_retentie_dagen(new.org_id,'transcriptRetentieDagen',30)::text),
    '{notitieRetentieDagen}',app.careon_scribe_retentie_dagen(new.org_id,'notitieRetentieDagen',30)::text);
  if new.consent_tekst is null or length(btrim(new.consent_tekst))=0 then
    raise exception 'scribe: toestemmingstekst ontbreekt' using errcode='22023';
  end if;
  return new;
end; $$;
revoke all on function app.careon_scribe_consent_vastleggen() from public,anon,authenticated,service_role;
drop trigger if exists careon_scribe_consent_vastleggen on public.careon_scribe_sessies;
create trigger careon_scribe_consent_vastleggen before insert on public.careon_scribe_sessies
  for each row execute function app.careon_scribe_consent_vastleggen();

create or replace function app.careon_scribe_instellingen_vergrendelen()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.organizations where id=new.org_id for update;
  return new;
end; $$;
revoke all on function app.careon_scribe_instellingen_vergrendelen() from public,anon,authenticated,service_role;
drop trigger if exists careon_scribe_instellingen_vergrendelen on public.careon_scribe_instellingen;
create trigger careon_scribe_instellingen_vergrendelen before insert on public.careon_scribe_instellingen
  for each row execute function app.careon_scribe_instellingen_vergrendelen();

create or replace function app.scribe_sessie_vergrendelen(p_sessie uuid)
returns public.careon_scribe_sessies language plpgsql security invoker set search_path = '' as $$
declare v_s public.careon_scribe_sessies;
begin
  select * into v_s from public.careon_scribe_sessies where id=p_sessie for update;
  if not found or v_s.behandelaar_id is distinct from auth.uid() or not app.mag_scribe_gebruiken(v_s.org_id) then
    raise exception 'scribe: consult niet gevonden of niet gemachtigd' using errcode='42501';
  end if;
  if v_s.status not in ('actief','afgerond') or v_s.transcript_verwijder_na <= now() then
    raise exception 'scribe: dit consult ligt vast of is verlopen' using errcode='55000';
  end if;
  return v_s;
end; $$;
revoke all on function app.scribe_sessie_vergrendelen(uuid) from public,anon;
grant execute on function app.scribe_sessie_vergrendelen(uuid) to authenticated;

-- Defense in depth for direct PostgREST writes and late provider completions.
create or replace function app.careon_scribe_inhoud_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_s public.careon_scribe_sessies; v_id uuid;
  v_service boolean := coalesce(auth.jwt()->>'role','')='service_role';
  v_mode text := coalesce(current_setting('careon.scribe_content_rpc',true),'');
begin
  v_id := case when tg_op='DELETE' then old.sessie_id else new.sessie_id end;
  select * into v_s from public.careon_scribe_sessies where id=v_id for update;
  if not found and tg_op='DELETE' then return old; end if; -- parent cascade
  if tg_op='UPDATE' and (new.sessie_id,new.org_id,new.behandelaar_id) is distinct from
    (old.sessie_id,old.org_id,old.behandelaar_id) then
    raise exception 'scribe: inhoudseigenaar en consult zijn onwijzigbaar' using errcode='42501';
  end if;
  if tg_op<>'DELETE' and (new.org_id,new.behandelaar_id) is distinct from (v_s.org_id,v_s.behandelaar_id) then
    raise exception 'scribe: inhoud hoort niet bij dit consult' using errcode='42501';
  end if;
  if not v_service then
    if tg_op='DELETE' and coalesce(current_setting('careon.scribe_rpc',true),'')='1' then return old; end if;
    if v_mode='' then
      raise exception 'scribe: inhoud wijzigen vereist een atomische RPC met revisie' using errcode='42501';
    end if;
    if v_s.status not in ('actief','afgerond') or v_s.transcript_verwijder_na<=now() then
      raise exception 'scribe: dit consult ligt vast of is verlopen' using errcode='55000';
    end if;
    if tg_table_name='careon_scribe_notities' and v_s.status<>'afgerond' then
      raise exception 'scribe: rond het consult eerst af' using errcode='55000';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function app.careon_scribe_inhoud_guard() from public,anon,authenticated,service_role;
do $$ declare v_t text; begin
  foreach v_t in array array['careon_scribe_segmenten','careon_scribe_staat','careon_scribe_notities','careon_scribe_taken'] loop
    execute format('drop trigger if exists a_scribe_inhoud_guard on public.%I',v_t);
    execute format('create trigger a_scribe_inhoud_guard before insert or update or delete on public.%I for each row execute function app.careon_scribe_inhoud_guard()',v_t);
  end loop;
end; $$;

create or replace function app.careon_scribe_transcript_gewijzigd()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_nr integer;
begin
  v_id:=case when tg_op='DELETE' then old.sessie_id else new.sessie_id end;
  v_nr:=case when tg_op='DELETE' then old.volgnummer else new.volgnummer end;
  if tg_op='UPDATE' and (new.spreker,new.tekst_gecorrigeerd,new.correctie_bron) is not distinct from
    (old.spreker,old.tekst_gecorrigeerd,old.correctie_bron) then return new; end if;
  update public.careon_scribe_sessies set transcript_revisie=transcript_revisie+1 where id=v_id;
  if coalesce(current_setting('careon.scribe_content_rpc',true),'')<>'analyse' then
    update public.careon_scribe_staat set versie=versie+1,verouderd=true,epd_lijst_beoordeeld=false,
      laatste_segment=case when tg_op='UPDATE' then 0 else least(laatste_segment,greatest(0,v_nr-1)) end,updated_at=now() where sessie_id=v_id;
    if tg_op='UPDATE' then
      -- Machine suggestions are rebuilt from corrected source. Preserve explicit
      -- clinician decisions (approved/rejected/completed tasks).
      delete from public.careon_scribe_taken where sessie_id=v_id and status='voorgesteld';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function app.careon_scribe_transcript_gewijzigd() from public,anon,authenticated,service_role;
drop trigger if exists careon_scribe_transcript_gewijzigd on public.careon_scribe_segmenten;
create trigger careon_scribe_transcript_gewijzigd after insert or update on public.careon_scribe_segmenten
  for each row execute function app.careon_scribe_transcript_gewijzigd();

create or replace function public.careon_scribe_staat_bewaren(p_sessie uuid,p_versie integer,p_staat jsonb,p_epd_beoordeeld boolean default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_s public.careon_scribe_sessies; v_t public.careon_scribe_staat;
begin
  if p_versie is null or p_versie<0 or p_staat is null then raise exception 'scribe: revisie en staat vereist' using errcode='22023'; end if;
  v_s:=app.scribe_sessie_vergrendelen(p_sessie);
  perform set_config('careon.scribe_content_rpc','staat',true);
  select * into v_t from public.careon_scribe_staat where sessie_id=p_sessie for update;
  if not found then
    if p_versie<>0 then raise exception 'scribe: de analyse is intussen gewijzigd' using errcode='55000'; end if;
    insert into public.careon_scribe_staat(sessie_id,org_id,behandelaar_id,staat,verouderd,epd_lijst_beoordeeld)
      values(p_sessie,v_s.org_id,v_s.behandelaar_id,p_staat,v_s.segment_teller>0,coalesce(p_epd_beoordeeld,false)) returning * into v_t;
  else
    if v_t.versie<>p_versie then raise exception 'scribe: de analyse is intussen gewijzigd' using errcode='55000'; end if;
    update public.careon_scribe_staat set staat=p_staat,versie=versie+1,
      epd_lijst_beoordeeld=case when (staat->'medicatie',staat->'allergieen') is distinct from
        (p_staat->'medicatie',p_staat->'allergieen') then false else coalesce(p_epd_beoordeeld,epd_lijst_beoordeeld) end,updated_at=now()
      where sessie_id=p_sessie returning * into v_t;
  end if;
  perform set_config('careon.scribe_content_rpc','',true);
  return to_jsonb(v_t);
end; $$;
revoke all on function public.careon_scribe_staat_bewaren(uuid,integer,jsonb,boolean) from public,anon;
grant execute on function public.careon_scribe_staat_bewaren(uuid,integer,jsonb,boolean) to authenticated;

create or replace function public.careon_scribe_segment_corrigeren(p_sessie uuid,p_volgnummer integer,p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_s public.careon_scribe_sessies; v_g public.careon_scribe_segmenten; v_t public.careon_scribe_staat;
begin
  v_s:=app.scribe_sessie_vergrendelen(p_sessie);
  if jsonb_typeof(p_patch) is distinct from 'object'
    or not (p_patch?'spreker' or p_patch?'tekst_gecorrigeerd')
    or p_patch-array['spreker','tekst_gecorrigeerd','correctie_bron']<>'{}'::jsonb
    or (p_patch?'spreker' and jsonb_typeof(p_patch->'spreker') is distinct from 'string')
    or (p_patch?'tekst_gecorrigeerd' and p_patch->'tekst_gecorrigeerd'<>'null'::jsonb
      and (jsonb_typeof(p_patch->'tekst_gecorrigeerd') is distinct from 'string'
        or length(btrim(p_patch->>'tekst_gecorrigeerd')) not between 1 and 4000)) then
    raise exception 'scribe: ongeldige transcriptcorrectie' using errcode='22023';
  end if;
  perform set_config('careon.scribe_content_rpc','correctie',true);
  update public.careon_scribe_segmenten set
    spreker=case when p_patch?'spreker' then p_patch->>'spreker' else spreker end,
    tekst_gecorrigeerd=case when p_patch?'tekst_gecorrigeerd' then p_patch->>'tekst_gecorrigeerd' else tekst_gecorrigeerd end,
    correctie_bron=case when p_patch?'tekst_gecorrigeerd' then case when p_patch->>'tekst_gecorrigeerd' is null then null else 'behandelaar' end else correctie_bron end
    where sessie_id=p_sessie and volgnummer=p_volgnummer returning * into v_g;
  if not found then raise exception 'scribe: segment niet gevonden' using errcode='55000'; end if;
  select * into v_t from public.careon_scribe_staat where sessie_id=p_sessie;
  perform set_config('careon.scribe_content_rpc','',true);
  return jsonb_build_object('segment',to_jsonb(v_g),'verouderd',coalesce(v_t.verouderd,false),'laatsteSegment',coalesce(v_t.laatste_segment,0));
end; $$;
revoke all on function public.careon_scribe_segment_corrigeren(uuid,integer,jsonb) from public,anon;
grant execute on function public.careon_scribe_segment_corrigeren(uuid,integer,jsonb) to authenticated;

create or replace function public.careon_scribe_analyse_bewaren(p_sessie uuid,p_versie integer,p_staat jsonb,p_laatste integer,
  p_bron text,p_model text,p_sprekers jsonb,p_correcties jsonb,p_taken jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_s public.careon_scribe_sessies; v_t public.careon_scribe_staat; v_e jsonb;
begin
  v_s:=app.scribe_sessie_vergrendelen(p_sessie);
  if p_versie is null or p_versie<1 or p_laatste is null or p_staat is null
    or jsonb_typeof(p_sprekers) is distinct from 'array' or jsonb_typeof(p_correcties) is distinct from 'array'
    or jsonb_typeof(p_taken) is distinct from 'array' then raise exception 'scribe: ongeldige analyse' using errcode='22023'; end if;
  select * into v_t from public.careon_scribe_staat where sessie_id=p_sessie for update;
  if not found or v_t.versie is distinct from p_versie then raise exception 'scribe: de analyse is intussen gewijzigd' using errcode='55000'; end if;
  if p_laatste<v_t.laatste_segment or p_laatste>v_s.segment_teller then
    raise exception 'scribe: ongeldige analysegrens' using errcode='22023'; end if;
  perform set_config('careon.scribe_content_rpc','analyse',true);
  for v_e in select value from jsonb_array_elements(p_sprekers) loop
    update public.careon_scribe_segmenten set spreker=v_e->>'spreker'
      where sessie_id=p_sessie and volgnummer=(v_e->>'volgnummer')::integer and spreker='onbekend';
  end loop;
  for v_e in select value from jsonb_array_elements(p_correcties) loop
    update public.careon_scribe_segmenten set tekst_gecorrigeerd=v_e->>'tekstGecorrigeerd',correctie_bron='ai'
      where sessie_id=p_sessie and volgnummer=(v_e->>'volgnummer')::integer and (correctie_bron is null or correctie_bron='ai');
  end loop;
  update public.careon_scribe_staat set staat=p_staat,versie=versie+1,laatste_segment=p_laatste,
    verouderd=false,bron=p_bron,model=p_model,updated_at=now() where sessie_id=p_sessie returning * into v_t;
  for v_e in select value from jsonb_array_elements(p_taken) loop
    if not exists(select 1 from public.careon_scribe_taken where sessie_id=p_sessie
      and lower(btrim(omschrijving))=lower(btrim(v_e->>'omschrijving')) and soort=v_e->>'soort') then
      insert into public.careon_scribe_taken(sessie_id,org_id,behandelaar_id,omschrijving,soort,bron_segmenten)
      values(p_sessie,v_s.org_id,v_s.behandelaar_id,v_e->>'omschrijving',v_e->>'soort',
        array(select value::integer from jsonb_array_elements_text(v_e->'bron')));
    end if;
  end loop;
  perform set_config('careon.scribe_content_rpc','',true);
  return to_jsonb(v_t);
end; $$;
revoke all on function public.careon_scribe_analyse_bewaren(uuid,integer,jsonb,integer,text,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.careon_scribe_analyse_bewaren(uuid,integer,jsonb,integer,text,text,jsonb,jsonb,jsonb) to authenticated;

-- Canonical format contract mirrors formaten.ts; tested against all eight.
create or replace function app.scribe_sectie_definities(p_formaat text)
returns jsonb language sql immutable set search_path = '' as $$
  select case p_formaat
    when 'soap' then '{"subjectief":false,"objectief":false,"analyse":true,"plan":false}'::jsonb
    when 'aobp' then '{"anamnese":false,"onderzoek":false,"beoordeling":true,"plan":false}'::jsonb
    when 'soep' then '{"subjectief":false,"objectief":false,"evaluatie":true,"plan":false}'::jsonb
    when 'psychiatrie' then '{"reden-van-komst":false,"speciele-anamnese":false,"psychiatrisch-onderzoek":false,"somatiek-medicatie":false,"sociale-anamnese":false,"risicotaxatie":true,"overwegingen":true,"beleid":false}'::jsonb
    when 'verpleegkundig' then '{"observaties":false,"interventies":false,"reactie-evaluatie":true,"vervolg":false}'::jsonb
    when 'seh' then '{"reden-triage":false,"anamnese":false,"onderzoek":false,"werkhypothese":true,"beleid-vervolg":false}'::jsonb
    when 'vervolg' then '{"beloop-sinds-vorig-contact":false,"huidige-klachten":false,"bevindingen":false,"beoordeling":true,"beleid":false}'::jsonb
    when 'ontslag' then '{"opnamereden":false,"beloop":false,"bevindingen-onderzoeken":false,"conclusie-beoordeling":true,"medicatie-bij-ontslag":false,"vervolgafspraken":false,"adviezen":false}'::jsonb
  end;
$$;
create or replace function app.scribe_secties_canoniek(p_formaat text,p_secties jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_d jsonb:=app.scribe_sectie_definities(p_formaat); v_e jsonb; v_ids text[]:='{}';
begin
  if v_d is null or not coalesce(app.careon_scribe_secties_geldig(p_secties),false)
    or jsonb_array_length(p_secties)<>(select count(*) from jsonb_object_keys(v_d)) then return false; end if;
  for v_e in select value from jsonb_array_elements(p_secties) loop
    if not (v_d?(v_e->>'id')) or (v_e->>'id')=any(v_ids)
      or jsonb_typeof(v_e->'vereistBehandelaar') is distinct from 'boolean'
      or (v_d->(v_e->>'id')='true'::jsonb and v_e->'vereistBehandelaar'<>'true'::jsonb)
      or jsonb_typeof(v_e->'tekst') is distinct from 'string'
      or jsonb_typeof(v_e->'conceptTekst') is distinct from 'string' then return false; end if;
    v_ids:=array_append(v_ids,v_e->>'id');
  end loop;
  return true;
end; $$;
revoke all on function app.scribe_sectie_definities(text),app.scribe_secties_canoniek(text,jsonb) from public,anon;
grant execute on function app.scribe_sectie_definities(text),app.scribe_secties_canoniek(text,jsonb) to authenticated,service_role;
alter table public.careon_scribe_notities drop constraint if exists careon_scribe_notities_canoniek;
alter table public.careon_scribe_notities add constraint careon_scribe_notities_canoniek
  check(app.scribe_secties_canoniek(formaat,secties)) not valid;

create or replace function public.careon_scribe_notitie_maken(p_sessie uuid,p_staat_versie integer,p_formaat text,p_secties jsonb,p_bron text,p_model text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_s public.careon_scribe_sessies; v_t public.careon_scribe_staat; v_n public.careon_scribe_notities;
begin
  v_s:=app.scribe_sessie_vergrendelen(p_sessie);
  select * into v_t from public.careon_scribe_staat where sessie_id=p_sessie;
  if not found or p_staat_versie is null or p_staat_versie<1 or v_s.status<>'afgerond' or v_t.versie is distinct from p_staat_versie or v_t.verouderd
    or v_t.laatste_segment<>v_s.segment_teller then
    raise exception 'scribe: analyse of transcript is intussen gewijzigd; genereer opnieuw' using errcode='55000'; end if;
  if not app.scribe_secties_canoniek(p_formaat,p_secties) or (v_s.taal='en' and p_bron in ('deterministisch','demo') and
    exists(select 1 from jsonb_array_elements(p_secties) e where e->'vereistBehandelaar'<>'true'::jsonb)) or exists(select 1 from jsonb_array_elements(p_secties) e
    where e->>'status' not in ('leeg','concept') or ((e->>'vereistBehandelaar')::boolean and length(btrim(e->>'tekst'))>0)) then
    raise exception 'scribe: ongeldig concept of machinale beoordelingssectie' using errcode='22023'; end if;
  perform set_config('careon.scribe_content_rpc','notitie',true);
  insert into public.careon_scribe_notities(sessie_id,org_id,behandelaar_id,versie,formaat,secties,bron,model,bron_staat_versie,bron_transcript_revisie)
    values(p_sessie,v_s.org_id,v_s.behandelaar_id,(select coalesce(max(versie),0)+1 from public.careon_scribe_notities where sessie_id=p_sessie),
      p_formaat,p_secties,p_bron,p_model,v_t.versie,v_s.transcript_revisie) returning * into v_n;
  update public.careon_scribe_sessies set notitie_model=p_model,updated_at=now() where id=p_sessie;
  perform set_config('careon.scribe_content_rpc','',true);
  return to_jsonb(v_n);
end; $$;
revoke all on function public.careon_scribe_notitie_maken(uuid,integer,text,jsonb,text,text) from public,anon;
grant execute on function public.careon_scribe_notitie_maken(uuid,integer,text,jsonb,text,text) to authenticated;

-- Revoke the old revision-free approval endpoint. Only the atomic edit/approve
-- operation below can establish a new approved document.
revoke all on function public.careon_scribe_notitie_goedkeuren(uuid) from authenticated,service_role;

create or replace function public.careon_scribe_notitie_bewerken(p_notitie uuid,p_sessie uuid,p_revisie integer,p_patches jsonb,
  p_alle_goedkeuren boolean default false,p_gaten_beoordeeld boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_s public.careon_scribe_sessies; v_t public.careon_scribe_staat; v_n public.careon_scribe_notities;
  v_e jsonb; v_p jsonb; v_secties jsonb:='[]'; v_over jsonb:='[]'; v_compleet boolean;
begin
  select sessie_id into v_id from public.careon_scribe_notities where id=p_notitie and sessie_id=p_sessie;
  v_s:=app.scribe_sessie_vergrendelen(v_id);
  select * into v_n from public.careon_scribe_notities where id=p_notitie for update;
  select * into v_t from public.careon_scribe_staat where sessie_id=v_id;
  if v_n.bewerk_revisie is distinct from p_revisie or v_n.status<>'concept' then
    raise exception 'scribe: verslag is intussen gewijzigd; laad de laatste versie' using errcode='55000'; end if;
  if not found or v_t.versie is null or v_n.bron_staat_versie is null or v_n.bron_transcript_revisie is null
    or v_s.status<>'afgerond' or v_n.bron_staat_versie is distinct from v_t.versie
    or v_n.bron_transcript_revisie is distinct from v_s.transcript_revisie or v_t.verouderd
    or v_t.laatste_segment<>v_s.segment_teller then
    raise exception 'scribe: de bron van dit verslag is gewijzigd; genereer opnieuw' using errcode='55000'; end if;
  if not app.scribe_secties_canoniek(v_n.formaat,v_n.secties) or jsonb_typeof(p_patches) is distinct from 'array'
    or jsonb_array_length(p_patches)>12 then raise exception 'scribe: ongeldige secties' using errcode='22023'; end if;
  if (jsonb_array_length(p_patches)=0 and p_alle_goedkeuren is distinct from true)
    or exists(select 1 from jsonb_array_elements(p_patches) p where jsonb_typeof(p) is distinct from 'object'
      or jsonb_typeof(p->'id') is distinct from 'string'
      or not (app.scribe_sectie_definities(v_n.formaat)?(p->>'id'))
      or not (p?'tekst' or p?'status')
      or (p?'tekst' and jsonb_typeof(p->'tekst') is distinct from 'string')
      or (p?'status' and coalesce(p->>'status','') not in ('leeg','concept','bewerkt','goedgekeurd'))
      or (p-array['id','tekst','status'])<>'{}'::jsonb)
    or (select count(*)<>count(distinct p->>'id') from jsonb_array_elements(p_patches) p) then
      raise exception 'scribe: ongeldige of dubbele sectiewijziging' using errcode='22023'; end if;
  for v_e in select value from jsonb_array_elements(v_n.secties) loop
    for v_p in select value from jsonb_array_elements(p_patches) where value->>'id'=v_e->>'id' loop
      if v_p?'tekst' then
        if jsonb_typeof(v_p->'tekst')<>'string' then raise exception 'scribe: ongeldige tekst' using errcode='22023'; end if;
        v_e:=v_e||jsonb_build_object('tekst',v_p->>'tekst','status','bewerkt');
      end if;
      if v_p?'status' then v_e:=v_e||jsonb_build_object('status',v_p->>'status'); end if;
    end loop;
    if p_alle_goedkeuren then
      if (v_e->>'vereistBehandelaar')::boolean then
        if v_e->>'status'<>'goedgekeurd' then v_over:=v_over||jsonb_build_array(v_e->>'id'); end if;
      elsif length(btrim(coalesce(nullif(v_e->>'tekst',''),v_e->>'conceptTekst','')))>0 then
        v_e:=v_e||jsonb_build_object('tekst',coalesce(nullif(v_e->>'tekst',''),v_e->>'conceptTekst'),'status','goedgekeurd');
      end if;
    end if;
    if v_e->>'status'='goedgekeurd' and length(btrim(v_e->>'tekst'))=0 then
      raise exception 'scribe: de beoordeling van de behandelaar of sectietekst ontbreekt' using errcode='55000'; end if;
    v_secties:=v_secties||jsonb_build_array(v_e);
  end loop;
  v_compleet:=not exists(select 1 from jsonb_array_elements(v_secties) e where e->>'status'<>'goedgekeurd');
  if v_compleet and v_s.ontbrekende_fragmenten>0 and p_gaten_beoordeeld is distinct from true then
    raise exception 'scribe: beoordeel eerst de ontbrekende fragmenten' using errcode='55000'; end if;
  if v_compleet and exists(select 1 from public.careon_scribe_notities where sessie_id=v_id and versie>v_n.versie) then
    raise exception 'scribe: keur uitsluitend de nieuwste verslagversie goed' using errcode='55000'; end if;
  perform set_config('careon.scribe_content_rpc','notitie',true);
  perform set_config('careon.scribe_rpc','1',true);
  update public.careon_scribe_notities set secties=v_secties,bewerk_revisie=bewerk_revisie+1,
    status=case when v_compleet then 'goedgekeurd' else 'concept' end,
    goedgekeurd_op=case when v_compleet then now() else null end,
    gaten_beoordeeld=case when v_compleet then v_s.ontbrekende_fragmenten else null end,updated_at=now()
    where id=p_notitie returning * into v_n;
  if v_compleet then perform public.careon_scribe_status_zetten(v_id,'goedgekeurd'); end if;
  perform set_config('careon.scribe_rpc','',true);
  perform set_config('careon.scribe_content_rpc','',true);
  return jsonb_build_object('notitie',to_jsonb(v_n),'overgeslagen',v_over,'goedgekeurd',v_compleet);
end; $$;
revoke all on function public.careon_scribe_notitie_bewerken(uuid,uuid,integer,jsonb,boolean,boolean) from public,anon;
grant execute on function public.careon_scribe_notitie_bewerken(uuid,uuid,integer,jsonb,boolean,boolean) to authenticated;

create or replace function public.careon_scribe_taak_bijwerken(p_sessie uuid,p_taak uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_s public.careon_scribe_sessies; v_t public.careon_scribe_taken;
begin
  v_s:=app.scribe_sessie_vergrendelen(p_sessie);
  perform set_config('careon.scribe_content_rpc','taak',true);
  update public.careon_scribe_taken set status=p_status,updated_at=now() where sessie_id=p_sessie and id=p_taak returning * into v_t;
  if not found then raise exception 'scribe: taak niet gevonden' using errcode='55000'; end if;
  perform set_config('careon.scribe_content_rpc','',true);
  return to_jsonb(v_t);
end; $$;
revoke all on function public.careon_scribe_taak_bijwerken(uuid,uuid,text) from public,anon;
grant execute on function public.careon_scribe_taak_bijwerken(uuid,uuid,text) to authenticated;

-- These server-only operations re-use the canonical role predicates for the
-- trusted server's authenticated actor. No client can choose that actor: the
-- helper and both public RPCs have EXECUTE exclusively for service_role.
create or replace function app.scribe_service_actor(p_actor uuid,p_org uuid,p_beheer boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_claims text:=current_setting('request.jwt.claims',true);
  v_sub text:=current_setting('request.jwt.claim.sub',true); v_result boolean;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'scribe: serverbewerking vereist' using errcode='42501'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  v_result:=case when p_beheer then app.mag_scribe_beheren(p_org) else app.mag_scribe_gebruiken(p_org) end;
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
  return coalesce(v_result,false);
end; $$;
revoke all on function app.scribe_service_actor(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app.scribe_service_actor(uuid,uuid,boolean) to service_role;

create or replace function public.careon_scribe_sessie_verwijderen(p_org uuid,p_sessie uuid,p_actor uuid,
  p_forceer boolean default false,p_reden text default '',p_grond text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s public.careon_scribe_sessies; v_aantal integer; v_weg uuid; v_eigen boolean;
begin
  if not app.scribe_service_actor(p_actor,p_org,false) then raise exception 'scribe: niet gemachtigd' using errcode='42501'; end if;
  select * into v_s from public.careon_scribe_sessies where id=p_sessie and org_id=p_org for update;
  if not found then raise exception 'scribe: consult niet gevonden' using errcode='P0002'; end if;
  v_eigen:=v_s.behandelaar_id=p_actor;
  if not v_eigen and (not app.scribe_service_actor(p_actor,p_org,true) or coalesce(p_grond,'') not in
    ('toestemming_ingetrokken','verkeerd_dossier','technisch_onbruikbaar','overig')) then
    raise exception 'scribe: beheer en een verwijdergrond vereist' using errcode='42501'; end if;
  select count(*) into v_aantal from public.careon_scribe_notities where sessie_id=p_sessie and status='goedgekeurd';
  if v_s.status<>'overgenomen' and (v_s.status='goedgekeurd' or v_aantal>0)
    and not (coalesce(p_forceer,false) and length(btrim(coalesce(p_reden,''))) between 1 and 300) then
    raise exception 'scribe: bevestig verwijdering van het nog niet overgenomen verslag met een reden' using errcode='55000'; end if;
  delete from public.careon_scribe_sessies where id=p_sessie and org_id=p_org returning id into v_weg;
  if v_weg is null then raise exception 'scribe: consult niet verwijderd' using errcode='55000'; end if;
  return jsonb_build_object('verwijderd',true,'id',v_weg,'segmenten',v_s.segment_teller,'notities',v_aantal,
    'rol',case when v_eigen then 'eigenaar' else 'beheerder' end);
end; $$;
revoke all on function public.careon_scribe_sessie_verwijderen(uuid,uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.careon_scribe_sessie_verwijderen(uuid,uuid,uuid,boolean,text,text) to service_role;

create or replace function public.careon_scribe_vrijgeven(p_org uuid,p_sessie uuid,p_actor uuid,p_ontvanger uuid,p_reden text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s public.careon_scribe_sessies; v_v public.careon_scribe_vrijgaven;
begin
  if not app.scribe_service_actor(p_actor,p_org,true) then raise exception 'scribe: beheer vereist' using errcode='42501'; end if;
  select * into v_s from public.careon_scribe_sessies where id=p_sessie and org_id=p_org for update;
  if not found or v_s.status not in ('goedgekeurd','overgenomen') or v_s.sessie_verwijder_na<=now()
    or not exists(select 1 from public.careon_scribe_notities where sessie_id=p_sessie and status='goedgekeurd') then
    raise exception 'scribe: geen goedgekeurd verslag beschikbaar' using errcode='55000'; end if;
  if p_ontvanger=p_actor or p_ontvanger=v_s.behandelaar_id or not app.scribe_service_actor(p_ontvanger,p_org,false) then
    raise exception 'scribe: kies een andere gemachtigde collega' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reden,''))) not between 1 and 300 then
    raise exception 'scribe: een reden is verplicht' using errcode='22023'; end if;
  insert into public.careon_scribe_vrijgaven(sessie_id,org_id,aan_user_id,door_user_id,reden)
    values(p_sessie,p_org,p_ontvanger,p_actor,p_reden) returning * into v_v;
  return to_jsonb(v_v);
end; $$;
revoke all on function public.careon_scribe_vrijgeven(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.careon_scribe_vrijgeven(uuid,uuid,uuid,uuid,text) to service_role;

notify pgrst,'reload schema';

-- Preserve the established bounded/idempotent ingestion behavior behind the new content guard.
create or replace function public.careon_scribe_voeg_segmenten_toe(
  p_sessie uuid,
  p_fragment_id uuid,
  p_segmenten jsonb,
  p_duur_ms integer default 0,
  p_ontbrekend boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sessie public.careon_scribe_sessies;
  v_aantal integer;
  v_bestaand jsonb;
  v_rijen jsonb;
begin
  if jsonb_typeof(p_segmenten) is distinct from 'array' then
    raise exception 'scribe: segmenten moeten een array zijn' using errcode = '22023';
  end if;
  v_aantal := jsonb_array_length(p_segmenten);
  if v_aantal = 0 or v_aantal > 900 or p_duur_ms is null or p_duur_ms < 0 then
    raise exception 'scribe: ongeldige segmentaantallen of duur' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_segmenten) e where jsonb_typeof(e) is distinct from 'object') then
    raise exception 'scribe: ongeldige segmenten' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_segmenten) e
    where coalesce((e->>'beginMs')::numeric,0)<0 or coalesce((e->>'eindMs')::numeric,0)<0
      or ((e->>'beginMs')::numeric is not null and (e->>'eindMs')::numeric < (e->>'beginMs')::numeric)) then
    raise exception 'scribe: ongeldige segmenttijd' using errcode = '22023';
  end if;

  select * into v_sessie from public.careon_scribe_sessies s where s.id=p_sessie for update;
  if not found or v_sessie.behandelaar_id is distinct from auth.uid() or not app.mag_scribe_gebruiken(v_sessie.org_id) then
    raise exception 'scribe: consult niet gevonden' using errcode = '42501';
  end if;

  -- Idempotentie op (sessie_id, fragment_id): een herhaald fragment levert de
  -- bestaande segmenten terug in plaats van dubbele regels.
  if p_fragment_id is not null then
    select coalesce(jsonb_agg(to_jsonb(g) order by g.volgnummer), '[]'::jsonb) into v_bestaand
    from public.careon_scribe_segmenten g
    where g.sessie_id = p_sessie and g.fragment_id = p_fragment_id;
    if jsonb_array_length(v_bestaand) > 0 then
      return v_bestaand;
    end if;
  end if;

  -- Afrondingsvenster van 90 seconden: fragmenten die nog onderweg waren toen
  -- de behandelaar "Consult afronden" koos, mogen alsnog landen.
  if v_sessie.transcript_verwijder_na<=now() then raise exception 'scribe: transcripttermijn verlopen' using errcode='55000'; end if;
  if v_sessie.status <> 'actief'
     and not (v_sessie.status = 'afgerond'
       and v_sessie.beeindigd_op is not null
       and v_sessie.beeindigd_op > now() - interval '90 seconds') then
    raise exception 'scribe: dit consult neemt geen nieuwe segmenten meer aan' using errcode = '55000';
  end if;

  if v_sessie.segment_teller + v_aantal > 900 then
    raise exception 'scribe: maximaal 900 segmenten per consult' using errcode = '54000';
  end if;

  perform set_config('careon.scribe_content_rpc','segment',true);
  with nieuw as (
    insert into public.careon_scribe_segmenten (
      sessie_id, org_id, behandelaar_id, volgnummer, fragment_id, spreker,
      tekst, tekst_gecorrigeerd, correctie_bron, begin_ms, eind_ms, bron
    )
    select
      v_sessie.id,
      v_sessie.org_id,
      v_sessie.behandelaar_id,
      v_sessie.segment_teller + e.ord::integer,
      p_fragment_id,
      coalesce(nullif(e.segment ->> 'spreker', ''), 'onbekend'),
      coalesce(e.segment ->> 'tekst', ''),
      nullif(e.segment ->> 'tekstGecorrigeerd', ''),
      nullif(e.segment ->> 'correctieBron', ''),
      nullif(e.segment ->> 'beginMs', '')::integer,
      nullif(e.segment ->> 'eindMs', '')::integer,
      coalesce(nullif(e.segment ->> 'bron', ''), 'live')
    from jsonb_array_elements(p_segmenten) with ordinality as e(segment, ord)
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(nieuw) order by nieuw.volgnummer), '[]'::jsonb)
  into v_rijen
  from nieuw;

  update public.careon_scribe_sessies s
  set segment_teller = s.segment_teller + v_aantal,
      duur_ms = s.duur_ms + greatest(0, coalesce(p_duur_ms, 0)),
      ontbrekende_fragmenten = s.ontbrekende_fragmenten
        -- Missing audio is determined from the persisted rows. A caller may
        -- neither hide a system gap with false nor invent a gap with true.
        + case when exists (select 1 from jsonb_array_elements(v_rijen) r where r->>'bron'='systeem') then 1 else 0 end,
      updated_at = now()
  where s.id = v_sessie.id;

  perform set_config('careon.scribe_content_rpc','',true);
  return v_rijen;
end;
$$;

create or replace function public.careon_prune_scribe()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segmenten integer;
  v_staat integer;
  v_sessies integer;
  v_verlaten integer;
begin
  -- Uitvoerrecht ligt al uitsluitend bij de service-role; deze controle op de
  -- claims-container is verdediging in de diepte (huisstijl 20260821155300).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'scribe: opschonen is voorbehouden aan de service-role' using errcode = '42501';
  end if;
  -- Match content RPC lock order before touching any child row.
  perform 1 from public.careon_scribe_sessies s
    where s.transcript_verwijder_na < now() or s.sessie_verwijder_na < now()
      or (s.status='actief' and s.updated_at < now()-interval '24 hours')
    order by s.id for update;
  perform set_config('careon.scribe_rpc', '1', true);

  delete from public.careon_scribe_segmenten g
  where exists (
    select 1 from public.careon_scribe_sessies s
    where s.id = g.sessie_id
      and s.transcript_verwijder_na is not null
      and s.transcript_verwijder_na < now()
  );
  get diagnostics v_segmenten = row_count;

  delete from public.careon_scribe_staat t
  where exists (
    select 1 from public.careon_scribe_sessies s
    where s.id = t.sessie_id
      and s.transcript_verwijder_na is not null
      and s.transcript_verwijder_na < now()
  );
  get diagnostics v_staat = row_count;

  delete from public.careon_scribe_sessies s
  where s.sessie_verwijder_na is not null and s.sessie_verwijder_na < now();
  get diagnostics v_sessies = row_count;

  with verlaten as (
    update public.careon_scribe_sessies s
    set status = 'afgerond',
        beeindigd_op = coalesce(s.beeindigd_op, s.updated_at),
        transcript_verwijder_na = now() + make_interval(
          days => greatest(1, app.careon_scribe_retentie_dagen(s.org_id, 'transcriptRetentieDagen', 30))),
        sessie_verwijder_na = now() + make_interval(
          days => greatest(1, app.careon_scribe_retentie_dagen(s.org_id, 'transcriptRetentieDagen', 30)))
    where s.status = 'actief' and s.updated_at < now() - interval '24 hours'
    returning 1
  )
  select count(*) into v_verlaten from verlaten;

  perform set_config('careon.scribe_rpc', '', true);
  return jsonb_build_object(
    'segmenten_verwijderd', v_segmenten,
    'staat_verwijderd', v_staat,
    'sessies_verwijderd', v_sessies,
    'verlaten_afgerond', v_verlaten
  );
end;
$$;

create or replace function app.careon_scribe_tellers_bevries()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role'
    and coalesce(current_setting('careon.scribe_content_rpc',true),'')=''
    and (new.transcript_revisie,new.segment_teller,new.duur_ms,new.ontbrekende_fragmenten)
      is distinct from (old.transcript_revisie,old.segment_teller,old.duur_ms,old.ontbrekende_fragmenten) then
    raise exception 'scribe: transcriptrevisie en tellers lopen uitsluitend via de RPC' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function app.careon_scribe_tellers_bevries() from public,anon,authenticated,service_role;
drop trigger if exists careon_scribe_tellers_bevries on public.careon_scribe_sessies;
create trigger careon_scribe_tellers_bevries before update on public.careon_scribe_sessies
  for each row execute function app.careon_scribe_tellers_bevries();
notify pgrst,'reload schema';

-- Every deletion is server-authorized, verified and audited by the supported route.
revoke delete on public.careon_scribe_sessies from authenticated;
