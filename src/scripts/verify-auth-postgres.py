"""F02 retained-claim authorization regressions against local PostgreSQL.

python3 src/scripts/verify-auth-postgres.py --port 55439 --user hassan

Creates and drops one fresh synthetic database on localhost. No application
.env, credentials, network providers, production data, or token issuance are
used. Applies the actual migration chain, excluding only 0019's token-issuance
hook (its Supabase-owned postgres role is absent in the local cluster). The
auth bootstrap supplies the same request-claim GUC boundary used by PostgREST;
all public tables, policies, and authorization/projection functions are real.
"""

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from local_postgres import LocalPostgres

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
FIX = "20260905135733_active_account_rls.sql"
ORG_A = "11111111-1111-4111-8111-111111111111"
ORG_B = "22222222-2222-4222-8222-222222222222"
MEMBER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
SUPER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"


def quoted(value):
    return "'" + value.replace("'", "''") + "'"


def as_user(subject, query):
    # Deliberately retained claims include stronger stale app metadata. Current
    # auth.users and membership rows, not these claims, must determine access.
    claims = json.dumps({
        "sub": subject, "role": "authenticated",
        "app_metadata": {"org_id": ORG_A, "role": "org_admin", "is_superadmin": True},
    })
    return f"set role authenticated; set request.jwt.claims = {quoted(claims)}; {query}"


def run(port, user):
    checks = 0

    def equal(actual, expected, label):
        nonlocal checks
        # psql also emits SET tags. Query results are always one final line.
        actual = actual.splitlines()[-1] if actual else ""
        if actual != str(expected):
            raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")
        checks += 1

    with LocalPostgres(port, user, prefix="careon_auth_regression") as db:
        db.bootstrap_supabase()
        migrations = sorted(MIGRATIONS.glob("*.sql"))
        for migration in migrations:
            if migration.name < FIX and migration.name != "0019_careon_access_token_hook.sql":
                db.apply(migration)

        db.sql(f"""
          insert into public.organizations(id,name,slug) values
            ('{ORG_A}','Synthetic A','synthetic-auth-a'),
            ('{ORG_B}','Synthetic B','synthetic-auth-b');
          insert into auth.users(id,email) values
            ('{MEMBER}','member@example.invalid'), ('{ADMIN}','admin@example.invalid'),
            ('{SUPER}','super@example.invalid'), ('{OTHER}','other@example.invalid');
          insert into public.organization_members(org_id,user_id,role) values
            ('{ORG_A}','{MEMBER}','member'), ('{ORG_A}','{ADMIN}','org_admin'),
            ('{ORG_A}','{SUPER}','org_admin'), ('{ORG_B}','{OTHER}','member');
          insert into public.platform_admins(user_id) values ('{SUPER}');
          insert into public.assistant_threads(user_id,id,org_id,title)
            select user_id,'fixture',org_id,'Synthetic chat' from public.organization_members;
          insert into public.assistant_messages(user_id,org_id,thread_id,message_id,payload)
            select user_id,org_id,'fixture','fixture-message','{{"synthetic":true}}'::jsonb
            from public.organization_members;
          insert into public.careon_agenda_state(org_id,state) values
            ('{ORG_A}','{{"cellen":[{{"omzetGerealiseerd":777,"onderhanden":888,"onderhandenSessies":9,"uren":12}}],"facturatie":[{{"synthetic":true}}]}}'),
            ('{ORG_B}','{{"cellen":[],"facturatie":[]}}');
        """)

        # Demonstrate the old defect using the actual pre-fix schema. No HTTP
        # login or replacement token is needed after the database ban changes.
        db.sql(f"update auth.users set banned_until = now() + interval '1 day' where id='{MEMBER}'")
        for table in ("profiles", "assistant_threads", "assistant_messages", "careon_agenda_state_public"):
            equal(db.sql(as_user(MEMBER, f"select count(*) from public.{table}")), 1,
                  f"pre-fix retained JWT exposes {table}")
        equal(db.sql(as_user(MEMBER, f"select app.is_org_member('{ORG_A}')")), "t",
              "pre-fix membership helper ignores ban")

        for migration in migrations:
            if migration.name >= FIX:
                db.apply(migration)

        def query(subject, sql, expected, label):
            equal(db.sql(as_user(subject, sql)), expected, label)

        def denied(subject, sql, label):
            error = db.error(as_user(subject, sql))
            if "42501" not in error:
                raise AssertionError(f"{label}: expected authorization error, got {error}")
            nonlocal checks
            checks += 1

        def helpers(subject, expected):
            query(subject,
                  f"select app.is_active_user(), app.is_superadmin(), app.is_org_member('{ORG_A}'), "
                  f"app.mag_financieel_zien('{ORG_A}'), app.mag_facturatie_zien('{ORG_A}')",
                  expected, "current authorization helpers")

        # Enforce coverage for future exposed tables too. Policies must combine
        # with existing tenant rules using AND (AS RESTRICTIVE), for reads and
        # writes, on every RLS table including tables created after F02.
        equal(db.sql("""
          select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
            and not exists (
              select 1 from pg_policy p where p.polrelid=c.oid
                and p.polname='careon_active_account' and not p.polpermissive
                and p.polcmd='*' and 'authenticated'::regrole::oid=any(p.polroles)
                and pg_get_expr(p.polqual,p.polrelid) like '%app.is_active_user()%'
                and pg_get_expr(p.polwithcheck,p.polrelid) like '%app.is_active_user()%'
            )
        """), 0, "all public RLS tables have restrictive active-account read/write policy")
        equal(db.sql("""
          select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity
            and (has_table_privilege('authenticated',c.oid,'SELECT')
              or has_table_privilege('authenticated',c.oid,'INSERT')
              or has_table_privilege('authenticated',c.oid,'UPDATE')
              or has_table_privilege('authenticated',c.oid,'DELETE'))
        """), 0, "no authenticated table grant bypasses RLS")
        equal(db.sql("""
          select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.prosecdef
            and has_function_privilege('authenticated',p.oid,'EXECUTE')
        """), 0, "no exposed authenticated definer RPC bypasses the policy checks")

        exposed_tables = db.sql("""
          select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
            and has_table_privilege('authenticated',c.oid,'SELECT') order by c.relname
        """).splitlines()

        def no_access(subject, label):
            helpers(subject, "f|f|f|f|f")
            for table in exposed_tables:
                # Identifiers originate only from this disposable schema.
                name = '"' + table.replace('"', '""') + '"'
                query(subject, f"select count(*) from public.{name}", 0, f"{label}: {table}")
            query(subject, "select count(*) from public.careon_agenda_state_public", 0,
                  f"{label}: agenda view")
            query(subject, "select count(*) from app.careon_agenda_state_public_rows()", 0,
                  f"{label}: direct internal projection")
            for table in ("assistant_threads", "assistant_messages"):
                query(subject, f"with changed as (delete from public.{table} returning 1) select count(*) from changed",
                      0, f"{label}: owner-only delete {table}")
            query(subject,
                  "with changed as (update public.assistant_threads set title='Must not persist' returning 1) "
                  "select count(*) from changed", 0, f"{label}: chat update")
            query(subject,
                  "with changed as (update public.assistant_messages set payload='{\"denied\":true}' returning 1) "
                  "select count(*) from changed", 0, f"{label}: message update")
            denied(subject,
                   f"insert into public.assistant_threads(user_id,id,org_id) values ('{subject}','denied','{ORG_A}')",
                   f"{label}: chat insert")
            denied(subject,
                   f"insert into public.assistant_messages(user_id,org_id,thread_id,message_id,payload) "
                   f"values ('{subject}','{ORG_A}','denied','denied','{{}}')",
                   f"{label}: message insert")
            denied(subject, "update public.profiles set full_name='Must not persist'",
                   f"{label}: profile writes have no client grant")

        no_access(MEMBER, "banned member with retained claims")
        # Refused mutations must leave fixtures available to recovery/admin.
        equal(db.sql("select count(*) from public.assistant_threads"), 4, "denied owner deletes persisted nothing")
        equal(db.sql("select count(*) from public.assistant_messages"), 4, "denied message deletes persisted nothing")
        equal(db.sql("select count(*) from public.assistant_threads where title='Must not persist'"), 0,
              "denied updates persisted nothing")

        db.sql(f"update auth.users set banned_until = null where id='{MEMBER}'")
        helpers(MEMBER, "t|f|t|f|f")
        for table in ("profiles", "organization_members", "organizations", "assistant_threads", "assistant_messages"):
            query(MEMBER, f"select count(*) from public.{table}", 1, f"active member reads own {table}")
        query(MEMBER, f"select count(*) from public.profiles where id='{OTHER}'", 0, "foreign profile hidden")
        query(MEMBER, f"select count(*) from public.assistant_threads where user_id='{OTHER}'", 0, "foreign chat hidden")
        query(MEMBER, f"select app.is_org_member('{ORG_B}'),app.mag_financieel_zien('{ORG_B}')", "f|f",
              "claims cannot add foreign tenant membership")
        query(MEMBER, "select count(*) from public.careon_agenda_state", 0, "member cannot read raw financial agenda")
        query(MEMBER,
              "select (state->'cellen'->0->>'omzetGerealiseerd')||':'||(state->'cellen'->0->>'onderhanden')||':'||"
              "(state->'cellen'->0->>'onderhandenSessies')||':'||(state->'cellen'->0->>'uren')||':'||"
              "jsonb_array_length(state->'facturatie') from public.careon_agenda_state_public",
              "0:0:0:12:0", "member agenda remains financially redacted")
        query(MEMBER, f"select count(*) from public.careon_agenda_state_public where org_id='{ORG_B}'", 0,
              "projection keeps tenant isolation")

        query(MEMBER,
              f"with changed as (insert into public.assistant_threads(user_id,id,org_id) values "
              f"('{MEMBER}','active-write','{ORG_A}') returning 1) select count(*) from changed",
              1, "active member can create own chat")
        query(MEMBER,
              "with changed as (update public.assistant_threads set title='Updated' where id='active-write' returning 1) "
              "select count(*) from changed", 1, "active member can update own chat")
        denied(MEMBER, f"update public.assistant_threads set org_id='{ORG_B}' where id='active-write'",
               "active member cannot move own chat to foreign tenant")
        query(MEMBER,
              "with changed as (delete from public.assistant_threads where id='active-write' returning 1) "
              "select count(*) from changed", 1, "active member can delete own chat")
        query(MEMBER,
              f"with changed as (insert into public.assistant_messages(user_id,org_id,thread_id,message_id,payload) "
              f"values ('{MEMBER}','{ORG_A}','fixture','active-write','{{}}') returning 1) select count(*) from changed",
              1, "active member can create own message using sequence grant")
        query(MEMBER,
              "with changed as (update public.assistant_messages set payload='{\"updated\":true}' "
              "where message_id='active-write' returning 1) select count(*) from changed",
              1, "active member can update own message")
        query(MEMBER,
              "with changed as (delete from public.assistant_messages where message_id='active-write' returning 1) "
              "select count(*) from changed", 1, "active member can delete own message")

        helpers(ADMIN, "t|f|t|t|t")
        query(ADMIN, "select state->'cellen'->0->>'omzetGerealiseerd' from public.careon_agenda_state_public",
              777, "active org admin sees own financial agenda")
        query(ADMIN, f"select count(*) from public.careon_agenda_state where org_id='{ORG_B}'", 0,
              "org admin raw data remains tenant scoped")
        denied(ADMIN, f"insert into public.careon_agenda_state(org_id,state) values ('{ORG_B}','{{}}')",
               "org admin cannot write foreign agenda")
        db.sql(f"update auth.users set banned_until = now() + interval '1 day' where id='{ADMIN}'")
        no_access(ADMIN, "banned org admin")
        denied(ADMIN, f"insert into public.careon_agenda_state(org_id,state) values ('{ORG_A}','{{}}')",
               "banned org admin cannot insert own financial aggregate")

        helpers(SUPER, "t|t|t|t|t")
        query(SUPER, "select count(*) from public.profiles", 4, "active superadmin retains authorized support reads")
        db.sql(f"update auth.users set banned_until = now() + interval '1 day' where id='{SUPER}'")
        no_access(SUPER, "banned superadmin with unchanged platform-admin row")
        equal(db.sql(f"select count(*) from public.platform_admins where user_id='{SUPER}'"), 1,
              "superadmin denial does not depend on deleting role row")

        db.sql(f"update auth.users set deleted_at=now(),banned_until=null where id='{MEMBER}'")
        no_access(MEMBER, "soft-deleted member with retained ownership/membership")
        db.sql(f"update auth.users set deleted_at=null,banned_until=now()-interval '1 second' where id='{MEMBER}'")
        helpers(MEMBER, "t|f|t|f|f")
        query(MEMBER, "select count(*) from public.assistant_threads", 1, "expired ban restores owner access")
        query(MEMBER, "select count(*) from public.careon_agenda_state_public", 1, "expired ban restores tenant projection")
        db.sql(f"delete from auth.users where id='{MEMBER}'")
        no_access(MEMBER, "physically deleted account with retained UID")

        # Service jobs keep their explicit BYPASSRLS boundary. A service query
        # without auth.uid does not receive the user-filtered projection.
        equal(db.sql("set role service_role; select count(*) from public.careon_agenda_state"), 2,
              "service role can read base snapshots")
        equal(db.sql("set role service_role; select count(*) from app.careon_agenda_state_public_rows()"), 0,
              "no-subject service projection is empty")
        equal(db.sql("set role authenticated; select app.is_active_user()"), "f", "missing subject fails closed")
        for statement in ("select app.is_active_user()", "select * from public.profiles",
                          "select * from public.careon_agenda_state_public"):
            if "42501" not in db.error("set role anon; " + statement):
                raise AssertionError("Anonymous authorization boundary returned unexpected error")
            checks += 1

    print(f"active-account PostgreSQL: {checks}/{checks} checks passed; synthetic database removed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--user", required=True)
    options = parser.parse_args()
    run(options.port, options.user)
