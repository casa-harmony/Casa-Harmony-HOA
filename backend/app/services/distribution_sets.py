"""Distribution Set logic: validate percentages and expand a set to amounts.

A set's lines must total 100%. Expanding splits a target amount across the lines
by percentage, with the final line absorbing any rounding remainder so the parts
always sum exactly to the amount.
"""
from __future__ import annotations

import uuid
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.distribution_set import DistributionSet, DistributionSetLine

CENT = Decimal("0.01")


class DistributionSetError(ValueError):
    pass


def validate_percentages(percents: list[Decimal]) -> None:
    total = sum((Decimal(str(p)) for p in percents), Decimal("0"))
    if total != Decimal("100"):
        raise DistributionSetError(f"Distribution set percentages must total 100 (got {total})")


def expand_set(db: Session, tenant_id: uuid.UUID, set_id: uuid.UUID, amount: Decimal) -> list[dict]:
    """Return [{code_combination_id, amount}] splitting `amount` by the set's lines."""
    dset = db.get(DistributionSet, set_id)
    if dset is None or dset.tenant_id != tenant_id:
        raise DistributionSetError("Distribution set not found")
    if not dset.active:
        raise DistributionSetError(f"Distribution set '{dset.name}' is inactive")
    lines = db.execute(
        select(DistributionSetLine).where(DistributionSetLine.distribution_set_id == set_id)
        .order_by(DistributionSetLine.line_num)
    ).scalars().all()
    if not lines:
        raise DistributionSetError("Distribution set has no lines")
    validate_percentages([ln.percent for ln in lines])

    amount = Decimal(str(amount)).quantize(CENT)
    out: list[dict] = []
    allocated = Decimal("0")
    for i, ln in enumerate(lines):
        if i == len(lines) - 1:
            part = amount - allocated  # last line absorbs the rounding remainder
        else:
            part = (amount * ln.percent / Decimal("100")).quantize(CENT, rounding=ROUND_HALF_UP)
        allocated += part
        out.append({"code_combination_id": ln.code_combination_id, "amount": part})
    return out
