"""Collections & delinquency services: AR aging, escalation cases, payment plans,
liens, and uncollectible write-offs (draft GL batch). Aging derives from open AR
invoice balances; the workflow tables track notices, arrangements, and liens.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.collections import (
    STAGES,
    DelinquencyCase,
    Lien,
    PaymentPlan,
    PaymentPlanInstallment,
)
from app.models.gl import GlJeLine
from app.models.subledger import ArHomeowner, ArInvoice, ArReceipt
from app.services import subledger_accounting as sla

CENT = Decimal("0.01")
AR_RECEIVABLE = "1100"
BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"]
_OPEN = ("DRAFT", "ACCOUNTED", "POSTED")


class CollectionsError(ValueError):
    pass


def _bucket(due: date | None, as_of: date) -> str:
    if due is None or due >= as_of:
        return "Current"
    d = (as_of - due).days
    return "1-30" if d <= 30 else "31-60" if d <= 60 else "61-90" if d <= 90 else "90+"


def aging(db: Session, tenant_id, as_of: date) -> list[dict]:
    """Per-homeowner aging of open AR balances into buckets."""
    rows = db.execute(
        select(ArInvoice, ArHomeowner)
        .join(ArHomeowner, ArHomeowner.id == ArInvoice.homeowner_id)
        .where(ArInvoice.tenant_id == tenant_id, ArInvoice.status.in_(_OPEN))
    ).all()
    by_ho: dict = {}
    for inv, ho in rows:
        bal = Decimal(inv.amount) - Decimal(inv.amount_paid or 0)
        if bal <= 0:
            continue
        e = by_ho.setdefault(ho.id, {
            "homeowner_id": ho.id, "account_number": ho.account_number,
            "name": f"{ho.first_name} {ho.last_name}",
            "buckets": {b: Decimal("0") for b in BUCKETS}, "total": Decimal("0")})
        e["buckets"][_bucket(inv.due_date, as_of)] += bal
        e["total"] += bal
    return sorted(by_ho.values(), key=lambda x: x["total"], reverse=True)


def aging_by_fund(db: Session, tenant_id, as_of: date) -> dict:
    """Bucketed open balances grouped by Fund."""
    rows = db.execute(select(ArInvoice).where(
        ArInvoice.tenant_id == tenant_id, ArInvoice.status.in_(_OPEN))).scalars().all()
    out: dict = {}
    for inv in rows:
        bal = Decimal(inv.amount) - Decimal(inv.amount_paid or 0)
        if bal <= 0:
            continue
        fund = inv.fund or "OPER"
        e = out.setdefault(fund, {b: Decimal("0") for b in BUCKETS})
        e[_bucket(inv.due_date, as_of)] += bal
    return out


def homeowner_balance(db: Session, tenant_id, homeowner_id) -> Decimal:
    rows = db.execute(select(ArInvoice.amount, ArInvoice.amount_paid).where(
        ArInvoice.tenant_id == tenant_id, ArInvoice.homeowner_id == homeowner_id,
        ArInvoice.status.in_(_OPEN))).all()
    return sum((Decimal(a) - Decimal(p or 0) for a, p in rows), Decimal("0"))


# --- Delinquency cases / escalation ---------------------------------------
def open_case(db: Session, tenant_id, homeowner_id, as_of: date, notes=None, created_by=None) -> DelinquencyCase:
    case = db.execute(select(DelinquencyCase).where(
        DelinquencyCase.tenant_id == tenant_id,
        DelinquencyCase.homeowner_id == homeowner_id)).scalar_one_or_none()
    if case is None:
        case = DelinquencyCase(
            tenant_id=tenant_id, homeowner_id=homeowner_id, stage="NOTICE", opened_date=as_of,
            balance_at_open=homeowner_balance(db, tenant_id, homeowner_id), last_notice_date=as_of,
            notice_count=1, notes=notes, created_by=created_by, updated_by=created_by)
        db.add(case)
    db.flush()
    return case


def send_notice(db: Session, case: DelinquencyCase, as_of: date) -> DelinquencyCase:
    case.last_notice_date = as_of
    case.notice_count += 1
    if case.stage in ("NONE", "RESOLVED"):
        case.stage = "NOTICE"
    db.flush()
    return case


def escalate(db: Session, case: DelinquencyCase, to_stage: str) -> DelinquencyCase:
    if to_stage not in STAGES:
        raise CollectionsError("Unknown stage")
    order = {s: i for i, s in enumerate(STAGES)}
    if to_stage == "RESOLVED":
        case.stage = "RESOLVED"
        case.closed_at = datetime.now(timezone.utc)
    else:
        if order[to_stage] < order[case.stage]:
            raise CollectionsError(f"Cannot move backward from {case.stage} to {to_stage}")
        case.stage = to_stage
    db.flush()
    return case


# --- Payment plans ---------------------------------------------------------
def _next_plan_number(db, tenant_id) -> str:
    n = db.execute(select(func.count(PaymentPlan.id)).where(PaymentPlan.tenant_id == tenant_id)).scalar_one()
    return f"PP-{n + 1:05d}"


def create_payment_plan(db: Session, *, tenant_id, homeowner_id, total_amount, installments,
                        start_date: date, frequency_days=30, notes=None, created_by=None) -> PaymentPlan:
    ho = db.get(ArHomeowner, homeowner_id)
    if ho is None or ho.tenant_id != tenant_id:
        raise CollectionsError("Homeowner not found")
    total = Decimal(str(total_amount)).quantize(CENT)
    n = int(installments)
    if total <= 0 or n <= 0:
        raise CollectionsError("Total and installments must be positive")
    plan = PaymentPlan(tenant_id=tenant_id, plan_number=_next_plan_number(db, tenant_id),
                       homeowner_id=homeowner_id, total_amount=total, installments=n,
                       frequency_days=frequency_days, start_date=start_date, status="ACTIVE",
                       notes=notes, created_by=created_by, updated_by=created_by)
    db.add(plan)
    db.flush()
    each = (total / n).quantize(CENT)
    running = Decimal("0")
    for i in range(1, n + 1):
        amt = (total - running) if i == n else each
        running += amt
        db.add(PaymentPlanInstallment(
            tenant_id=tenant_id, plan_id=plan.id, seq=i,
            due_date=start_date + timedelta(days=frequency_days * (i - 1)), amount=amt,
            created_by=created_by, updated_by=created_by))
    db.flush()
    return plan


def pay_installment(db: Session, inst: PaymentPlanInstallment, amount=None) -> PaymentPlanInstallment:
    amt = Decimal(str(amount)).quantize(CENT) if amount is not None else Decimal(inst.amount)
    inst.amount_paid = (Decimal(inst.amount_paid) + amt).quantize(CENT)
    if inst.amount_paid >= Decimal(inst.amount):
        inst.status = "PAID"
    db.flush()
    plan = db.get(PaymentPlan, inst.plan_id)
    if plan and all(s.status == "PAID" for s in plan.schedule):
        plan.status = "COMPLETED"
    db.flush()
    return inst


# --- Liens -----------------------------------------------------------------
def _next_lien_number(db, tenant_id) -> str:
    n = db.execute(select(func.count(Lien.id)).where(Lien.tenant_id == tenant_id)).scalar_one()
    return f"LN-{n + 1:05d}"


def create_lien(db: Session, *, tenant_id, homeowner_id, amount, reference=None, notes=None, created_by=None) -> Lien:
    ho = db.get(ArHomeowner, homeowner_id)
    if ho is None or ho.tenant_id != tenant_id:
        raise CollectionsError("Homeowner not found")
    lien = Lien(tenant_id=tenant_id, lien_number=_next_lien_number(db, tenant_id),
                homeowner_id=homeowner_id, amount=Decimal(str(amount)).quantize(CENT),
                status="DRAFT", reference=reference, notes=notes,
                created_by=created_by, updated_by=created_by)
    db.add(lien)
    db.flush()
    return lien


def set_lien_status(db: Session, lien: Lien, status: str, on_date: date) -> Lien:
    if status == "FILED":
        lien.status = "FILED"
        lien.filed_date = on_date
    elif status == "RELEASED":
        lien.status = "RELEASED"
        lien.released_date = on_date
    else:
        raise CollectionsError("Invalid lien status")
    db.flush()
    return lien


# --- Write-off (draft GL batch) -------------------------------------------
def write_off_invoice(db: Session, *, tenant_id, invoice_id, expense_combination_id, gl_date: date,
                      created_by=None):
    """Write off an uncollectible AR invoice: draft GL Dr bad-debt / Cr AR (per fund)."""
    from app.services.distributions import resolve_combination

    inv = db.get(ArInvoice, invoice_id)
    if inv is None or inv.tenant_id != tenant_id:
        raise CollectionsError("Invoice not found")
    bal = Decimal(inv.amount) - Decimal(inv.amount_paid or 0)
    if bal <= 0:
        raise CollectionsError("Invoice has no open balance")
    expense = resolve_combination(db, tenant_id, expense_combination_id)
    structure = sla.get_primary_structure(db, tenant_id)
    recv = sla._account(db, tenant_id, structure.id, AR_RECEIVABLE, inv.fund or "OPER")
    batch = sla._new_batch(db, tenant_id, "AR", gl_date, f"Write-off {inv.invoice_number}", created_by)
    header = sla._add_header(db, batch, structure.id, "Write-off", "Collections",
                             gl_date, "AR_WRITEOFF", inv.id, f"Write-off {inv.invoice_number}", created_by)
    db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=1,
                    code_combination_id=expense.id, entered_dr=bal, entered_cr=0,
                    fund_value=expense.fund_value, description="Bad debt expense",
                    created_by=created_by, updated_by=created_by))
    db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=2,
                    code_combination_id=recv.id, entered_dr=0, entered_cr=bal,
                    fund_value=inv.fund or "OPER", description="Write off receivable",
                    created_by=created_by, updated_by=created_by))
    db.flush()
    db.refresh(batch)
    sla._set_control_totals(batch)
    inv.amount_paid = Decimal(inv.amount)  # clears the open balance
    inv.status = "WRITTEN_OFF"
    db.flush()
    return {"batch_id": batch.id, "amount": bal}


# --- Collection effectiveness ---------------------------------------------
def collection_effectiveness(db: Session, tenant_id, start: date, end: date) -> dict:
    billed = Decimal(db.execute(select(func.coalesce(func.sum(ArInvoice.amount), 0)).where(
        ArInvoice.tenant_id == tenant_id, ArInvoice.invoice_date >= start,
        ArInvoice.invoice_date <= end, ArInvoice.status != "WRITTEN_OFF")).scalar_one())
    collected = Decimal(db.execute(select(func.coalesce(func.sum(ArReceipt.amount), 0)).where(
        ArReceipt.tenant_id == tenant_id, ArReceipt.receipt_date >= start,
        ArReceipt.receipt_date <= end)).scalar_one())
    rate = (collected / billed * Decimal("100")).quantize(Decimal("0.1")) if billed > 0 else Decimal("0")
    return {"billed": billed, "collected": collected, "rate_pct": rate}
