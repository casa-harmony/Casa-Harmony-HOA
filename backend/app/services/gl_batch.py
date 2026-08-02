"""GL journal batch lifecycle: submit → approve → post to GL_BALANCES.

Posting is **idempotent** (a POSTED batch is skipped) and **transactional** (the
caller's session commits the whole batch atomically). Balances are accumulated by
period and code combination, carrying the fund value for fund-based reporting.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.gl import GlBalance, GlJeBatch, GlJeHeader, GlJeLine
from app.services.periods import period_parts


class BatchError(ValueError):
    pass


def compute_totals(db: Session, batch: GlJeBatch) -> tuple[Decimal, Decimal]:
    rows = db.execute(
        select(GlJeLine)
        .join(GlJeHeader, GlJeHeader.id == GlJeLine.header_id)
        .where(GlJeHeader.batch_id == batch.id)
    ).scalars().all()
    dr = sum((r.entered_dr for r in rows), Decimal("0"))
    cr = sum((r.entered_cr for r in rows), Decimal("0"))
    return dr, cr


def submit_batch(db: Session, batch: GlJeBatch) -> GlJeBatch:
    if batch.status not in ("DRAFT", "REJECTED"):
        raise BatchError(f"Cannot submit a batch in status {batch.status}")
    dr, cr = compute_totals(db, batch)
    if dr != cr:
        raise BatchError(f"Batch does not balance: debits {dr} != credits {cr}")
    if dr == 0:
        raise BatchError("Batch has no amounts")
    batch.control_total_dr = dr
    batch.control_total_cr = cr
    batch.status = "SUBMITTED"
    db.flush()
    return batch


def approve_batch(db: Session, batch: GlJeBatch, approver_id: uuid.UUID) -> GlJeBatch:
    if batch.status != "SUBMITTED":
        raise BatchError("Only SUBMITTED batches can be approved")
    dr, cr = compute_totals(db, batch)
    if dr != cr:
        raise BatchError(f"Batch does not balance: debits {dr} != credits {cr}")
    batch.status = "APPROVED"
    batch.approved_by = approver_id
    batch.approved_at = datetime.now(timezone.utc)
    db.flush()
    return batch


def _prior_end_balance(db: Session, tenant_id, ccid, pyear: int, pnum: int) -> Decimal:
    """Ending balance of the most recent period before (pyear, pnum) for a CCID."""
    prior = db.execute(
        select(GlBalance).where(
            GlBalance.tenant_id == tenant_id,
            GlBalance.code_combination_id == ccid,
            (GlBalance.period_year < pyear)
            | ((GlBalance.period_year == pyear) & (GlBalance.period_num < pnum)),
        ).order_by(GlBalance.period_year.desc(), GlBalance.period_num.desc())
    ).scalars().first()
    return prior.end_balance if prior else Decimal("0")


def _apply_lines_to_balances(db: Session, lines: list[GlJeLine], batch: GlJeBatch) -> None:
    """Aggregate all lines per code combination, then upsert one balance row each.

    Aggregating in memory (rather than per line) means a batch with many lines on
    the same account — e.g. a monthly assessment run crediting one income account
    across ~1000 invoices — updates a single GL_BALANCES row, avoiding duplicate
    inserts and keeping the post O(distinct combinations).
    """
    pname, pyear, pnum = period_parts(batch.accounting_date)
    agg: dict[uuid.UUID, dict] = {}
    for line in lines:
        a = agg.setdefault(line.code_combination_id, {
            "dr": Decimal("0"), "cr": Decimal("0"), "fund": line.fund_value,
        })
        a["dr"] += line.entered_dr
        a["cr"] += line.entered_cr

    for ccid, a in agg.items():
        bal = db.execute(
            select(GlBalance).where(
                GlBalance.tenant_id == batch.tenant_id,
                GlBalance.code_combination_id == ccid,
                GlBalance.period_name == pname,
            )
        ).scalar_one_or_none()
        if bal is None:
            begin = _prior_end_balance(db, batch.tenant_id, ccid, pyear, pnum)
            bal = GlBalance(
                tenant_id=batch.tenant_id, code_combination_id=ccid,
                period_name=pname, period_year=pyear, period_num=pnum,
                fund_value=a["fund"], begin_balance=begin,
                period_net_dr=Decimal("0"), period_net_cr=Decimal("0"),
            )
            db.add(bal)
            db.flush()
        bal.period_net_dr += a["dr"]
        bal.period_net_cr += a["cr"]


def post_batch(db: Session, batch: GlJeBatch) -> GlJeBatch:
    """Post an APPROVED batch to GL_BALANCES. Idempotent: POSTED batches no-op."""
    if batch.status == "POSTED":
        return batch
    if batch.status != "APPROVED":
        raise BatchError("Only APPROVED batches can be posted")
    # GL lock-down: never post into a closed period.
    from app.services.period_close import assert_open
    assert_open(db, batch.tenant_id, batch.accounting_date)

    lines = db.execute(
        select(GlJeLine)
        .join(GlJeHeader, GlJeHeader.id == GlJeLine.header_id)
        .where(GlJeHeader.batch_id == batch.id)
    ).scalars().all()
    _apply_lines_to_balances(db, lines, batch)

    for header in batch.headers:
        header.status = "POSTED"
    batch.status = "POSTED"
    batch.posted_at = datetime.now(timezone.utc)
    db.flush()
    return batch


def post_all_approved(db: Session, tenant_id: uuid.UUID) -> list[uuid.UUID]:
    """Nightly job: post every APPROVED batch for a tenant. Returns posted ids."""
    batches = db.execute(
        select(GlJeBatch).where(
            GlJeBatch.tenant_id == tenant_id, GlJeBatch.status == "APPROVED"
        )
    ).scalars().all()
    from app.services.period_close import PeriodClosedError
    posted = []
    for batch in batches:
        try:
            post_batch(db, batch)
        except PeriodClosedError:
            continue  # leave APPROVED; cannot post into a closed period
        posted.append(batch.id)
    return posted
