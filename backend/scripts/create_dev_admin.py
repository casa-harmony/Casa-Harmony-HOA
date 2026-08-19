"""Create the developer SUPERADMIN — a login that only ever sees the sandbox.

The problem this solves: you want to click through the real application, create
communities, invite residents, post invoices — without any of it touching the
client's live data, and without standing up a second deployment or database.

The sandbox partition (migration ``d7c2a91b4e05``) puts every tenant and user on
one of two sides, ``is_sandbox`` true or false, and PostgreSQL RLS makes the two
sides mutually invisible. Neither superadmin can see across it: the developer
login cannot list, select, or read a live community, and the live superadmin
does not see the developer's test communities cluttering its lists.

    DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.create_dev_admin \
        --email dev@casaharmony.ai --password 'Str0ng!DevPassw0rd'

    # ...and stand up a sandbox community to work in straight away
    DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.create_dev_admin \
        --email dev@casaharmony.ai --password 'Str0ng!DevPassw0rd' \
        --with-community "Sandbox HOA:sandbox-hoa"

Idempotent: re-running with an existing email resets that account's password and
re-asserts its sandbox flag rather than failing.

Runs as the owner role so it can write identity tables directly:

    DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.create_dev_admin ...
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from app.core.config import settings
from app.core.database import session_for
from app.core.security import hash_password
from app.models.identity import Tenant, User


def _ensure_permissions_and_roles(db) -> None:
    """System permissions/roles must exist before a community can be provisioned."""
    from scripts.seed import _ensure_permissions, _ensure_system_roles

    # _ensure_system_roles takes the permission map _ensure_permissions returns,
    # so the roles it creates come out with their permissions already attached.
    _ensure_system_roles(db, _ensure_permissions(db))
    db.flush()


def main() -> int:
    if settings.ENVIRONMENT == "production":
        print("Fatal: refusing to create a sandbox login in production.", file=sys.stderr)
        return 2

    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True, help="developer login email")
    ap.add_argument("--password", required=True, help="developer login password")
    ap.add_argument("--name", default="Developer (sandbox)", help="display name")
    ap.add_argument(
        "--with-community",
        metavar="NAME:SLUG",
        help="also provision a sandbox community to work in, e.g. 'Sandbox HOA:sandbox-hoa'",
    )
    args = ap.parse_args()

    if len(args.password) < 8:
        print("Fatal: --password must be at least 8 characters.", file=sys.stderr)
        return 2

    email = args.email.strip().lower()

    # "any" straddles both sides of the partition: this script is the one place
    # that legitimately needs to see a live user (to refuse to convert one).
    db = session_for(tenant_id=None, is_superadmin=True, sandbox="any")
    try:
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is not None and not user.is_sandbox:
            print(
                f"Fatal: {email} is an existing LIVE account. Refusing to move a live "
                "login into the sandbox — pick a different --email.",
                file=sys.stderr,
            )
            return 2

        if user is None:
            user = User(
                email=email,
                hashed_password=hash_password(args.password),
                full_name=args.name,
                is_superadmin=True,
                is_sandbox=True,
                is_active=True,
                must_change_password=False,
            )
            db.add(user)
            action = "created"
        else:
            user.hashed_password = hash_password(args.password)
            user.is_superadmin = True
            user.is_active = True
            action = "updated (password reset)"
        db.flush()

        community = None
        if args.with_community:
            if ":" not in args.with_community:
                print("Fatal: --with-community must be 'NAME:SLUG'.", file=sys.stderr)
                return 2
            name, slug = (p.strip() for p in args.with_community.split(":", 1))
            _ensure_permissions_and_roles(db)

            existing = db.execute(select(Tenant).where(Tenant.slug == slug)).scalar_one_or_none()
            if existing is not None and not existing.is_sandbox:
                print(
                    f"Fatal: slug {slug!r} is already used by a LIVE community.",
                    file=sys.stderr,
                )
                return 2

            from app.services.provisioning import provision_tenant

            # Provision on the sandbox side. The before_insert stamp reads the
            # request context, which scripts don't have, so set it explicitly.
            community = provision_tenant(
                db=db,
                slug=slug,
                name=name,
                admin_email=email,
                admin_password=args.password,
                admin_name=args.name,
                actor_id=user.id,
            )
            community.is_sandbox = True
            db.flush()
            # Capture as plain strings: commit expires the instance, and the
            # refresh SELECT would run after the session is closed.
            community = (community.name, community.slug)

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(f"Developer SUPERADMIN {action}: {email}")
    print("  sandbox: yes — this login cannot see or touch live communities.")
    if community is not None:
        print(f"  sandbox community: {community[0]} (slug={community[1]})")
    print("\nSign in at /login with this email. Everything you create there stays")
    print("in the sandbox: no email or SMS is sent, and payments use the MOCK provider.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
