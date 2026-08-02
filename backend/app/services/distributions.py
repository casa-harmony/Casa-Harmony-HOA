"""Distribution validation shared by PO and AP.

Enforces HOA fund accounting: every distribution's account combination MUST carry
a Fund segment value (``fund_value``). Also verifies the combination belongs to the
tenant, is enabled, and is postable.
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.kff import GlCodeCombination


class DistributionError(ValueError):
    pass


def resolve_combination(
    db: Session, tenant_id: uuid.UUID, code_combination_id: uuid.UUID
) -> GlCodeCombination:
    cc = db.get(GlCodeCombination, code_combination_id)
    if cc is None or cc.tenant_id != tenant_id:
        raise DistributionError("Invalid account code combination")
    if not cc.enabled or not cc.allow_posting:
        raise DistributionError(
            f"Account {cc.concatenated_segments} is disabled or not postable"
        )
    # Fund segment is mandatory for every HOA distribution.
    if not cc.fund_value:
        raise DistributionError(
            f"Account {cc.concatenated_segments} has no Fund segment value; "
            "the Fund segment is mandatory on all distributions"
        )
    return cc
