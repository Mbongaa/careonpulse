"""Canonical reviewed-English note RPC tests; only synthetic source statements."""
import copy
import json
import os
from pathlib import Path
import subprocess
import uuid

HEADER = "Vastgelegde feiten — controleer de inhoud vóór goedkeuring."


def shared_english_examples():
    """Run the exact shared TS fixtures and validator; no provider module imports."""
    repo = Path(__file__).resolve().parents[3]
    script = """
      const {ENGLISH_EVIDENCE_EXAMPLES}=require('./src/scripts/lib/scribe-english-evidence-fixtures.ts');
      const {valideerEngelsBewijs}=require('./src/lib/careon-scribe/english-evidence.ts');
      process.stdout.write(JSON.stringify(ENGLISH_EVIDENCE_EXAMPLES.map(example=>({
        ...example,
        typescript:valideerEngelsBewijs(example.field,
          {tekst:example.quote??example.source,bron:[1],ingetrokken:false,...example.additions},
          [{id:'synthetic',volgnummer:1,spreker:example.speaker??'patient',sprekerBron:'behandelaar',
            tekst:example.source,tekstGecorrigeerd:null,correctieBron:null,beginMs:0,eindMs:8000,
            bron:'handmatig',createdAt:'2026-09-11T00:00:00.000Z'}])
      }))));
    """
    env = {**os.environ, "TS_NODE_PROJECT": "tsconfig.scripts.json"}
    result = subprocess.run(["node", "-r", "ts-node/register", "-e", script], cwd=repo,
        env=env, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def verify_english_drafts(db):
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

    db.sql(f"""
      insert into public.organizations(id,name,slug) values ('{org}','English draft synthetic','draft-{org}');
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
    read(f"insert into public.careon_scribe_sessies(id,org_id,behandelaar_id,patient_referentie,taal,consult_type,consent_bevestigd_op,consent_revisie,consent_tekst) values ('{sid}','{org}','{owner}','SYN-DRAFT','en','soap',now(),1,'ignored')")
    arrays = "symptomen begeleidendeSymptomen uitlokkendeFactoren verlichtendeFactoren medicatie allergieen voorgeschiedenis familieanamnese leefstijl psychisch metingen onderzoek overwegingen plan acties ontbrekend waarschuwingen".split()
    empty = {"samenvatting": "", "hoofdklacht": None, "duur": None, "beloop": None, "ernst": None,
        **{key: [] for key in arrays}}
    read(f"select public.careon_scribe_staat_bewaren('{sid}',0,{lit(empty)})")

    def source(text, speaker="patient", confirmed=True, missing=False):
        read(f"select public.careon_scribe_voeg_segmenten_toe('{sid}',null,{lit([{'tekst':text,'spreker':speaker,'bron':'systeem' if missing else 'handmatig'}])},8000,{str(missing).lower()})")
        result = json.loads(read(f"select to_jsonb(g) from public.careon_scribe_segmenten g where sessie_id='{sid}' order by volgnummer desc limit 1"))
        if confirmed:
            read(f"select public.careon_scribe_segment_corrigeren('{sid}',{result['volgnummer']},{lit({'spreker':speaker})})")
        return result

    def fact(src, **extra):
        return {"tekst": src["tekst"], "bron": [src["volgnummer"]], "ingetrokken": False, **extra}

    def eligible(field, row, src):
        return read(f"select app.scribe_engels_feit_geldig('{field}',{lit(row)},g) from public.careon_scribe_segmenten g where id='{src['id']}'")

    med_src = source("I take sertraline 50 mg.")
    symptom_src = source("I have a headache.")
    lifestyle_src = source("I smoke cannabis.")
    allergy_src = source("I am allergic to penicillin.")
    plan_src = source("I will arrange a follow-up appointment.", "arts")
    denial_src = source("I do not drink alcohol.")
    unknown_src = source("I have nausea.", confirmed=False)
    gap_src = source("Missing synthetic fragment.", confirmed=False, missing=True)
    med = fact(med_src, naam="sertraline", dosering="50 mg", gebruik="huidig")
    symptom = fact(symptom_src)
    lifestyle = fact(lifestyle_src, categorie="drugs")
    allergy = fact(allergy_src, aard="allergie")
    plan = fact(plan_src)
    action = fact(plan_src, omschrijving=plan_src["tekst"], soort="overig")
    denial = fact(denial_src, categorie="alcohol")
    for field, row, src in [("medicatie", med, med_src), ("symptomen", symptom, symptom_src),
        ("leefstijl", lifestyle, lifestyle_src), ("allergieen", allergy, allergy_src),
        ("plan", plan, plan_src), ("acties", action, plan_src), ("leefstijl", denial, denial_src)]:
        equal(eligible(field, row, src), "t", f"literal confirmed {field} eligible")
    equal(eligible("symptomen", fact(unknown_src), unknown_src), "f", "known role without confirmation fails")
    equal(eligible("symptomen", fact(gap_src), gap_src), "f", "missing fragment cannot support a fact")
    equal(eligible("medicatie", {**med, "dosering": "100 mg"}, med_src), "f", "wrong dose fails")
    equal(eligible("medicatie", {**med, "tekst": med["tekst"].upper()}, med_src), "f", "persisted machine text is byte-exact effective source")
    equal(eligible("medicatie", {**med, "bron": [symptom_src["volgnummer"]]}, med_src), "f", "source number must identify same row")
    negative = [
        ("symptomen", "Do you have headaches", "arts", {}),
        ("allergieen", "I might be allergic to penicillin.", "patient", {"aard": "allergie"}),
        ("plan", "I could arrange an appointment.", "arts", {}),
        ("symptomen", "I had headaches last year.", "patient", {}),
        ("leefstijl", "I used to smoke cannabis.", "patient", {"categorie": "drugs"}),
        ("symptomen", "I hear voices.", "patient", {}),
        ("symptomen", "My mother has headaches.", "patient", {}),
        ("medicatie", "I take sertraline 50 mg and tramadol 100 mg.", "patient", {"naam": "sertraline", "dosering": "100 mg", "gebruik": "huidig"}),
        ("medicatie", "I take a bus every day.", "patient", {"naam": "bus", "dosering": None, "gebruik": "huidig"}),
        ("symptomen", "I have pain. I do not have a headache.", "patient", {}),
        ("medicatie", "I believe I take sertraline 50 mg.", "patient", {"naam": "sertraline", "dosering": "50 mg", "gebruik": "huidig"}),
        ("leefstijl", "I think I drink alcohol.", "patient", {"categorie": "alcohol"}),
    ]
    for field, text, speaker, extra in negative:
        src = source(text, speaker)
        equal(eligible(field, fact(src, **extra), src), "f", f"unsupported source rejected: {text}")
    stopped = source("I have stopped taking tramadol 100 mg.")
    equal(eligible("medicatie", fact(stopped, naam="tramadol", dosering="100 mg", gebruik="gestopt"), stopped), "t", "literal medication stopping accepted")
    accented = source("I take valproïnezuur 200 mg.")
    equal(eligible("medicatie", fact(accented, naam="valproïnezuur", dosering="200 mg", gebruik="huidig"), accented), "t", "medicine vocabulary normalizes accents without rewriting exact source")
    spaced = source("I take sodium  valproate 200 mg.")
    equal(eligible("medicatie", fact(spaced, naam="sodium valproate", dosering="200 mg", gebruik="huidig"), spaced), "t", "multiword medicine whitespace follows English validator")
    for example in shared_english_examples():
        equal(example["typescript"], example["expected"], f"shared TS fixture: {example['name']}")
        src = source(example["source"], example.get("speaker", "patient"))
        row = {**fact(src), **example.get("additions", {})}
        row["tekst"] = example.get("quote", example["source"])
        equal(eligible(example["field"], row, src), "t" if example["expected"] else "f",
            f"same shared fixture in actual SQL: {example['name']}")

    manual = {"tekst": "Clinician-authored synthetic symptom.", "bron": [], "ingetrokken": False, "doorBehandelaar": True}
    value = {**empty, "symptomen": [symptom, manual], "begeleidendeSymptomen": [symptom],
        "medicatie": [med], "allergieen": [allergy], "leefstijl": [lifestyle, denial], "plan": [plan], "acties": [action]}

    def render(section, state=value):
        return json.loads(read(f"select app.scribe_engelse_feitsectie('{sid}',{lit(state)},'{section}')"))

    expected_subjective = HEADER + "\n\n" + "\n".join([
        f"- {symptom['tekst']} (§2)", f"- {manual['tekst']}", f"- {med['tekst']} (§1)",
        f"- {allergy['tekst']} (§4)", f"- {lifestyle['tekst']} (§3)", f"- {denial['tekst']} (§6)"])
    equal(render("subjectief"), {"tekst": expected_subjective, "bron": [1, 2, 3, 4, 6]}, "field order, array order, dedup, human source-free row and sorted projection")
    equal(render("plan"), {"tekst": HEADER + f"\n\n- {plan['tekst']} (§5)", "bron": [5]}, "plan/action identical literal row deduplicates")
    equal(render("beoordeling"), {"tekst": "", "bron": []}, "assessment has no factual mapping")
    equal(render("subjectief", {**value, "symptomen": [symptom, fact(unknown_src)]}), {"tekst": "", "bron": []}, "invalid machine row prevents partial section replacement")
    for field, row, section in [("medicatie", med, "subjectief"), ("allergieen", allergy, "subjectief"),
        ("leefstijl", lifestyle, "subjectief"), ("acties", action, "plan")]:
        equal(render(section, {**value, field: [{**row, "doorBehandelaar": True}]}), {"tekst": "", "bron": []},
            f"structured human {field} retains full legacy rendering")
    for field in ("hoofdklacht", "duur", "beloop", "ernst"):
        equal(render("subjectief", {**value, field: "Previously reviewed scalar"}), {"tekst": "", "bron": []},
            f"existing {field} prevents incomplete literal prefill")
    for field in ("uitlokkendeFactoren", "verlichtendeFactoren", "voorgeschiedenis", "familieanamnese"):
        equal(render("subjectief", {**value, field: [manual]}), {"tekst": "", "bron": []},
            f"active unsupported {field} keeps complete legacy rendering")
        equal(render("subjectief", {**value, field: [{**manual, "ingetrokken": True}]}), render("subjectief"),
            f"retracted {field} does not block a current literal prefill")
    equal(render("subjectief", {**empty, "symptomen": [{**symptom, "ingetrokken": True}]}), {"tekst": "", "bron": []}, "retracted facts stay excluded")
    equal(json.loads(read(f"select app.scribe_engelse_feitsectie('{sid}',{lit({**empty,'symptomen':[symptom]})},'subjectief')", colleague)),
        {"tekst": "", "bron": []}, "colleague cannot resolve owner's machine sources")

    def state():
        return json.loads(read(f"select to_jsonb(t) from public.careon_scribe_staat t where sessie_id='{sid}'"))

    last = int(read(f"select segment_teller from public.careon_scribe_sessies where id='{sid}'"))
    read(f"select public.careon_scribe_analyse_bewaren('{sid}',{state()['versie']},{lit(value)},{last},'ai','synthetic','[]','[]','[]')")
    read(f"select public.careon_scribe_status_zetten('{sid}','afgerond')")
    sections = []
    for key in ("subjectief", "objectief", "analyse", "plan"):
        rendered = render(key)
        text = rendered["tekst"]
        if key == "subjectief":
            text = "Let op: 1 fragmenten ontbreken in het transcript.\n\n" + text
        sections.append({"id": key, "titel": key, "tekst": text, "conceptTekst": text or "Clinician review required.",
            "bron": rendered["bron"], "status": "concept" if text else "leeg", "vereistBehandelaar": True})

    def make_sql(rows):
        return f"select public.careon_scribe_notitie_maken('{sid}',{state()['versie']},'soap',{lit(rows)},'deterministisch',null)"

    for key, entry in [("tekst", "Invented paragraph"), ("conceptTekst", "Invented paragraph"), ("bron", [1]), ("vereistBehandelaar", False), ("status", "goedgekeurd")]:
        bad = copy.deepcopy(sections)
        bad[0][key] = entry
        refused(make_sql(bad), "22023")
    bad = copy.deepcopy(sections)
    bad[2].update(tekst=sections[0]["tekst"], conceptTekst=sections[0]["conceptTekst"])
    refused(make_sql(bad), "22023")
    note = json.loads(read(make_sql(sections)))
    equal(note["secties"], sections, "canonical factual draft persists unchanged through note RPC")
    refused(make_sql(sections), "42501", colleague)

    def edit_sql(patches, current=note, all_=False):
        return f"select public.careon_scribe_notitie_bewerken('{current['id']}','{sid}',{current['bewerk_revisie']},{lit(patches)},{str(all_).lower()},false)"

    skipped = json.loads(read(edit_sql([], all_=True)))
    equal(len(skipped["overgeslagen"]), 4, "bulk approval skips clinician-required factual drafts")
    approved = json.loads(read(edit_sql([{"id": "subjectief", "status": "goedgekeurd"}], skipped["notitie"])))
    equal(approved["notitie"]["secties"][0]["status"], "goedgekeurd", "individual reviewed factual draft approval needs no rewrite")
    read(f"select public.careon_scribe_segment_corrigeren('{sid}',{med_src['volgnummer']},{lit({'tekst_gecorrigeerd':'I take sertraline 25 mg.'})})")
    refused(edit_sql([{"id": "plan", "status": "goedgekeurd"}], approved["notitie"]), "55000")
    equal(render("somatiek-medicatie"), {"tekst": "", "bron": []}, "source correction prevents partial replacement of stale machine section")
    return checks
