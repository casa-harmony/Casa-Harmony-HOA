"""Demo data: 3 HOAs + every role/login combination for review.

Idempotent. Run after the base seed:
    python -m scripts.seed && python -m scripts.seed_demo

Creates staff logins (SUPERADMIN/SYSADMIN/HOA_ADMIN/ACCOUNTANT/BOARD_MEMBER/VIEWER,
plus a multi-HOA SYSADMIN and a dual-role user) and, in Maple Grove HOA, resident
logins (owner, multi-unit owner, renter sharing a unit, and an SMS-MFA owner).

Demo accounts are created with must_change_password=False so they can be reviewed
without the first-login change prompt (real admin-created accounts force a change).
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.database import session_for
from app.core.permissions import PERMISSIONS, SYSTEM_ROLES
from app.core.security import hash_password
from app.models.identity import Membership, Permission, Role, RolePermission, Tenant, User
from app.models.kff import KffStructure
from app.models.resident import Resident, ResidentUnit
from app.models.subledger import ArHomeowner
from app.services.coa_bootstrap import provision_default_coa
from scripts.seed import _ensure_permissions, _ensure_system_roles, _ensure_user

DEMO_PW = "CasaDemo123!"          # all staff demo logins
RESIDENT_PW = "CasaDemo123!"      # all resident demo logins
BOARD_PERMS = ["coa.read", "report.read", "audit.read", "po.approve", "ap.approve", "gl.batch.approve"]

SUMMARY: list[dict] = []


def _tenant(db, su, slug, name, city, state, units):
    t = db.execute(select(Tenant).where(Tenant.slug == slug)).scalar_one_or_none()
    if t is None:
        t = Tenant(name=name, slug=slug, legal_name=f"{name}, Inc.", num_units=units,
                   city=city, state=state, created_by=su.id, updated_by=su.id)
        db.add(t)
        db.flush()
        provision_default_coa(db, t.id, su.id)
    return t


def _board_role(db, su, tenant, perms: dict[str, Permission]) -> Role:
    role = db.execute(
        select(Role).where(Role.tenant_id == tenant.id, Role.code == "BOARD_MEMBER")
    ).scalar_one_or_none()
    if role is None:
        role = Role(code="BOARD_MEMBER", name="Board Member",
                    description="HOA board — review financials and approve spending.",
                    is_system=False, tenant_id=tenant.id, created_by=su.id, updated_by=su.id)
        db.add(role)
        db.flush()
        for code in BOARD_PERMS:
            if code in perms:
                db.add(RolePermission(role_id=role.id, permission_id=perms[code].id))
        db.flush()
    return role


def _staff(db, su, email, name, role, tenant, role_label):
    user = _ensure_user(db, email, DEMO_PW, name, is_superadmin=False)
    user.must_change_password = False
    if not db.execute(select(Membership).where(
        Membership.user_id == user.id, Membership.tenant_id == tenant.id,
        Membership.role_id == role.id)).scalar_one_or_none():
        db.add(Membership(tenant_id=tenant.id, user_id=user.id, role_id=role.id,
                          created_by=su.id, updated_by=su.id))
    SUMMARY.append({"type": "STAFF", "login": email, "password": DEMO_PW,
                    "role": role_label, "hoa": tenant.slug, "mfa": "TOTP (optional)"})


def _homeowner(db, su, tenant, acct, unit, first, last, email):
    h = db.execute(select(ArHomeowner).where(
        ArHomeowner.tenant_id == tenant.id, ArHomeowner.account_number == acct)).scalar_one_or_none()
    if h is None:
        h = ArHomeowner(tenant_id=tenant.id, account_number=acct, property_unit=unit,
                        first_name=first, last_name=last, email=email,
                        created_by=su.id, updated_by=su.id)
        db.add(h)
        db.flush()
    return h


def _resident(db, su, tenant, username, name, rtype, email, units, *, mfa_enabled=True,
              mfa_channel="EMAIL", phone=None):
    r = db.execute(select(Resident).where(
        Resident.tenant_id == tenant.id, Resident.username == username)).scalar_one_or_none()
    if r is None:
        r = Resident(tenant_id=tenant.id, username=username, password_hash=hash_password(RESIDENT_PW),
                     resident_type=rtype, full_name=name, email=email, phone=phone,
                     mfa_enabled=mfa_enabled, mfa_channel=mfa_channel, must_change_password=False,
                     created_by=su.id, updated_by=su.id)
        db.add(r)
        db.flush()
        for home, primary in units:
            db.add(ResidentUnit(tenant_id=tenant.id, resident_id=r.id, homeowner_id=home.id,
                                unit_number=home.property_unit or home.account_number,
                                is_primary=primary, created_by=su.id, updated_by=su.id))
    mfa = "none" if not mfa_enabled else ("SMS" if mfa_channel == "SMS" else "EMAIL")
    SUMMARY.append({"type": "RESIDENT", "login": f"{username} @ {tenant.slug}", "password": RESIDENT_PW,
                    "role": f"{rtype} ({len(units)} unit{'s' if len(units) != 1 else ''})",
                    "hoa": tenant.slug, "mfa": mfa})


def main() -> int:
    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        perms = _ensure_permissions(db)
        roles = _ensure_system_roles(db, perms)
        su = db.execute(select(User).where(User.is_superadmin.is_(True))).scalars().first()
        SUMMARY.append({"type": "PLATFORM", "login": "superadmin@casaharmony.ai",
                        "password": "ChangeMe!Superadmin1", "role": "SUPERADMIN",
                        "hoa": "(all HOAs)", "mfa": "TOTP (optional)"})

        maple = _tenant(db, su, "maple-grove", "Maple Grove HOA", "Austin", "TX", 240)
        oak = _tenant(db, su, "oak-ridge", "Oak Ridge HOA", "Denver", "CO", 120)
        pine = _tenant(db, su, "pine-valley", "Pine Valley HOA", "Portland", "OR", 80)

        # Multi-HOA SYSADMIN (one login manages all three).
        for t in (maple, oak, pine):
            _staff(db, su, "sa.demo@casademo.ai", "Demo SysAdmin (multi-HOA)", roles["SYSADMIN"], t,
                   "SYSADMIN (multi-HOA)")

        # Maple Grove — full staff + board.
        _staff(db, su, "admin.mg@casademo.ai", "Maple Admin", roles["HOA_ADMIN"], maple, "HOA_ADMIN")
        _staff(db, su, "acct.mg@casademo.ai", "Maple Accountant", roles["ACCOUNTANT"], maple, "ACCOUNTANT")
        _staff(db, su, "board.mg@casademo.ai", "Maple Board Member",
               _board_role(db, su, maple, perms), maple, "BOARD_MEMBER")
        _staff(db, su, "viewer.mg@casademo.ai", "Maple Viewer", roles["VIEWER"], maple, "VIEWER")

        # Oak Ridge — admin + board.
        _staff(db, su, "admin.oak@casademo.ai", "Oak Admin", roles["HOA_ADMIN"], oak, "HOA_ADMIN")
        _staff(db, su, "board.oak@casademo.ai", "Oak Board Member",
               _board_role(db, su, oak, perms), oak, "BOARD_MEMBER")

        # Pine Valley — admin.
        _staff(db, su, "admin.pine@casademo.ai", "Pine Admin", roles["HOA_ADMIN"], pine, "HOA_ADMIN")

        # Dual-role user: ACCOUNTANT in Oak Ridge AND VIEWER in Pine Valley.
        _staff(db, su, "dual@casademo.ai", "Dual Role User", roles["ACCOUNTANT"], oak,
               "ACCOUNTANT (+ VIEWER in pine-valley)")
        dual = db.execute(select(User).where(User.email == "dual@casademo.ai")).scalar_one()
        if not db.execute(select(Membership).where(
            Membership.user_id == dual.id, Membership.tenant_id == pine.id,
            Membership.role_id == roles["VIEWER"].id)).scalar_one_or_none():
            db.add(Membership(tenant_id=pine.id, user_id=dual.id, role_id=roles["VIEWER"].id,
                              created_by=su.id, updated_by=su.id))

        # Maple Grove residents (units + logins).
        u101 = _homeowner(db, su, maple, "MG-101", "101", "John", "Doe", "jdoe@maple.example")
        u102 = _homeowner(db, su, maple, "MG-102", "102", "Anita", "Smith", "asmith@maple.example")
        u103 = _homeowner(db, su, maple, "MG-103", "103", "Anita", "Smith", "asmith@maple.example")
        u104 = _homeowner(db, su, maple, "MG-104", "104", "Maria", "Gomez", "mgomez@maple.example")

        _resident(db, su, maple, "jdoe", "John Doe (owner)", "OWNER", "jdoe@maple.example",
                  [(u101, True)])
        _resident(db, su, maple, "asmith", "Anita Smith (multi-unit owner)", "OWNER",
                  "asmith@maple.example", [(u102, True), (u103, False)])
        _resident(db, su, maple, "rlee", "Robert Lee (renter)", "RENTER", "rlee@maple.example",
                  [(u101, True)], mfa_enabled=False)  # shares unit 101 with jdoe; MFA off
        _resident(db, su, maple, "mgomez", "Maria Gomez (owner, SMS MFA)", "OWNER",
                  "mgomez@maple.example", [(u104, True)], mfa_channel="SMS", phone="+15125550104")

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    # Print a review table.
    w = {"type": 9, "login": 34, "password": 16, "role": 36, "hoa": 13, "mfa": 16}
    hdr = "  ".join(h.upper().ljust(w[h]) for h in ("type", "login", "password", "role", "hoa", "mfa"))
    print("\n=== Casa Harmony — Demo Logins ===\n")
    print(hdr)
    print("-" * len(hdr))
    for row in SUMMARY:
        print("  ".join(str(row[h]).ljust(w[h]) for h in ("type", "login", "password", "role", "hoa", "mfa")))
    print(f"\nTotal: {len(SUMMARY)} logins across 3 demo HOAs (maple-grove, oak-ridge, pine-valley).")
    print("Residents sign in at /portal/login (HOA slug + username); staff at /login (email).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
