"""Resident self-service portal (owners & renters).

Public login issues a scoped ``resident`` token carrying the HOA, so RLS binds to
that tenant automatically. Every endpoint further restricts data to the units the
resident is actually linked to — a resident can never see another unit or HOA.
"""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db, get_elevated_db
from app.core.deps import get_current_resident
from app.core.security import create_access_token, hash_password, verify_password
from app.models.documents import DocumentAttachment
from app.models.identity import Tenant
from app.models.resident import Resident, ResidentUnit
from app.models.subledger import ArHomeowner, ArInvoice, ArReceipt
from app.core.config import settings
from app.schemas.resident import (
    PortalChangePassword,
    PortalDashboard,
    PortalDocument,
    PortalForgot,
    PortalInvoice,
    PortalLogin,
    PortalLoginResult,
    PortalNotification,
    PortalPay,
    PortalReceipt,
    PortalReset,
    PortalResident,
    PortalToken,
    PortalUnit,
    PortalVerify,
)
from app.services import audit, documents_svc, otp
from app.services.reports import build_homeowner_ledger_workbook
from app.services.subledger_accounting import (
    AccountingError,
    create_accounting_for_ar_receipt,
)
from app.services.distributions import DistributionError

router = APIRouter(prefix="/portal", tags=["portal"])
_OPEN = ("DRAFT", "ACCOUNTED", "POSTED")


def _issue_token(resident: Resident) -> str:
    return create_access_token(
        subject=str(resident.id),
        extra_claims={"scope": "resident", "tenant_id": str(resident.tenant_id),
                      "username": resident.username},
    )


def _resident_out(resident: Resident) -> PortalResident:
    return PortalResident(id=resident.id, username=resident.username,
                          full_name=resident.full_name, resident_type=resident.resident_type,
                          must_change_password=resident.must_change_password)


@router.post("/login", response_model=PortalLoginResult)
def portal_login(payload: PortalLogin, db: Session = Depends(get_elevated_db)):
    """Step 1: verify the password, then send an email/SMS one-time code (MFA)."""
    tenant = db.execute(
        select(Tenant).where(Tenant.slug == payload.hoa_slug.lower())
    ).scalar_one_or_none()
    resident = None
    if tenant:
        resident = db.execute(
            select(Resident).where(
                Resident.tenant_id == tenant.id,
                func.lower(Resident.username) == payload.username.lower(),
            )
        ).scalar_one_or_none()
    if resident is None or not verify_password(payload.password, resident.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid HOA, username, or password")
    if not resident.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")

    # MFA disabled (or no contact on file) → issue the token directly.
    if not resident.mfa_enabled:
        return PortalLoginResult(mfa_required=False, access_token=_issue_token(resident),
                                 resident=_resident_out(resident))
    try:
        challenge, code = otp.create_challenge(db, resident)
    except otp.OtpError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    result = PortalLoginResult(
        mfa_required=True, challenge_id=challenge.id, channel=challenge.channel,
        destination_masked=challenge.destination_masked,
    )
    # In development only (no real provider), surface the code so UAT can proceed.
    if settings.ENVIRONMENT == "development":
        result.dev_otp = code
    return result


@router.post("/login/verify", response_model=PortalToken)
def portal_login_verify(payload: PortalVerify, db: Session = Depends(get_elevated_db)):
    """Step 2: verify the one-time code and issue the resident token."""
    try:
        resident = otp.verify_challenge(db, payload.challenge_id, payload.code)
    except otp.OtpError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    return PortalToken(access_token=_issue_token(resident), resident=_resident_out(resident))


@router.get("/me", response_model=PortalResident)
def portal_me(resident: Resident = Depends(get_current_resident)):
    return _resident_out(resident)


@router.post("/change-password")
def portal_change_password(
    payload: PortalChangePassword,
    resident: Resident = Depends(get_current_resident),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, resident.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if verify_password(payload.new_password, resident.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must differ from the current one")
    resident.password_hash = hash_password(payload.new_password)
    resident.must_change_password = False
    db.flush()
    return {"status": "ok"}


@router.post("/forgot-password")
def portal_forgot_password(payload: PortalForgot, db: Session = Depends(get_elevated_db)):
    """Send a one-time reset code to the resident's email/SMS. Always 200."""
    tenant = db.execute(
        select(Tenant).where(Tenant.slug == payload.hoa_slug.lower())
    ).scalar_one_or_none()
    resident = None
    if tenant:
        resident = db.execute(
            select(Resident).where(
                Resident.tenant_id == tenant.id,
                func.lower(Resident.username) == payload.username.lower(),
            )
        ).scalar_one_or_none()
    generic = {"status": "If the account exists, a reset code has been sent."}
    if resident is None or not resident.is_active:
        return generic
    try:
        challenge, code = otp.create_challenge(db, resident)
    except otp.OtpError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    out = {**generic, "challenge_id": str(challenge.id), "channel": challenge.channel,
           "destination_masked": challenge.destination_masked}
    if settings.ENVIRONMENT == "development":
        out["dev_otp"] = code
    return out


@router.post("/reset-password")
def portal_reset_password(payload: PortalReset, db: Session = Depends(get_elevated_db)):
    """Complete the reset with the one-time code (single-use)."""
    try:
        resident = otp.verify_challenge(db, payload.challenge_id, payload.code)
    except otp.OtpError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    resident.password_hash = hash_password(payload.new_password)
    resident.must_change_password = False
    db.flush()
    return {"status": "ok"}


def _owned_unit(db: Session, resident: Resident, homeowner_id: uuid.UUID) -> ResidentUnit:
    link = db.execute(
        select(ResidentUnit).where(
            ResidentUnit.resident_id == resident.id,
            ResidentUnit.homeowner_id == homeowner_id,
        )
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unit not found for this resident")
    return link


def _unit_balance(db: Session, tenant_id: uuid.UUID, homeowner_id: uuid.UUID) -> Decimal:
    rows = db.execute(
        select(ArInvoice.amount, ArInvoice.amount_paid).where(
            ArInvoice.tenant_id == tenant_id,
            ArInvoice.homeowner_id == homeowner_id,
            ArInvoice.status.in_(_OPEN),
        )
    ).all()
    return sum((Decimal(a) - Decimal(p or 0) for a, p in rows), Decimal("0"))


@router.get("/units", response_model=list[PortalUnit])
def my_units(
    resident: Resident = Depends(get_current_resident),
    db: Session = Depends(get_db),
):
    links = db.execute(
        select(ResidentUnit, ArHomeowner)
        .join(ArHomeowner, ArHomeowner.id == ResidentUnit.homeowner_id)
        .where(ResidentUnit.resident_id == resident.id)
    ).all()
    return [
        PortalUnit(
            homeowner_id=ho.id, unit_number=link.unit_number, account_number=ho.account_number,
            is_primary=link.is_primary, balance=_unit_balance(db, resident.tenant_id, ho.id),
        )
        for link, ho in links
    ]


@router.get("/units/{homeowner_id}/invoices", response_model=list[PortalInvoice])
def unit_invoices(
    homeowner_id: uuid.UUID,
    resident: Resident = Depends(get_current_resident),
    db: Session = Depends(get_db),
):
    _owned_unit(db, resident, homeowner_id)
    rows = db.execute(
        select(ArInvoice).where(
            ArInvoice.tenant_id == resident.tenant_id, ArInvoice.homeowner_id == homeowner_id
        ).order_by(ArInvoice.invoice_date.desc())
    ).scalars().all()
    return [
        PortalInvoice(
            id=i.id, invoice_number=i.invoice_number, invoice_type=i.invoice_type,
            amount=i.amount, amount_paid=i.amount_paid or Decimal("0"),
            balance=Decimal(i.amount) - Decimal(i.amount_paid or 0),
            invoice_date=i.invoice_date, due_date=i.due_date, status=i.status,
        )
        for i in rows
    ]


@router.get("/units/{homeowner_id}/receipts", response_model=list[PortalReceipt])
def unit_receipts(
    homeowner_id: uuid.UUID,
    resident: Resident = Depends(get_current_resident),
    db: Session = Depends(get_db),
):
    _owned_unit(db, resident, homeowner_id)
    rows = db.execute(
        select(ArReceipt).where(
            ArReceipt.tenant_id == resident.tenant_id, ArReceipt.homeowner_id == homeowner_id
        ).order_by(ArReceipt.receipt_date.desc())
    ).scalars().all()
    return [PortalReceipt(receipt_number=r.receipt_number, amount=r.amount,
                          receipt_date=r.receipt_date, payment_method=r.payment_method) for r in rows]


@router.get("/units/{homeowner_id}/ledger/export")
def unit_ledger(
    homeowner_id: uuid.UUID,
    resident: Resident = Depends(get_current_resident),
    db: Session = Depends(get_db),
):
    _owned_unit(db, resident, homeowner_id)
    ho = db.get(ArHomeowner, homeowner_id)
    xlsx = build_homeowner_ledger_workbook(db, resident.tenant_id, ho)
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="ledger_{ho.account_number}.xlsx"'},
    )


@router.post("/pay/checkout")
def pay_checkout(
    payload: PortalPay,
    resident: Resident = Depends(get_current_resident),
    db: Session = Depends(get_db),
):
    """Start a real-gateway hosted checkout for one of the resident's invoices.
    Returns a checkout_url to redirect to; the webhook confirms + posts the receipt."""
    from app.services import gateway
    from app.services.gateway import GatewayError

    inv = db.get(ArInvoice, payload.invoice_id)
    if inv is None or inv.tenant_id != resident.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    _owned_unit(db, resident, inv.homeowner_id)
    try:
        return gateway.create_checkout(db, tenant_id=resident.tenant_id, invoice_id=inv.id,
                                       amount=payload.amount, homeowner_id=inv.homeowner_id)
    except GatewayError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("/pay", response_model=PortalReceipt, status_code=status.HTTP_201_CREATED)
def pay(
    payload: PortalPay,
    resident: Resident = Depends(get_current_resident),
    db: Session = Depends(get_db),
):
    """Record a resident payment for one of their invoices.

    This path books the receipt directly from the asserted amount with no
    payment processor, so it is a DEMO shortcut only. In production a resident
    payment must settle through ``/portal/pay/checkout`` and the gateway
    webhook; otherwise a resident could clear their own balance without paying.
    """
    from app.core.config import settings

    if not settings.ALLOW_DIRECT_PORTAL_PAYMENT or settings.is_production:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Direct payment is disabled. Use the hosted checkout to pay online.",
        )

    inv = db.get(ArInvoice, payload.invoice_id)
    if inv is None or inv.tenant_id != resident.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    _owned_unit(db, resident, inv.homeowner_id)  # resident must own the invoice's unit

    # A draft invoice is not yet a payable receivable; refuse anything that is
    # not open, and anything already settled.
    if inv.status in ("DRAFT", "PAID", "VOID", "WRITTEN_OFF", "CANCELLED"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Invoice is not payable (status: {inv.status})"
        )
    if payload.amount is None or payload.amount <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Amount must be positive")

    seq = db.execute(
        select(func.count(ArReceipt.id)).where(ArReceipt.tenant_id == resident.tenant_id)
    ).scalar_one()
    receipt = ArReceipt(
        tenant_id=resident.tenant_id, homeowner_id=inv.homeowner_id, applied_invoice_id=inv.id,
        receipt_number=f"WEB-{seq + 1:06d}", amount=payload.amount, receipt_date=date.today(),
        payment_method="CARD", status="APPLIED",
        created_by=None, updated_by=None,
    )
    db.add(receipt)
    db.flush()
    inv.amount_paid = (inv.amount_paid or Decimal("0")) + payload.amount
    if inv.amount_paid >= inv.amount:
        inv.status = "PAID"
    try:
        create_accounting_for_ar_receipt(db, receipt, fund=inv.fund or "OPER")
    except (AccountingError, DistributionError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Payment posting failed: {exc}")
    audit.record(db, action="PORTAL_PAYMENT", entity_type="ArReceipt", entity_id=receipt.id,
                 after={"invoice": inv.invoice_number, "amount": str(payload.amount),
                        "resident": resident.username})
    return PortalReceipt(receipt_number=receipt.receipt_number, amount=receipt.amount,
                         receipt_date=receipt.receipt_date, payment_method=receipt.payment_method)


# --- P22: resident dashboard, documents, notifications, statement ----------
def _owned_homeowner_ids(db: Session, resident: Resident) -> list[uuid.UUID]:
    return [hid for (hid,) in db.execute(
        select(ResidentUnit.homeowner_id).where(ResidentUnit.resident_id == resident.id)).all()]


@router.get("/dashboard", response_model=PortalDashboard)
def portal_dashboard(resident: Resident = Depends(get_current_resident),
                     db: Session = Depends(get_db)):
    """Cross-unit summary for the signed-in resident."""
    ho_ids = _owned_homeowner_ids(db, resident)
    if not ho_ids:
        return PortalDashboard(total_balance=Decimal("0"), units=0, open_invoices=0,
                               open_assessments=0, open_special=0)
    open_invs = db.execute(select(ArInvoice).where(
        ArInvoice.tenant_id == resident.tenant_id,
        ArInvoice.homeowner_id.in_(ho_ids), ArInvoice.status.in_(_OPEN))).scalars().all()
    total = sum((Decimal(i.amount) - Decimal(i.amount_paid or 0) for i in open_invs), Decimal("0"))
    due_dates = sorted([i.due_date for i in open_invs if i.due_date])
    special = sum(1 for i in open_invs if i.invoice_type in ("SPECIAL_ASSESSMENT", "LATE_FEE"))
    recent = db.execute(select(ArReceipt).where(
        ArReceipt.tenant_id == resident.tenant_id, ArReceipt.homeowner_id.in_(ho_ids))
        .order_by(ArReceipt.receipt_date.desc()).limit(5)).scalars().all()
    return PortalDashboard(
        total_balance=total, units=len(ho_ids), open_invoices=len(open_invs),
        open_assessments=len(open_invs) - special, open_special=special,
        next_due_date=due_dates[0] if due_dates else None,
        recent_payments=[PortalReceipt(receipt_number=r.receipt_number, amount=r.amount,
                                       receipt_date=r.receipt_date, payment_method=r.payment_method)
                         for r in recent])


@router.get("/notifications", response_model=list[PortalNotification])
def portal_notifications(resident: Resident = Depends(get_current_resident),
                         db: Session = Depends(get_db)):
    """Computed alerts: overdue, due-soon (<=14d), and late-fee charges across units."""
    links = db.execute(
        select(ResidentUnit, ArHomeowner)
        .join(ArHomeowner, ArHomeowner.id == ResidentUnit.homeowner_id)
        .where(ResidentUnit.resident_id == resident.id)).all()
    units = {ho.id: link.unit_number for link, ho in links}
    if not units:
        return []
    today = date.today()
    soon = today + timedelta(days=14)
    invs = db.execute(select(ArInvoice).where(
        ArInvoice.tenant_id == resident.tenant_id,
        ArInvoice.homeowner_id.in_(list(units)), ArInvoice.status.in_(_OPEN))).scalars().all()
    out: list[PortalNotification] = []
    for i in invs:
        bal = Decimal(i.amount) - Decimal(i.amount_paid or 0)
        if bal <= 0:
            continue
        unit = units[i.homeowner_id]
        if i.invoice_type == "LATE_FEE":
            out.append(PortalNotification(category="LATE_FEE",
                       message=f"Late fee ${bal:.2f} on unit {unit} ({i.invoice_number}).",
                       homeowner_id=i.homeowner_id, unit_number=unit, due_date=i.due_date, amount=bal))
        elif i.due_date and i.due_date < today:
            out.append(PortalNotification(category="OVERDUE",
                       message=f"Overdue ${bal:.2f} on unit {unit} (due {i.due_date.isoformat()}).",
                       homeowner_id=i.homeowner_id, unit_number=unit, due_date=i.due_date, amount=bal))
        elif i.due_date and i.due_date <= soon:
            out.append(PortalNotification(category="DUE_SOON",
                       message=f"${bal:.2f} due {i.due_date.isoformat()} on unit {unit}.",
                       homeowner_id=i.homeowner_id, unit_number=unit, due_date=i.due_date, amount=bal))
    out.sort(key=lambda n: (n.category != "OVERDUE", n.due_date or date.max))
    return out


@router.get("/units/{homeowner_id}/documents", response_model=list[PortalDocument])
def unit_documents(homeowner_id: uuid.UUID,
                   resident: Resident = Depends(get_current_resident),
                   db: Session = Depends(get_db)):
    _owned_unit(db, resident, homeowner_id)
    docs = db.execute(select(DocumentAttachment).where(
        DocumentAttachment.tenant_id == resident.tenant_id,
        DocumentAttachment.homeowner_id == homeowner_id)
        .order_by(DocumentAttachment.created_at.desc())).scalars().all()
    return [PortalDocument(id=d.id, homeowner_id=d.homeowner_id, entity_type=d.entity_type,
                           filename=d.filename, content_type=d.content_type,
                           size_bytes=d.size_bytes, created_at=d.created_at) for d in docs]


@router.get("/documents/{doc_id}/download")
def portal_download_document(doc_id: uuid.UUID,
                            resident: Resident = Depends(get_current_resident),
                            db: Session = Depends(get_db)):
    doc = db.get(DocumentAttachment, doc_id)
    if doc is None or doc.tenant_id != resident.tenant_id or doc.homeowner_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    _owned_unit(db, resident, doc.homeowner_id)  # resident must own the linked unit
    try:
        data = documents_svc.read_bytes(doc)
    except documents_svc.DocumentError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return Response(content=data, media_type=doc.content_type,
                    headers={"Content-Disposition": f'attachment; filename="{doc.filename}"'})


@router.get("/units/{homeowner_id}/statement/export")
def unit_statement(homeowner_id: uuid.UUID,
                   resident: Resident = Depends(get_current_resident),
                   db: Session = Depends(get_db)):
    """Resident statement (open assessments + payment history + balance)."""
    _owned_unit(db, resident, homeowner_id)
    ho = db.get(ArHomeowner, homeowner_id)
    from app.services.reports import build_resident_statement_workbook
    t = db.get(Tenant, resident.tenant_id)
    xlsx = build_resident_statement_workbook(db, resident.tenant_id, ho, t.name if t else "HOA")
    return Response(content=xlsx,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="statement_{ho.account_number}.xlsx"'})


@router.get("/collections")
def portal_collections(resident: Resident = Depends(get_current_resident),
                       db: Session = Depends(get_db)):
    """The resident's active payment plans and lien status across owned units."""
    from app.models.collections import Lien, PaymentPlan, PaymentPlanInstallment
    ho_ids = _owned_homeowner_ids(db, resident)
    if not ho_ids:
        return {"payment_plans": [], "liens": []}
    plans = db.execute(select(PaymentPlan).where(
        PaymentPlan.tenant_id == resident.tenant_id,
        PaymentPlan.homeowner_id.in_(ho_ids)).order_by(PaymentPlan.plan_number.desc())).scalars().all()
    liens = db.execute(select(Lien).where(
        Lien.tenant_id == resident.tenant_id,
        Lien.homeowner_id.in_(ho_ids), Lien.status != "RELEASED")).scalars().all()
    plan_out = []
    for pl in plans:
        sched = db.execute(select(PaymentPlanInstallment).where(
            PaymentPlanInstallment.plan_id == pl.id).order_by(PaymentPlanInstallment.seq)).scalars().all()
        plan_out.append({"plan_number": pl.plan_number, "total_amount": str(pl.total_amount),
                         "installments": pl.installments, "status": pl.status,
                         "next_due": next((s.due_date.isoformat() for s in sched if s.status != "PAID"), None),
                         "remaining": str(sum((Decimal(s.amount) - Decimal(s.amount_paid) for s in sched), Decimal("0")))})
    lien_out = [{"lien_number": ln.lien_number, "amount": str(ln.amount), "status": ln.status,
                 "filed_date": ln.filed_date.isoformat() if ln.filed_date else None} for ln in liens]
    return {"payment_plans": plan_out, "liens": lien_out}
