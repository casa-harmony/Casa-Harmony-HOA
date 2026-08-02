"""AR billing service: billing plans (monthly fees / special assessments) and
automated late fees. Each generated AR invoice posts a balanced GL journal
(Dr Assessments Receivable per Fund / Cr each plan line's revenue account).
"""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ar_billing import BillingPlan, BillingPlanLine, LateFeeRule
from app.models.subledger import ArHomeowner, ArInvoice
from app.services import subledger_accounting as sla
from app.services.gl_posting import post_journal

CENT = Decimal("0.01")
AR_RECEIVABLE = "1100"


class BillingError(ValueError):
    pass


def _next_number(db: Session, tenant_id, prefix="AR") -> str:
    n = db.execute(select(func.count(ArInvoice.id)).where(ArInvoice.tenant_id == tenant_id)).scalar_one()
    return f"{prefix}-{n + 1:06d}"


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, min(d.day, 28))


def create_plan(db, *, tenant_id, name, plan_type="MONTHLY_FEE", lines=None, created_by=None) -> BillingPlan:
    if db.execute(select(BillingPlan).where(BillingPlan.tenant_id == tenant_id,
                  BillingPlan.name == name)).scalar_one_or_none():
        raise BillingError("Billing plan name already exists")
    plan = BillingPlan(tenant_id=tenant_id, name=name, plan_type=plan_type,
                       created_by=created_by, updated_by=created_by)
    db.add(plan)
    db.flush()
    for ln in (lines or []):
        add_line(db, tenant_id=tenant_id, plan_id=plan.id, created_by=created_by, **ln)
    return plan


def add_line(db, *, tenant_id, plan_id, income_combination_id, amount, department=None, created_by=None):
    cc = sla.get_primary_structure(db, tenant_id)  # ensure structure exists
    from app.services.distributions import resolve_combination
    comb = resolve_combination(db, tenant_id, income_combination_id)
    line = BillingPlanLine(tenant_id=tenant_id, plan_id=plan_id, department=department,
                           income_combination_id=comb.id, fund_value=comb.fund_value,
                           amount=Decimal(str(amount)).quantize(CENT),
                           created_by=created_by, updated_by=created_by)
    db.add(line)
    db.flush()
    return line


def _post_invoice_journal(db, tenant_id, invoice, allocations, structure_id, created_by):
    """allocations: list of (income_cc_id, fund, amount). Dr AR/fund, Cr income lines."""
    from collections import defaultdict
    ar_by_fund: dict = defaultdict(Decimal)
    lines = []
    for income_cc_id, fund, amt in allocations:
        if amt <= 0:
            continue
        lines.append({"code_combination_id": income_cc_id, "credit": amt, "debit": 0,
                      "description": "Assessment revenue"})
        ar_by_fund[fund] += amt
    structure = sla.get_primary_structure(db, tenant_id)
    for fund, amt in ar_by_fund.items():
        recv = sla._account(db, tenant_id, structure.id, AR_RECEIVABLE, fund)
        lines.append({"code_combination_id": recv.id, "debit": amt, "credit": 0,
                      "description": "Assessments Receivable"})
    journal = post_journal(db, tenant_id=tenant_id, structure_id=structure.id,
                           accounting_date=invoice.invoice_date, lines=lines,
                           description=f"Assessment {invoice.invoice_number}", source="AR",
                           created_by=created_by)
    invoice.gl_journal_id = journal.id
    invoice.status = "POSTED"
    db.flush()


def run_billing(db, *, tenant_id, plan_id, invoice_date: date, due_days=30,
                homeowner_ids=None, installments=1, created_by=None) -> dict:
    plan = db.get(BillingPlan, plan_id)
    if plan is None or plan.tenant_id != tenant_id:
        raise BillingError("Billing plan not found")
    plan_lines = db.execute(select(BillingPlanLine).where(
        BillingPlanLine.plan_id == plan_id)).scalars().all()
    if not plan_lines:
        raise BillingError("Plan has no lines")
    structure = sla.get_primary_structure(db, tenant_id)

    if homeowner_ids:
        homeowners = [h for h in (db.get(ArHomeowner, hid) for hid in homeowner_ids)
                      if h and h.tenant_id == tenant_id]
    else:
        homeowners = db.execute(select(ArHomeowner).where(
            ArHomeowner.tenant_id == tenant_id, ArHomeowner.status == "active")).scalars().all()
    installments = max(1, int(installments))

    created = 0
    total_billed = Decimal("0")
    for h in homeowners:
        for inst in range(installments):
            inv_date = _add_months(invoice_date, inst)
            allocations = []
            inv_total = Decimal("0")
            for pl in plan_lines:
                base = Decimal(pl.amount)
                if installments > 1:
                    each = (base / installments).quantize(CENT)
                    amt = (base - each * (installments - 1)) if inst == installments - 1 else each
                else:
                    amt = base
                allocations.append((pl.income_combination_id, pl.fund_value, amt))
                inv_total += amt
            suffix = f" ({inst + 1}/{installments})" if installments > 1 else ""
            inv = ArInvoice(
                tenant_id=tenant_id, homeowner_id=h.id, invoice_number=_next_number(db, tenant_id),
                description=f"{plan.name}{suffix}", invoice_type=plan.plan_type, amount=inv_total,
                invoice_date=inv_date, due_date=inv_date + timedelta(days=due_days),
                fund=plan_lines[0].fund_value, status="DRAFT",
                created_by=created_by, updated_by=created_by)
            db.add(inv)
            db.flush()
            _post_invoice_journal(db, tenant_id, inv, allocations, structure.id, created_by)
            created += 1
            total_billed += inv_total
    return {"invoices_created": created, "total_billed": total_billed}


# --- Late fees -------------------------------------------------------------
def get_late_fee_rule(db, tenant_id) -> LateFeeRule:
    r = db.execute(select(LateFeeRule).where(LateFeeRule.tenant_id == tenant_id)).scalar_one_or_none()
    if r is None:
        from app.core.model_defaults import make_default
        r = make_default(LateFeeRule, tenant_id=tenant_id)
    return r


def apply_late_fees(db, *, tenant_id, as_of: date, created_by=None) -> dict:
    rule = get_late_fee_rule(db, tenant_id)
    if not rule.active:
        raise BillingError("Late-fee rule is not active")
    if not rule.income_combination_id:
        raise BillingError("Late-fee income account not configured")
    cutoff = as_of - timedelta(days=rule.grace_days)
    overdue = db.execute(select(ArInvoice).where(
        ArInvoice.tenant_id == tenant_id,
        ArInvoice.status.in_(("POSTED", "ACCOUNTED")),
        ArInvoice.invoice_type != "LATE_FEE",
        ArInvoice.late_fee_applied.is_(False),
        ArInvoice.due_date < cutoff)).scalars().all()
    structure = sla.get_primary_structure(db, tenant_id)
    count = 0
    total = Decimal("0")
    for inv in overdue:
        balance = Decimal(inv.amount) - Decimal(inv.amount_paid)
        if balance <= 0:
            inv.late_fee_applied = True
            continue
        if rule.fee_type == "PERCENT":
            fee = (balance * Decimal(rule.percent) / Decimal("100")).quantize(CENT)
        else:
            fee = Decimal(rule.flat_amount).quantize(CENT)
        if fee <= 0:
            continue
        fee_inv = ArInvoice(
            tenant_id=tenant_id, homeowner_id=inv.homeowner_id,
            invoice_number=_next_number(db, tenant_id), invoice_type="LATE_FEE", amount=fee,
            description=f"Late fee on {inv.invoice_number}", invoice_date=as_of,
            due_date=as_of + timedelta(days=rule.grace_days), fund=rule.fund_value, status="DRAFT",
            created_by=created_by, updated_by=created_by)
        db.add(fee_inv)
        db.flush()
        _post_invoice_journal(db, tenant_id, fee_inv,
                              [(rule.income_combination_id, rule.fund_value, fee)],
                              structure.id, created_by)
        inv.late_fee_applied = True
        count += 1
        total += fee
    db.flush()
    return {"late_fees_charged": count, "total": total}
