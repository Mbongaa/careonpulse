-- Speaker provenance is not a clinical role claim. Legacy rows remain unverified.
-- Only an explicit owner role correction stamps clinician confirmation.
alter table public.careon_scribe_segmenten add column spreker_bron text
  constraint careon_scribe_spreker_bron check(spreker_bron in ('behandelaar','ai'));
comment on column public.careon_scribe_segmenten.spreker_bron is
  'Null: legacy/unverified. ai: inferred. behandelaar: explicit authenticated owner speaker correction.';

create or replace function app.careon_scribe_spreker_bron_bewaken()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_mode text:=coalesce(current_setting('careon.scribe_content_rpc',true),'');
begin
  if tg_op='INSERT' then
    if new.spreker_bron is not null then
      raise exception 'scribe: nieuwe fragmenten hebben geen bevestigde sprekerherkomst' using errcode='42501'; end if;
  elsif (new.spreker,new.spreker_bron) is distinct from (old.spreker,old.spreker_bron) then
    if v_mode='correctie' and new.spreker_bron='behandelaar' then return new; end if;
    if v_mode='analyse' and old.spreker='onbekend' and old.spreker_bron is distinct from 'behandelaar'
      and new.spreker_bron='ai' then return new; end if;
    raise exception 'scribe: sprekerherkomst wijzigen vereist de juiste bronbewerking' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function app.careon_scribe_spreker_bron_bewaken() from public,anon,authenticated,service_role;
create trigger b_scribe_spreker_bron_bewaken before insert or update on public.careon_scribe_segmenten
  for each row execute function app.careon_scribe_spreker_bron_bewaken();

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
  if exists(select 1 from jsonb_array_elements(p_segmenten) e
    where e?'sprekerBron' or e?'spreker_bron') then
    raise exception 'scribe: sprekerherkomst wordt uitsluitend door de server vastgelegd' using errcode='22023';
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
    spreker_bron=case when p_patch?'spreker' then 'behandelaar' else spreker_bron end,
    tekst_gecorrigeerd=case when p_patch?'tekst_gecorrigeerd' then p_patch->>'tekst_gecorrigeerd' else tekst_gecorrigeerd end,
    correctie_bron=case when p_patch?'tekst_gecorrigeerd' then case when p_patch->>'tekst_gecorrigeerd' is null then null else 'behandelaar' end else correctie_bron end
    where sessie_id=p_sessie and volgnummer=p_volgnummer returning * into v_g;
  if not found then raise exception 'scribe: segment niet gevonden' using errcode='55000'; end if;
  select * into v_t from public.careon_scribe_staat where sessie_id=p_sessie;
  perform set_config('careon.scribe_content_rpc','',true);
  return jsonb_build_object('segment',to_jsonb(v_g),'verouderd',coalesce(v_t.verouderd,false),'laatsteSegment',coalesce(v_t.laatste_segment,0));
end; $$;

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
  if exists(select 1 from jsonb_array_elements(p_sprekers) e
    where jsonb_typeof(e) is distinct from 'object'
      or not e?&array['volgnummer','spreker'] or e-array['volgnummer','spreker']<>'{}'::jsonb
      or jsonb_typeof(e->'volgnummer') is distinct from 'number'
      or (e->>'volgnummer') !~ '^[0-9]{1,4}$' or (e->>'volgnummer')::integer not between 1 and 900
      or jsonb_typeof(e->'spreker') is distinct from 'string'
      or e->>'spreker' not in ('arts','patient','overig','onbekend')) then
    raise exception 'scribe: ongeldige AI-sprekertoewijzing' using errcode='22023'; end if;
  perform set_config('careon.scribe_content_rpc','analyse',true);
  for v_e in select value from jsonb_array_elements(p_sprekers) loop
    update public.careon_scribe_segmenten set spreker=v_e->>'spreker',spreker_bron='ai'
      where sessie_id=p_sessie and volgnummer=(v_e->>'volgnummer')::integer and spreker='onbekend' and spreker_bron is distinct from 'behandelaar';
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

create or replace function app.careon_scribe_transcript_gewijzigd()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_nr integer;
begin
  v_id:=case when tg_op='DELETE' then old.sessie_id else new.sessie_id end;
  v_nr:=case when tg_op='DELETE' then old.volgnummer else new.volgnummer end;
  if tg_op='UPDATE' and (new.spreker,new.spreker_bron,new.tekst_gecorrigeerd,new.correctie_bron) is not distinct from
    (old.spreker,old.spreker_bron,old.tekst_gecorrigeerd,old.correctie_bron) then return new; end if;
  update public.careon_scribe_sessies set transcript_revisie=transcript_revisie+1 where id=v_id;
  if coalesce(current_setting('careon.scribe_content_rpc',true),'')<>'analyse' then
    update public.careon_scribe_staat set versie=versie+1,verouderd=true,epd_lijst_beoordeeld=false,
      staat=case when tg_op='UPDATE' then staat-'gesprekscontext' else staat end,
      laatste_segment=case when tg_op='UPDATE' then 0 else least(laatste_segment,greatest(0,v_nr-1)) end,updated_at=now() where sessie_id=v_id;
    if tg_op='UPDATE' then
      -- Machine suggestions are rebuilt from corrected source. Preserve explicit
      -- clinician decisions (approved/rejected/completed tasks).
      delete from public.careon_scribe_taken where sessie_id=v_id and status='voorgesteld';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
-- CREATE OR REPLACE retains the existing grants. Restate the intended boundary.
revoke all on function public.careon_scribe_segment_corrigeren(uuid,integer,jsonb),
 public.careon_scribe_analyse_bewaren(uuid,integer,jsonb,integer,text,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.careon_scribe_segment_corrigeren(uuid,integer,jsonb),
 public.careon_scribe_analyse_bewaren(uuid,integer,jsonb,integer,text,text,jsonb,jsonb,jsonb) to authenticated;
revoke all on function app.careon_scribe_transcript_gewijzigd() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
