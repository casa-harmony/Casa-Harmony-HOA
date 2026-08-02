"""Purchase Order service: build PO with lines + KFF distributions."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.masters import ApSupplier
from app.models.procurement import PoDistribution, PoHeader, PoLine
from app.services.distributions import DistributionError, resolve_combination
from app.services.distribution_sets import expand_set

CENT = Decimal("0.01")


def create_po(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    vendor_id: uuid.UUID,
    order_date: date,
    lines: list[dict],
    description: str | None = None,
    document_type: str = "STANDARD",
    start_date: date | None = None,
    end_date: date | None = None,
    amount_limit: Decimal | None = None,
    created_by: uuid.UUID | None = None,
) -> PoHeader:
    vendor = db.get(ApSupplier, vendor_id)
    if vendor is None or vendor.tenant_id != tenant_id:
        raise DistributionError("Invalid vendor")
    if not lines:
        raise DistributionError("A PO requires at least one line")
    if start_date and end_date and end_date < start_date:
        raise DistributionError("Contract end date cannot precede the start date")

    header = PoHeader(
        tenant_id=tenant_id, po_number=_next_number(db, tenant_id),
        vendor_id=vendor_id, order_date=order_date, description=description,
        document_type=document_type, start_date=start_date, end_date=end_date,
        status="INCOMPLETE", approval_status="DRAFT",
        created_by=created_by, updated_by=created_by,
    )
    db.add(header)
    db.flush()

    total = Decimal("0")
    for i, ln in enumerate(lines, start=1):
        qty = Decimal(str(ln.get("quantity", 1)))
        price = Decimal(str(ln.get("unit_price", 0))).quantize(CENT)
        line_amount = (qty * price).quantize(CENT)
        po_line = PoLine(
            tenant_id=tenant_id, po_header_id=header.id, line_num=i,
            item_description=ln["item_description"], quantity=qty, unit_price=price,
            line_amount=line_amount, created_by=created_by, updated_by=created_by,
        )
        db.add(po_line)
        db.flush()

        # A line may supply explicit distributions OR a distribution_set_id to expand.
        line_dists = ln.get("distributions") or []
        if ln.get("distribution_set_id"):
            line_dists = expand_set(db, tenant_id, ln["distribution_set_id"], line_amount)

        dist_total = Decimal("0")
        for j, d in enumerate(line_dists, start=1):
            amount = Decimal(str(d["amount"])).quantize(CENT)
            cc = resolve_combination(db, tenant_id, d["code_combination_id"])
            # Distribute the line quantity proportionally to each distribution's amount.
            qty_ordered = (qty * (amount / line_amount)).quantize(Decimal("0.0001")) if line_amount else Decimal("0")
            db.add(PoDistribution(
                tenant_id=tenant_id, po_line_id=po_line.id, distribution_num=j,
                code_combination_id=cc.id, amount=amount, fund_value=cc.fund_value,
                quantity_ordered=qty_ordered,
                created_by=created_by, updated_by=created_by,
            ))
            dist_total += amount
        if dist_total != line_amount:
            raise DistributionError(
                f"Line {i}: distributions {dist_total} must equal line amount {line_amount}"
            )
        total += line_amount

    header.amount = total
    # Amount limit defaults to the line total; for a CONTRACT it may be set higher.
    limit = Decimal(str(amount_limit)).quantize(CENT) if amount_limit else total
    if limit < total:
        raise DistributionError(
            f"Amount limit {limit} cannot be below the line total {total}"
        )
    header.amount_limit = limit
    db.flush()
    return header


def _next_number(db: Session, tenant_id: uuid.UUID) -> str:
    from sqlalchemy import func, select

    n = db.execute(
        select(func.count(PoHeader.id)).where(PoHeader.tenant_id == tenant_id)
    ).scalar_one()
    return f"PO-{n + 1:06d}"
