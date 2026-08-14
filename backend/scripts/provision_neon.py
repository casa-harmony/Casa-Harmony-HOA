"""Provision a Neon (or any managed) Postgres for Casa Harmony.

Creates, idempotently:

* the application database (default ``casa_harmony``), separate from whatever
  else lives in the Neon project;
* the restricted ``casa_app`` login role — ``NOSUPERUSER NOBYPASSRLS`` — which
  the API connects as, so Row-Level Security is always enforced. This matters
  on Neon specifically: the ``neondb_owner`` role Neon hands you has
  ``BYPASSRLS``, so connecting the app with the default connection string would
  silently disable every tenant-isolation policy in the schema.

Run it with the **owner** connection string, then put the printed values in
``backend/.env``::

    python -m scripts.provision_neon --owner-url "postgresql://owner:pw@host/neondb"

Re-running is safe: an existing role keeps its password unless --rotate-password
is passed, and an existing database is left alone.
"""
from __future__ import annotations

import argparse
import re
import secrets
import string
import sys
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql

APP_ROLE = "casa_app"
DEFAULT_DB = "casa_harmony"


def _password(n: int = 28) -> str:
    # Keep it URL-safe so it can be pasted into a connection string unescaped.
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))


def _normalise(url: str) -> str:
    """Accept the SQLAlchemy-flavoured URL and the pooled host; psycopg wants neither."""
    url = url.replace("postgresql+psycopg://", "postgresql://")
    return url.replace("-pooler.", ".")


def _swap(url: str, *, db: str | None = None, user: str | None = None,
          password: str | None = None) -> str:
    parts = urlsplit(url)
    userinfo = parts.netloc.split("@")[-1]
    u = user if user is not None else (parts.username or "")
    p = password if password is not None else (parts.password or "")
    netloc = f"{u}:{p}@{userinfo}"
    path = f"/{db}" if db else parts.path
    return urlunsplit((parts.scheme, netloc, path, parts.query, parts.fragment))


def _redact(url: str) -> str:
    return re.sub(r"//([^:]+):[^@]+@", r"//\1:***@", url)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner-url", required=True,
                    help="Connection string for the DB owner (Neon's neondb_owner).")
    ap.add_argument("--db", default=DEFAULT_DB, help=f"Application database (default {DEFAULT_DB}).")
    ap.add_argument("--rotate-password", action="store_true",
                    help="Reset the casa_app password even if the role already exists.")
    args = ap.parse_args()

    owner_url = _normalise(args.owner_url)
    app_password = _password()

    # ---- 1. database -------------------------------------------------------
    with psycopg.connect(owner_url, autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute("select 1 from pg_database where datname = %s", (args.db,))
        if cur.fetchone():
            print(f"  database {args.db!r} already exists")
        else:
            cur.execute(f'CREATE DATABASE "{args.db}"')
            print(f"  created database {args.db!r}")

        # ---- 2. restricted role -------------------------------------------
        cur.execute("select 1 from pg_roles where rolname = %s", (APP_ROLE,))
        exists = cur.fetchone() is not None
        if exists and not args.rotate_password:
            print(f"  role {APP_ROLE!r} already exists — password unchanged "
                  f"(use --rotate-password to reset it)")
            app_password = None
        elif exists:
            # CREATE/ALTER ROLE are utility statements — they cannot take bound
            # parameters, so the password is composed as a quoted literal.
            cur.execute(sql.SQL("ALTER ROLE {} WITH PASSWORD {} "
                                "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS LOGIN").format(
                sql.Identifier(APP_ROLE), sql.Literal(app_password)))
            print(f"  rotated password for existing role {APP_ROLE!r}")
        else:
            cur.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {} "
                                "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS").format(
                sql.Identifier(APP_ROLE), sql.Literal(app_password)))
            print(f"  created role {APP_ROLE!r} (NOSUPERUSER NOBYPASSRLS)")

        cur.execute(f'GRANT CONNECT ON DATABASE "{args.db}" TO {APP_ROLE}')

        # The safety property this whole script exists for.
        cur.execute(
            "select rolsuper, rolbypassrls from pg_roles where rolname = %s", (APP_ROLE,)
        )
        is_super, bypasses = cur.fetchone()
        if is_super or bypasses:
            print(f"  FATAL: {APP_ROLE} has superuser={is_super} bypassrls={bypasses}; "
                  "RLS would not be enforced.", file=sys.stderr)
            return 1
        print(f"  verified {APP_ROLE}: superuser=False bypassrls=False")

    # ---- 3. schema privileges (must run inside the app database) -----------
    db_url = _swap(owner_url, db=args.db)
    with psycopg.connect(db_url, autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute(f"GRANT USAGE, CREATE ON SCHEMA public TO {APP_ROLE}")
        print(f"  granted USAGE, CREATE on schema public to {APP_ROLE}")

    app_url = _swap(db_url, user=APP_ROLE, password=app_password or "<existing-password>")
    sep = "&" if "?" in app_url else "?"
    if "sslmode" not in app_url:
        app_url = f"{app_url}{sep}sslmode=require"

    print("\n  Add to backend/.env:\n")
    print(f"    MIGRATION_DB_URL={_swap(db_url, db=args.db).replace('postgresql://', 'postgresql+psycopg://')}")
    print(f"    DATABASE_URL={app_url.replace('postgresql://', 'postgresql+psycopg://')}")
    print("\n  (MIGRATION_DB_URL is the owner and runs Alembic; DATABASE_URL is the")
    print("   restricted role the API runs as. Never point the API at the owner.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
