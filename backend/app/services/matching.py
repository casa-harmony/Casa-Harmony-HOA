"""PO ↔ AP matching engine: distribution inheritance, budget/tolerance checks,
quantity/amount billing, and reversal on cancellation.

When an AP invoice references a PO:
- Each invoice line that names a ``po_line_id`` inherits the PO line's KFF
  distributions (strings match exactly) unless the user supplied explicit ones.
- The invoice is checked against the PO's remaining dollar limit (within a
  configurable tolerance). Over-limit invoices are flagged + put on hold.
- On commit (approval/accounting) the billed quantities/amounts roll up to the
  PO distributions and header; cancellation reverses them so the PO is re-billable.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.notifications import ApMatchTolerance
from app.models.payables import ApInvoice, ApInvoiceDistribution, ApInvoiceLine
from app.models.procurement import PoDistribution, PoHeader, PoLine
from app.services import notifications

CENT = Decimal("0.01")
QTY = Decimal("0.0001")


def get_tolerance(db: Session, tenant_id: uuid.UUID) -> ApMatchTolerance:
    tol = db.execute(
        select(ApMatchTolerance).where(ApMatchTolerance.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if tol is None:
        from app.core.model_defaults import make_default
        tol = make_default(ApMatchTolerance, tenant_id=tenant_id)
    return tol


def po_remaining(po: PoHeader) -> Decimal:
    return Decimal(po.amount_limit) - Decimal(po.billed_amount)


def inherit_po_distributions(db: Session, tenant_id, inv_line: ApInvoiceLine, line_amount: Decimal):
    """Copy a PO line's distributions onto an invoice line, scaled to the line amount.
    Returns the list of created ApInvoiceDistribution (already added + flushed)."""
    po_dists = db.execute(
        select(PoDistribution).where(PoDistribution.po_line_id == inv_line.po_line_id)
        .order_by(PoDistribution.distribution_num)
    ).scalars().all()
    if not po_dists:
        return []
    po_line_total = sum((Decimal(d.amount) for d in po_dists), Decimal("0")) or Decimal("1")
    created = []
    running = Decimal("0")
    for j, pd in enumerate(po_dists, start=1):
        if j == len(po_dists):
            amt = (line_amount - running).quantize(CENT)  # last absorbs rounding
        else:
            amt = (line_amount * (Decimal(pd.amount) / po_line_total)).quantize(CENT)
            running += amt
        d = ApInvoiceDistribution(
            tenant_id=tenant_id, invoice_line_id=inv_line.id, distribution_num=j,
            code_combination_id=pd.code_combination_id, amount=amt, fund_value=pd.fund_value,
            po_distribution_id=pd.id,
        )
        db.add(d)
        created.append(d)
    db.flush()
    return created


def link_distributions_to_po(db: Session, invoice: ApInvoice) -> None:
    """For invoice distributions whose line is matched to a PO line, link each to the
    PO distribution with the same code combination (so billing/reversal can roll up)."""
    for line in invoice.lines:
        if not line.po_line_id:
            continue
        po_dists = db.execute(
            select(PoDistribution).where(PoDistribution.po_line_id == line.po_line_id)
        ).scalars().all()
        by_cc = {d.code_combination_id: d for d in po_dists}
        for d in line.distributions:
            if d.po_distribution_id is None and d.code_combination_id in by_cc:
                d.po_distribution_id = by_cc[d.code_combination_id].id
    db.flush()


def evaluate_match(db: Session, invoice: ApInvoice, *, staff_user_id=None) -> None:
    """Set match_status and place a hold if the invoice exceeds the PO limit."""
    if invoice.po_header_id is None:
        invoice.match_status = "NOT_MATCHED"
        return
    po = db.get(PoHeader, invoice.po_header_id)
    if po is None or po.tenant_id != invoice.tenant_id:
        from app.services.distributions import DistributionError
        raise DistributionError("Referenced PO not found")
    if po.status not in ("APPROVED", "PARTIALLY_BILLED", "FULLY_BILLED", "CLOSED"):
        from app.services.distributions import DistributionError
        raise DistributionError("Cannot match to a PO that is not approved")

    link_distributions_to_po(db, invoice)
    tol = get_tolerance(db, invoice.tenant_id)
    amt_tol = Decimal("1") + Decimal(tol.amount_tolerance_pct) / Decimal("100")
    allowed = po_remaining(po) * amt_tol

    # Amount control: cumulative billing must stay within the PO limit (+ tolerance).
    if Decimal(invoice.amount) > allowed + CENT:
        invoice.match_status = "MATCH_EXCEPTION"
        invoice.on_hold = True
        invoice.hold_reason = (
            f"Exceeds PO {po.po_number} remaining limit "
            f"(${po_remaining(po)}) beyond tolerance"
        )
        notifications.notify_budget_overrun(db, tenant_id=invoice.tenant_id, invoice=invoice,
                                            po=po, staff_user_id=staff_user_id)
        return

    # 3-way control (only when receipts are required): cumulative billed amount must
    # not exceed the accepted received amount (+ tolerance). 2-way flows are unaffected.
    if tol.require_receipt:
        from app.services.receiving import received_amount

        recv = received_amount(db, po.id)
        billable = recv * amt_tol
        projected = Decimal(po.billed_amount) + Decimal(invoice.amount)
        if projected > billable + CENT:
            invoice.match_status = "MATCH_EXCEPTION"
            invoice.on_hold = True
            invoice.hold_reason = (
                f"Awaiting receipt: PO {po.po_number} accepted-received ${recv} is "
                f"insufficient for cumulative billing ${projected}"
            )
            notifications.create_notification(
                db, tenant_id=invoice.tenant_id, category="HOLD",
                message=(f"Invoice {invoice.invoice_number} held — insufficient receipt on "
                         f"PO {po.po_number} (received ${recv}, billing ${projected})."),
                entity_type="ApInvoice", entity_id=invoice.id,
                recipient_user_id=staff_user_id)
            return

    invoice.match_status = "MATCHED"


def update_po_status(po: PoHeader) -> None:
    billed = Decimal(po.billed_amount)
    if billed <= 0:
        if po.status in ("PARTIALLY_BILLED", "FULLY_BILLED"):
            po.status = "APPROVED"
    elif billed >= Decimal(po.amount_limit) - CENT:
        po.status = "FULLY_BILLED"
    else:
        po.status = "PARTIALLY_BILLED"


def apply_billing(db: Session, invoice: ApInvoice) -> None:
    """Roll the invoice's matched amounts/quantities up to the PO (on commit)."""
    if invoice.po_header_id is None:
        return
    po = db.get(PoHeader, invoice.po_header_id)
    if po is None:
        return
    added = Decimal("0")
    for line in invoice.lines:
        for d in line.distributions:
            if not d.po_distribution_id:
                continue
            pd = db.get(PoDistribution, d.po_distribution_id)
            if pd is None:
                continue
            amt = Decimal(d.amount)
            pd.amount_billed = Decimal(pd.amount_billed) + amt
            if Decimal(pd.amount) > 0 and Decimal(pd.quantity_ordered) > 0:
                unit = Decimal(pd.amount) / Decimal(pd.quantity_ordered)
                if unit > 0:
                    pd.quantity_billed = (Decimal(pd.quantity_billed) + amt / unit).quantize(QTY)
            added += amt
    po.billed_amount = Decimal(po.billed_amount) + added
    update_po_status(po)
    db.flush()
    if added > 0:
        from app.services import encumbrance
        encumbrance.liquidate(db, po, added)


def reverse_billing(db: Session, invoice: ApInvoice) -> None:
    """Reverse billed amounts/quantities (on invoice cancellation) → PO re-billable."""
    if invoice.po_header_id is None:
        return
    po = db.get(PoHeader, invoice.po_header_id)
    if po is None:
        return
    removed = Decimal("0")
    for line in invoice.lines:
        for d in line.distributions:
            if not d.po_distribution_id:
                continue
            pd = db.get(PoDistribution, d.po_distribution_id)
            if pd is None:
                continue
            amt = Decimal(d.amount)
            pd.amount_billed = max(Decimal("0"), Decimal(pd.amount_billed) - amt)
            if Decimal(pd.amount) > 0 and Decimal(pd.quantity_ordered) > 0:
                unit = Decimal(pd.amount) / Decimal(pd.quantity_ordered)
                if unit > 0:
                    pd.quantity_billed = max(Decimal("0"),
                                             (Decimal(pd.quantity_billed) - amt / unit).quantize(QTY))
            removed += amt
    po.billed_amount = max(Decimal("0"), Decimal(po.billed_amount) - removed)
    update_po_status(po)
    db.flush()
    if removed > 0:
        from app.services import encumbrance
        encumbrance.reverse_liquidation(db, po, removed)


def run_budget_checks(db: Session, tenant_id: uuid.UUID, *, warn_pct: Decimal = Decimal("90")) -> int:
    """Periodic sweep: alert the Board for over-limit or near-limit POs. Dedupes
    against an existing unread notification for the same PO. Returns alerts raised."""
    from app.models.notifications import Notification

    pos = db.execute(
        select(PoHeader).where(PoHeader.tenant_id == tenant_id,
                               PoHeader.status.in_(("APPROVED", "PARTIALLY_BILLED", "FULLY_BILLED")))
    ).scalars().all()
    raised = 0
    for po in pos:
        limit = Decimal(po.amount_limit)
        if limit <= 0:
            continue
        used_pct = Decimal(po.billed_amount) / limit * Decimal("100")
        if used_pct < warn_pct:
            continue
        # Dedupe: skip if an unread alert already exists for this PO.
        existing = db.execute(
            select(Notification).where(
                Notification.tenant_id == tenant_id, Notification.entity_id == po.id,
                Notification.category == "BUDGET_OVERRUN", Notification.is_read.is_(False))
        ).first()
        if existing:
            continue
        over = used_pct >= Decimal("100")
        msg = (f"PO {po.po_number} is {used_pct.quantize(Decimal('0.1'))}% billed "
               f"(${po.billed_amount} of ${limit}). "
               + ("Limit reached." if over else "Approaching its limit."))
        notifications.create_notification(
            db, tenant_id=tenant_id, category="BUDGET_OVERRUN", message=msg,
            entity_type="PoHeader", entity_id=po.id, recipient_role_code="BOARD_MEMBER")
        raised += 1
    db.flush()
    return raised
