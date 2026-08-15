from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.identity import Membership, User
from app.models.kff import KffStructure, GlCodeCombination
from app.models.period import AccountingPeriod
from app.models.cash import CeBankAccount
from app.models.masters import PaymentTerm
from app.models.workflow import ApprovalHierarchy
from app.models.resident import Resident
from app.models.ar_billing import BillingPlan
from app.services.golive_exec import validate, get_status, RETAINED_EARNINGS_NATURAL

def get_tenant_readiness(db: Session, tenant_id: uuid.UUID) -> dict[str, Any]:
    from sqlalchemy import text
    db.execute(text("SELECT set_config('app.current_tenant', :tid, true)"), {"tid": str(tenant_id)})
    stages = []

    # 1. IDENTITY
    admin_count = db.execute(
        select(func.count(Membership.id))
        .join(User)
        .where(Membership.tenant_id == tenant_id, User.is_superadmin.is_(False))
    ).scalar_one()
    
    identity_ok = admin_count > 0
    missing = [] if identity_ok else ["No active non-superadmin memberships"]
    stages.append({
        "id": "IDENTITY",
        "label": "Identity & Access",
        "completed": identity_ok,
        "missing": missing,
        "next_action_label": "Add an administrator",
        "next_action_route": "/users",
    })

    # 2. LEDGER
    structures = db.execute(select(func.count(KffStructure.id)).where(KffStructure.tenant_id == tenant_id)).scalar_one()
    
    funds = [f for (f,) in db.execute(
        select(GlCodeCombination.fund_value).where(GlCodeCombination.tenant_id == tenant_id).distinct()
    ).all() if f]
    
    missing_funds = []
    for fund in funds:
        ok = db.execute(select(GlCodeCombination).where(
            GlCodeCombination.tenant_id == tenant_id,
            GlCodeCombination.natural_account_value == RETAINED_EARNINGS_NATURAL,
            GlCodeCombination.fund_value == fund,
            GlCodeCombination.allow_posting.is_(True)
        )).first()
        if not ok:
            missing_funds.append(fund)

    ledger_missing = []
    if structures == 0:
        ledger_missing.append("Chart of Accounts structure is not configured")
    if missing_funds:
        ledger_missing.append(f"Missing Retained Earnings account for funds: {', '.join(missing_funds)}")

    ledger_ok = len(ledger_missing) == 0
    stages.append({
        "id": "LEDGER",
        "label": "General Ledger",
        "completed": ledger_ok,
        "missing": ledger_missing,
        "next_action_label": "Configure Chart of Accounts",
        "next_action_route": "/coa",
    })

    # 3. CALENDAR
    open_periods = db.execute(select(func.count(AccountingPeriod.id)).where(
        AccountingPeriod.tenant_id == tenant_id, AccountingPeriod.status == "OPEN"
    )).scalar_one()
    
    calendar_ok = open_periods > 0
    stages.append({
        "id": "CALENDAR",
        "label": "Fiscal Calendar",
        "completed": calendar_ok,
        "missing": [] if calendar_ok else ["No OPEN accounting period for the current year"],
        "next_action_label": "Open fiscal period",
        "next_action_route": "/periods",
    })

    # 4. MASTERS
    banks = db.execute(select(func.count(CeBankAccount.id)).where(CeBankAccount.tenant_id == tenant_id)).scalar_one()
    terms = db.execute(select(func.count(PaymentTerm.id)).where(PaymentTerm.tenant_id == tenant_id)).scalar_one()
    hierarchies = db.execute(select(func.count(ApprovalHierarchy.id)).where(ApprovalHierarchy.tenant_id == tenant_id)).scalar_one()

    masters_missing = []
    if banks == 0:
        masters_missing.append("No bank accounts configured")
    if terms == 0:
        masters_missing.append("No payment terms configured")
    if hierarchies == 0:
        masters_missing.append("No approval hierarchy configured")

    masters_ok = len(masters_missing) == 0
    stages.append({
        "id": "MASTERS",
        "label": "Master Data",
        "completed": masters_ok,
        "missing": masters_missing,
        "next_action_label": "Configure master data",
        "next_action_route": "/vendors",
    })

    # 5. SUBLEDGER
    residents = db.execute(select(func.count(Resident.id)).where(Resident.tenant_id == tenant_id)).scalar_one()
    plans = db.execute(select(func.count(BillingPlan.id)).where(
        BillingPlan.tenant_id == tenant_id, BillingPlan.active.is_(True)
    )).scalar_one()

    subledger_missing = []
    if residents == 0:
        subledger_missing.append("No residents exist")
    if plans == 0:
        subledger_missing.append("No active billing plans exist")

    subledger_ok = len(subledger_missing) == 0
    stages.append({
        "id": "SUBLEDGER",
        "label": "Subledger Setup",
        "completed": subledger_ok,
        "missing": subledger_missing,
        "next_action_label": "Import homeowners",
        "next_action_route": "/residents",
    })

    # 6. LIVE
    val = validate(db, tenant_id)
    status = get_status(db, tenant_id)
    live_ok = val["passed"] and status.is_live
    
    live_missing = []
    if not val["passed"]:
        live_missing.extend([c["check"] for c in val["checks"] if not c["ok"]])
    if not status.is_live:
        live_missing.append("Tenant is not activated")

    stages.append({
        "id": "LIVE",
        "label": "Production Live",
        "completed": live_ok,
        "missing": live_missing,
        "next_action_label": "Complete go-live checklist",
        "next_action_route": "/go-live",
    })

    # Determine current stage
    current_stage = "LIVE"
    for stage in stages:
        if not stage["completed"]:
            current_stage = stage["id"]
            break

    return {
        "tenant_id": tenant_id,
        "current_stage": current_stage,
        "stages": stages,
    }
