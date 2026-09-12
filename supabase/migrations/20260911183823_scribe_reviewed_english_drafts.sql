-- Canonical drafts from independently reviewed English source statements.
-- Conversation excerpts retain their stricter rewrite requirement; assessments
-- remain empty. No new table, RLS policy, or privileged public RPC.
create or replace function app.scribe_engelse_feitvelden(p_sectie text)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce('{
    "subjectief":["symptomen","begeleidendeSymptomen","medicatie","allergieen","leefstijl"],
    "anamnese":["symptomen","medicatie","allergieen"],"plan":["plan","acties"],
    "speciele-anamnese":["symptomen","begeleidendeSymptomen"],"somatiek-medicatie":["medicatie","allergieen"],
    "sociale-anamnese":["leefstijl"],"beleid":["plan","acties"],
    "observaties":["symptomen","medicatie","allergieen"],"interventies":["plan"],"vervolg":["acties"],
    "beleid-vervolg":["plan","acties"],"beloop-sinds-vorig-contact":["symptomen"],
    "huidige-klachten":["symptomen","medicatie","allergieen"],"beloop":["symptomen"],
    "medicatie-bij-ontslag":["medicatie","allergieen"],"vervolgafspraken":["acties"],"adviezen":["plan"]
  }'::jsonb->p_sectie,'[]'::jsonb);
$$;

create or replace function app.scribe_engelse_overige_velden(p_sectie text)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce('{
    "subjectief":["hoofdklacht","duur","beloop","ernst","uitlokkendeFactoren","verlichtendeFactoren","voorgeschiedenis","familieanamnese"],
    "anamnese":["hoofdklacht","duur","beloop","ernst","voorgeschiedenis","familieanamnese"],
    "speciele-anamnese":["uitlokkendeFactoren","verlichtendeFactoren"],"somatiek-medicatie":["voorgeschiedenis"],
    "sociale-anamnese":["familieanamnese"],"observaties":["hoofdklacht","duur","ernst","metingen","psychisch"],
    "beloop-sinds-vorig-contact":["beloop"],"huidige-klachten":["hoofdklacht","ernst"],"beloop":["beloop"]
  }'::jsonb->p_sectie,'[]'::jsonb);
$$;

-- This narrow allowlist mirrors english-evidence.ts. The source row is loaded
-- by the renderer under the caller's RLS, never accepted as a client identity.
create or replace function app.scribe_engels_feit_geldig(p_veld text,p_rij jsonb,p_bron public.careon_scribe_segmenten)
returns boolean language plpgsql immutable set search_path='' as $$
declare
  v_t text:=app.scribe_context_trim(coalesce(p_bron.tekst_gecorrigeerd,p_bron.tekst));
  v_patient boolean:=p_bron.spreker='patient'; v_onzeker boolean; v_ontkenning boolean; v_verleden boolean;
  v_stop boolean; v_prefix text; v_body text; v_clause text; v_name text; v_match text[]; v_doses text[];
  v_tail text; v_hits integer:=0;
begin
  if p_bron.id is null or p_bron.bron='systeem' or p_bron.spreker not in ('patient','arts')
    or p_bron.spreker_bron is distinct from 'behandelaar'
    or jsonb_typeof(p_rij->'ingetrokken') is distinct from 'boolean'
    or (p_rij->'ingetrokken'='true'::jsonb and not (p_veld='medicatie' and p_rij->>'gebruik'='gestopt'))
    or p_rij->'bron' is distinct from jsonb_build_array(p_bron.volgnummer)
    or p_rij->>'tekst' is distinct from coalesce(p_bron.tekst_gecorrigeerd,p_bron.tekst)
    or length(p_rij->>'tekst') not between 1 and 600 then return false; end if;
  if v_t ~ '\?' or v_t ~* $re$^(?:(?:do|does|did|am|are|is|was|were|have|has|had|can|could|would|will|shall|should|may|might|must)\s+(?:you|he|she|they|we|I|the patient)\y|(?:what|why|when|where|who|whose|which|how)\y)$re$
    or v_t ~* $re$\y(?:mother|father|brother|sister|daughter|son|partner|wife|husband|grandmother|grandfather)\y$re$
    or v_t ~* $re$\y(?:suicid\w*|self[- ]harm\w*|overdos\w*|homicid\w*|weapon\w*|knife|gun|psychos\w*|psychotic|hallucinat\w*|delusion\w*|voices|paranoi\w*)\y|\y(?:kill|hurt|harm) (?:myself|yourself|himself|herself|anyone|others|someone)\y|\y(?:want|wish) to die\y$re$
    or v_t ~* $re$(?<!\d)\.\s+\S|\y(?:but|however|although|except)\y$re$ then return false; end if;
  v_onzeker:=v_t ~* $re$\y(?:if|would|could|may|might|maybe|perhaps|possibly|possible|probably|think|believe|suppose|guess|consider\w*|suggest\w*|option\w*|unsure|uncertain|suspect\w*|seems?|apparently)\y|\ynot sure\y$re$;
  v_ontkenning:=v_t ~* $re$\y(?:not|no|never|neither|without|den(?:y|ies|ied)|declin\w*|refus\w*)\y|\y(?:don|doesn|didn|isn|aren|wasn|weren|haven|hasn|hadn|won|wouldn|couldn|shouldn|can)['’]t\y|\yruled out\y$re$;
  v_verleden:=v_t ~* $re$\y(?:yesterday|previously|formerly|earlier|ago|used to|last (?:night|week|month|year)|in the past|as a child|in (?:19|20)\d{2})\y|\yI (?:felt|had|was|used|took)\y$re$;
  v_stop:=v_t ~* $re$\y(?:stopp?ed|discontinued|ceased|no longer)\y$re$;
  if p_veld='medicatie' then
    if v_onzeker or jsonb_typeof(p_rij->'naam') is distinct from 'string'
      or jsonb_typeof(p_rij->'dosering') not in ('string','null') then return false; end if;
    v_name:=lower(normalize(app.scribe_context_trim(p_rij->>'naam'),NFC));
    if not '["sertraline","citalopram","escitalopram","paroxetine","fluoxetine","fluvoxamine","venlafaxine","duloxetine","diazepam","oxazepam","lorazepam","temazepam","morfine","oxycodon","tramadol","fentanyl","codeine","ibuprofen","naproxen","diclofenac","meloxicam","celecoxib","acetylsalicylzuur","aspirine","carbasalaatcalcium","amoxicilline","amoxicilline/clavulaanzuur","augmentin","flucloxacilline","feneticilline","benzylpenicilline","piperacilline","cotrimoxazol","sulfamethoxazol","haloperidol","olanzapine","quetiapine","risperidon","aripiprazol","clozapine","paliperidon","paliperidonpalmitaat","zuclopentixol","zuclopentixoldecanoaat","flupentixol","flupentixoldecanoaat","haloperidoldecanoaat","amitriptyline","nortriptyline","clomipramine","imipramine","doxepine","lithium","valproinezuur","valproaat","natriumvalproaat","lamotrigine","carbamazepine","methylfenidaat","dexamfetamine","lisdexamfetamine","fenelzine","tranylcypromine","moclobemide","selegiline","rasagiline","methadon","domperidon","sint-janskruid","linezolid","enalapril","lisinopril","perindopril","hydrochloorthiazide","acenocoumarol","fenprocoumon","methotrexaat","paracetamol","metformine","levothyroxine","melatonine","mirtazapine","pantoprazol","omeprazol","prednison","salbutamol","simvastatine","atorvastatine","metoprolol","bisoprolol","amlodipine","hydroxyzine","promethazine","biperideen","naltrexon","acamprosaat","disulfiram","sodium valproate"]'::jsonb?lower(regexp_replace(normalize(v_name,NFD),U&'[\0300-\036F]','','g')) then return false; end if;
    if p_rij->>'gebruik'='huidig' then
      if v_ontkenning or v_stop or v_verleden then return false; end if;
      v_prefix:=case when v_patient then '^I\s+(?:currently\s+)?(?:take|use|am (?:currently )?(?:taking|using))\s+(.+)$'
        else '^The patient\s+(?:currently\s+)?(?:takes|uses|is (?:currently )?(?:taking|using))\s+(.+)$' end;
    elsif p_rij->>'gebruik'='gestopt' then
      if v_t ~* $re$\y(?:not|never)\y|\y(?:haven|hasn|didn)['’]t\y$re$ then return false; end if;
      v_prefix:=case when v_patient then '^I\s+(?:(?:have\s+)?(?:stopped|discontinued|ceased)(?:\s+(?:taking|using))?|no longer\s+(?:take|use))\s+(.+)$'
        else '^The patient\s+(?:(?:has\s+)?(?:stopped|discontinued|ceased)(?:\s+(?:taking|using))?|no longer\s+(?:takes|uses))\s+(.+)$' end;
    else return false; end if;
    v_match:=regexp_match(v_t,v_prefix,'i'); if v_match is null then return false; end if; v_body:=v_match[1];
    foreach v_clause in array regexp_split_to_array(v_body,'\s+and\s+|;\s*|,\s*(?=[A-Za-z])','i') loop
      v_clause:=regexp_replace(regexp_replace(lower(normalize(app.scribe_context_trim(v_clause),NFC)),'[.!]$',''),'\s+',' ','g');
      if left(v_clause,length(v_name))=v_name and (length(v_clause)=length(v_name) or substring(v_clause from length(v_name)+1 for 1) ~ '\s') then
        v_hits:=v_hits+1; v_tail:=app.scribe_context_trim(substring(v_clause from length(v_name)+1));
      end if;
    end loop;
    if v_hits<>1 then return false; end if;
    if p_rij->'dosering'='null'::jsonb then return true; end if;
    v_doses:=regexp_match(v_tail,'^(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|µg|g|ml|units?|iu)\y','i');
    if v_doses is null then return false; end if;
    return regexp_replace(replace(replace(lower(p_rij->>'dosering'),',','.'),'µg','ug'),'\s+','','g')=
      replace(replace(lower(v_doses[1]||v_doses[2]),',','.'),'µg','ug');
  elsif p_veld='allergieen' then
    if v_ontkenning or v_onzeker or v_verleden or v_stop then return false; end if;
    v_prefix:=case when v_patient then '^I (?:am|have an?) ' else '^The patient (?:is|has an?) ' end;
    if p_rij->>'aard'='allergie' then return v_t ~* (v_prefix||'(?:allergic to|allergy to)\s+\S'); end if;
    if p_rij->>'aard'='intolerantie' then return v_t ~* (v_prefix||'(?:intolerant to|intolerance to)\s+\S'); end if;
    return false;
  elsif p_veld in ('symptomen','begeleidendeSymptomen','leefstijl') then
    if v_onzeker or v_verleden or not (v_t ~* case when v_patient then '^I\y' else '^The patient\y' end) then return false; end if;
    if p_veld<>'leefstijl' then
      return v_t ~* $re$\y(?:pain|aches?|headaches?|dizzy|dizziness|nausea|nauseous|vomit\w*|cough\w*|fever|tired|fatigue|breathless|short of breath|palpitation\w*|insomnia|diarrh\w*|constipat\w*|rash|poor appetite|anxious|sad)\y$re$;
    end if;
    if v_t !~* '\y(?:smoke|smokes|smoking|use|uses|using|take|takes|taking|drink|drinks|drinking)\y' then return false; end if;
    return case p_rij->>'categorie'
      when 'roken' then v_t ~* '\y(?:cigarettes?|tobacco|cigars?)\y'
      when 'alcohol' then v_t ~* '\y(?:alcohol|beer|wine|spirits|vodka|whisky|whiskey)\y'
      when 'drugs' then v_t ~* '\y(?:cannabis|marijuana|cocaine|heroin|mdma|ecstasy)\y' else false end;
  elsif p_veld in ('plan','acties') then
    if p_bron.spreker<>'arts' or v_onzeker or v_ontkenning or v_verleden then return false; end if;
    if v_t !~* '^(?:I will|We will|I am going to|We have agreed to)\s+(?:arrange|refer|contact|review|request|order|schedule|prescribe|start|stop|increase|decrease|discuss|send)\y' then return false; end if;
    return p_veld='plan' or (p_rij->>'soort'='overig' and p_rij->>'omschrijving'=p_rij->>'tekst' and length(p_rij->>'omschrijving')<=300);
  end if;
  return false;
end; $$;

create or replace function app.scribe_engelse_feitsectie(p_sessie uuid,p_staat jsonb,p_sectie text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_veld text; v_rij jsonb; v_bron public.careon_scribe_segmenten; v_nrs text; v_key text;
  v_keys text[]:='{}'; v_lines text[]:='{}'; v_all jsonb:='[]'; v_projection jsonb; v_other jsonb;
begin
  for v_veld in select value from jsonb_array_elements_text(app.scribe_engelse_overige_velden(p_sectie)) loop
    v_other:=p_staat->v_veld;
    if jsonb_typeof(v_other)='array' then
      if exists(select 1 from jsonb_array_elements(v_other) r where r->'ingetrokken' is distinct from 'true'::jsonb) then
        return jsonb_build_object('tekst','','bron','[]'::jsonb); end if;
    elsif v_other is not null and v_other not in ('null'::jsonb,'""'::jsonb,'false'::jsonb,'0'::jsonb) then
      return jsonb_build_object('tekst','','bron','[]'::jsonb);
    end if;
  end loop;
  for v_veld in select value from jsonb_array_elements_text(app.scribe_engelse_feitvelden(p_sectie)) loop
    for v_rij in select value from jsonb_array_elements(coalesce(p_staat->v_veld,'[]'::jsonb)) loop
      if v_rij->'ingetrokken'='true'::jsonb then continue; end if;
      if jsonb_typeof(v_rij) is distinct from 'object' or v_rij->'ingetrokken' is distinct from 'false'::jsonb
        or jsonb_typeof(v_rij->'tekst') is distinct from 'string' or length(app.scribe_context_trim(v_rij->>'tekst'))<1
        or length(v_rij->>'tekst')>600 or jsonb_typeof(v_rij->'bron') is distinct from 'array' then return jsonb_build_object('tekst','','bron','[]'::jsonb); end if;
      if exists(select 1 from jsonb_array_elements(v_rij->'bron') n where jsonb_typeof(n)<>'number' or n::text !~ '^[0-9]{1,3}$' or n::text::integer not between 1 and 900) then return jsonb_build_object('tekst','','bron','[]'::jsonb); end if;
      -- Structured clinician metadata must retain the existing full rendering.
      if v_rij->'doorBehandelaar'='true'::jsonb and v_veld in ('medicatie','allergieen','leefstijl','acties') then
        return jsonb_build_object('tekst','','bron','[]'::jsonb); end if;
      if v_rij->'doorBehandelaar' is distinct from 'true'::jsonb then
        if jsonb_array_length(v_rij->'bron')<>1 then return jsonb_build_object('tekst','','bron','[]'::jsonb); end if;
        select * into v_bron from public.careon_scribe_segmenten where sessie_id=p_sessie and volgnummer=(v_rij->'bron'->>0)::integer;
        if not found or not coalesce(app.scribe_engels_feit_geldig(v_veld,v_rij,v_bron),false) then return jsonb_build_object('tekst','','bron','[]'::jsonb); end if;
      end if;
      select string_agg(value,',' order by ord) into v_nrs from jsonb_array_elements_text(v_rij->'bron') with ordinality n(value,ord);
      v_key:=(v_rij->>'tekst')||'|'||coalesce(v_nrs,'');
      if v_key=any(v_keys) then continue; end if; v_keys:=array_append(v_keys,v_key);
      select string_agg('§'||value,', ' order by ord) into v_nrs from jsonb_array_elements_text(v_rij->'bron') with ordinality n(value,ord);
      v_lines:=array_append(v_lines,'- '||(v_rij->>'tekst')||case when v_nrs is null then '' else ' ('||v_nrs||')' end);
      v_all:=v_all||(v_rij->'bron');
    end loop;
  end loop;
  select coalesce(jsonb_agg(n order by n),'[]'::jsonb) into v_projection from (select distinct value::text::integer n from jsonb_array_elements(v_all)) q;
  return jsonb_build_object('tekst',case when cardinality(v_lines)=0 then '' else
    E'Vastgelegde feiten — controleer de inhoud vóór goedkeuring.\n\n'||array_to_string(v_lines,E'\n') end,'bron',v_projection);
end; $$;
revoke all on function app.scribe_engelse_feitvelden(text),app.scribe_engelse_overige_velden(text),app.scribe_engels_feit_geldig(text,jsonb,public.careon_scribe_segmenten),
 app.scribe_engelse_feitsectie(uuid,jsonb,text) from public,anon;
grant execute on function app.scribe_engelse_feitvelden(text),app.scribe_engelse_overige_velden(text),app.scribe_engels_feit_geldig(text,jsonb,public.careon_scribe_segmenten),
 app.scribe_engelse_feitsectie(uuid,jsonb,text) to authenticated,service_role;

create or replace function public.careon_scribe_notitie_maken(p_sessie uuid,p_staat_versie integer,p_formaat text,p_secties jsonb,p_bron text,p_model text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_s public.careon_scribe_sessies; v_t public.careon_scribe_staat; v_n public.careon_scribe_notities;
  v_e jsonb; v_context jsonb; v_feiten jsonb; v_feittekst text; v_tekst text; v_assessment boolean; v_positie integer:=0;
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
    v_feiten:=case when v_s.taal='en' and not v_assessment then app.scribe_engelse_feitsectie(p_sessie,v_t.staat,v_e->>'id') else '{"tekst":"","bron":[]}'::jsonb end;
    v_feittekst:=v_feiten->>'tekst';
    if v_feittekst<>'' and v_positie=1 and v_s.ontbrekende_fragmenten>0 then
      v_feittekst:='Let op: '||v_s.ontbrekende_fragmenten||E' fragmenten ontbreken in het transcript.\n\n'||v_feittekst;
    end if;
    if v_feittekst<>'' and v_e->>'conceptTekst'=v_feittekst then
      if v_e->>'tekst'<>v_feittekst or v_e->'bron' is distinct from v_feiten->'bron'
        or v_e->'vereistBehandelaar'<>'true'::jsonb or v_e->>'status'<>'concept' then
        raise exception 'scribe: vastgelegde feiten vereisen exacte bron en individuele beoordeling' using errcode='22023'; end if;
    elsif v_tekst<>'' and v_e->>'conceptTekst'=v_tekst then
      if v_e->'bron' is distinct from v_context->'bron' or v_e->'vereistBehandelaar'<>'true'::jsonb
        or (not v_assessment and (v_e->>'tekst'<>v_tekst or v_e->>'status'<>'concept')) then
        raise exception 'scribe: gesprekscitaten vereisen exacte bron en eigen beoordeling' using errcode='22023'; end if;
    elsif ((v_e->>'vereistBehandelaar')::boolean and length(btrim(v_e->>'tekst'))>0)
      or (v_s.taal='en' and p_bron in ('deterministisch','demo') and v_e->'vereistBehandelaar'<>'true'::jsonb)
      or position('Vastgelegde feiten — controleer de inhoud vóór goedkeuring.' in coalesce(v_e->>'conceptTekst',''))>0
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


notify pgrst,'reload schema';
