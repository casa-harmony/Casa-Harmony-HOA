"""Provision a fresh, clean HOA (community) end to end.

One command turns an empty database into a usable community: the tenant, its
default 6-segment Chart of Accounts, an administrator login that can run the
HOA, and — optionally — resident portal logins linked to their units.

    # minimal: a community with one admin login
    python -m scripts.create_community \
        --name "Willowbrook HOA" --slug willowbrook \
        --admin-email admin@willowbrook.org --admin-password 'Str0ng!Passw0rd'

    # also create two resident portal logins, each linked to a new unit
    python -m scripts.create_community \
        --name "Willowbrook HOA" --slug willowbrook \
        --admin-email admin@willowbrook.org --admin-password 'Str0ng!Passw0rd' \
        --resident 'jsmith:Jane Smith:101A:jane@example.com' \
        --resident 'bjones:Bob Jones:102B:bob@example.com'

The admin is created as SYSADMIN, which can manage users, residents, the COA,
and every financial module for this HOA. Residents are created with
``must_change_password`` set, so they set their own password on first login;
each is linked to a freshly created homeowner account (their "unit").

Idempotent by slug: re-running with an existing slug reports it and stops rather
than duplicating. Runs as the owner role (needs DDL-free writes across identity
tables); invoke with the migration URL, e.g.:

    DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.create_community ...
"""
from __future__ import annotations

import argparse
import sys
import uuid

from sqlalchemy import select

from app.core.database import session_for
from app.core.security import hash_password
from app.models.identity import Tenant, User
from app.models.resident import Resident, ResidentUnit
from app.models.subledger import ArHomeowner
from app.services.provisioning import provision_tenant


def _ensure_permissions_and_roles(db):
    """Make sure system permissions + roles exist, reusing the seed's helpers."""
    # The seed module owns the canonical definitions; import lazily so this
    # script has no import-time dependency on it.
    from scripts.seed import _ensure_permissions, _ensure_system_roles

    perms = _ensure_permissions(db)
    roles = _ensure_system_roles(db, perms)
    return roles


def _parse_resident(spec: str) -> dict:
    # username:Full Name:unit:email(optional)
    parts = spec.split(":")
    if len(parts) < 3:
        raise argparse.ArgumentTypeError(
            f"--resident must be 'username:Full Name:unit[:email]', got {spec!r}"
        )
    return {
        "username": parts[0].strip(),
        "full_name": parts[1].strip(),
        "unit": parts[2].strip(),
        "email": parts[3].strip() if len(parts) > 3 and parts[3].strip() else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True, help="Display name, e.g. 'Willowbrook HOA'")
    ap.add_argument("--slug", required=True, help="URL-safe id, e.g. 'willowbrook' (a-z0-9-)")
    ap.add_argument("--admin-email", required=True)
    ap.add_argument("--admin-password", required=True)
    ap.add_argument("--admin-name", default=None, help="Admin full name (defaults from email)")
    ap.add_argument("--resident", action="append", default=[], type=_parse_resident,
                    help="'username:Full Name:unit[:email]' — repeatable")
    ap.add_argument("--no-coa", action="store_true", help="Skip Chart of Accounts bootstrap")
    args = ap.parse_args()

    if not args.slug.replace("-", "").isalnum() or not args.slug.islower():
        print("slug must be lower-case letters, digits, and hyphens only.", file=sys.stderr)
        return 2
    if len(args.admin_password) < 8:
        print("admin password must be at least 8 characters.", file=sys.stderr)
        return 2

    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        if db.execute(select(Tenant).where(Tenant.slug == args.slug)).scalar_one_or_none():
            print(f"A community with slug {args.slug!r} already exists. "
                  "Choose another slug or purge it first.", file=sys.stderr)
            return 1

        roles = _ensure_permissions_and_roles(db)
        sysadmin_role = roles["SYSADMIN"]

        # A stable actor for created_by; the platform superadmin.
        superadmin = db.execute(
            select(User).where(User.is_superadmin.is_(True))
        ).scalars().first()
        actor_id = superadmin.id if superadmin else None

        tenant = provision_tenant(
            db=db,
            slug=args.slug,
            name=args.name,
            admin_email=args.admin_email,
            admin_password=args.admin_password,
            admin_name=args.admin_name,
            create_default_coa=not args.no_coa,
            actor_id=actor_id,
        )
        print(f"  created community {tenant.name!r} (slug={tenant.slug}, id={tenant.id})")
        print(f"  provisioned default 6-segment Chart of Accounts and all 12 setup steps")
        print(f"  created/linked admin {args.admin_email} as SYSADMIN of {tenant.slug}")

        # 4. residents + their units
        for r in args.resident:
            homeowner = ArHomeowner(
                tenant_id=tenant.id,
                account_number=f"H-{uuid.uuid4().hex[:6].upper()}",
                first_name=r["full_name"].split(" ")[0],
                last_name=" ".join(r["full_name"].split(" ")[1:]) or r["full_name"],
                email=r["email"], property_unit=r["unit"],
                created_by=actor_id, updated_by=actor_id,
            )
            db.add(homeowner)
            db.flush()
            resident = Resident(
                tenant_id=tenant.id, username=r["username"],
                password_hash=hash_password(uuid.uuid4().hex),  # placeholder; must reset
                resident_type="OWNER", full_name=r["full_name"], email=r["email"],
                is_active=True, must_change_password=True, mfa_enabled=False,
                created_by=actor_id, updated_by=actor_id,
            )
            db.add(resident)
            db.flush()
            db.add(ResidentUnit(
                tenant_id=tenant.id, resident_id=resident.id, homeowner_id=homeowner.id,
                unit_number=r["unit"], is_primary=True,
                created_by=actor_id, updated_by=actor_id,
            ))
            print(f"  created resident {r['username']!r} → unit {r['unit']} "
                  f"(homeowner {homeowner.account_number}); must set password via 'forgot password'")

        db.commit()

        print("\nDone. Sign in:")
        print(f"  Staff:    {args.admin_email}  (SYSADMIN, HOA '{tenant.slug}')")
        for r in args.resident:
            print(f"  Resident: {r['username']} @ {tenant.slug}  (set password via portal 'forgot password')")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
