"""Disposable synthetic PostgreSQL test database; never loads application .env.

Usage: with LocalPostgres(port=55439, user="hassan", prefix="careon_auth_regression") as db:
    db.bootstrap_supabase()
    db.apply(Path(...))
    db.sql("select ...")
    db.error("expected failing statement")
    process = db.start_sql("concurrent statement", app_name="test-race")
"""

import os
import re
import subprocess
import uuid
from pathlib import Path


class LocalPostgres:
    def __init__(self, port, user, prefix="careon_billing_regression"):
        if not re.fullmatch(r"careon_[a-z_]+_regression", prefix):
            raise ValueError("Only synthetic regression database prefixes are allowed")
        if not 1024 <= int(port) <= 65535:
            raise ValueError("An explicit unprivileged local test port is required")
        self.port = int(port)
        self.user = user
        self.name = prefix + "_" + uuid.uuid4().hex[:12]
        self.created = False

    def command(self, database=None):
        return [
            "psql", "--no-psqlrc", "--no-password", "-h", "127.0.0.1",
            "-p", str(self.port), "-U", self.user, "-d", database or self.name,
            "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-A", "-t",
        ]

    @staticmethod
    def environment(app_name="careon-regression"):
        clean = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
        clean.update(PGAPPNAME=app_name, PGCONNECT_TIMEOUT="5", PSQL_HISTORY=os.devnull)
        return clean

    def execute(self, query, database=None):
        return subprocess.run(
            self.command(database) + ["-c", query], text=True, capture_output=True,
            env=self.environment(), timeout=30,
        )

    def sql(self, query):
        result = self.execute(query)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def error(self, query):
        result = self.execute(query)
        if not result.returncode:
            raise AssertionError("Expected SQL failure but statement succeeded")
        return result.stderr

    def apply(self, filename):
        result = subprocess.run(
            self.command() + ["-f", str(Path(filename).resolve())], text=True,
            capture_output=True, env=self.environment(), timeout=30,
        )
        if result.returncode:
            raise AssertionError(result.stderr)

    def start_sql(self, query, app_name="careon-regression-concurrent"):
        return subprocess.Popen(
            self.command() + ["-c", query], text=True, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=self.environment(app_name),
        )

    def bootstrap_supabase(self):
        self.sql("""
          do $$ begin create role anon nologin;
            exception when duplicate_object then null; end $$;
          do $$ begin create role authenticated nologin;
            exception when duplicate_object then null; end $$;
          do $$ begin create role service_role nologin bypassrls;
            exception when duplicate_object then null; end $$;
          do $$ begin create role supabase_auth_admin nologin;
            exception when duplicate_object then null; end $$;
          create schema auth;
          create schema storage;
          create table auth.users (
            id uuid primary key, email text, email_confirmed_at timestamptz,
            raw_user_meta_data jsonb default '{}'::jsonb,
            raw_app_meta_data jsonb default '{}'::jsonb,
            banned_until timestamptz, deleted_at timestamptz,
            created_at timestamptz default now()
          );
          create table auth.identities (
            id uuid primary key default gen_random_uuid(), user_id uuid references auth.users,
            provider text, identity_data jsonb, created_at timestamptz default now()
          );
          create function auth.uid() returns uuid language sql stable as $$
            select coalesce(
              nullif(current_setting('request.jwt.claim.sub', true), ''),
              nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
            )::uuid;
          $$;
          create function auth.jwt() returns jsonb language sql stable as $$
            select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
          $$;
          create function auth.role() returns text language sql stable as $$
            select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt()->>'role');
          $$;
          grant usage on schema auth to anon, authenticated, service_role;
          create table storage.buckets (
            id text primary key, name text not null, public boolean not null default false,
            file_size_limit bigint, allowed_mime_types text[]
          );
          create table storage.objects (
            id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets,
            name text, metadata jsonb
          );
        """)

    def __enter__(self):
        result = self.execute('create database "' + self.name + '"', database="postgres")
        if result.returncode:
            raise AssertionError(result.stderr)
        self.created = True
        return self

    def __exit__(self, *_args):
        if self.created:
            # This exact randomly named database was created by this instance.
            result = self.execute('drop database "' + self.name + '" with (force)', database="postgres")
            if result.returncode:
                raise AssertionError("Could not remove synthetic test database: " + result.stderr)
