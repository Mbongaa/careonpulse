"""Exact source-bound context regressions against actual local PostgreSQL RPCs.

Only synthetic conversation text is used. Called after both an additive upgrade
and a clean migration chain by verify-scribe-postgres.py.
"""
import copy
import json
import time
import uuid


HEADER = "Gesprekscitaten — spreker en betekenis controleren. Dit zijn geen vastgestelde bevindingen of afspraken."


def verify_context(db):
    checks = 0
    org, owner, admin, colleague = [str(uuid.uuid4()) for _ in range(4)]

    def lit(value):
        return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"

    def caller(sql, subject=owner):
        return f"set role authenticated; set request.jwt.claims = '{json.dumps({'sub': subject, 'role': 'authenticated'})}'; {sql}"

    def read(sql, subject=owner):
        return db.sql(caller(sql, subject)).splitlines()[-1]

    def equal(actual, expected, label):
        nonlocal checks
        if actual != expected:
            raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")
        checks += 1

    def refused(sql, code, subject=owner):
        nonlocal checks
        error = db.error(caller(sql, subject))
        if code not in error:
            raise AssertionError(f"Expected {code}: {error}")
        checks += 1

    db.sql(f"""
      insert into public.organizations(id,name,slug) values ('{org}','Context synthetic','context-{org}');
      insert into auth.users(id,email) values ('{owner}','owner-{owner}@example.invalid'),
        ('{admin}','admin-{admin}@example.invalid'),('{colleague}','c-{colleague}@example.invalid');
      insert into public.organization_members(org_id,user_id,role) values
        ('{org}','{owner}','member'),('{org}','{admin}','org_admin'),('{org}','{colleague}','member');
      insert into public.careon_scribe_gemachtigden(org_id,user_id) values ('{org}','{owner}'),('{org}','{colleague}');
    """)
    settings = {"ingeschakeld": True, "dpiaVastgesteldOp": "2026-09-01", "dpiaEigenaar": "FG",
        "verwerkersovereenkomstBevestigd": True, "consenttekstGoedgekeurdOp": "2026-09-01",
        "consenttekst": "Synthetic consent.", "transcriptRetentieDagen": 30,
        "notitieRetentieDagen": 20, "transcriptWissenBijOvername": True}
    read(f"insert into public.careon_scribe_instellingen(org_id,state,revision) values ('{org}',{lit(settings)},1)", admin)

    def empty(context=None):
        arrays = "symptomen begeleidendeSymptomen uitlokkendeFactoren verlichtendeFactoren medicatie allergieen voorgeschiedenis familieanamnese leefstijl psychisch metingen onderzoek overwegingen plan acties ontbrekend waarschuwingen".split()
        result = {"samenvatting": "", "hoofdklacht": None, "duur": None, "beloop": None, "ernst": None,
            **{key: [] for key in arrays}}
        if context is not None:
            result["gesprekscontext"] = context
        return result

    def start():
        sid = str(uuid.uuid4())
        read(f"insert into public.careon_scribe_sessies(id,org_id,behandelaar_id,patient_referentie,taal,consult_type,consent_bevestigd_op,consent_revisie,consent_tekst) values ('{sid}','{org}','{owner}','SYN-CONTEXT','en','psychiatrie',now(),1,'ignored')")
        read(f"select public.careon_scribe_staat_bewaren('{sid}',0,{lit(empty())})")
        return sid

    def state(sid):
        return json.loads(read(f"select to_jsonb(t) from public.careon_scribe_staat t where sessie_id='{sid}'"))

    def append(sid, text, missing=False):
        read(f"select public.careon_scribe_voeg_segmenten_toe('{sid}',null,{lit([{'spreker':'onbekend','tekst':text,'bron':'systeem' if missing else 'handmatig'}])},8000,{str(missing).lower()})")
        return json.loads(read(f"select jsonb_build_object('segmentId',id,'volgnummer',volgnummer,'tekst',coalesce(tekst_gecorrigeerd,tekst)) from public.careon_scribe_segmenten where sessie_id='{sid}' order by volgnummer desc limit 1"))

    def context(section, *citations):
        return {"sectieId": section, "bron": [c["volgnummer"] for c in citations],
            "citaten": list(citations), "status": "te_controleren"}

    def analysis_sql(sid, ctx, version=None):
        current = state(sid)
        last = int(read(f"select segment_teller from public.careon_scribe_sessies where id='{sid}'"))
        return f"select public.careon_scribe_analyse_bewaren('{sid}',{current['versie'] if version is None else version},{lit(empty(ctx))},{last},'deterministisch',null,'[]','[]','[]')"

    def save(sid, ctx):
        return json.loads(read(analysis_sql(sid, ctx)))

    sid = start()
    first = append(sid, "How have you been feeling? — I have been worried.")
    second = append(sid, "Do you take tablets? — No tablets.")
    third = append(sid, "Shall we speak with your mother? — Yes.")
    row = context("speciele-anamnese", first, second)
    equal(read("select app.scribe_context_vorm(null)"), "t", "legacy missing optional context")
    equal(read("select app.scribe_context_vorm('[]')"), "t", "empty optional context")
    equal(read(f"select app.scribe_context_vorm({lit([row])})"), "t", "bounded exact context shape")
    malformed = [None, {}, [None], [{**row, "status": "goedgekeurd"}], [{**row, "role": "patient"}],
        [{**row, "bron": [1]}], [{**row, "citaten": []}], [row, row],
        [{**row, "citaten": [second, first], "bron": [2, 1]}], [context("speciele-anamnese", first, third)],
        [{**row, "citaten": [first] * 4, "bron": [1] * 4}],
        [{**row, "citaten": [{**first, "tekst": ""}], "bron": [1]}],
        [{**row, "citaten": [{**first, "tekst": "x" * 4001}], "bron": [1]}],
        [{**row, "citaten": [{**first, "start": 0}], "bron": [1]}]]
    for value in malformed:
        equal(read(f"select app.scribe_context_vorm({lit(value)})"), "f", "malformed context fails shape")
    equal(read(f"select app.scribe_context_vorm((select jsonb_agg({lit(row)} || jsonb_build_object('sectieId','section-'||n)) from generate_series(1,601) n))"), "f", "601 entries rejected")
    quote = {**first, "tekst": "x" * 4000}
    equal(read(f"select app.scribe_context_vorm((select jsonb_agg({lit(context('section', quote))} || jsonb_build_object('sectieId','section-'||n)) from generate_series(1,64) n))"), "t", "256000 character boundary accepted")
    equal(read(f"select app.scribe_context_vorm((select jsonb_agg({lit(context('section', quote))} || jsonb_build_object('sectieId','section-'||n)) from generate_series(1,65) n))"), "f", "256000 character budget enforced")
    equal(save(sid, [row])["staat"]["gesprekscontext"], [row], "exact quotes round trip")
    equal(read(f"select count(*) from public.careon_scribe_staat where sessie_id='{sid}'", colleague), "0", "colleague cannot read context")
    refused(analysis_sql(sid, [row]), "42501", colleague)
    foreign = append(start(), "Other consult text.")
    gap = append(sid, "Missing fragment.", True)
    for forged in [context("speciele-anamnese", {**first, "tekst": "Invented medication"}),
        context("speciele-anamnese", {**first, "segmentId": str(uuid.uuid4())}),
        context("speciele-anamnese", {**first, "volgnummer": 2}),
        context("speciele-anamnese", foreign), context("speciele-anamnese", gap), context("invented-section", first)]:
        refused(analysis_sql(sid, [forged]), "22023")
    equal(state(sid)["staat"]["gesprekscontext"], [row], "appending does not discard valid earlier context")
    defs = json.loads(read("select app.scribe_sectie_definities('psychiatrie')"))
    legacy = start()
    append(legacy, "Synthetic English consultation with no selected context.")
    save(legacy, None)
    read(f"select public.careon_scribe_status_zetten('{legacy}','afgerond')")
    fallback = [{"id": key, "titel": key, "tekst": "", "conceptTekst": "Review the English transcript.",
        "status": "leeg", "bron": [], "vereistBehandelaar": True} for key in defs]
    legacy_note = json.loads(read(f"select public.careon_scribe_notitie_maken('{legacy}',{state(legacy)['versie']},'psychiatrie',{lit(fallback)},'deterministisch',null)"))
    equal(sum(bool(s["tekst"]) for s in legacy_note["secties"]), 0, "legacy English fallback stays all manual")
    forged_fallback = copy.deepcopy(fallback)
    next(s for s in forged_fallback if not defs[s["id"]]).update(tekst="Unbacked English facts", vereistBehandelaar=False, status="concept")
    refused(f"select public.careon_scribe_notitie_maken('{legacy}',{state(legacy)['versie']},'psychiatrie',{lit(forged_fallback)},'deterministisch',null)", "22023")
    contexts = [context(key, first, second, third) for key in defs]
    save(sid, contexts)
    rendered = HEADER + "\n\n" + "\n\n".join(f"§{c['volgnummer']}: {c['tekst']}" for c in [first, second, third])
    equal(json.loads(read(f"select app.scribe_context_sectie({lit(contexts)},'speciele-anamnese')")),
        {"bron": [1, 2, 3], "tekst": rendered}, "SQL renderer preserves exact full strings")
    read(f"select public.careon_scribe_status_zetten('{sid}','afgerond')")
    sections = [{"id": key, "titel": key, "tekst": "" if assessment else rendered,
        "conceptTekst": rendered, "status": "concept", "bron": [1, 2, 3], "vereistBehandelaar": True}
        for key, assessment in defs.items()]
    # The real deterministic renderer adds its missing-fragment warning to the first section.
    sections[0]["conceptTekst"] = "Let op: 1 fragmenten ontbreken in het transcript.\n\n" + rendered
    if not defs[sections[0]["id"]]:
        sections[0]["tekst"] = sections[0]["conceptTekst"]

    def make_sql(value):
        return f"select public.careon_scribe_notitie_maken('{sid}',{state(sid)['versie']},'psychiatrie',{lit(value)},'deterministisch',null)"

    for key, value in [("tekst", "Invented medication"), ("bron", [2]), ("vereistBehandelaar", False), ("conceptTekst", rendered + " invented")]:
        bad = copy.deepcopy(sections)
        factual = next(s for s in bad if not defs[s["id"]])
        factual[key] = value
        refused(make_sql(bad), "22023")
    bad = copy.deepcopy(sections)
    next(s for s in bad if defs[s["id"]])["tekst"] = "Invented risk assessment"
    refused(make_sql(bad), "22023")
    note = json.loads(read(make_sql(sections)))
    equal(sum(bool(s["tekst"]) for s in note["secties"]), 6, "six factual sections prefilled")
    equal(sum(s["tekst"] == "" for s in note["secties"]), 2, "two actual assessments stay empty")

    def edit_sql(patches, current=note, all_=False):
        return f"select public.careon_scribe_notitie_bewerken('{current['id']}','{sid}',{current['bewerk_revisie']},{lit(patches)},{str(all_).lower()},false)"

    factual = next(s for s in sections if not defs[s["id"]])
    refused(edit_sql([{"id": factual["id"], "status": "goedgekeurd"}]), "55000")
    refused(edit_sql([{"id": factual["id"], "tekst": factual["tekst"], "status": "goedgekeurd"}]), "55000")
    refused(edit_sql([{"id": factual["id"], "tekst": "\t\u00a0" + factual["tekst"] + "\n\u3000", "status": "goedgekeurd"}]), "55000")
    edited = json.loads(read(edit_sql([{"id": factual["id"], "tekst": factual["tekst"]}])))
    refused(edit_sql([{"id": factual["id"], "status": "goedgekeurd"}], edited["notitie"]), "55000")
    skipped = json.loads(read(edit_sql([], edited["notitie"], True)))
    equal(len(skipped["overgeslagen"]), 8, "bulk approval skips every clinician-required context")
    reviewed = json.loads(read(edit_sql([{"id": factual["id"], "tekst": "Clinician reviewed synthetic account.", "status": "goedgekeurd"}], skipped["notitie"])))
    equal(next(s for s in reviewed["notitie"]["secties"] if s["id"] == factual["id"])["status"], "goedgekeurd", "individual rewrite can be approved")

    old_revision = state(sid)["versie"]
    correction = f"select public.careon_scribe_segment_corrigeren('{sid}',{first['volgnummer']},{lit({'tekst_gecorrigeerd':'Corrected synthetic question and answer.'})})"
    read(correction)
    equal("gesprekscontext" in state(sid)["staat"], False, "source edit clears all provisional context")
    refused(analysis_sql(sid, contexts, old_revision), "55000")
    refused(analysis_sql(sid, contexts), "22023")
    refused(edit_sql([{"id": factual["id"], "status": "goedgekeurd"}], reviewed["notitie"]), "55000")
    corrected = {**first, "tekst": "Corrected synthetic question and answer."}
    save(sid, [context("speciele-anamnese", corrected)])
    equal(state(sid)["staat"]["gesprekscontext"][0]["citaten"][0]["tekst"], corrected["tekst"], "current corrected quote accepted")

    # A source edit takes the same parent lock while the model response waits.
    version = state(sid)["versie"]
    update_again = f"select public.careon_scribe_segment_corrigeren('{sid}',{first['volgnummer']},{lit({'tekst_gecorrigeerd':'Second correction.'})})"
    writer = db.start_sql(caller(f"begin; select 1 from public.careon_scribe_sessies where id='{sid}' for update; select pg_sleep(0.7); {update_again}; commit;"))
    time.sleep(0.15)
    late = db.start_sql(caller(analysis_sql(sid, [context("speciele-anamnese", corrected)], version)))
    _, writer_error = writer.communicate(timeout=10)
    _, late_error = late.communicate(timeout=10)
    equal(writer.returncode, 0, f"source edit won parent lock: {writer_error}")
    equal("55000" in late_error, True, "late model response rejected after competing source edit")
    equal("gesprekscontext" in state(sid)["staat"], False, "late response did not resurrect old quote")
    late_terminal_sql = analysis_sql(sid, [], version)
    read(f"select public.careon_scribe_status_zetten('{sid}','geannuleerd')")
    equal(read(f"select count(*) from public.careon_scribe_staat where sessie_id='{sid}'"), "0", "terminal purge removes quoted context")
    refused(late_terminal_sql, "55000")
    equal(db.sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('careon_scribe_staat_bewaren','careon_scribe_analyse_bewaren','careon_scribe_notitie_maken','careon_scribe_notitie_bewerken') and p.prosecdef"), "0", "state and note RPCs remain invoker")
    return checks
