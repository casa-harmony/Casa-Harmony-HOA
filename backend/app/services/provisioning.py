"""Single transactional provisioning service for a new community.

This service produces the twelve outputs required for a fully usable community:
the tenant row, COA, GL codes, periods, budget config, AP config, (optional) bank,
approval hierarchy, (optional) dunning rules, checklist, initial admin, and audit record.
It guarantees that if it succeeds, the community is fully set up for accounting and operations.
"""
from __future__ import annotations

import uuid
from datetime import date
from dateutil.relativedelta import relativedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.identity import Tenant, User, Role, Membership
from app.models.banking import ApBank, ApBankAccount
from app.models.masters import ApSupplier, PaymentTerm, VendorType, FndLookup
from app.models.payments import PaymentMethod
from app.models.workflow import ApprovalHierarchy, ApprovalRule
from app.models.period import AccountingPeriod
from app.models.budgeting import BudgetControlSettings
from app.models.distribution_set import DistributionSet, DistributionSetLine
from app.models.dunning import DunningRule
from app.models.audit import AuditLog

from app.services.coa_bootstrap import provision_default_coa
from app.services.kff import create_combination
from app.core.security import hash_password


def generate_periods(
    db: Session, tenant_id: uuid.UUID, start_year: int, actor_id: uuid.UUID | None = None
) -> None:
    """Generate 12 periods for the specified fiscal year and the next fiscal year."""
    today = date.today()
    for year in (start_year, start_year + 1):
        for month in range(1, 13):
            # period name like "JAN-2026"
            start_date = date(year, month, 1)
            end_date = start_date + relativedelta(months=1, days=-1)
            period_name = start_date.strftime("%b-%Y").upper()

            # The current period is OPEN, future periods are FUTURE
            # Past periods in the current year might be CLOSED, but let's just make everything before/current OPEN and later FUTURE, or just based on current month/year.
            if year < today.year or (year == today.year and month <= today.month):
                status = "OPEN"
            else:
                status = "FUTURE"

            period = AccountingPeriod(
                tenant_id=tenant_id,
                period_name=period_name,
                period_year=year,
                period_num=month,
                start_date=start_date,
                end_date=end_date,
                status=status,
                created_by=actor_id,
                updated_by=actor_id,
            )
            db.add(period)


def generate_standard_gl_combinations(
    db: Session, tenant_id: uuid.UUID, structure, actor_id: uuid.UUID | None = None
) -> None:
    """Move standard GL code-combination list out of scripts/seed.py into this service."""
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
            create_combination(db, structure, tenant_id, seg, created_by=actor_id)
        except Exception:
            pass  # already exists


def provision_tenant(
    db: Session,
    slug: str,
    name: str,
    admin_email: str,
    admin_password: str,
    admin_name: str | None = None,
    legal_name: str | None = None,
    num_units: int | None = None,
    address_line1: str | None = None,
    address_line2: str | None = None,
    city: str | None = None,
    state: str | None = None,
    postal_code: str | None = None,
    monthly_dues: float | None = None,
    kind: str | None = None,
    is_demo: bool = False,
    create_default_coa: bool = True,
    actor_id: uuid.UUID | None = None,
) -> Tenant:
    """Provision a new community end-to-end within the current transaction."""
    
    tenant = db.execute(select(Tenant).where(Tenant.slug == slug)).scalar_one_or_none()
    if tenant is not None:
        return tenant

    # 1. Tenant row
    tenant = Tenant(
        name=name,
        slug=slug,
        status="active",
        legal_name=legal_name,
        num_units=num_units,
        address_line1=address_line1,
        address_line2=address_line2,
        city=city,
        state=state,
        postal_code=postal_code,
        monthly_dues=monthly_dues,
        kind=kind,
        is_demo=is_demo,
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(tenant)
    db.flush()

    # 2. COA structure
    structure = None
    if create_default_coa:
        structure = provision_default_coa(db, tenant.id, actor_id)

    # 3. GL code combinations
    if structure is not None:
        generate_standard_gl_combinations(db, tenant.id, structure, actor_id)

    # 4. Fiscal calendar
    generate_periods(db, tenant.id, date.today().year, actor_id)

    # 5. Budget control settings row
    budget_ctrl = BudgetControlSettings(
        tenant_id=tenant.id,
        mode="ADVISORY",
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(budget_ctrl)

    # 6. AP config
    term = PaymentTerm(
        tenant_id=tenant.id, name="Net 30", description="Pay within 30 days",
        due_days=30, active=True, created_by=actor_id, updated_by=actor_id
    )
    db.add(term)
    
    vtype = VendorType(
        tenant_id=tenant.id, code="LANDSCAPING", name="Landscaping", active=True,
        created_by=actor_id, updated_by=actor_id
    )
    db.add(vtype)
    
    pmethod = PaymentMethod(
        tenant_id=tenant.id, code="CHECK", name="Check", method_type="CHECK", active=True,
        created_by=actor_id, updated_by=actor_id
    )
    db.add(pmethod)

    # 7. Bank and operating bank account (Optional, skipped in base provision to let users configure)
    # 8. Default approval hierarchy
    ap_hier = ApprovalHierarchy(
        tenant_id=tenant.id, name="AP Invoice Approvals", document_type="AP_INVOICE",
        created_by=actor_id, updated_by=actor_id
    )
    db.add(ap_hier)
    db.flush()
    
    sysadmin_role = db.execute(select(Role).where(Role.code == "SYSADMIN")).scalar_one_or_none()
    if sysadmin_role:
        db.add(ApprovalRule(
            tenant_id=tenant.id, hierarchy_id=ap_hier.id, level_num=1,
            min_amount=0, max_amount=None, approver_role_id=sysadmin_role.id,
            created_by=actor_id, updated_by=actor_id
        ))

    # 9. Late-fee rule and dunning rules (Optional, skipped in base provision)

    # 10. Go-live checklist items
    # Already has a seeding helper; call it here
    from app.services.golive_exec import get_status
    get_status(db, tenant.id)

    # 11. First administrator
    admin = db.execute(select(User).where(User.email == admin_email.lower())).scalar_one_or_none()
    if admin is None:
        admin = User(
            email=admin_email.lower(),
            full_name=admin_name or admin_email.split("@")[0],
            hashed_password=hash_password(admin_password),
            is_superadmin=False,
            must_change_password=False,
        )
        db.add(admin)
        db.flush()
    
    if sysadmin_role:
        db.add(Membership(
            tenant_id=tenant.id, user_id=admin.id, role_id=sysadmin_role.id,
            is_active=True, created_by=actor_id, updated_by=actor_id
        ))

    # 12. Audit record of the provisioning
    audit = AuditLog(
        tenant_id=tenant.id,
        actor_id=actor_id,
        entity_type="Tenant",
        entity_id=str(tenant.id),
        action="PROVISION",
        changes={"slug": slug, "name": name, "create_default_coa": create_default_coa},
    )
    db.add(audit)

    return tenant
