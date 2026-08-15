"""Delete one or more HOAs (tenants) and everything scoped to them.

For removing test/demo communities that accumulated during development. This is
destructive and irreversible — it deletes every tenant-scoped row across all
tables, then the tenant itself, then any user left with no remaining membership.

    python -m scripts.purge_tenant --slug isolation-probe-29198a48 --slug alpha-fbc60e86
    python -m scripts.purge_tenant --slug some-hoa --yes    # skip the prompt

Runs as the migration/owner role so it can delete across every table regardless
of RLS. It refuses to touch the primary demo tenant unless --force is given.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import text

from app.core.database import session_for
from app.models.identity import Membership, Tenant, User

PROTECTED_SLUGS = {"casa-harmony"}

def tenant_tables(db) -> list[str]:
    """Every public table that carries a tenant_id, discovered from the schema.

    Hardcoding table names here drifted badly (e.g. ``banks`` vs the real
    ``ap_banks``), so those DELETEs were silently skipped and the purge only
    worked because deleting the tenant row cascades via FKs. Deriving the list
    from ``information_schema`` makes the script correct by construction and
    future-proof: any table with a tenant_id column is purged, and the count
    reported is real.
    """
    rows = db.execute(text(
        "SELECT c.table_name FROM information_schema.columns c "
        "WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' "
        "ORDER BY c.table_name"
    )).all()
    return [r[0] for r in rows]


from app.core.config import settings

def main() -> int:
    if settings.ENVIRONMENT == "production":
        print("Fatal: This script is disabled in production environments.", file=sys.stderr)
        return 2

    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", action="append", default=[], help="HOA slug (repeatable)")
    ap.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    ap.add_argument("--force", action="store_true", help="allow purging a protected slug")
    args = ap.parse_args()

    if not args.slug:
        print("Nothing to do: pass at least one --slug", file=sys.stderr)
        return 2

    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        targets = []
        for slug in args.slug:
            if slug in PROTECTED_SLUGS and not args.force:
                print(f"Refusing to purge protected slug {slug!r} (use --force).", file=sys.stderr)
                return 2
            t = db.query(Tenant).filter(Tenant.slug == slug).one_or_none()
            if t is None:
                print(f"  {slug}: not found, skipping")
                continue
            targets.append(t)

        if not targets:
            print("No matching tenants.")
            return 0

        print("About to permanently delete these HOAs and ALL their data:")
        for t in targets:
            print(f"  - {t.name}  (slug={t.slug}, id={t.id})")
        if not args.yes:
            if input("Type 'delete' to confirm: ").strip() != "delete":
                print("Aborted.")
                return 1

        tables = tenant_tables(db)

        # Capture identifiers as plain strings; the ORM row is deleted below and
        # must not be touched afterwards.
        target_info = [(str(t.id), t.slug) for t in targets]
        target_ids = [tid for tid, _ in target_info]
        ids_sql = ",".join(f"'{tid}'" for tid in target_ids)

        # Users who hold a membership in a purged tenant — captured before those
        # rows are deleted below, so orphan cleanup never touches users who
        # belonged only to other, still-existing tenants.
        affected = {r[0] for r in db.execute(text(
            f"SELECT DISTINCT user_id FROM memberships WHERE tenant_id IN ({ids_sql})"
        )).all()}

        for tid, slug in target_info:
            deleted = 0
            for table in tables:
                res = db.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id = :tid"), {"tid": tid}
                )
                deleted += res.rowcount or 0
            # tenant-scoped (non-system) roles
            db.execute(text("DELETE FROM role_permissions WHERE role_id IN "
                            "(SELECT id FROM roles WHERE tenant_id = :tid)"), {"tid": tid})
            db.execute(text("DELETE FROM roles WHERE tenant_id = :tid"), {"tid": tid})
            db.execute(text("DELETE FROM tenants WHERE id = :tid"), {"tid": tid})
            db.commit()
            print(f"  purged {slug}: {deleted} scoped rows + roles + tenant")

        # Users left with no memberships and not superadmin are orphans — but
        # only the ones who actually lost a membership in this purge.
        if affected:
            affected_sql = ",".join(f"'{u}'" for u in affected)
            orphans = db.execute(text(
                f"SELECT id, email FROM users u WHERE u.id IN ({affected_sql}) "
                "AND u.is_superadmin = false "
                "AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)"
            )).all()
            for uid, email in orphans:
                db.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": str(uid)})
                print(f"  removed orphaned user {email}")
        db.commit()

        print("Done.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
