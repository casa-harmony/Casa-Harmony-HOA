"""Receiving service: record receipts against PO lines, fan out to PO-distribution
transactions, run inspection/acceptance, and keep ``quantity_received`` in sync.

Only **accepted** transactions credit the PO; the accepted received amount is what
3-way matching checks an invoice against (see ``services.matching``).
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.procurement import PoDistribution, PoHeader, PoLine
from app.models.receiving import RcvShipmentHeader, RcvShipmentLine, RcvTransaction
from app.services import notifications

CENT = Decimal("0.01")
QTY = Decimal("0.0001")


class ReceivingError(ValueError):
    pass


def next_receipt_number(db: Session, tenant_id: uuid.UUID) -> str:
    n = db.execute(
        select(func.count(RcvShipmentHeader.id)).where(RcvShipmentHeader.tenant_id == tenant_id)
    ).scalar_one()
    return f"RCV-{n + 1:06d}"


def received_amount(db: Session, po_header_id: uuid.UUID) -> Decimal:
    """Total accepted received amount for a PO (the 3-way matching ceiling)."""
    val = db.execute(
        select(func.coalesce(func.sum(RcvTransaction.amount), 0))
        .join(RcvShipmentLine, RcvShipmentLine.id == RcvTransaction.shipment_line_id)
        .join(RcvShipmentHeader, RcvShipmentHeader.id == RcvShipmentLine.header_id)
        .where(RcvShipmentHeader.po_header_id == po_header_id,
               RcvTransaction.accepted.is_(True))
    ).scalar_one()
    return Decimal(val)


def _credit_distributions(db: Session, header: RcvShipmentHeader) -> None:
    """Credit pending (not-yet-accepted) transactions to their PO distributions, once.

    Queries rows directly (not via relationships) so it works immediately after a
    receipt is created in the same transaction. Flipping ``accepted`` False→True is
    the idempotency guard against double-crediting.
    """
    db.flush()  # ensure pending receipt lines/transactions are persisted before querying
    lines = db.execute(
        select(RcvShipmentLine).where(RcvShipmentLine.header_id == header.id)
    ).scalars().all()
    for line in lines:
        line.accepted = True
        txns = db.execute(
            select(RcvTransaction).where(
                RcvTransaction.shipment_line_id == line.id,
                RcvTransaction.accepted.is_(False))
        ).scalars().all()
        for txn in txns:
            txn.accepted = True
            pd = db.get(PoDistribution, txn.po_distribution_id)
            if pd is not None:
                pd.quantity_received = (Decimal(pd.quantity_received) + Decimal(txn.quantity)).quantize(QTY)
    db.flush()


def create_receipt(
    db: Session, *, tenant_id: uuid.UUID, po_header_id: uuid.UUID, received_date: date,
    lines: list[dict], needs_inspection: bool = False, packing_slip: str | None = None,
    notes: str | None = None, created_by: uuid.UUID | None = None,
) -> RcvShipmentHeader:
    """lines: [{po_line_id, quantity, amount?}]. amount defaults to qty * unit_price."""
    po = db.get(PoHeader, po_header_id)
    if po is None or po.tenant_id != tenant_id:
        raise ReceivingError("PO not found")
    if po.status not in ("APPROVED", "PARTIALLY_BILLED", "FULLY_BILLED"):
        raise ReceivingError("Can only receive against an approved PO")
    if not lines:
        raise ReceivingError("A receipt requires at least one line")

    header = RcvShipmentHeader(
        tenant_id=tenant_id, receipt_number=next_receipt_number(db, tenant_id),
        po_header_id=po_header_id, received_date=received_date, packing_slip=packing_slip,
        notes=notes, needs_inspection=needs_inspection,
        status="PENDING_INSPECTION" if needs_inspection else "ACCEPTED",
        created_by=created_by, updated_by=created_by,
    )
    db.add(header)
    db.flush()

    alerts: list[str] = []
    for i, ln in enumerate(lines, start=1):
        po_line = db.get(PoLine, ln["po_line_id"])
        if po_line is None or po_line.po_header_id != po_header_id:
            raise ReceivingError("PO line does not belong to this PO")
        qty = Decimal(str(ln["quantity"])).quantize(QTY)
        if qty <= 0:
            raise ReceivingError("Received quantity must be positive")
        line_amount = (Decimal(str(ln["amount"])).quantize(CENT) if ln.get("amount") is not None
                       else (qty * Decimal(po_line.unit_price)).quantize(CENT))

        rline = RcvShipmentLine(
            tenant_id=tenant_id, header_id=header.id, line_num=i, po_line_id=po_line.id,
            quantity_received=qty, amount_received=line_amount, accepted=False,
            created_by=created_by, updated_by=created_by,
        )
        db.add(rline)
        db.flush()

        # Fan out across the PO line's distributions, proportional to amount.
        po_dists = db.execute(
            select(PoDistribution).where(PoDistribution.po_line_id == po_line.id)
            .order_by(PoDistribution.distribution_num)
        ).scalars().all()
        po_line_total = sum((Decimal(d.amount) for d in po_dists), Decimal("0")) or Decimal("1")
        run_amt = run_qty = Decimal("0")
        for j, pd in enumerate(po_dists, start=1):
            if j == len(po_dists):
                amt, q = (line_amount - run_amt).quantize(CENT), (qty - run_qty).quantize(QTY)
            else:
                frac = Decimal(pd.amount) / po_line_total
                amt = (line_amount * frac).quantize(CENT)
                q = (qty * frac).quantize(QTY)
                run_amt += amt
                run_qty += q
            db.add(RcvTransaction(
                tenant_id=tenant_id, shipment_line_id=rline.id, po_distribution_id=pd.id,
                txn_type="RECEIVE", quantity=q, amount=amt, fund_value=pd.fund_value,
                accepted=False, created_by=created_by, updated_by=created_by,
            ))

        # Discrepancy / partial-receipt detection (vs ordered).
        ordered_q = Decimal(po_line.quantity)
        already = db.execute(
            select(func.coalesce(func.sum(RcvShipmentLine.quantity_received), 0))
            .join(RcvShipmentHeader, RcvShipmentHeader.id == RcvShipmentLine.header_id)
            .where(RcvShipmentHeader.po_header_id == po_header_id,
                   RcvShipmentLine.po_line_id == po_line.id)
        ).scalar_one()
        cum = Decimal(already)
        if cum > ordered_q + QTY:
            alerts.append(f"line {i}: over-received ({cum} > ordered {ordered_q})")
        elif cum < ordered_q:
            alerts.append(f"line {i}: partial receipt ({cum} of {ordered_q})")

    if not needs_inspection:
        _credit_distributions(db, header)

    if alerts:
        notifications.create_notification(
            db, tenant_id=tenant_id, category="INFO",
            message=f"Receipt {header.receipt_number} on PO {po.po_number}: " + "; ".join(alerts),
            entity_type="RcvShipmentHeader", entity_id=header.id,
            recipient_user_id=created_by)
    db.flush()
    return header


def accept_receipt(db: Session, header: RcvShipmentHeader, user_id: uuid.UUID | None) -> None:
    from datetime import datetime, timezone
    if header.status == "ACCEPTED":
        return
    if header.status == "REJECTED":
        raise ReceivingError("Receipt already rejected")
    header.status = "ACCEPTED"
    header.inspected_by = user_id
    header.inspected_at = datetime.now(timezone.utc)
    _credit_distributions(db, header)


def reject_receipt(db: Session, header: RcvShipmentHeader, user_id: uuid.UUID | None) -> None:
    from datetime import datetime, timezone
    if header.status == "ACCEPTED":
        raise ReceivingError("Cannot reject an already-accepted receipt")
    header.status = "REJECTED"
    header.inspected_by = user_id
    header.inspected_at = datetime.now(timezone.utc)
    db.flush()
