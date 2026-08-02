from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.identity import Tenant
from app.models.receiving import RcvShipmentHeader
from app.schemas.receiving import ReceiptCreate, ReceiptDetail, ReceiptOut
from app.services import audit, po_reports, receiving
from app.services.receiving import ReceivingError

router = APIRouter(
    prefix="/receiving", tags=["receiving"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _get(db, rid, tenant_id) -> RcvShipmentHeader:
    h = db.get(RcvShipmentHeader, rid)
    if h is None or h.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt not found")
    return h


@router.get("", response_model=list[ReceiptOut])
def list_receipts(po_header_id: uuid.UUID | None = None, rcv_status: str | None = None,
                  db: Session = Depends(get_db),
                  principal: Principal = Depends(require_permission("po.receive"))):
    stmt = select(RcvShipmentHeader).where(RcvShipmentHeader.tenant_id == principal.tenant_id)
    if po_header_id:
        stmt = stmt.where(RcvShipmentHeader.po_header_id == po_header_id)
    if rcv_status:
        stmt = stmt.where(RcvShipmentHeader.status == rcv_status)
    return db.execute(stmt.order_by(RcvShipmentHeader.receipt_number.desc())).scalars().all()


@router.get("/pending-inspection", response_model=list[ReceiptOut])
def pending_inspection(db: Session = Depends(get_db),
                       principal: Principal = Depends(require_permission("po.receive"))):
    return db.execute(
        select(RcvShipmentHeader).where(
            RcvShipmentHeader.tenant_id == principal.tenant_id,
            RcvShipmentHeader.status == "PENDING_INSPECTION")
        .order_by(RcvShipmentHeader.received_date)
    ).scalars().all()


@router.get("/register/export")
def export_register(start: date, end: date, db: Session = Depends(get_db),
                    principal: Principal = Depends(require_permission("report.read"))):
    t = db.get(Tenant, principal.tenant_id)
    content = po_reports.build_receiving_register_workbook(
        db, principal.tenant_id, start, end, t.name if t else "HOA")
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="receiving_register_{start}_{end}.xlsx"'})


@router.get("/{receipt_id}", response_model=ReceiptDetail)
def get_receipt(receipt_id: uuid.UUID, db: Session = Depends(get_db),
                principal: Principal = Depends(require_permission("po.receive"))):
    return _get(db, receipt_id, principal.tenant_id)


@router.post("", response_model=ReceiptDetail, status_code=status.HTTP_201_CREATED)
def create_receipt(payload: ReceiptCreate, db: Session = Depends(get_db),
                   principal: Principal = Depends(require_permission("po.receive"))):
    try:
        header = receiving.create_receipt(
            db, tenant_id=principal.tenant_id, po_header_id=payload.po_header_id,
            received_date=payload.received_date, needs_inspection=payload.needs_inspection,
            packing_slip=payload.packing_slip, notes=payload.notes,
            lines=[ln.model_dump() for ln in payload.lines], created_by=principal.user.id)
    except ReceivingError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="CREATE", entity_type="RcvShipmentHeader", entity_id=header.id,
                 after={"receipt_number": header.receipt_number, "status": header.status})
    return header


@router.post("/{receipt_id}/accept", response_model=ReceiptDetail)
def accept(receipt_id: uuid.UUID, db: Session = Depends(get_db),
           principal: Principal = Depends(require_permission("po.receive"))):
    h = _get(db, receipt_id, principal.tenant_id)
    try:
        receiving.accept_receipt(db, h, principal.user.id)
    except ReceivingError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="ACCEPT", entity_type="RcvShipmentHeader", entity_id=h.id)
    return h


@router.post("/{receipt_id}/reject", response_model=ReceiptDetail)
def reject(receipt_id: uuid.UUID, db: Session = Depends(get_db),
           principal: Principal = Depends(require_permission("po.receive"))):
    h = _get(db, receipt_id, principal.tenant_id)
    try:
        receiving.reject_receipt(db, h, principal.user.id)
    except ReceivingError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="REJECT", entity_type="RcvShipmentHeader", entity_id=h.id)
    return h
