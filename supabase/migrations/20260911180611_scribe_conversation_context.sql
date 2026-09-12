-- Reviewable, exact conversation context. No new table, clinical fact or role.
-- Existing invoker RPCs, parent locks, CAS and retention remain authoritative.
create or replace function app.scribe_context_vorm(p_context jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_r jsonb; v_c jsonb; v_nr integer; v_prev integer; v_bron jsonb; v_ids text[];
  v_keys text[]:='{}'; v_key text; v_total integer:=0;
begin
  if p_context is null then return true; end if;
  if jsonb_typeof(p_context) is distinct from 'array' or jsonb_array_length(p_context)>600 then return false; end if;
  for v_r in select value from jsonb_array_elements(p_context) loop
    if jsonb_typeof(v_r) is distinct from 'object'
      or not v_r?&array['sectieId','bron','citaten','status']
      or v_r-array['sectieId','bron','citaten','status']<>'{}'::jsonb
      or jsonb_typeof(v_r->'sectieId') is distinct from 'string'
      or (v_r->>'sectieId') !~ '^[a-z][a-z0-9-]{0,79}$'
      or v_r->>'status' is distinct from 'te_controleren'
      or jsonb_typeof(v_r->'bron') is distinct from 'array'
      or jsonb_typeof(v_r->'citaten') is distinct from 'array'
      or jsonb_array_length(v_r->'citaten') not between 1 and 3 then return false; end if;
    v_prev:=0; v_bron:='[]'; v_ids:='{}';
    for v_c in select value from jsonb_array_elements(v_r->'citaten') loop
      if jsonb_typeof(v_c) is distinct from 'object'
        or not v_c?&array['segmentId','volgnummer','tekst']
        or v_c-array['segmentId','volgnummer','tekst']<>'{}'::jsonb
        or jsonb_typeof(v_c->'segmentId') is distinct from 'string'
        or length(v_c->>'segmentId') not between 1 and 100
        or jsonb_typeof(v_c->'volgnummer') is distinct from 'number'
        or (v_c->>'volgnummer') !~ '^[0-9]{1,4}$'
        or jsonb_typeof(v_c->'tekst') is distinct from 'string'
        or length(btrim(v_c->>'tekst'))<1 or length(v_c->>'tekst')>4000 then return false; end if;
      v_nr:=(v_c->>'volgnummer')::integer;
      if v_nr<=v_prev or (v_prev>0 and v_nr<>v_prev+1) or v_nr>900 or (v_c->>'segmentId')=any(v_ids) then return false; end if;
      v_prev:=v_nr; v_bron:=v_bron||jsonb_build_array(v_nr);
      v_ids:=array_append(v_ids,v_c->>'segmentId'); v_total:=v_total+length(v_c->>'tekst');
    end loop;
    if v_r->'bron' is distinct from v_bron then return false; end if;
    v_key:=(v_r->>'sectieId')||'|'||array_to_string(v_ids,'|');
    if v_key=any(v_keys) then return false; end if;
    v_keys:=array_append(v_keys,v_key);
  end loop;
  return v_total<=256000;
end; $$;

create or replace function app.scribe_context_bronnen(p_sessie uuid,p_context jsonb)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare v_r jsonb; v_c jsonb; v_type text; v_def jsonb;
begin
  if not app.scribe_context_vorm(p_context) then return false; end if;
  if p_context is null then return true; end if;
  select consult_type into v_type from public.careon_scribe_sessies where id=p_sessie;
  if not found then return false; end if;
  v_def:=app.scribe_sectie_definities(v_type);
  for v_r in select value from jsonb_array_elements(p_context) loop
    if not v_def?(v_r->>'sectieId') then return false; end if;
    for v_c in select value from jsonb_array_elements(v_r->'citaten') loop
      if not exists(select 1 from public.careon_scribe_segmenten g where g.sessie_id=p_sessie
        and g.id::text=v_c->>'segmentId' and g.volgnummer=(v_c->>'volgnummer')::integer
        and g.bron<>'systeem' and coalesce(g.tekst_gecorrigeerd,g.tekst)=v_c->>'tekst') then return false; end if;
    end loop;
  end loop;
  return true;
end; $$;

create or replace function app.careon_scribe_context_bewaken()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- The existing a_scribe_inhoud_guard locks this same parent first.
  perform 1 from public.careon_scribe_sessies where id=new.sessie_id for update;
  if not app.scribe_context_bronnen(new.sessie_id,new.staat->'gesprekscontext') then
    raise exception 'scribe: gesprekscontext komt niet overeen met de actuele bron' using errcode='22023';
  end if;
  return new;
end; $$;
revoke all on function app.scribe_context_vorm(jsonb),app.scribe_context_bronnen(uuid,jsonb) from public,anon;
grant execute on function app.scribe_context_vorm(jsonb),app.scribe_context_bronnen(uuid,jsonb) to authenticated,service_role;
revoke all on function app.careon_scribe_context_bewaken() from public,anon,authenticated,service_role;
alter table public.careon_scribe_staat add constraint careon_scribe_context_vorm
  check(app.scribe_context_vorm(staat->'gesprekscontext')) not valid;
create trigger b_scribe_context_bewaken before insert or update on public.careon_scribe_staat
  for each row execute function app.careon_scribe_context_bewaken();

create or replace function app.scribe_context_sectie(p_context jsonb,p_sectie text)
returns jsonb language sql immutable set search_path = '' as $$
  with citaten as (
    select distinct (c->>'volgnummer')::integer nr,c->>'tekst' tekst
    from jsonb_array_elements(coalesce(p_context,'[]'::jsonb)) r,
      jsonb_array_elements(r->'citaten') c where r->>'sectieId'=p_sectie
  ) select jsonb_build_object('bron',coalesce(jsonb_agg(nr order by nr),'[]'::jsonb),
    'tekst',case when count(*)=0 then '' else
      E'Gesprekscitaten — spreker en betekenis controleren. Dit zijn geen vastgestelde bevindingen of afspraken.\n\n'||
      string_agg('§'||nr||': '||tekst,E'\n\n' order by nr) end) from citaten;
$$;
create or replace function app.scribe_context_trim(p_tekst text)
returns text language sql immutable set search_path = '' as $$
  select btrim(p_tekst,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
revoke all on function app.scribe_context_sectie(jsonb,text),app.scribe_context_trim(text) from public,anon;
grant execute on function app.scribe_context_sectie(jsonb,text),app.scribe_context_trim(text) to authenticated,service_role;

create or replace function public.careon_scribe_notitie_maken(p_sessie uuid,p_staat_versie integer,p_formaat text,p_secties jsonb,p_bron text,p_model text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_s public.careon_scribe_sessies; v_t public.careon_scribe_staat; v_n public.careon_scribe_notities;
  v_e jsonb; v_context jsonb; v_tekst text; v_assessment boolean; v_positie integer:=0;
begin
  v_s:=app.scribe_sessie_vergrendelen(p_sessie);
  select * into v_t from public.careon_scribe_staat where sessie_id=p_sessie;
  if not found or p_staat_versie is null or p_staat_versie<1 or v_s.status<>'afgerond' or v_t.versie is distinct from p_staat_versie or v_t.verouderd
    or v_t.laatste_segment<>v_s.segment_teller then
    raise exception 'scribe: analyse of transcript is intussen gewijzigd; genereer opnieuw' using errcode='55000'; end if;
  if not app.scribe_secties_canoniek(p_formaat,p_secties)
    or not app.scribe_context_bronnen(p_sessie,v_t.staat->'gesprekscontext') then
    raise exception 'scribe: ongeldig concept of bron' using errcode='22023'; end if;
  for v_e in select value from jsonb_array_elements(p_secties) loop
    v_positie:=v_positie+1;
    v_assessment:=(app.scribe_sectie_definities(p_formaat)->>(v_e->>'id'))::boolean;
    v_context:=app.scribe_context_sectie(v_t.staat->'gesprekscontext',v_e->>'id');
    v_tekst:=v_context->>'tekst';
    if v_tekst<>'' and v_positie=1 and v_s.ontbrekende_fragmenten>0 then
      v_tekst:='Let op: '||v_s.ontbrekende_fragmenten||E' fragmenten ontbreken in het transcript.\n\n'||v_tekst;
    end if;
    if v_e->>'status' not in ('leeg','concept') or
      (v_assessment and length(btrim(v_e->>'tekst'))>0) then
      raise exception 'scribe: ongeldig concept of machinale beoordelingssectie' using errcode='22023'; end if;
    if v_tekst<>'' and v_e->>'conceptTekst'=v_tekst then
      if v_e->'bron' is distinct from v_context->'bron' or v_e->'vereistBehandelaar'<>'true'::jsonb
        or (not v_assessment and (v_e->>'tekst'<>v_tekst or v_e->>'status'<>'concept')) then
        raise exception 'scribe: gesprekscitaten vereisen exacte bron en eigen beoordeling' using errcode='22023'; end if;
    elsif ((v_e->>'vereistBehandelaar')::boolean and length(btrim(v_e->>'tekst'))>0)
      or (v_s.taal='en' and p_bron in ('deterministisch','demo') and v_e->'vereistBehandelaar'<>'true'::jsonb)
      or position('Gesprekscitaten — spreker en betekenis controleren.' in coalesce(v_e->>'conceptTekst',''))>0 then
      raise exception 'scribe: ongeldig concept of machinale beoordelingssectie' using errcode='22023';
    end if;
  end loop;
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

-- Any source correction invalidates every provisional conversation excerpt.
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
revoke all on function app.careon_scribe_transcript_gewijzigd() from public,anon,authenticated,service_role;
drop trigger if exists careon_scribe_transcript_gewijzigd on public.careon_scribe_segmenten;
create trigger careon_scribe_transcript_gewijzigd after insert or update on public.careon_scribe_segmenten
  for each row execute function app.careon_scribe_transcript_gewijzigd();


-- A verbatim context prefill cannot be approved without an individual rewrite.
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
    if v_e->>'status'='goedgekeurd' and v_e->'vereistBehandelaar'='true'::jsonb
      and not (app.scribe_sectie_definities(v_n.formaat)->>(v_e->>'id'))::boolean
      and position('Gesprekscitaten — spreker en betekenis controleren. Dit zijn geen vastgestelde bevindingen of afspraken.' in coalesce(v_e->>'conceptTekst',''))>0
      and app.scribe_context_trim(v_e->>'tekst')=app.scribe_context_trim(v_e->>'conceptTekst') then
      raise exception 'scribe: herschrijf de gesprekscitaten na individuele beoordeling' using errcode='55000'; end if;
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
