from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.identity import Tenant
from app.models.payables import ApInvoice
from app.models.workflow import ApprovalRequest
from app.schemas.approvals import ActIn
from app.schemas.payables import ApInvoiceCreate, ApInvoiceOut, HoldIn
from app.services import ap_reports, approvals, audit
from app.services.ap_service import create_invoice
from app.services.distributions import DistributionError
from app.services.subledger_accounting import AccountingError, create_accounting_for_ap_invoice

router = APIRouter(
    prefix="/payables", tags=["payables"], dependencies=[Depends(require_active_tenant)]
)


def _get_inv(db: Session, inv_id: uuid.UUID, tenant_id: uuid.UUID) -> ApInvoice:
    inv = db.get(ApInvoice, inv_id)
    if inv is None or inv.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    return inv


def _finalize(db: Session, inv: ApInvoice, approver_id: uuid.UUID) -> None:
    """On final approval: mark APPROVED and run Subledger Accounting (draft GL batch)."""
    inv.status = "APPROVED"
    inv.approval_status = "APPROVED"
    inv.approved_by = approver_id
    inv.approved_at = datetime.now(timezone.utc)
    try:
        create_accounting_for_ap_invoice(db, inv, created_by=approver_id)
    except (AccountingError, DistributionError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Accounting failed: {exc}")
    # Roll matched billing up to the PO (quantity_billed / amount_billed / status).
    from app.services import matching
    matching.apply_billing(db, inv)


@router.get("", response_model=list[ApInvoiceOut])
def list_invoices(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ap.manage")),
):
    return db.execute(
        select(ApInvoice).where(ApInvoice.tenant_id == principal.tenant_id)
        .order_by(ApInvoice.invoice_date.desc())
    ).scalars().all()


@router.post("", response_model=ApInvoiceOut, status_code=status.HTTP_201_CREATED)
def create(
    payload: ApInvoiceCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ap.manage")),
):
    try:
        inv = create_invoice(
            db, tenant_id=principal.tenant_id, vendor_id=payload.vendor_id,
            invoice_number=payload.invoice_number, invoice_date=payload.invoice_date,
            gl_date=payload.gl_date, po_header_id=payload.po_header_id,
            description=payload.description, tax_amount=payload.tax_amount,
            lines=[ln.model_dump() for ln in payload.lines], created_by=principal.user.id,
        )
    except DistributionError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="CREATE", entity_type="ApInvoice", entity_id=inv.id,
                 after={"invoice_number": inv.invoice_number, "amount": str(inv.amount),
                        "match_status": inv.match_status})
    return inv


@router.post("/{invoice_id}/submit", response_model=ApInvoiceOut)
def submit(
    invoice_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ap.manage")),
):
    inv = _get_inv(db, invoice_id, principal.tenant_id)
    if inv.status not in ("DRAFT", "REJECTED"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cannot submit a {inv.status} invoice")
    if inv.on_hold:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Invoice is on hold: {inv.hold_reason or 'released required'}")
    if inv.match_status == "MATCH_EXCEPTION":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Invoice exceeds matched PO amount (match exception)")

    # Differentiated routing: a clean PO match is fast-tracked (auto-approved within
    # tolerance); a non-matched invoice is routed for Board verification of the
    # accounting strings.
    if inv.match_status == "MATCHED":
        inv.status = "SUBMITTED"
        inv.approval_status = "APPROVED"
        _finalize(db, inv, principal.user.id)
        audit.record(db, action="SUBMIT", entity_type="ApInvoice", entity_id=inv.id,
                     after={"route": "FAST_TRACK_MATCHED"})
        return inv

    req = approvals.submit(
        db, tenant_id=principal.tenant_id, document_type="AP_INVOICE",
        document_id=inv.id, amount=inv.amount, submitted_by=principal.user.id,
    )
    inv.status = "SUBMITTED"
    inv.approval_status = "PENDING"
    # Non-matched invoices need explicit Board verification of the KFF strings.
    from app.services import notifications
    notifications.create_notification(
        db, tenant_id=principal.tenant_id, category="INFO",
        message=(f"Non-matched invoice {inv.invoice_number} (${inv.amount}) requires Board "
                 "verification of the accounting distribution before approval."),
        entity_type="ApInvoice", entity_id=inv.id, recipient_role_code="BOARD_MEMBER")
    if req.status == "APPROVED":
        _finalize(db, inv, principal.user.id)
    audit.record(db, action="SUBMIT", entity_type="ApInvoice", entity_id=inv.id,
                 after={"route": "BOARD_REVIEW_NONMATCHED"})
    return inv


@router.post("/{invoice_id}/approve", response_model=ApInvoiceOut)
def approve(
    invoice_id: uuid.UUID,
    payload: ActIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ap.approve")),
):
    inv = _get_inv(db, invoice_id, principal.tenant_id)
    req = db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.tenant_id == principal.tenant_id,
            ApprovalRequest.document_type == "AP_INVOICE",
            ApprovalRequest.document_id == inv.id,
        )
    ).scalar_one_or_none()
    if req is None or req.status != "PENDING":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No pending approval for this invoice")
    approvals.act(db, request=req, approver_id=principal.user.id,
                  approve=payload.approve, comments=payload.comments)
    if req.status == "APPROVED":
        _finalize(db, inv, principal.user.id)
    elif req.status == "REJECTED":
        inv.status = "REJECTED"
        inv.approval_status = "REJECTED"
    audit.record(db, action="APPROVE" if payload.approve else "REJECT",
                 entity_type="ApInvoice", entity_id=inv.id)
    return inv


@router.post("/{invoice_id}/hold", response_model=ApInvoiceOut)
def place_hold(
    invoice_id: uuid.UUID, payload: HoldIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ap.manage")),
):
    inv = _get_inv(db, invoice_id, principal.tenant_id)
    if inv.status in ("PAID", "CANCELLED"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cannot hold a {inv.status} invoice")
    inv.on_hold = True
    inv.hold_reason = payload.reason
    audit.record(db, action="HOLD", entity_type="ApInvoice", entity_id=inv.id,
                 after={"hold_reason": payload.reason})
    return inv


@router.post("/{invoice_id}/release-hold", response_model=ApInvoiceOut)
def release_hold(
    invoice_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ap.approve")),
):
    """Releasing a hold requires approval authority (ap.approve)."""
    inv = _get_inv(db, invoice_id, principal.tenant_id)
    if not inv.on_hold:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invoice is not on hold")
    inv.on_hold = False
    prior = inv.hold_reason
    inv.hold_reason = None
    audit.record(db, action="RELEASE_HOLD", entity_type="ApInvoice", entity_id=inv.id,
                 before={"hold_reason": prior})
    return inv


@router.post("/{invoice_id}/cancel", response_model=ApInvoiceOut)
def cancel(
    invoice_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ap.approve")),
):
    """Cancel an invoice: reverse any PO billing (PO becomes re-billable), void a
    still-draft GL batch, drop the payable schedule, and release holds."""
    from app.models.gl import GlJeBatch, GlJeHeader
    from app.models.payments import ApInvoicePayment, ApPaymentSchedule
    from app.services import matching

    inv = _get_inv(db, invoice_id, principal.tenant_id)
    if inv.status in ("CANCELLED", "PAID"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cannot cancel a {inv.status} invoice")
    # Block if any payment has been applied.
    if db.execute(select(ApInvoicePayment).where(ApInvoicePayment.invoice_id == inv.id)).first():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Invoice has payments applied; void the payment first")
    # Block if its GL batch is already posted.
    if inv.gl_je_header_id:
        hdr = db.get(GlJeHeader, inv.gl_je_header_id)
        batch = db.get(GlJeBatch, hdr.batch_id) if hdr else None
        if batch and batch.status == "POSTED":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "GL batch already posted; reverse via GL before cancelling")
        if batch and batch.status != "POSTED":
            batch.status = "CANCELLED"

    matching.reverse_billing(db, inv)  # PO billed amounts/quantities restored
    sched = db.execute(select(ApPaymentSchedule).where(
        ApPaymentSchedule.invoice_id == inv.id)).scalar_one_or_none()
    if sched:
        db.delete(sched)
    inv.on_hold = False
    inv.hold_reason = None
    inv.status = "CANCELLED"
    inv.approval_status = "CANCELLED"
    audit.record(db, action="CANCEL", entity_type="ApInvoice", entity_id=inv.id,
                 after={"po_header_id": str(inv.po_header_id) if inv.po_header_id else None})
    return inv


# --- Reports ---------------------------------------------------------------
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx(content: bytes, filename: str) -> Response:
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _tname(db, tid):
    t = db.get(Tenant, tid)
    return t.name if t else "HOA"


@router.get("/register/export")
def export_invoice_register(start: date, end: date, db: Session = Depends(get_db),
                            principal: Principal = Depends(require_permission("report.read"))):
    return _xlsx(ap_reports.build_invoice_register_workbook(
        db, principal.tenant_id, start, end, _tname(db, principal.tenant_id)),
        f"ap_invoice_register_{start}_{end}.xlsx")


@router.get("/distributions/export")
def export_distributions(start: date, end: date, db: Session = Depends(get_db),
                         principal: Principal = Depends(require_permission("report.read"))):
    return _xlsx(ap_reports.build_ap_distributions_workbook(
        db, principal.tenant_id, start, end, _tname(db, principal.tenant_id)),
        f"ap_distributions_{start}_{end}.xlsx")
