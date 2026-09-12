"""Audit-only synthetic PostgreSQL proofs. Does not read .env or call providers.

Run under WSL: python3 this-file --repo /mnt/c/.../careon-dashboard
Uses the existing disposable test helper on localhost:55439 as hassan.
All test records live in a randomly named database removed on exit.
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser()
parser.add_argument("--repo", required=True)
args = parser.parse_args()
repo = Path(args.repo)
spec = importlib.util.spec_from_file_location("sv", repo / "src/scripts/verify-scribe-postgres.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

with m.LocalPostgres(55439, "hassan", prefix="careon_scribe_audit_regression") as db:
    db.bootstrap_supabase()
    for migration in sorted(m.MIGRATIONS.glob("*.sql")):
        if migration.name != m.TOKEN_HOOK:
            db.apply(migration)
    db.sql(f"""
        insert into public.organizations(id,name,slug)
        values ('{m.ORG}','Synthetic audit','synthetic-scribe-audit');
        insert into auth.users(id,email) values
          ('{m.BEHEERDER}','admin@example.invalid'),('{m.BEHANDELAAR}','owner@example.invalid'),
          ('{m.COLLEGA}','colleague@example.invalid'),('{m.LID}','member@example.invalid');
        insert into public.organization_members(org_id,user_id,role) values
          ('{m.ORG}','{m.BEHEERDER}','org_admin'),('{m.ORG}','{m.BEHANDELAAR}','member'),
          ('{m.ORG}','{m.COLLEGA}','member'),('{m.ORG}','{m.LID}','member');
        insert into public.careon_scribe_gemachtigden(org_id,user_id) values
          ('{m.ORG}','{m.BEHANDELAAR}'),('{m.ORG}','{m.COLLEGA}'),('{m.ORG}','{m.LID}');
    """)

    def user(query):
        return db.sql(m.as_user(m.BEHANDELAAR, query)).splitlines()[-1]

    def start(sid):
        user(f"""insert into public.careon_scribe_sessies
          (id,org_id,behandelaar_id,patient_referentie,consent_bevestigd_op,consent_revisie,consent_tekst)
          values ('{sid}','{m.ORG}','{m.BEHANDELAAR}','D-123',now(),999999,'invented consent')""")

    weak = {"ingeschakeld": True, "dpiaVastgesteldOp": "", "verwerkersovereenkomstBevestigd": True}
    db.sql(m.as_user(m.BEHEERDER, f"insert into public.careon_scribe_instellingen(org_id,state,revision) values ('{m.ORG}',{m.literal(weak)},1)"))
    print("WEAK_ACTIVATION:", user(f"select app.scribe_ingeschakeld('{m.ORG}')"))
    start(m.SESSIE)
    print("MISMATCH_CONSENT_SESSION_CREATED:", user(f"select count(*) from public.careon_scribe_sessies where id='{m.SESSIE}'"))
    print("ADMIN_FILTERED_DELETE:", db.sql(m.as_user(m.BEHEERDER, f"delete from public.careon_scribe_sessies where id='{m.SESSIE}' and org_id='{m.ORG}'")).splitlines()[-1])
    print("OWNER_ROW_SURVIVES_ADMIN_DELETE:", user(f"select count(*) from public.careon_scribe_sessies where id='{m.SESSIE}'"))
    user(f"select public.careon_scribe_status_zetten('{m.SESSIE}','afgerond')")
    user(f"insert into public.careon_scribe_notities(id,sessie_id,org_id,behandelaar_id) values ('{m.NOTITIE}','{m.SESSIE}','{m.ORG}','{m.BEHANDELAAR}')")
    print("EMPTY_NOTE_APPROVAL:", user(f"select public.careon_scribe_notitie_goedkeuren('{m.NOTITIE}')->>'status'"))
    print("EMPTY_NOTE_SESSION_STATUS:", user(f"select status from public.careon_scribe_sessies where id='{m.SESSIE}'"))
    db.sql(m.as_service(f"insert into public.careon_scribe_vrijgaven(sessie_id,org_id,aan_user_id,door_user_id) values ('{m.SESSIE}','{m.ORG}','{m.COLLEGA}','{m.BEHEERDER}'),('{m.SESSIE}','{m.ORG}','{m.LID}','{m.BEHEERDER}')"))
    print("MULTIPLE_RECIPIENTS_SAME_SESSION:", db.sql(m.as_service(f"select count(*) from public.careon_scribe_vrijgaven where sessie_id='{m.SESSIE}'")).splitlines()[-1])
    start(m.TWEEDE)
    user(f"select public.careon_scribe_status_zetten('{m.TWEEDE}','geannuleerd')")
    user(f"insert into public.careon_scribe_segmenten(sessie_id,org_id,behandelaar_id,volgnummer,tekst) values ('{m.TWEEDE}','{m.ORG}','{m.BEHANDELAAR}',901,'synthetic terminal-state text')")
    user(f"insert into public.careon_scribe_staat(sessie_id,org_id,behandelaar_id,staat) values ('{m.TWEEDE}','{m.ORG}','{m.BEHANDELAAR}',{m.literal(m.lege_staat())})")
    print("CANCELLED_SESSION_CHILDREN_REINSERTED:", user(f"select s.status,s.segment_teller,(select count(*) from public.careon_scribe_segmenten g where g.sessie_id=s.id),(select count(*) from public.careon_scribe_staat t where t.sessie_id=s.id) from public.careon_scribe_sessies s where id='{m.TWEEDE}'"))

    m.TWEEDE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    start(m.TWEEDE)
    user(f"insert into public.careon_scribe_staat(sessie_id,org_id,behandelaar_id,staat) values ('{m.TWEEDE}','{m.ORG}','{m.BEHANDELAAR}',{m.literal(m.lege_staat())})")

    # Deterministic interleaving of the exact two state writes used by routes.
    # A model request has read state v1; a correction marks it stale without
    # incrementing v1; the old model response still matches the v1 predicate.
    user(f"update public.careon_scribe_staat set versie=1,laatste_segment=2 where sessie_id='{m.TWEEDE}'")
    before = user(f"select versie from public.careon_scribe_staat where sessie_id='{m.TWEEDE}'")
    user(f"update public.careon_scribe_staat set verouderd=true,laatste_segment=0,updated_at=now() where sessie_id='{m.TWEEDE}' and org_id='{m.ORG}'")
    stale = m.lege_staat({"samenvatting": "Synthetic old analysis before correction"})
    user(f"update public.careon_scribe_staat set staat={m.literal(stale)},versie={int(before)+1},laatste_segment=2,verouderd=false,updated_at=now() where sessie_id='{m.TWEEDE}' and org_id='{m.ORG}' and versie={before}")
    print("CORRECTION_RACE_LOSES_INVALIDATION:", user(f"select versie,laatste_segment,verouderd from public.careon_scribe_staat where sessie_id='{m.TWEEDE}'"))

    # Two PATCH handlers independently read the same note. Each writes the full
    # section array, without any version/ETag predicate, so the second loses A.
    note2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    original = m.secties("Synthetic assessment")
    for section in original:
        section["status"] = "concept"
    user(f"insert into public.careon_scribe_notities(id,sessie_id,org_id,behandelaar_id,secties) values ('{note2}','{m.TWEEDE}','{m.ORG}','{m.BEHANDELAAR}',{m.literal(original)})")
    edit_a = json.loads(json.dumps(original)); edit_a[0]["tekst"] = "Clinician correction A"
    edit_b = json.loads(json.dumps(original)); edit_b[1]["tekst"] = "Clinician correction B"
    for edit in (edit_a, edit_b):
        user(f"update public.careon_scribe_notities set secties={m.literal(edit)},updated_at=now() where id='{note2}' and org_id='{m.ORG}'")
    print("NOTE_CONCURRENT_EDITS_LAST_WRITE_WINS:", user(f"select secties->0->>'tekst',secties->1->>'tekst' from public.careon_scribe_notities where id='{note2}'"))

print("DISPOSABLE_DATABASE_REMOVED")
