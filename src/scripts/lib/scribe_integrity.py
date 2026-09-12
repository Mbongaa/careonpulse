"""Behavioral regressions for the additive Scribe audit remediation.

Runs on the synthetic database used by verify-scribe-postgres, after upgrading
the original schema. All assertions execute actual PostgreSQL functions/RLS;
the competing-writer tests use independent connections and real row locks.
"""
import json
import time
import uuid


def verify_integrity(db):
    checks = 0
    org, owner, admin, colleague, colleague2, outsider = [str(uuid.uuid4()) for _ in range(6)]

    def lit(value):
        return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"

    def caller(subject, sql):
        return f"set role authenticated; set request.jwt.claims = '{json.dumps({'sub': subject, 'role': 'authenticated'})}'; {sql}"

    def service(sql):
        return "set role service_role; set request.jwt.claims = '{\"role\":\"service_role\"}'; " + sql

    def read(sql, subject=owner):
        return db.sql(caller(subject, sql)).splitlines()[-1]

    def equal(actual, expected, label):
        nonlocal checks
        if str(actual) != str(expected):
            raise AssertionError(f"{label}: expected {expected!r}; got {actual!r}")
        checks += 1

    def refused(sql, subject=owner, code=None):
        nonlocal checks
        error = db.error(caller(subject, sql))
        if code and code not in error:
            raise AssertionError(f"Expected {code}: {error}")
        checks += 1

    def service_refused(sql, code=None):
        nonlocal checks
        error = db.error(service(sql))
        if code and code not in error:
            raise AssertionError(f"Expected {code}: {error}")
        checks += 1

    def raw(sql):
        return db.sql(service(sql)).splitlines()[-1]

    db.sql(f"""
      insert into public.organizations(id,name,slug) values ('{org}','Scribe integrity synthetic','audit-{org}');
      insert into auth.users(id,email) values ('{owner}','owner-{owner}@example.invalid'),
       ('{admin}','admin-{admin}@example.invalid'),('{colleague}','c-{colleague}@example.invalid'),
       ('{colleague2}','d-{colleague2}@example.invalid'),('{outsider}','o-{outsider}@example.invalid');
      insert into public.organization_members(org_id,user_id,role) values
       ('{org}','{owner}','member'),('{org}','{admin}','org_admin'),
       ('{org}','{colleague}','member'),('{org}','{colleague2}','member');
      insert into public.careon_scribe_gemachtigden(org_id,user_id) values
       ('{org}','{owner}'),('{org}','{colleague}'),('{org}','{colleague2}');
    """)
    settings = {"ingeschakeld": True, "dpiaVastgesteldOp": "2026-09-01", "dpiaEigenaar": "FG",
        "verwerkersovereenkomstBevestigd": True, "consenttekstGoedgekeurdOp": "2026-09-01",
        "consenttekst": "Transcript {transcriptRetentieDagen} dagen; verslag {notitieRetentieDagen} dagen.",
        "transcriptRetentieDagen": 30, "notitieRetentieDagen": 20, "transcriptWissenBijOvername": True}
    for key in ("dpiaVastgesteldOp", "dpiaEigenaar", "verwerkersovereenkomstBevestigd", "consenttekstGoedgekeurdOp"):
        for bad in (None, ""):
            malformed = {**settings, key: bad}
            refused(f"insert into public.careon_scribe_instellingen(org_id,state,revision) values ('{org}',{lit(malformed)},1)", admin)
            equal(read(f"select app.scribe_activatie_geldig({lit(malformed)})"), "f", f"missing {key} fails closed")
    for date in ("2026-99-01", "not-a-date", "2026-02-30"):
        equal(read(f"select app.scribe_activatie_geldig({lit({**settings, 'dpiaVastgesteldOp': date})})"), "f", "bad DPIA date")
    read(f"insert into public.careon_scribe_instellingen(org_id,state,revision) values ('{org}',{lit(settings)},1)", admin)

    def empty():
        arrays = "symptomen begeleidendeSymptomen uitlokkendeFactoren verlichtendeFactoren medicatie allergieen voorgeschiedenis familieanamnese leefstijl psychisch metingen onderzoek overwegingen plan acties ontbrekend waarschuwingen".split()
        return {"samenvatting": "", "hoofdklacht": None, "duur": None, "beloop": None, "ernst": None,
            **{key: [] for key in arrays}}

    def start(language="nl"):
        sid = str(uuid.uuid4())
        read(f"insert into public.careon_scribe_sessies(id,org_id,behandelaar_id,patient_referentie,taal,consent_bevestigd_op,consent_revisie,consent_tekst) values ('{sid}','{org}','{owner}','SYN-100','{language}',now(),1,'caller supplied text')")
        return sid

    def state(sid):
        return json.loads(read(f"select to_jsonb(t) from public.careon_scribe_staat t where sessie_id='{sid}'"))

    def prepare(sid):
        return json.loads(read(f"select public.careon_scribe_staat_bewaren('{sid}',0,{lit(empty())})"))

    def append(sid, text="Synthetic statement.", missing=False, fragment=None):
        frag = f"'{fragment}'" if fragment else "null"
        return json.loads(read(f"select public.careon_scribe_voeg_segmenten_toe('{sid}',{frag},{lit([{'spreker':'arts','tekst':text,'bron':'systeem' if missing else 'handmatig'}])},8000,{str(missing).lower()})"))

    def analysis_sql(sid, revision, value=None, last=1):
        return f"select public.careon_scribe_analyse_bewaren('{sid}',{revision},{lit(value or empty())},{last},'deterministisch',null,'[]','[]','[]')"

    def analyse(sid, last=1):
        return json.loads(read(analysis_sql(sid, state(sid)["versie"], last=last)))

    def sections(form="soap", english=False):
        defs = json.loads(read(f"select app.scribe_sectie_definities('{form}')"))
        return [{"id": key, "titel": key, "tekst": "" if required or english else "Synthetic draft.",
            "conceptTekst": "Synthetic source", "status": "leeg" if required or english else "concept",
            "bron": [1], "vereistBehandelaar": required or english} for key, required in defs.items()]

    def make(sid, form="soap", english=False):
        return json.loads(read(f"select public.careon_scribe_notitie_maken('{sid}',{state(sid)['versie']},'{form}',{lit(sections(form,english))},'deterministisch',null)"))

    def edit_sql(sid, note, patches, rev=None, all_=False, gaps=False):
        return f"select public.careon_scribe_notitie_bewerken('{note['id']}','{sid}',{rev or note['bewerk_revisie']},{lit(patches)},{str(all_).lower()},{str(gaps).lower()})"

    def approve(sid, note, gaps=False):
        patches = [{"id": s["id"], "tekst": "Clinician reviewed synthetic text", "status": "goedgekeurd"} for s in note["secties"]]
        return json.loads(read(edit_sql(sid, note, patches, gaps=gaps)))["notitie"]

    def finish(sid):
        return read(f"select public.careon_scribe_status_zetten('{sid}','afgerond')")

    sid = start()
    equal(read(f"select consent_tekst from public.careon_scribe_sessies where id='{sid}'"),
        "Transcript 30 dagen; verslag 20 dagen.", "canonical rendered consent replaces arbitrary input")
    refused(f"insert into public.careon_scribe_sessies(org_id,behandelaar_id,patient_referentie,consent_bevestigd_op,consent_revisie,consent_tekst) values ('{org}','{owner}','SYN-100',now(),9999,'invented')", code="55000")
    refused(f"select public.careon_scribe_staat_bewaren('{sid}',null,{lit(empty())})", code="22023")
    refused(f"update public.careon_scribe_sessies set segment_teller=500 where id='{sid}'", code="42501")
    prepared = prepare(sid)
    refused(f"insert into public.careon_scribe_segmenten(sessie_id,org_id,behandelaar_id,volgnummer,tekst) values ('{sid}','{org}','{owner}',901,'bypass')", code="42501")
    refused(f"update public.careon_scribe_staat set versie=999 where sessie_id='{sid}'", code="42501")
    fragment = str(uuid.uuid4())
    append(sid, fragment=fragment)
    append(sid, fragment=fragment)
    equal(read(f"select segment_teller from public.careon_scribe_sessies where id='{sid}'"), "1", "fragment retry idempotent")
    equal(read(f"select transcript_revisie from public.careon_scribe_sessies where id='{sid}'"), "1", "transcript revision follows actual insert")
    gap_sid, gap_fragment = start(), str(uuid.uuid4())
    for bad in ("null", "'null'::jsonb", "'{}'::jsonb", "'[null]'::jsonb"):
        refused(f"select public.careon_scribe_voeg_segmenten_toe('{gap_sid}',null,{bad},0,false)", code="22023")
    refused(f"select public.careon_scribe_voeg_segmenten_toe('{gap_sid}',null,{lit([{'tekst':'bad time','beginMs':-1}])},0,false)", code="22023")
    refused(f"select public.careon_scribe_voeg_segmenten_toe('{gap_sid}',null,{lit([{'tekst':'bad duration'}])},-1,false)", code="22023")
    read(f"select public.careon_scribe_voeg_segmenten_toe('{gap_sid}','{gap_fragment}',{lit([{'tekst':'Unrecoverable fragment','bron':'systeem'}])},4000,false)")
    equal(read(f"select ontbrekende_fragmenten from public.careon_scribe_sessies where id='{gap_sid}'"), "1", "false flag cannot hide a persisted system gap")
    append(gap_sid, missing=True, fragment=gap_fragment)
    equal(read(f"select ontbrekende_fragmenten from public.careon_scribe_sessies where id='{gap_sid}'"), "1", "gap retry cannot double count")
    append(sid, missing=True, fragment=fragment)
    equal(read(f"select ontbrekende_fragmenten from public.careon_scribe_sessies where id='{sid}'"), "0", "restored gap ID returns committed audio without adding gap")
    equal(read(f"select tekst from public.careon_scribe_segmenten where sessie_id='{sid}'"), "Synthetic statement.", "restored gap ID preserves original content")
    for subject in (admin, colleague, outsider):
        equal(read(f"select count(*) from public.careon_scribe_segmenten where sessie_id='{sid}'", subject), "0", "owner-only transcript after upgrade")
        refused(f"select public.careon_scribe_staat_bewaren('{sid}',1,{lit(empty())})", subject, "42501")
    analysed = analyse(sid)
    old_revision = analysed["versie"]
    read(f"select public.careon_scribe_segment_corrigeren('{sid}',1,{lit({'tekst_gecorrigeerd':'Clinician correction'})})")
    equal(state(sid)["verouderd"], True, "correction invalidates state")
    equal(state(sid)["versie"], old_revision + 1, "correction increments CAS token")
    equal(state(sid)["laatste_segment"], 0, "correction rewinds machine-state reconstruction")
    refused(analysis_sql(sid, old_revision), code="55000")
    equal(state(sid)["verouderd"], True, "late analysis cannot clear correction invalidation")
    analyse(sid)
    refused(analysis_sql(sid, "null"), code="22023")
    finish(sid)
    note = make(sid)
    refused(f"select public.careon_scribe_notitie_goedkeuren('{note['id']}')", code="42501")
    refused(f"insert into public.careon_scribe_notities(sessie_id,org_id,behandelaar_id) values ('{sid}','{org}','{owner}')", code="42501")
    for malformed in ([None], [{}], [{"id":"unknown","tekst":"text"}], [{"id":"analyse","status":None}],
            [{"id":"analyse","tekst":None}], [{"id":"analyse","tekst":"a"},{"id":"analyse","tekst":"b"}]):
        refused(edit_sql(sid,note,malformed), code="22023")
    refused(edit_sql(sid,note,[]), code="22023")
    first = json.loads(read(edit_sql(sid,note,[{"id":"subjectief","tekst":"Clinician A"}])))["notitie"]
    refused(edit_sql(sid,note,[{"id":"objectief","tekst":"Clinician B"}]), code="55000")
    saved = json.loads(read(f"select secties from public.careon_scribe_notities where id='{note['id']}'"))
    equal(next(s['tekst'] for s in saved if s['id']=='subjectief'), "Clinician A", "stale second edit cannot erase first")

    # Real concurrent connections, forced into the competing-write schedule.
    lock = db.start_sql(caller(owner, f"begin; select 1 from public.careon_scribe_sessies where id='{sid}' for update; select pg_sleep(0.7); {edit_sql(sid,first,[{'id':'subjectief','tekst':'Winner'}])}; commit;"))
    time.sleep(0.15)
    loser = db.start_sql(caller(owner, edit_sql(sid,first,[{"id":"objectief","tekst":"Must not overwrite"}])))
    out, err = lock.communicate(timeout=10)
    equal(lock.returncode, 0, f"first locked writer commits {err}")
    out, err = loser.communicate(timeout=10)
    equal(loser.returncode != 0 and "55000" in err, True, "concurrent stale note writer gets conflict")

    # Fresh source correction invalidates a previously generated note.
    fresh_note = json.loads(read(f"select to_jsonb(n) from public.careon_scribe_notities n where id='{note['id']}'"))
    read(f"select public.careon_scribe_segment_corrigeren('{sid}',1,{lit({'spreker':'patient'})})")
    refused(edit_sql(sid,fresh_note,[{"id":"analyse","tekst":"Should not approve stale source","status":"goedgekeurd"}]), code="55000")
    analyse(sid)
    new_note = make(sid)
    approved = approve(sid,new_note)
    equal(approved["status"], "goedgekeurd", "atomic approval succeeds after fresh generation")
    equal(read(f"select status from public.careon_scribe_sessies where id='{sid}'"), "goedgekeurd", "session and note approved atomically")
    refused(f"select public.careon_scribe_segment_corrigeren('{sid}',1,{lit({'spreker':'arts'})})", code="55000")
    refused(f"select public.careon_scribe_staat_bewaren('{sid}',{state(sid)['versie']},{lit(empty())})", code="55000")
    # Protected deletion is rechecked in its transaction, not from a prior GET.
    delete = f"select public.careon_scribe_sessie_verwijderen('{org}','{sid}','{admin}',false,'','overig')"
    service_refused(delete, "55000")
    refused(delete, admin, "42501")
    refused(f"delete from public.careon_scribe_sessies where id='{sid}'", admin, "42501")

    def release_sql(recipient):
        return f"select public.careon_scribe_vrijgeven('{org}','{sid}','{admin}','{recipient}','Synthetic offboarding')"
    first_release = db.start_sql(service(f"begin; select 1 from public.careon_scribe_sessies where id='{sid}' for update; select pg_sleep(0.7); {release_sql(colleague)}; commit;"))
    time.sleep(0.15)
    second_release = db.start_sql(service(release_sql(colleague2)))
    _, err = first_release.communicate(timeout=10)
    equal(first_release.returncode, 0, f"first release commits {err}")
    _, err = second_release.communicate(timeout=10)
    equal(second_release.returncode != 0 and "23505" in err, True, "concurrent second recipient conflicts")
    equal(raw(f"select count(*) from public.careon_scribe_vrijgaven where sessie_id='{sid}'"), "1", "exactly one recipient")
    equal(read(f"select count(*) from public.careon_scribe_notities where sessie_id='{sid}' and status='goedgekeurd'",colleague), "1", "recipient reads approved note")
    equal(read(f"select count(*) from public.careon_scribe_notities where sessie_id='{sid}' and status='concept'",colleague), "0", "recipient cannot read draft")
    raw(f"delete from public.careon_scribe_gemachtigden where org_id='{org}' and user_id='{colleague}'")
    equal(read(f"select count(*) from public.careon_scribe_notities where sessie_id='{sid}'",colleague), "0", "revocation remains effective")
    deleted = json.loads(raw(f"select public.careon_scribe_sessie_verwijderen('{org}','{sid}','{admin}',true,'Synthetic explicit reason','overig')"))
    equal(deleted["id"],sid,"administrator deletion returns actual deleted ID")
    equal(read(f"select count(*) from public.careon_scribe_sessies where id='{sid}'"),"0","owner confirms row deleted")
    equal(raw(f"select count(*) from public.careon_scribe_segmenten where sessie_id='{sid}'"),"0","admin deletion cascades transcript")
    service_refused(f"select public.careon_scribe_sessie_verwijderen('{org}','{sid}','{admin}',true,'reason','overig')","P0002")

    # Missing source/null and canonical-format counterexamples.
    blank = start(); finish(blank)
    refused(f"select public.careon_scribe_notitie_maken('{blank}',null,'soap',{lit(sections())},'deterministisch',null)",code="55000")
    prepare(blank)
    for value in ([], [{"id":"analyse","titel":"A","tekst":"","conceptTekst":"","status":"leeg","bron":[],"vereistBehandelaar":False}]):
        refused(f"select public.careon_scribe_notitie_maken('{blank}',1,'soap',{lit(value)},'deterministisch',null)",code="22023")
    for form in ("soap","aobp","soep","psychiatrie","verpleegkundig","seh","vervolg","ontslag"):
        made = make(blank,form)
        equal(made["formaat"],form,"canonical format accepted")
        bad=sections(form)
        required=next(s for s in bad if s['vereistBehandelaar']); required['vereistBehandelaar']=False
        refused(f"select public.careon_scribe_notitie_maken('{blank}',1,'{form}',{lit(bad)},'deterministisch',null)",code="22023")
    english=start('en');prepare(english);finish(english)
    refused(f"select public.careon_scribe_notitie_maken('{english}',1,'soap',{lit(sections())},'deterministisch',null)",code="22023")
    en_note=make(english,english=True)
    bulk=json.loads(read(edit_sql(english,en_note,[],all_=True)))
    equal(bulk['goedgekeurd'],False,"English fallback cannot bulk approve")
    equal(len(bulk['overgeslagen']),4,"every English fallback section requires clinician entry")

    # A correction to a later segment still requires authoritative replay from
    # zero, while an ordinary append preserves the analysed context cursor.
    later=start();prepare(later)
    for _ in range(10): append(later)
    analyse(later,last=10)
    task_values=[{'omschrijving':'Synthetic machine suggestion','soort':'overig','bron':[10]},
      {'omschrijving':'Clinician reviewed task','soort':'overig','bron':[10]}]
    read(f"select public.careon_scribe_analyse_bewaren('{later}',{state(later)['versie']},{lit(empty())},10,'deterministisch',null,'[]','[]',{lit(task_values)})")
    task=read(f"select id from public.careon_scribe_taken where sessie_id='{later}' and omschrijving='Clinician reviewed task'")
    read(f"select public.careon_scribe_taak_bijwerken('{later}','{task}','goedgekeurd')")
    append(later)
    equal(state(later)['laatste_segment'],10,'ordinary append preserves preceding machine facts')
    for bad in (None, {}, {'arbitrary':'field'}, {'tekst_gecorrigeerd':''}):
        refused(f"select public.careon_scribe_segment_corrigeren('{later}',10,{lit(bad)})",code='22023')
    read(f"select public.careon_scribe_segment_corrigeren('{later}',10,{lit({'tekst_gecorrigeerd':'Corrected later medicine'})})")
    equal(state(later)['laatste_segment'],0,'correction to segment10 forces full machine-state replay')
    equal(read(f"select count(*) from public.careon_scribe_taken where sessie_id='{later}' and status='voorgesteld'"),0,'stale machine task suggestions cleared with correction')
    equal(read(f"select count(*) from public.careon_scribe_taken where sessie_id='{later}' and status='goedgekeurd'"),1,'clinician-reviewed tasks survive correction')
    refused(f"delete from public.careon_scribe_sessies where id='{later}'",code='42501')

    # Gaps cannot be acknowledged by SQL NULL or the old legacy RPC.
    gap=start();prepare(gap);append(gap,missing=True);analyse(gap);finish(gap);gap_note=make(gap)
    patches=[{'id':s['id'],'tekst':'Reviewed','status':'goedgekeurd'} for s in gap_note['secties']]
    refused(edit_sql(gap,gap_note,patches),code='55000')
    refused(edit_sql(gap,gap_note,patches).replace(",false)",",null)"),code='55000')
    equal(approve(gap,gap_note,gaps=True)['gaten_beoordeeld'],1,'gap count frozen on approval')

    # Cancellation wins while a completed analysis is queued on the parent lock.
    terminal=start();prepare(terminal);append(terminal)
    rev=state(terminal)['versie']
    cancel=db.start_sql(caller(owner,f"begin; select 1 from public.careon_scribe_sessies where id='{terminal}' for update; select pg_sleep(0.7); select public.careon_scribe_status_zetten('{terminal}','geannuleerd'); commit;"))
    time.sleep(0.15)
    late=db.start_sql(caller(owner,analysis_sql(terminal,rev)))
    _,err=cancel.communicate(timeout=10);equal(cancel.returncode,0,f'cancellation commits {err}')
    _,err=late.communicate(timeout=10);equal(late.returncode!=0 and '55000' in err,True,'late analysis cannot resurrect state')
    equal(raw(f"select count(*) from public.careon_scribe_staat where sessie_id='{terminal}'"),'0','cancelled state stays erased')
    refused(f"select public.careon_scribe_staat_bewaren('{terminal}',0,{lit(empty())})",code='55000')
    refused(f"select public.careon_scribe_voeg_segmenten_toe('{terminal}',null,{lit([{'tekst':'late','bron':'handmatig'}])},0,false)",code='55000')
    refused(f"insert into public.careon_scribe_staat(sessie_id,org_id,behandelaar_id,staat) values ('{terminal}','{org}','{owner}',{lit(empty())})",code='42501')

    # A late note generation cannot land after cancellation either.
    late_note=start();prepare(late_note);finish(late_note)
    read(f"select public.careon_scribe_status_zetten('{late_note}','geannuleerd')")
    refused(f"select public.careon_scribe_notitie_maken('{late_note}',1,'soap',{lit(sections())},'deterministisch',null)",code='55000')
    # Retention remains functional with parent-first pruning and service role.
    raw(f"update public.careon_scribe_sessies set sessie_verwijder_na=now()-interval '1 second' where id='{terminal}'")
    prune=json.loads(raw("select public.careon_prune_scribe()"))
    equal(prune['sessies_verwijderd']>=1,True,'retention removes expired terminal sessions')
    equal(raw(f"select count(*) from public.careon_scribe_sessies where id='{terminal}'"),'0','expired session gone')
    # Service-only mutations reject a stale/deactivated administrator identity.
    db.sql(f"update auth.users set banned_until=now()+interval '1 day' where id='{admin}'")
    service_refused(f"select public.careon_scribe_sessie_verwijderen('{org}','{blank}','{admin}',false,'','overig')",'42501')
    equal(raw("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'careon_scribe%' and p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE')"),'0','no public authenticated definer added')
    print(f"scribe audit integrity: {checks} actual PostgreSQL assertions passed, including competing connections")
    return checks
