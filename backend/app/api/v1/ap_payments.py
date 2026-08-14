from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.identity import Tenant
from app.models.payments import ApPayment
from app.schemas.payments import (
    BatchPayIn,
    BatchPayOut,
    PayableOut,
    PaymentCreate,
    PaymentOut,
)
from app.services import ap_payments, ap_reports, audit
from app.services.ap_payments import PaymentError

router = APIRouter(
    prefix="/ap-payments", tags=["ap-payments"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/payable", response_model=list[PayableOut])
def list_payable(vendor_id: uuid.UUID | None = None, due_before: date | None = None,
                 db: Session = Depends(get_db),
                 principal: Principal = Depends(require_permission("ap.pay"))):
    rows = ap_payments.open_schedules(db, principal.tenant_id, vendor_id, due_before)
    return [PayableOut(invoice_id=inv.id, invoice_number=inv.invoice_number, vendor_id=v.id,
                       vendor_name=v.name, due_date=s.due_date, gross_amount=s.gross_amount,
                       amount_remaining=s.amount_remaining) for (s, inv, v) in rows]


@router.get("", response_model=list[PaymentOut])
def list_payments(db: Session = Depends(get_db),
                  principal: Principal = Depends(require_permission("ap.pay"))):
    return db.execute(select(ApPayment).where(ApPayment.tenant_id == principal.tenant_id)
                      .order_by(ApPayment.payment_date.desc())).scalars().all()


@router.post("", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
def create_payment(payload: PaymentCreate, db: Session = Depends(get_db),
                   principal: Principal = Depends(require_permission("ap.pay"))):
    try:
        payment, _batch = ap_payments.create_payment(
            db, tenant_id=principal.tenant_id, vendor_id=payload.vendor_id,
            payment_method_id=payload.payment_method_id, payment_date=payload.payment_date,
            reference=payload.reference, memo=payload.memo,
            applications=[a.model_dump() for a in payload.applications],
            created_by=principal.user.id)
    except PaymentError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="CREATE", entity_type="ApPayment", entity_id=payment.id,
                 after={"payment_number": payment.payment_number, "amount": str(payment.amount)})
    return payment


def _get_payment(db, pid, tenant_id) -> ApPayment:
    p = db.get(ApPayment, pid)
    if p is None or p.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    return p


@router.post("/{payment_id}/void", response_model=PaymentOut)
def void_payment(payment_id: uuid.UUID, db: Session = Depends(get_db),
                 principal: Principal = Depends(require_permission("ap.pay"))):
    p = _get_payment(db, payment_id, principal.tenant_id)
    try:
        ap_payments.void_payment(db, p, created_by=principal.user.id)
    except PaymentError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="VOID", entity_type="ApPayment", entity_id=p.id)
    return p


@router.post("/{payment_id}/stop", response_model=PaymentOut)
def stop_payment(payment_id: uuid.UUID, db: Session = Depends(get_db),
                 principal: Principal = Depends(require_permission("ap.pay"))):
    p = _get_payment(db, payment_id, principal.tenant_id)
    try:
        ap_payments.stop_payment(db, p, created_by=principal.user.id)
    except PaymentError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="STOP", entity_type="ApPayment", entity_id=p.id)
    return p


@router.post("/batch", response_model=BatchPayOut)
def batch_pay(payload: BatchPayIn, db: Session = Depends(get_db),
              principal: Principal = Depends(require_permission("ap.pay"))):
    try:
        payments = ap_payments.batch_pay(
            db, tenant_id=principal.tenant_id, payment_method_id=payload.payment_method_id,
            payment_date=payload.payment_date, due_before=payload.due_before,
            created_by=principal.user.id)
    except PaymentError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    total = sum((Decimal(p.amount) for p in payments), Decimal("0"))
    audit.record(db, action="BATCH_PAY", entity_type="ApPayment",
                 after={"count": len(payments), "total": str(total)})
    return BatchPayOut(payments_created=len(payments), total_paid=total,
                       payment_ids=[p.id for p in payments])


# --- Reports ---------------------------------------------------------------
def _xlsx(content: bytes, filename: str) -> Response:
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _tname(db, tid):
    t = db.get(Tenant, tid)
    return t.name if t else "HOA"


@router.get("/register/export")
def export_register(start: date, end: date, db: Session = Depends(get_db),
                    principal: Principal = Depends(require_permission("report.read"))):
    return _xlsx(ap_reports.build_payment_register_workbook(
        db, principal.tenant_id, start, end, _tname(db, principal.tenant_id)),
        f"payment_register_{start}_{end}.xlsx")


@router.get("/aged-payables/export")
def export_aged(as_of: date | None = None, db: Session = Depends(get_db),
                principal: Principal = Depends(require_permission("report.read"))):
    d = as_of or date.today()
    return _xlsx(ap_reports.build_aged_payables_workbook(
        db, principal.tenant_id, d, _tname(db, principal.tenant_id)), f"aged_payables_{d}.xlsx")


@router.get("/cash-requirements/export")
def export_cash_req(as_of: date | None = None, db: Session = Depends(get_db),
                    principal: Principal = Depends(require_permission("report.read"))):
    d = as_of or date.today()
    return _xlsx(ap_reports.build_cash_requirements_workbook(
        db, principal.tenant_id, d, _tname(db, principal.tenant_id)), f"cash_requirements_{d}.xlsx")


@router.post("/{payment_id}/clear", response_model=PaymentOut)
def clear_payment(payment_id: uuid.UUID, db: Session = Depends(get_db),
                 principal: Principal = Depends(require_permission("ap.pay"))):
    p = _get_payment(db, payment_id, principal.tenant_id)
    try:
        ap_payments.clear_payment(db, p, created_by=principal.user.id)
    except PaymentError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="CLEAR", entity_type="ApPayment", entity_id=p.id)
    return p
