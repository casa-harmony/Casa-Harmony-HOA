"""AP payments orchestration: selection, creation, void/stop, batch runs.

A payment applies to one or more invoice payment schedules, updates remaining
balances + invoice status, and books Dr AP / Cr Cash per fund via Subledger
Accounting (a DRAFT GL batch the GL accountant later posts). Void/stop reverse it.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.masters import ApSupplier
from app.models.payables import ApInvoice
from app.models.payments import (
    ApInvoicePayment,
    ApPayment,
    ApPaymentSchedule,
    PaymentMethod,
)
from app.services import subledger_accounting as sla

CENT = Decimal("0.01")


class PaymentError(ValueError):
    pass


def next_payment_number(db: Session, tenant_id: uuid.UUID) -> str:
    n = db.execute(
        select(func.count(ApPayment.id)).where(ApPayment.tenant_id == tenant_id)
    ).scalar_one()
    return f"PAY-{n + 1:06d}"


def open_schedules(db: Session, tenant_id: uuid.UUID, vendor_id=None, due_before: date | None = None):
    """Payable invoices: schedules with remaining > 0, joined to invoice + vendor."""
    stmt = (
        select(ApPaymentSchedule, ApInvoice, ApSupplier)
        .join(ApInvoice, ApInvoice.id == ApPaymentSchedule.invoice_id)
        .join(ApSupplier, ApSupplier.id == ApInvoice.vendor_id)
        .where(ApPaymentSchedule.tenant_id == tenant_id, ApPaymentSchedule.status != "PAID")
    )
    if vendor_id:
        stmt = stmt.where(ApInvoice.vendor_id == vendor_id)
    if due_before:
        stmt = stmt.where(ApPaymentSchedule.due_date <= due_before)
    rows = db.execute(stmt.order_by(ApPaymentSchedule.due_date)).all()
    return [(s, inv, v) for (s, inv, v) in rows if s.amount_remaining > 0]


def _apply_to_schedule(db: Session, invoice_id: uuid.UUID, amount: Decimal) -> None:
    sched = db.execute(
        select(ApPaymentSchedule).where(ApPaymentSchedule.invoice_id == invoice_id)
    ).scalar_one_or_none()
    if sched is None:
        raise PaymentError("Invoice has no open payment schedule (is it accounted?)")
    if amount > sched.amount_remaining + CENT:
        raise PaymentError(f"Applied {amount} exceeds remaining {sched.amount_remaining}")
    sched.amount_paid += amount
    sched.status = "PAID" if sched.amount_paid >= sched.gross_amount else "PARTIAL"
    inv = db.get(ApInvoice, invoice_id)
    if inv and sched.status == "PAID":
        inv.status = "PAID"


def create_payment(
    db: Session, *, tenant_id: uuid.UUID, vendor_id: uuid.UUID, payment_method_id,
    payment_date: date, applications: list[dict], reference: str | None = None,
    memo: str | None = None, created_by=None,
) -> tuple[ApPayment, object]:
    """applications: [{invoice_id, amount}]. Returns (payment, draft GL batch)."""
    vendor = db.get(ApSupplier, vendor_id)
    if vendor is None or vendor.tenant_id != tenant_id:
        raise PaymentError("Invalid vendor")
    if not applications:
        raise PaymentError("A payment must apply to at least one invoice")
    if payment_method_id:
        pm = db.get(PaymentMethod, payment_method_id)
        if pm is None or pm.tenant_id != tenant_id:
            raise PaymentError("Invalid payment method")

    total = Decimal("0")
    norm = []
    for a in applications:
        inv = db.get(ApInvoice, a["invoice_id"])
        if inv is None or inv.tenant_id != tenant_id or inv.vendor_id != vendor_id:
            raise PaymentError("Invoice not found for this vendor")
        amt = Decimal(str(a["amount"])).quantize(CENT)
        if amt <= 0:
            raise PaymentError("Applied amount must be positive")
        total += amt
        norm.append((inv.id, amt))

    payment = ApPayment(
        tenant_id=tenant_id, payment_number=next_payment_number(db, tenant_id),
        vendor_id=vendor_id, payment_method_id=payment_method_id, payment_date=payment_date,
        amount=total, reference=reference, memo=memo, status="CREATED",
        created_by=created_by, updated_by=created_by,
    )
    db.add(payment)
    db.flush()
    for invoice_id, amt in norm:
        db.add(ApInvoicePayment(tenant_id=tenant_id, payment_id=payment.id,
                                invoice_id=invoice_id, amount_applied=amt,
                                created_by=created_by, updated_by=created_by))
        _apply_to_schedule(db, invoice_id, amt)
    db.flush()
    db.refresh(payment)
    batch = sla.create_accounting_for_payment(db, payment, payment.applications, created_by=created_by)
    return payment, batch


def _reverse(db, payment: ApPayment, new_status: str, created_by):
    if payment.status != "CREATED":
        raise PaymentError(f"Cannot {new_status.lower()} a payment in status {payment.status}")
    # Restore schedules + invoice status.
    for app in payment.applications:
        sched = db.execute(
            select(ApPaymentSchedule).where(ApPaymentSchedule.invoice_id == app.invoice_id)
        ).scalar_one_or_none()
        if sched:
            sched.amount_paid -= Decimal(app.amount_applied)
            sched.status = ("PAID" if sched.amount_paid >= sched.gross_amount
                            else "PARTIAL" if sched.amount_paid > 0 else "UNPAID")
        inv = db.get(ApInvoice, app.invoice_id)
        if inv and inv.status == "PAID" and (sched is None or sched.status != "PAID"):
            inv.status = "ACCOUNTED"
    batch = sla.create_payment_reversal(db, payment, payment.applications, created_by=created_by)
    payment.status = new_status
    from datetime import datetime, timezone
    payment.voided_at = datetime.now(timezone.utc)
    db.flush()
    return batch


def void_payment(db, payment: ApPayment, created_by=None):
    """Reverse the payment's accounting and reopen the invoices."""
    return _reverse(db, payment, "VOID", created_by)


def stop_payment(db, payment: ApPayment, created_by=None):
    """Stop an uncashed payment — same accounting reversal, distinct status."""
    return _reverse(db, payment, "STOPPED", created_by)


def batch_pay(db, *, tenant_id, payment_method_id, payment_date, due_before, created_by=None):
    """Pay every open schedule due on/before a date, one payment per vendor (full)."""
    rows = open_schedules(db, tenant_id, due_before=due_before)
    by_vendor: dict[uuid.UUID, list] = {}
    for sched, inv, _v in rows:
        by_vendor.setdefault(inv.vendor_id, []).append((inv.id, sched.amount_remaining))
    payments = []
    for vendor_id, items in by_vendor.items():
        apps = [{"invoice_id": iid, "amount": rem} for iid, rem in items]
        payment, _batch = create_payment(
            db, tenant_id=tenant_id, vendor_id=vendor_id, payment_method_id=payment_method_id,
            payment_date=payment_date, applications=apps, memo="Batch payment run",
            created_by=created_by,
        )
        payments.append(payment)
    return payments


def clear_payment(db, payment: ApPayment, created_by=None):
    if payment.status != "CREATED":
        raise PaymentError("Can only clear a CREATED payment")
    payment.status = "CLEARED"
    db.flush()
    return payment
