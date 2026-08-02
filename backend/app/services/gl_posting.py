"""General Ledger posting engine.

Enforces double-entry accounting: a journal must balance (Σ debits = Σ credits),
every line must reference an enabled, postable ``gl_code_combination`` in the same
tenant/structure. Subledgers (AR, AP, …) post through :func:`post_journal`.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.kff import GlCodeCombination
from app.models.subledger import ArInvoice, GlJournal, GlJournalLine

CENT = Decimal("0.01")


class PostingError(ValueError):
    pass


def next_journal_number(db: Session, tenant_id: uuid.UUID, prefix: str = "JE") -> str:
    count = db.execute(
        select(func.count(GlJournal.id)).where(GlJournal.tenant_id == tenant_id)
    ).scalar_one()
    return f"{prefix}-{count + 1:06d}"


def post_journal(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    structure_id: uuid.UUID,
    accounting_date: date,
    lines: list[dict],
    description: str | None = None,
    source: str = "Manual",
    created_by: uuid.UUID | None = None,
) -> GlJournal:
    if len(lines) < 2:
        raise PostingError("A journal requires at least two lines")
    from app.services.period_close import PeriodClosedError, assert_open
    try:
        assert_open(db, tenant_id, accounting_date)
    except PeriodClosedError as exc:
        raise PostingError(str(exc))

    total_debit = Decimal("0")
    total_credit = Decimal("0")
    validated: list[dict] = []

    for idx, ln in enumerate(lines, start=1):
        debit = Decimal(str(ln.get("debit") or 0)).quantize(CENT)
        credit = Decimal(str(ln.get("credit") or 0)).quantize(CENT)
        if debit < 0 or credit < 0:
            raise PostingError(f"Line {idx}: amounts must be non-negative")
        if (debit > 0) == (credit > 0):
            raise PostingError(f"Line {idx}: exactly one of debit/credit must be > 0")

        ccid = db.get(GlCodeCombination, ln["code_combination_id"])
        if ccid is None or ccid.tenant_id != tenant_id or ccid.structure_id != structure_id:
            raise PostingError(f"Line {idx}: invalid code combination for this ledger")
        if not ccid.enabled or not ccid.allow_posting:
            raise PostingError(
                f"Line {idx}: code combination {ccid.concatenated_segments} is not postable"
            )

        total_debit += debit
        total_credit += credit
        validated.append(
            {
                "line_number": idx,
                "code_combination_id": ccid.id,
                "debit": debit,
                "credit": credit,
                "description": ln.get("description"),
            }
        )

    if total_debit != total_credit:
        raise PostingError(
            f"Journal does not balance: debits {total_debit} != credits {total_credit}"
        )
    if total_debit == 0:
        raise PostingError("Journal total must be greater than zero")

    journal = GlJournal(
        tenant_id=tenant_id,
        structure_id=structure_id,
        journal_number=next_journal_number(db, tenant_id),
        description=description,
        source=source,
        status="POSTED",
        accounting_date=accounting_date,
        posted_at=accounting_date,
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(journal)
    db.flush()
    for v in validated:
        db.add(GlJournalLine(tenant_id=tenant_id, journal_id=journal.id, **v))
    db.flush()
    return journal


def post_ar_invoice(
    db: Session,
    *,
    invoice: ArInvoice,
    structure_id: uuid.UUID,
    receivable_ccid: uuid.UUID,
    income_ccid: uuid.UUID,
    created_by: uuid.UUID | None = None,
) -> GlJournal:
    """Post an HOA assessment invoice: Dr Assessments Receivable / Cr Income."""
    journal = post_journal(
        db,
        tenant_id=invoice.tenant_id,
        structure_id=structure_id,
        accounting_date=invoice.invoice_date,
        description=f"AR invoice {invoice.invoice_number}",
        source="AR",
        created_by=created_by,
        lines=[
            {"code_combination_id": receivable_ccid, "debit": invoice.amount, "credit": 0,
             "description": "Assessments Receivable"},
            {"code_combination_id": income_ccid, "debit": 0, "credit": invoice.amount,
             "description": "Assessment Income"},
        ],
    )
    invoice.gl_journal_id = journal.id
    invoice.status = "POSTED"
    db.flush()
    return journal
