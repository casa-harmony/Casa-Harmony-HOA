"""Wipe every sandbox community and sandbox user; leave live data untouched.

The point of the sandbox is that you can make a mess in it. This puts it back to
empty in one command, with no chance of catching live data in the blast radius:
targets are selected by ``is_sandbox = true``, so a live tenant is not merely
skipped, it is never a candidate.

    DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.reset_sandbox --yes

    # keep the developer logins, drop only their communities
    DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.reset_sandbox --keep-admins --yes

Deletion reuses scripts/purge_tenant's schema-derived table sweep, so it stays
correct as tables are added.

Runs as the owner role:

    DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.reset_sandbox --yes
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import text

from app.core.config import settings
from app.core.database import session_for
from scripts.purge_tenant import tenant_tables


def main() -> int:
    if settings.ENVIRONMENT == "production":
        print("Fatal: This script is disabled in production environments.", file=sys.stderr)
        return 2

    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    ap.add_argument(
        "--keep-admins",
        action="store_true",
        help="delete sandbox communities but keep the sandbox logins themselves",
    )
    args = ap.parse_args()

    # Owner role: RLS is bypassed here, so both sides are visible. Every
    # statement below is explicitly filtered on is_sandbox instead.
    db = session_for(tenant_id=None, is_superadmin=True, sandbox="any")
    try:
        targets = db.execute(
            text("SELECT id, slug, name FROM tenants WHERE is_sandbox IS TRUE ORDER BY name")
        ).all()
        sandbox_users = db.execute(
            text("SELECT id, email FROM users WHERE is_sandbox IS TRUE ORDER BY email")
        ).all()

        if not targets and not sandbox_users:
            print("Sandbox is already empty.")
            return 0

        print("About to permanently delete:")
        for t in targets:
            print(f"  - community {t.name}  (slug={t.slug})")
        if not args.keep_admins:
            for u in sandbox_users:
                print(f"  - login {u.email}")
        live = db.execute(
            text("SELECT count(*) FROM tenants WHERE is_sandbox IS FALSE")
        ).scalar_one()
        print(f"Live communities untouched: {live}")

        if not args.yes:
            if input("Type 'reset' to confirm: ").strip() != "reset":
                print("Aborted.")
                return 1

        tables = tenant_tables(db)
        for t in targets:
            deleted = 0
            # Same retry-until-stable sweep as purge_tenant: information_schema
            # order is alphabetical, not FK-safe, so a single pass can trip over
            # a RESTRICT reference that a later pass clears.
            remaining = list(tables)
            last_errors: dict[str, str] = {}
            while remaining:
                failed = []
                progressed = False
                for table in remaining:
                    savepoint = db.begin_nested()
                    try:
                        res = db.execute(
                            text(f"DELETE FROM {table} WHERE tenant_id = :tid"), {"tid": t.id}
                        )
                        savepoint.commit()
                        deleted += res.rowcount or 0
                        progressed = True
                    except Exception as e:
                        savepoint.rollback()
                        failed.append(table)
                        last_errors[table] = str(e).splitlines()[0]
                if not progressed:
                    details = "\n".join(f"  {x}: {last_errors[x]}" for x in failed)
                    raise RuntimeError(
                        f"Cannot reset {t.slug}: these tables made no progress:\n{details}"
                    )
                remaining = failed
            db.execute(text("DELETE FROM role_permissions WHERE role_id IN "
                            "(SELECT id FROM roles WHERE tenant_id = :tid)"), {"tid": t.id})
            db.execute(text("DELETE FROM roles WHERE tenant_id = :tid"), {"tid": t.id})
            db.execute(text("DELETE FROM tenants WHERE id = :tid"), {"tid": t.id})
            db.commit()
            print(f"  reset {t.slug}: {deleted} scoped rows + roles + community")

        if not args.keep_admins:
            removed = db.execute(
                text("DELETE FROM users WHERE is_sandbox IS TRUE")
            ).rowcount
            db.commit()
            print(f"  removed {removed} sandbox login(s)")

        remaining_live = db.execute(
            text("SELECT count(*) FROM tenants WHERE is_sandbox IS FALSE")
        ).scalar_one()
        print(f"Done. Live communities still present: {remaining_live}")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
