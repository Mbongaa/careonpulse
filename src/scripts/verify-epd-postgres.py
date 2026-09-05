"""Real local PostgreSQL publication/MVCC/RLS tests with synthetic EPD slices.

python3 src/scripts/verify-epd-postgres.py --port 55439 --user hassan
"""

import argparse
import datetime
import json
import sys
import time
import uuid
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from local_postgres import LocalPostgres

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"
ORG = "11111111-1111-4111-8111-111111111111"
OTHER_ORG = "99999999-9999-4999-8999-999999999999"
ADMIN = "22222222-2222-4222-8222-222222222222"
MEMBER = "33333333-3333-4333-8333-333333333333"
OUTSIDER = "44444444-4444-4444-8444-444444444444"
TABLES = ["careon_import_runs", "careon_import_records", "careon_agenda_state", "careon_verwijzers_state", "careon_toeslagen_state", "careon_declaraties_state", "careon_epd_generations"]


def payload(tag):
    return {
        "fileName": "synthetic.csv", "records": [{"syntheticGeneration": tag}],
        "agenda": {"tag": tag, "cellen": [{"sessies": 7, "omzetGerealiseerd": 100, "onderhanden": 200, "onderhandenSessies": 2}], "facturatie": [{"synthetic": 100}]},
        "verwijzers": {"tag": tag}, "toeslagen": {"tag": tag}, "declaraties": {"tag": tag},
    }


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def publish(generation, expected, source_time, body):
    parent = "null" if expected is None else f"'{expected}'::uuid"
    return f"set role service_role; select public.careon_publish_epd_generation('{ORG}','{generation}',{parent},'{source_time}',{literal(body)});"


def as_user(user, query):
    return f"set role authenticated; select set_config('request.jwt.claim.sub','{user}',false); {query}"


def read(db, user=ADMIN, org=ORG):
    return json.loads(db.sql(as_user(user, f"select public.careon_read_epd_snapshot('{org}');")).splitlines()[-1])


def assert_generation(value, generation, tag):
    assert value["generationId"] == generation
    assert value["production"]["records"] == [{"syntheticGeneration": tag}]
    assert [value[key]["tag"] for key in ["agenda", "verwijzers", "toeslagen", "declaraties"]] == [tag] * 4


def counts(db):
    return [db.sql(f"select count(*) from public.{table}") for table in TABLES]


def wait_for_sleep(db, application):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if db.sql(f"select count(*) from pg_stat_activity where datname='{db.name}' and application_name='{application}' and wait_event='PgSleep'") == "1":
            return
        time.sleep(0.03)
    raise AssertionError("Synthetic publication barrier was not reached")


def run(port, user):
    checks = 0
    with LocalPostgres(port, user, prefix="careon_epd_regression") as db:
        db.bootstrap_supabase()
        for name in [
            "0001_careon_production.sql", "0002_careon_middelen.sql", "0003_careon_agenda.sql",
            "0004_careon_toeslagen.sql", "0005_careon_declaraties.sql", "0006_assistant_production_hardening.sql",
            "0007_careon_hr.sql", "0008_runtime_operations_hardening.sql", "0009_auth_tenancy.sql",
            "0010_org_scoping.sql", "0015_financieel_rls.sql", "0017_import_runs_created_at.sql",
            "0020_careon_facturatie.sql", "20260822235000_security_invoker_boundaries.sql",
            "20260905135733_active_account_rls.sql", "20260905135745_epd_atomic_generations.sql",
        ]:
            db.apply(MIGRATIONS / name)
        db.sql(f"""
          insert into public.organizations(id,name,slug) values ('{ORG}','Synthetic A','synthetic-a'),('{OTHER_ORG}','Synthetic B','synthetic-b');
          insert into auth.users(id,email) values ('{ADMIN}','admin@example.invalid'),('{MEMBER}','member@example.invalid'),('{OUTSIDER}','outside@example.invalid');
          insert into public.organization_members(org_id,user_id,role) values
            ('{ORG}','{ADMIN}','org_admin'),('{ORG}','{MEMBER}','member'),('{OTHER_ORG}','{OUTSIDER}','org_admin');
        """)
        now = datetime.datetime.now(datetime.timezone.utc)
        times = [(now - datetime.timedelta(hours=hours)).isoformat() for hours in [72, 48, 24]]
        first = str(uuid.uuid4())
        db.sql("create function app.synthetic_fail() returns trigger language plpgsql as $$ begin raise exception 'synthetic slice failure'; end $$;")
        for table in TABLES:
            db.sql(f"create trigger synthetic_failure before insert on public.{table} for each row execute function app.synthetic_fail();")
            assert "synthetic slice failure" in db.error(publish(first, None, times[0], payload("first")))
            assert counts(db) == ["0"] * len(TABLES)
            db.sql(f"drop trigger synthetic_failure on public.{table};")
            checks += 2
        db.sql(publish(first, None, times[0], payload("first")))
        assert_generation(read(db), first, "first")
        checks += 1

        # Hold the org advisory lock so both publishers wait before competing
        # with precisely the same expected generation.
        barrier = db.start_sql(f"begin; select pg_advisory_xact_lock(hashtextextended('careon-epd:{ORG}',0)); select pg_sleep(1); commit;", "epd-publisher-barrier")
        wait_for_sleep(db, "epd-publisher-barrier")
        candidates = [str(uuid.uuid4()), str(uuid.uuid4())]
        publishers = [db.start_sql(publish(candidate, first, times[1], payload("second"))) for candidate in candidates]
        barrier.communicate(timeout=5)
        outputs = [process.communicate(timeout=5) for process in publishers]
        assert sorted(process.returncode for process in publishers) == [0, 1]
        winner_index = next(index for index, process in enumerate(publishers) if process.returncode == 0)
        winner = candidates[winner_index]
        assert "40001" in outputs[1 - winner_index][1]
        assert counts(db) == ["2"] * len(TABLES)
        assert_generation(read(db), winner, "second")
        checks += 4
        db.sql(publish(winner, first, times[1], payload("second")))
        assert counts(db) == ["2"] * len(TABLES)
        assert "23505" in db.error(publish(winner, first, times[1], payload("changed")))
        assert "22023" in db.error(publish(str(uuid.uuid4()), winner, times[0], payload("stale")))
        checks += 3

        # The writer pauses after several inserts but before publishing; readers
        # must still get all five slices of the previous generation.
        third = str(uuid.uuid4())
        db.sql("""
          create function app.synthetic_pause() returns trigger language plpgsql as $$
          begin perform pg_sleep(2); return new; end $$;
          create trigger synthetic_pause before insert on public.careon_declaraties_state
            for each row execute function app.synthetic_pause();
        """)
        writer = db.start_sql(publish(third, winner, times[2], payload("third")), "epd-paused-writer")
        wait_for_sleep(db, "epd-paused-writer")
        assert_generation(read(db), winner, "second")
        _, error = writer.communicate(timeout=5)
        assert writer.returncode == 0, error
        assert_generation(read(db), third, "third")
        db.sql("drop trigger synthetic_pause on public.careon_declaraties_state;")
        checks += 3

        member = read(db, MEMBER)
        assert member["production"]["records"] == [{"syntheticGeneration": "third"}]
        assert member["agenda"]["cellen"][0] == {"sessies": 7, "omzetGerealiseerd": 0, "onderhanden": 0, "onderhandenSessies": 0}
        assert member["agenda"]["facturatie"] == []
        assert member["toeslagen"] is None and member["declaraties"] is None
        assert all(value is None for value in read(db, OUTSIDER).values())
        db.sql(f"update auth.users set banned_until=now()+interval '1 day' where id='{MEMBER}';")
        assert all(value is None for value in read(db, MEMBER).values())
        assert "42501" in db.error(as_user(ADMIN, publish(str(uuid.uuid4()), third, times[2], payload("denied")).replace("set role service_role; ", "")))
        checks += 7

        # A generation-managed tenant rejects legacy single-slice inserts,
        # while a different manual-import tenant remains writable.
        assert "42501" in db.error(as_user(ADMIN, f"insert into public.careon_verwijzers_state(org_id,state) values ('{ORG}','{{}}');"))
        db.sql(as_user(OUTSIDER, f"insert into public.careon_verwijzers_state(org_id,state) values ('{OTHER_ORG}','{{}}');"))
        checks += 2

        # A caller cannot append records to an already published generation.
        # Ordinary manual imports in a different tenant retain their row path.
        published_run = db.sql(f"select run_id from public.careon_epd_generations where id='{third}'")
        assert "42501" in db.error(as_user(ADMIN, f"insert into public.careon_import_records(run_id,record) values ('{published_run}','{{\"syntheticAppend\":true}}');"))
        assert_generation(read(db), third, "third")
        manual_run = str(uuid.uuid4())
        db.sql(as_user(OUTSIDER, f"""
          insert into public.careon_import_runs(id,org_id,file_name,total_rows)
            values ('{manual_run}','{OTHER_ORG}','synthetic-manual.csv',1);
          insert into public.careon_import_records(run_id,record)
            values ('{manual_run}','{{"syntheticManual":true}}');
        """))
        assert db.sql(f"select count(*) from public.careon_import_records where run_id='{manual_run}'") == "1"
        checks += 3
    print(f"verify-epd-postgres: {checks} real PostgreSQL checks passed; synthetic database removed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--user", required=True)
    options = parser.parse_args()
    run(options.port, options.user)
