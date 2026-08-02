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
from app.services.coa_bootstrap import provision_default_coa
from app.services.kff import create_combination


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
        )
        db.add(user)
        db.flush()
    return user


def main() -> int:
    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        perms = _ensure_permissions(db)
        roles = _ensure_system_roles(db, perms)

        superadmin = _ensure_user(
            db, settings.SUPERADMIN_EMAIL, settings.SUPERADMIN_PASSWORD,
            "Platform Super Administrator", is_superadmin=True,
        )

        # --- Demo HOA tenant + default COA ---
        tenant = db.execute(select(Tenant).where(Tenant.slug == "casa-harmony")).scalar_one_or_none()
        created_tenant = tenant is None
        if tenant is None:
            tenant = Tenant(
                name="Casa Harmony Master Association",
                slug="casa-harmony",
                legal_name="Casa Harmony Master Association, Inc.",
                num_units=1000,
                city="Naples",
                state="FL",
                postal_code="34102",
                created_by=superadmin.id,
                updated_by=superadmin.id,
            )
            db.add(tenant)
            db.flush()
            structure = provision_default_coa(db, tenant.id, superadmin.id)
        else:
            from app.models.kff import KffStructure

            structure = db.execute(
                select(KffStructure).where(KffStructure.tenant_id == tenant.id)
            ).scalar_one_or_none()

        # --- Demo SYSADMIN user with membership in the demo HOA ---
        sysadmin = _ensure_user(
            db, "sysadmin@casaharmony.ai", "ChangeMe!Sysadmin1",
            "Demo System Administrator", is_superadmin=False,
        )
        sysadmin_role = roles["SYSADMIN"]
        has_membership = db.execute(
            select(Membership).where(
                Membership.user_id == sysadmin.id,
                Membership.tenant_id == tenant.id,
                Membership.role_id == sysadmin_role.id,
            )
        ).scalar_one_or_none()
        if has_membership is None:
            db.add(Membership(
                tenant_id=tenant.id, user_id=sysadmin.id, role_id=sysadmin_role.id,
                created_by=superadmin.id, updated_by=superadmin.id,
            ))

        # --- Standard chart of accounts code combinations (idempotent) ---
        if structure is not None:
            standard = [
                {1: "0100", 2: "OPER", 3: "000", 4: "1000", 5: "0000", 6: "NONE"},  # Operating cash
                {1: "0100", 2: "RESV", 3: "000", 4: "1010", 5: "0000", 6: "NONE"},  # Reserve cash
                {1: "0100", 2: "OPER", 3: "000", 4: "1100", 5: "0000", 6: "NONE"},  # Assessments receivable
                {1: "0100", 2: "OPER", 3: "000", 4: "2000", 5: "0000", 6: "NONE"},  # AP - operating
                {1: "0100", 2: "RESV", 3: "000", 4: "2000", 5: "0000", 6: "NONE"},  # AP - reserve
                {1: "0100", 2: "OPER", 3: "000", 4: "4000", 5: "0000", 6: "NONE"},  # Assessment income
                {1: "0100", 2: "OPER", 3: "100", 4: "5000", 5: "0000", 6: "NONE"},  # Landscaping expense
                {1: "0100", 2: "OPER", 3: "200", 4: "5100", 5: "0000", 6: "NONE"},  # Utilities expense
                {1: "0100", 2: "RESV", 3: "000", 4: "6000", 5: "0000", 6: "NONE"},  # Reserve funding
            ]
            for seg in standard:
                try:
                    create_combination(db, structure, tenant.id, seg, created_by=superadmin.id)
                except Exception:
                    pass  # already exists

        # --- Demo masters: vendor + bank + bank account (idempotent) ---
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

        # --- Approval hierarchy for AP invoices (single level → SYSADMIN) ---
        ap_hier = db.execute(
            select(ApprovalHierarchy).where(
                ApprovalHierarchy.tenant_id == tenant.id,
                ApprovalHierarchy.document_type == "AP_INVOICE",
            )
        ).scalar_one_or_none()
        if ap_hier is None:
            ap_hier = ApprovalHierarchy(
                tenant_id=tenant.id, name="AP Invoice Approvals", document_type="AP_INVOICE",
                created_by=superadmin.id, updated_by=superadmin.id,
            )
            db.add(ap_hier)
            db.flush()
            db.add(ApprovalRule(
                tenant_id=tenant.id, hierarchy_id=ap_hier.id, level_num=1,
                min_amount=0, max_amount=None, approver_role_id=sysadmin_role.id,
                created_by=superadmin.id, updated_by=superadmin.id,
            ))

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
        print(f"   SUPERADMIN : {settings.SUPERADMIN_EMAIL} / {settings.SUPERADMIN_PASSWORD}")
        print("   SYSADMIN   : sysadmin@casaharmony.ai / ChangeMe!Sysadmin1")
        print(f"   Demo HOA   : {tenant.name} (slug=casa-harmony, id={tenant.id})")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
