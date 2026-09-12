"""Actual PostgreSQL role provenance, edit invalidation and competing-writer tests."""
import json
import time
import uuid


def verify_speaker_provenance(db, legacy_segments=None):
    checks = 0
    org, owner, admin, colleague = [str(uuid.uuid4()) for _ in range(4)]

    def lit(value):
        return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"

    def caller(sql, subject=owner):
        return f"set role authenticated; set request.jwt.claims='{json.dumps({'sub':subject,'role':'authenticated'})}'; {sql}"

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

    if legacy_segments is not None:
        equal(legacy_segments > 0, True, "upgrade contains actual legacy rows")
        equal(int(db.sql("select count(*) from public.careon_scribe_segmenten where spreker_bron is null")),
            legacy_segments, "migration leaves every legacy role unverified")
    db.sql(f"""
      insert into public.organizations(id,name,slug) values ('{org}','Speaker synthetic','speaker-{org}');
      insert into auth.users(id,email) values ('{owner}','o-{owner}@example.invalid'),
        ('{admin}','a-{admin}@example.invalid'),('{colleague}','c-{colleague}@example.invalid');
      insert into public.organization_members(org_id,user_id,role) values
        ('{org}','{owner}','member'),('{org}','{admin}','org_admin'),('{org}','{colleague}','member');
      insert into public.careon_scribe_gemachtigden(org_id,user_id) values ('{org}','{owner}'),('{org}','{colleague}');
    """)
    settings = {"ingeschakeld": True, "dpiaVastgesteldOp": "2026-09-01", "dpiaEigenaar": "FG",
        "verwerkersovereenkomstBevestigd": True, "consenttekstGoedgekeurdOp": "2026-09-01",
        "consenttekst": "Synthetic consent.", "transcriptRetentieDagen": 30,
        "notitieRetentieDagen": 20, "transcriptWissenBijOvername": True}
    read(f"insert into public.careon_scribe_instellingen(org_id,state,revision) values ('{org}',{lit(settings)},1)", admin)
    sid = str(uuid.uuid4())
    read(f"insert into public.careon_scribe_sessies(id,org_id,behandelaar_id,patient_referentie,taal,consult_type,consent_bevestigd_op,consent_revisie,consent_tekst) values ('{sid}','{org}','{owner}','SYN-SPEAKER','en','psychiatrie',now(),1,'ignored')")
    arrays = "symptomen begeleidendeSymptomen uitlokkendeFactoren verlichtendeFactoren medicatie allergieen voorgeschiedenis familieanamnese leefstijl psychisch metingen onderzoek overwegingen plan acties ontbrekend waarschuwingen".split()
    empty = {"samenvatting": "", "hoofdklacht": None, "duur": None, "beloop": None, "ernst": None,
        **{key: [] for key in arrays}}
    read(f"select public.careon_scribe_staat_bewaren('{sid}',0,{lit(empty)})")

    def append_sql(rows):
        return f"select public.careon_scribe_voeg_segmenten_toe('{sid}',null,{lit(rows)},8000,false)"

    row = {"spreker": "onbekend", "tekst": "Synthetic dialogue.", "bron": "handmatig"}
    for key in ("sprekerBron", "spreker_bron"):
        refused(append_sql([{**row, key: "behandelaar"}]), "22023")
    read(append_sql([row, row, row, {**row, "spreker": "patient"}]))

    def segments():
        return json.loads(read(f"select jsonb_agg(to_jsonb(g) order by volgnummer) from public.careon_scribe_segmenten g where sessie_id='{sid}'"))

    def state():
        return json.loads(read(f"select to_jsonb(t) from public.careon_scribe_staat t where sessie_id='{sid}'"))

    def revision():
        return int(read(f"select transcript_revisie from public.careon_scribe_sessies where id='{sid}'"))

    def analysis_sql(roles, value=empty, version=None):
        return f"select public.careon_scribe_analyse_bewaren('{sid}',{state()['versie'] if version is None else version},{lit(value)},4,'ai','synthetic-model',{lit(roles)},'[]','[]')"

    def correct_sql(nr, patch):
        return f"select public.careon_scribe_segment_corrigeren('{sid}',{nr},{lit(patch)})"

    equal([s["spreker_bron"] for s in segments()], [None] * 4, "all appended roles start unverified")
    refused(correct_sql(1, {"spreker": "patient", "spreker_bron": "ai"}), "22023")
    refused(analysis_sql([{"volgnummer": 1, "spreker": "patient", "sprekerBron": "behandelaar"}]), "22023")
    refused(analysis_sql([{"volgnummer": 1, "spreker": None}]), "22023")
    read(analysis_sql([{"volgnummer": 1, "spreker": "patient"}]))
    equal((segments()[0]["spreker"], segments()[0]["spreker_bron"]), ("patient", "ai"), "AI assignment is explicitly inferred")
    first = segments()[0]
    context = [{"sectieId": "speciele-anamnese", "bron": [1], "status": "te_controleren",
        "citaten": [{"segmentId": first["id"], "volgnummer": 1, "tekst": first["tekst"]}]}]
    read(analysis_sql([], {**empty, "gesprekscontext": context}))
    previous_revision, previous_version = revision(), state()["versie"]
    read(correct_sql(1, {"spreker": "patient"}))
    equal(segments()[0]["spreker_bron"], "behandelaar", "same-role edit confirms clinician provenance")
    equal(revision(), previous_revision + 1, "same-role confirmation increments source revision")
    equal(state()["versie"], previous_version + 1, "same-role confirmation invalidates state version")
    equal(state()["laatste_segment"], 0, "same-role confirmation rewinds analysis")
    equal("gesprekscontext" in state()["staat"], False, "confirmation clears provisional quoted context")
    stable_revision = revision()
    read(correct_sql(1, {"spreker": "patient"}))
    equal(revision(), stable_revision, "repeated identical confirmed value is idempotent")
    read(correct_sql(2, {"spreker": "onbekend"}))
    read(analysis_sql([{"volgnummer": 1, "spreker": "arts"}, {"volgnummer": 2, "spreker": "patient"},
        {"volgnummer": 3, "spreker": "arts"}, {"volgnummer": 4, "spreker": "arts"}]))
    equal([(s["spreker"], s["spreker_bron"]) for s in segments()],
        [("patient", "behandelaar"), ("onbekend", "behandelaar"), ("arts", "ai"), ("patient", None)],
        "AI cannot overwrite confirmed or legacy known roles")
    read(correct_sql(3, {"tekst_gecorrigeerd": "Corrected text with inferred speaker."}))
    equal(segments()[2]["spreker_bron"], "ai", "text-only edit does not confirm AI role")
    read(correct_sql(1, {"tekst_gecorrigeerd": "Corrected text with confirmed speaker."}))
    equal(segments()[0]["spreker_bron"], "behandelaar", "text-only edit preserves prior confirmation")
    refused(f"update public.careon_scribe_segmenten set spreker_bron='behandelaar' where sessie_id='{sid}' and volgnummer=3", "42501")
    refused(correct_sql(3, {"spreker": "patient"}), "42501", colleague)
    equal(read(f"select count(*) from public.careon_scribe_segmenten where sessie_id='{sid}'", colleague), "0", "provenance has owner-only read access")
    service_claim = "set role service_role; set request.jwt.claims='{\"role\":\"service_role\"}'; "
    error = db.error(service_claim + f"update public.careon_scribe_segmenten set spreker_bron='behandelaar' where sessie_id='{sid}' and volgnummer=3")
    equal("42501" in error, True, "direct privileged content update cannot forge role provenance")

    # An owner confirms the same role while a model response waits on the parent.
    read(analysis_sql([]))
    version = state()["versie"]
    writer = db.start_sql(caller(f"begin; select 1 from public.careon_scribe_sessies where id='{sid}' for update; select pg_sleep(0.7); {correct_sql(3, {'spreker':'arts'})}; commit;"))
    time.sleep(0.15)
    late = db.start_sql(caller(analysis_sql([], version=version)))
    _, writer_error = writer.communicate(timeout=10)
    _, late_error = late.communicate(timeout=10)
    equal(writer.returncode, 0, f"clinician confirmation commits: {writer_error}")
    equal("55000" in late_error, True, "late model response cannot overwrite role confirmation")
    equal(segments()[2]["spreker_bron"], "behandelaar", "confirmed provenance survives competing analysis")
    late_sql = analysis_sql([], version=version)
    read(f"select public.careon_scribe_status_zetten('{sid}','geannuleerd')")
    refused(late_sql, "55000")
    equal(read(f"select count(*) from public.careon_scribe_segmenten where sessie_id='{sid}'"), "0", "terminal purge removes provenance with transcript")
    equal(db.sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('careon_scribe_segment_corrigeren','careon_scribe_analyse_bewaren','careon_scribe_voeg_segmenten_toe') and p.prosecdef"), "0", "speaker content RPCs remain invoker")
    return checks
