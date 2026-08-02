"""Accounts Payable service: invoice entry, KFF distributions, PO matching."""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.masters import ApSupplier, PaymentTerm
from app.models.payables import ApInvoice, ApInvoiceDistribution, ApInvoiceLine
from app.models.procurement import PoHeader
from app.services.distributions import DistributionError, resolve_combination
from app.services.distribution_sets import expand_set

CENT = Decimal("0.01")


def create_invoice(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    vendor_id: uuid.UUID,
    invoice_number: str,
    invoice_date: date,
    gl_date: date,
    lines: list[dict],
    po_header_id: uuid.UUID | None = None,
    description: str | None = None,
    tax_amount: Decimal | None = None,
    created_by: uuid.UUID | None = None,
) -> ApInvoice:
    vendor = db.get(ApSupplier, vendor_id)
    if vendor is None or vendor.tenant_id != tenant_id:
        raise DistributionError("Invalid vendor")
    if not lines:
        raise DistributionError("An invoice requires at least one line")

    # Derive the due date from the vendor's payment term, if assigned.
    due_date = None
    if vendor.payment_term_id:
        term = db.get(PaymentTerm, vendor.payment_term_id)
        if term is not None:
            due_date = invoice_date + timedelta(days=term.due_days)

    invoice = ApInvoice(
        tenant_id=tenant_id, invoice_number=invoice_number, vendor_id=vendor_id,
        po_header_id=po_header_id, invoice_date=invoice_date, gl_date=gl_date,
        due_date=due_date, amount=Decimal("0"),
        tax_amount=Decimal(str(tax_amount)).quantize(CENT) if tax_amount else Decimal("0"),
        description=description, status="DRAFT",
        approval_status="DRAFT", created_by=created_by, updated_by=created_by,
    )
    db.add(invoice)
    db.flush()

    total = Decimal("0")
    for i, ln in enumerate(lines, start=1):
        line_amount = Decimal(str(ln["amount"])).quantize(CENT)
        inv_line = ApInvoiceLine(
            tenant_id=tenant_id, invoice_id=invoice.id, line_num=i,
            po_line_id=ln.get("po_line_id"), description=ln.get("description"),
            amount=line_amount, created_by=created_by, updated_by=created_by,
        )
        db.add(inv_line)
        db.flush()

        line_dists = ln.get("distributions") or []
        if ln.get("distribution_set_id"):
            line_dists = expand_set(db, tenant_id, ln["distribution_set_id"], line_amount)

        # Matched line with no explicit distributions → inherit from the PO line.
        if not line_dists and ln.get("po_line_id"):
            from app.services import matching
            created = matching.inherit_po_distributions(db, tenant_id, inv_line, line_amount)
            if not created:
                raise DistributionError(f"Line {i}: PO line has no distributions to inherit")
            total += line_amount
            continue

        dist_total = Decimal("0")
        for j, d in enumerate(line_dists, start=1):
            amount = Decimal(str(d["amount"])).quantize(CENT)
            cc = resolve_combination(db, tenant_id, d["code_combination_id"])
            db.add(ApInvoiceDistribution(
                tenant_id=tenant_id, invoice_line_id=inv_line.id, distribution_num=j,
                code_combination_id=cc.id, amount=amount, fund_value=cc.fund_value,
                created_by=created_by, updated_by=created_by,
            ))
            dist_total += amount
        if dist_total != line_amount:
            raise DistributionError(
                f"Line {i}: distributions {dist_total} must equal line amount {line_amount}"
            )
        total += line_amount

    invoice.amount = total
    from app.services import matching
    matching.evaluate_match(db, invoice, staff_user_id=created_by)
    db.flush()
    return invoice
