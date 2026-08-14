"""Idempotent seed: permissions, system roles, SUPERADMIN, and a demo HOA.

Run after migrations:  python -m scripts.seed
Safe to run multiple times — existing rows are reused, not duplicated.

Executes under an elevated (superadmin) RLS context so it may insert across
tenants, exactly as the platform SUPERADMIN would at runtime.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.config import settings
from app.core.database import session_for
from app.core.permissions import PERMISSIONS, SYSTEM_ROLES
from app.core.security import hash_password
from app.models.identity import (
    Membership,
    Permission,
    Role,
    RolePermission,
    Tenant,
    User,
)
from app.models.banking import ApBank, ApBankAccount
from app.models.masters import ApSupplier
from app.models.resident import Resident, ResidentUnit
from app.models.subledger import ArHomeowner
from app.models.workflow import ApprovalHierarchy, ApprovalRule
from app.core.security import hash_password
from app.services.provisioning import provision_tenant


def _ensure_permissions(db) -> dict[str, Permission]:
    existing = {p.code: p for p in db.execute(select(Permission)).scalars()}
    for code, (category, desc) in PERMISSIONS.items():
        if code not in existing:
            p = Permission(code=code, category=category, description=desc)
            db.add(p)
            existing[code] = p
    db.flush()
    return existing


def _ensure_system_roles(db, perms: dict[str, Permission]) -> dict[str, Role]:
    roles: dict[str, Role] = {}
    for code, (name, desc, perm_codes) in SYSTEM_ROLES.items():
        role = db.execute(
            select(Role).where(Role.code == code, Role.tenant_id.is_(None))
        ).scalar_one_or_none()
        if role is None:
            role = Role(code=code, name=name, description=desc, is_system=True, tenant_id=None)
            db.add(role)
            db.flush()
        granted = {rp.permission_id for rp in db.execute(
            select(RolePermission).where(RolePermission.role_id == role.id)
        ).scalars()}
        wanted = list(perms.values()) if perm_codes == "*" else [
            perms[c] for c in perm_codes if c in perms
        ]
        for p in wanted:
            if p.id not in granted:
                db.add(RolePermission(role_id=role.id, permission_id=p.id))
        roles[code] = role
    db.flush()
    return roles


def _ensure_user(db, email: str, password: str, full_name: str, is_superadmin: bool) -> User:
    user = db.execute(select(User).where(User.email == email.lower())).scalar_one_or_none()
    if user is None:
        user = User(
            email=email.lower(),
            full_name=full_name,
            hashed_password=hash_password(password),
            is_superadmin=is_superadmin,
            must_change_password=True,  # factory-created accounts change on first login
        )
        db.add(user)
        db.flush()
    return user


def main() -> int:
    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        perms = _ensure_permissions(db)
        roles = _ensure_system_roles(db, perms)

        if not settings.SUPERADMIN_PASSWORD:
            print(
                "Fatal: SUPERADMIN_PASSWORD is not set — refusing to seed a known default password.",
                file=sys.stderr,
            )
            return 2
        superadmin = _ensure_user(
            db, settings.SUPERADMIN_EMAIL, settings.SUPERADMIN_PASSWORD,
            "Platform Super Administrator", is_superadmin=True,
        )

        tenant = None
        # The demo HOA (and its masters/residents) is a sales asset, not
        # production data — never seed it into production.
        if settings.ENVIRONMENT == "production":
            print("ℹ️  Production environment: skipping demo HOA + sample data.")
        else:
            # --- Demo HOA tenant + default COA + setup ---
            tenant = provision_tenant(
                db=db,
                slug="casa-harmony",
                name="Casa Harmony Master Association",
                legal_name="Casa Harmony Master Association, Inc.",
                num_units=1000,
                city="Naples",
                state="FL",
                postal_code="34102",
                admin_email="sysadmin@casaharmony.ai",
                admin_password="ChangeMe!Sysadmin1",
                admin_name="Demo System Administrator",
                is_demo=True,
                create_default_coa=True,
                actor_id=superadmin.id,
            )

            # --- Demo masters: vendor + bank + bank account (idempotent) ---
            # Bank and operating account
            bank = db.execute(
                select(ApBank).where(
                    ApBank.tenant_id == tenant.id, ApBank.routing_number == "021000021"
                )
            ).scalar_one_or_none()
            if bank is None:
                bank = ApBank(
                    tenant_id=tenant.id, bank_name="JPMorgan Chase Bank", routing_number="021000021",
                    city="New York", state="NY",
                    created_by=superadmin.id, updated_by=superadmin.id,
                )
                db.add(bank)
                db.flush()
                db.add(ApBankAccount(
                    tenant_id=tenant.id, bank_id=bank.id, account_name="Operating Account",
                    account_number="1234567890", account_type="CHECKING",
                    created_by=superadmin.id, updated_by=superadmin.id,
                ))

            # Vendor
            vendor = db.execute(
                select(ApSupplier).where(
                    ApSupplier.tenant_id == tenant.id, ApSupplier.vendor_number == "V-0001"
                )
            ).scalar_one_or_none()
            if vendor is None:
                vendor = ApSupplier(
                    tenant_id=tenant.id, vendor_number="V-0001", name="GreenScape Landscaping LLC",
                    payment_terms="NET30", email="ar@greenscape.example",
                    created_by=superadmin.id, updated_by=superadmin.id,
                )
                db.add(vendor)

            # --- A few demo homeowners (idempotent) ---
            for i in range(1, 4):
                acct = f"H-{i:04d}"
                exists = db.execute(
                    select(ArHomeowner).where(
                        ArHomeowner.tenant_id == tenant.id, ArHomeowner.account_number == acct
                    )
                ).scalar_one_or_none()
                if exists is None:
                    db.add(ArHomeowner(
                        tenant_id=tenant.id, account_number=acct, first_name="Demo",
                        last_name=f"Homeowner {i}", email=f"owner{i}@casa.example",
                        property_unit=f"{i:02d}A", created_by=superadmin.id, updated_by=superadmin.id,
                    ))

            # --- Demo resident portal login linked to a unit (idempotent) ---
            db.flush()
            first_home = db.execute(
                select(ArHomeowner).where(ArHomeowner.tenant_id == tenant.id)
                .order_by(ArHomeowner.account_number)
            ).scalars().first()
            if first_home is not None:
                resident = db.execute(
                    select(Resident).where(
                        Resident.tenant_id == tenant.id, Resident.username == "owner1"
                    )
                ).scalar_one_or_none()
                if resident is None:
                    resident = Resident(
                        tenant_id=tenant.id, username="owner1",
                        password_hash=hash_password("ChangeMe!Owner1"), resident_type="OWNER",
                        full_name="Demo Owner One", email="owner1@casa.example",
                        created_by=superadmin.id, updated_by=superadmin.id,
                    )
                    db.add(resident)
                    db.flush()
                    db.add(ResidentUnit(
                        tenant_id=tenant.id, resident_id=resident.id, homeowner_id=first_home.id,
                        unit_number=first_home.property_unit or first_home.account_number,
                        is_primary=True, created_by=superadmin.id, updated_by=superadmin.id,
                    ))

        db.commit()
        print("✅ Seed complete.")
        print(f"   SUPERADMIN : {settings.SUPERADMIN_EMAIL}")
        if tenant is not None:
            print("   SYSADMIN   : sysadmin@casaharmony.ai")
            print(f"   Demo HOA   : {tenant.name} (slug=casa-harmony, id={tenant.id})")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
