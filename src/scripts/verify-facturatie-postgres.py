"""Behavioral invoice transaction tests against an explicitly supplied local PG.

python3 src/scripts/verify-facturatie-postgres.py --port 55439 --user hassan
Creates and drops only a fresh synthetic database; never uses application .env.
"""

import argparse
import json
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from local_postgres import LocalPostgres

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"
ORG = "11111111-1111-4111-8111-111111111111"
ACTOR = "22222222-2222-4222-8222-222222222222"
INVOICE = "33333333-3333-4333-8333-333333333333"
SECOND = "44444444-4444-4444-8444-444444444444"


def snapshot(amount=1000, credit=False):
    sign = -1 if credit else 1
    return {
        "factuurdatum": "2026-09-05", "prestatie_van": "2026-08-01",
        "prestatie_tot": "2026-08-31", "vervaldatum": "2026-10-05",
        "betaaltermijn_dagen": 30, "contact_id": None,
        "afnemer": {"naam": "Synthetic recipient", "adresRegel1": "Test 1", "postcode": "1000 AA", "plaats": "Test", "land": "NL"},
        "afzender": {"statutaireNaam": "Synthetic sender", "adresRegel1": "Test 2", "postcode": "1000 AA", "plaats": "Test", "land": "NL", "kvkNummer": "12345678", "iban": "synthetic", "btwId": "synthetic"},
        "uw_kenmerk": None, "order_referentie": None,
        "regels": [{"id": "fixture", "omschrijving": "Synthetic item", "aantal": sign, "eenheid": "stuk", "stukprijsCent": amount, "btwTarief": "0", "btwCategorie": "Z"}],
        "btw_totalen": [{"tarief": "0", "categorie": "Z", "grondslagCent": sign * amount, "btwCent": 0}],
        "vrijstelling_tekst": None, "subtotaal_cent": sign * amount,
        "btw_cent": 0, "totaal_cent": sign * amount, "opmerking": "Synthetic regression fixture",
    }


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def issue(invoice, revision, payload, credit=False):
    return (
        "select public.careon_factuur_uitreiken_atomic("
        f"'{ACTOR}', '{ORG}', '{invoice}', {revision}, {literal(payload)}, "
        f"'{('C' if credit else 'F')}', 2026::smallint, 1, '{{reeks}}{{jaar}}-{{nummer:4}}', "
        f"{str(credit).lower()});"
    )


def wait_for_sleep(db, application):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if db.sql(f"select count(*) from pg_stat_activity where datname='{db.name}' and application_name='{application}' and wait_event='PgSleep'") == "1":
            return
        time.sleep(0.03)
    raise AssertionError("Synthetic row-lock barrier was not reached")


def finish(process, success=True):
    output, error = process.communicate(timeout=10)
    if (process.returncode == 0) != success:
        raise AssertionError(error or "Unexpected SQL success")
    return output.strip() if success else error


def run(port, user):
    checks = 0
    with LocalPostgres(port, user) as db:
        db.bootstrap_supabase()
        db.apply(MIGRATIONS / "0009_auth_tenancy.sql")
        db.apply(MIGRATIONS / "0020_careon_facturatie.sql")
        db.sql("""
          create table public.careon_agenda_state (
            id uuid, org_id uuid, saved_at timestamptz, operation_id uuid, state jsonb
          );
          create function app.mag_financieel_zien(uuid) returns boolean language sql as $$ select false $$;
          create function app.redigeer_agenda_financieel(jsonb) returns jsonb language sql as $$ select $1 $$;
        """)
        db.apply(MIGRATIONS / "20260822234500_facturatie_storage_backup_boundary.sql")
        db.apply(MIGRATIONS / "20260822235000_security_invoker_boundaries.sql")
        db.apply(MIGRATIONS / "20260905135739_invoice_atomic_issuance.sql")
        db.sql(f"""
          insert into public.organizations(id,name,slug) values ('{ORG}','Synthetic','synthetic-billing');
          insert into auth.users(id,email) values ('{ACTOR}','synthetic@example.invalid');
          insert into public.organization_members(org_id,user_id,role) values ('{ORG}','{ACTOR}','org_admin');
          insert into public.careon_facturatie_facturen(id,org_id,jaar) values
            ('{INVOICE}','{ORG}',2026), ('{SECOND}','{ORG}',2026);
        """)

        # A real concurrent autosave holds the row while issuance waits. It
        # preserves updated_at and tries to forge revision=1; the DB increments.
        autosave = db.start_sql(f"""
          begin;
          select id from public.careon_facturatie_facturen where id='{INVOICE}' for update;
          select pg_sleep(1);
          update public.careon_facturatie_facturen
            set regels={literal(snapshot(2000)['regels'])}, revision=1, updated_at=updated_at
            where id='{INVOICE}';
          commit;
        """, app_name="billing-autosave")
        wait_for_sleep(db, "billing-autosave")
        stale_issue = db.start_sql(issue(INVOICE, 1, snapshot()), app_name="billing-stale-issue")
        finish(autosave)
        assert "40001" in finish(stale_issue, success=False)
        assert db.sql(f"select status||':'||revision from public.careon_facturatie_facturen where id='{INVOICE}'") == "concept:2"
        assert db.sql(f"select count(*) from public.careon_facturatie_nummers where org_id='{ORG}'") == "0"
        checks += 3

        # The complete validated snapshot, including its recalculated amounts,
        # replaces the concept only after the matching revision is locked.
        result = json.loads(db.sql(issue(INVOICE, 2, snapshot(2000))))
        assert result == {"factuur_id": INVOICE, "already_issued": False}
        assert db.sql(f"select status||':'||totaal_cent||':'||(regels->0->>'stukprijsCent') from public.careon_facturatie_facturen where id='{INVOICE}'") == "definitief:2000:2000"
        assert json.loads(db.sql(issue(INVOICE, 2, snapshot(9999))))["already_issued"] is True
        assert db.sql(f"select laatste from public.careon_facturatie_nummers where org_id='{ORG}' and reeks='F'") == "1"
        checks += 4

        # Two blocked issuance requests resume together. One commits and the
        # other returns that same document without changing the counter.
        barrier = db.start_sql(f"begin; select id from public.careon_facturatie_facturen where id='{SECOND}' for update; select pg_sleep(1); commit;", "billing-issue-barrier")
        wait_for_sleep(db, "billing-issue-barrier")
        issues = [db.start_sql(issue(SECOND, 1, snapshot())) for _ in range(2)]
        finish(barrier)
        results = [json.loads(finish(process)) for process in issues]
        assert {item["factuur_id"] for item in results} == {SECOND}
        assert sorted(item["already_issued"] for item in results) == [False, True]
        assert db.sql(f"select laatste from public.careon_facturatie_nummers where org_id='{ORG}' and reeks='F'") == "2"
        checks += 3

        # Inject failure after the credit has been issued but before the
        # original is marked. The entire operation, including number, rolls back.
        revision = int(db.sql(f"select revision from public.careon_facturatie_facturen where id='{INVOICE}'"))
        db.sql(f"""
          create function app.synthetic_credit_failure() returns trigger language plpgsql as $$
          begin if new.id='{INVOICE}'::uuid and new.status='gecrediteerd' then
            raise exception 'synthetic injected failure'; end if; return new; end $$;
          create trigger synthetic_credit_failure before update on public.careon_facturatie_facturen
            for each row execute function app.synthetic_credit_failure();
        """)
        assert "synthetic injected failure" in db.error(issue(INVOICE, revision, snapshot(2000, True), True))
        assert db.sql(f"select count(*) from public.careon_facturatie_facturen where gecrediteerde_factuur_id='{INVOICE}'") == "0"
        assert db.sql(f"select count(*) from public.careon_facturatie_nummers where org_id='{ORG}' and reeks='C'") == "0"
        assert db.sql(f"select status from public.careon_facturatie_facturen where id='{INVOICE}'") == "definitief"
        db.sql("drop trigger synthetic_credit_failure on public.careon_facturatie_facturen;")
        checks += 4

        # Two full-credit requests both block on the original invoice. They
        # return one credit and consume one number, including replay afterward.
        barrier = db.start_sql(f"begin; select id from public.careon_facturatie_facturen where id='{INVOICE}' for update; select pg_sleep(1); commit;", "billing-credit-barrier")
        wait_for_sleep(db, "billing-credit-barrier")
        credits = [db.start_sql(issue(INVOICE, revision, snapshot(2000, True), True)) for _ in range(2)]
        finish(barrier)
        results = [json.loads(finish(process)) for process in credits]
        assert len({item["factuur_id"] for item in results}) == 1
        assert sorted(item["already_issued"] for item in results) == [False, True]
        credit_id = results[0]["factuur_id"]
        assert db.sql(f"select status from public.careon_facturatie_facturen where id='{INVOICE}'") == "gecrediteerd"
        assert db.sql(f"select laatste from public.careon_facturatie_nummers where org_id='{ORG}' and reeks='C'") == "1"
        assert json.loads(db.sql(issue(INVOICE, revision, None, True)))["factuur_id"] == credit_id
        checks += 5

        # RLS/API grants cannot invoke either issuance bypass; caller-supplied
        # credit concepts also cannot use the normal invoice issuance branch.
        assert "42501" in db.error("set role authenticated; " + issue(SECOND, 1, snapshot()))
        service_replay = db.sql("set role service_role; " + issue(SECOND, 1, snapshot())).splitlines()[-1]
        assert json.loads(service_replay) == {"factuur_id": SECOND, "already_issued": True}
        assert "42501" in db.error(f"set role service_role; select * from public.careon_factuur_definitief_maken_service('{ACTOR}','{ORG}','{SECOND}','F',2026::smallint,1,'{{reeks}}{{jaar}}-{{nummer:4}}','2026-09-05','2026-10-05');")
        assert "40001" in db.error(issue(credit_id, 1, snapshot()))
        assert "23505" in db.error(f"""
          insert into public.careon_facturatie_facturen
            (org_id,status,soort,reeks,jaar,volgnummer,nummer,gecrediteerde_factuur_id,factuurdatum,definitief_op)
          values ('{ORG}','definitief','creditfactuur','C',2026,999,'C2026-0999','{INVOICE}','2026-09-05',now());
        """)
        checks += 5

        # The repaired archive fixture changes only the hash, preserving all
        # required metadata. The former partial-metadata fixture must fail.
        db.sql(f"update public.careon_facturatie_facturen set pdf_pad='{ORG}/2026/F2026-0001.pdf', pdf_sha256=repeat('a',64), pdf_bytes=100, pdf_gegenereerd_op=now() where id='{INVOICE}';")
        db.sql(f"update public.careon_facturatie_facturen set pdf_sha256=repeat('0',64) where id='{INVOICE}';")
        assert "23514" in db.error(f"update public.careon_facturatie_facturen set pdf_pad=null,pdf_bytes=null,pdf_sha256=repeat('0',64) where id='{INVOICE}';")
        assert db.sql(f"select pdf_sha256=repeat('0',64) and pdf_pad is not null and pdf_bytes=100 and pdf_gegenereerd_op is not null from public.careon_facturatie_facturen where id='{INVOICE}'") == "t"
        checks += 2
    print(f"verify-facturatie-postgres: {checks} real PostgreSQL checks passed; synthetic database removed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--user", required=True)
    options = parser.parse_args()
    run(options.port, options.user)
