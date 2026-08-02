"""Budget depth service: versions, period spread, approval, Budget-vs-Actual, and
budgetary control (advisory/absolute) against actuals + open PO commitments.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.budgeting import BudgetControlSettings, BudgetLine, BudgetVersion
from app.models.gl import GlBalance
from app.models.kff import GlCodeCombination
from app.models.procurement import PoDistribution, PoHeader, PoLine
from app.services.distributions import resolve_combination

CENT = Decimal("0.01")


class BudgetError(ValueError):
    pass


def create_version(db, *, tenant_id, name, fiscal_year, version_type="ORIGINAL", created_by=None):
    if db.execute(select(BudgetVersion).where(BudgetVersion.tenant_id == tenant_id,
                  BudgetVersion.name == name)).scalar_one_or_none():
        raise BudgetError("Budget version name already exists")
    v = BudgetVersion(tenant_id=tenant_id, name=name, fiscal_year=fiscal_year,
                      version_type=version_type, status="DRAFT",
                      created_by=created_by, updated_by=created_by)
    db.add(v)
    db.flush()
    return v


def _get_version(db, version_id, tenant_id) -> BudgetVersion:
    v = db.get(BudgetVersion, version_id)
    if v is None or v.tenant_id != tenant_id:
        raise BudgetError("Budget version not found")
    return v


def spread_line(db, *, tenant_id, version_id, code_combination_id, annual_amount,
                method="EVEN", per_period=None, created_by=None):
    """Create/replace the 12 monthly budget lines for a code combination.

    method EVEN splits annual_amount across 12 months (last absorbs rounding);
    method MANUAL uses per_period (list of 12 amounts)."""
    v = _get_version(db, version_id, tenant_id)
    if v.status == "APPROVED":
        raise BudgetError("Cannot edit an approved version; create a REVISED version")
    cc = resolve_combination(db, tenant_id, code_combination_id)
    # Clear existing lines for this combination.
    for old in db.execute(select(BudgetLine).where(
            BudgetLine.version_id == version_id,
            BudgetLine.code_combination_id == cc.id)).scalars().all():
        db.delete(old)
    db.flush()

    if method == "MANUAL":
        if not per_period or len(per_period) != 12:
            raise BudgetError("MANUAL spread requires 12 period amounts")
        amounts = [Decimal(str(x)).quantize(CENT) for x in per_period]
    else:
        annual = Decimal(str(annual_amount)).quantize(CENT)
        each = (annual / 12).quantize(CENT)
        amounts = [each] * 11 + [(annual - each * 11).quantize(CENT)]

    for period_num, amt in enumerate(amounts, start=1):
        db.add(BudgetLine(tenant_id=tenant_id, version_id=version_id, code_combination_id=cc.id,
                          fund_value=cc.fund_value, cost_center_value=cc.cost_center_value,
                          period_num=period_num, amount=amt,
                          created_by=created_by, updated_by=created_by))
    db.flush()
    return v


def submit_version(db, version_id, tenant_id):
    v = _get_version(db, version_id, tenant_id)
    if v.status not in ("DRAFT", "REJECTED"):
        raise BudgetError(f"Cannot submit a {v.status} version")
    v.status = "SUBMITTED"
    db.flush()
    return v


def approve_version(db, version_id, tenant_id, *, approve=True, make_controlling=False, user_id=None):
    from datetime import datetime, timezone
    v = _get_version(db, version_id, tenant_id)
    if v.status != "SUBMITTED":
        raise BudgetError("Only submitted versions can be approved/rejected")
    if not approve:
        v.status = "REJECTED"
        db.flush()
        return v
    v.status = "APPROVED"
    v.approved_by = user_id
    v.approved_at = datetime.now(timezone.utc)
    if make_controlling:
        for other in db.execute(select(BudgetVersion).where(
                BudgetVersion.tenant_id == tenant_id,
                BudgetVersion.is_controlling.is_(True))).scalars().all():
            other.is_controlling = False
        v.is_controlling = True
    db.flush()
    return v


def budget_vs_actual(db, tenant_id, version_id):
    """Per code combination: budgeted (version) vs actual (GL balances for the year)."""
    v = _get_version(db, version_id, tenant_id)
    budg = db.execute(
        select(BudgetLine.code_combination_id, func.coalesce(func.sum(BudgetLine.amount), 0))
        .where(BudgetLine.version_id == version_id)
        .group_by(BudgetLine.code_combination_id)
    ).all()
    budget_by_cc = {cc: Decimal(amt) for cc, amt in budg}

    rows = []
    cc_ids = set(budget_by_cc)
    # Actuals for the fiscal year from GL balances.
    actuals = db.execute(
        select(GlBalance.code_combination_id,
               func.coalesce(func.sum(GlBalance.period_net_dr - GlBalance.period_net_cr), 0))
        .where(GlBalance.tenant_id == tenant_id, GlBalance.period_year == v.fiscal_year)
        .group_by(GlBalance.code_combination_id)
    ).all()
    actual_by_cc = {cc: Decimal(net) for cc, net in actuals}
    cc_ids |= set(actual_by_cc)

    combos = {c.id: c for c in db.execute(select(GlCodeCombination).where(
        GlCodeCombination.id.in_(cc_ids))).scalars().all()} if cc_ids else {}
    for cc_id in cc_ids:
        cc = combos.get(cc_id)
        budget = budget_by_cc.get(cc_id, Decimal("0"))
        actual = actual_by_cc.get(cc_id, Decimal("0"))  # debit-positive (expense)
        rows.append({
            "code_combination_id": cc_id,
            "account": cc.concatenated_segments if cc else str(cc_id),
            "fund_value": cc.fund_value if cc else "",
            "cost_center": (cc.cost_center_value if cc else "") or "",
            "budget": budget, "actual": actual, "variance": budget - actual,
        })
    rows.sort(key=lambda r: (r["fund_value"], r["account"]))
    return rows


# --- Budgetary control -----------------------------------------------------
def get_control(db, tenant_id) -> BudgetControlSettings:
    s = db.execute(select(BudgetControlSettings).where(
        BudgetControlSettings.tenant_id == tenant_id)).scalar_one_or_none()
    if s is None:
        s = BudgetControlSettings(tenant_id=tenant_id, mode="NONE")
    return s


def _open_commitments(db, tenant_id, cc_id) -> Decimal:
    val = db.execute(
        select(func.coalesce(func.sum(PoDistribution.amount - PoDistribution.amount_billed), 0))
        .join(PoLine, PoLine.id == PoDistribution.po_line_id)
        .join(PoHeader, PoHeader.id == PoLine.po_header_id)
        .where(PoDistribution.tenant_id == tenant_id,
               PoDistribution.code_combination_id == cc_id,
               PoHeader.status.in_(("APPROVED", "PARTIALLY_BILLED")))
    ).scalar_one()
    return Decimal(val)


def check_budget(db, tenant_id, code_combination_id, additional: Decimal) -> dict:
    """Compare projected (actuals + open commitments + additional) against the
    controlling version's annual budget for a code combination."""
    s = get_control(db, tenant_id)
    result = {"mode": s.mode, "over": False, "budget": Decimal("0"),
              "consumed": Decimal("0"), "projected": Decimal("0")}
    if s.mode == "NONE" or s.controlling_version_id is None:
        return result
    v = db.get(BudgetVersion, s.controlling_version_id)
    if v is None:
        return result
    budget = Decimal(db.execute(
        select(func.coalesce(func.sum(BudgetLine.amount), 0)).where(
            BudgetLine.version_id == v.id,
            BudgetLine.code_combination_id == code_combination_id)).scalar_one())
    actual = Decimal(db.execute(
        select(func.coalesce(func.sum(GlBalance.period_net_dr - GlBalance.period_net_cr), 0))
        .where(GlBalance.tenant_id == tenant_id, GlBalance.period_year == v.fiscal_year,
               GlBalance.code_combination_id == code_combination_id)).scalar_one())
    commitments = _open_commitments(db, tenant_id, code_combination_id)
    consumed = actual + commitments
    projected = consumed + Decimal(additional)
    result.update(budget=budget, consumed=consumed, projected=projected,
                  over=(budget > 0 and projected > budget + CENT))
    return result


def enforce_po_budget(db, po, created_by=None) -> list[dict]:
    """At PO approval: check each distribution's combination against the controlling
    budget. ABSOLUTE mode raises on overage (blocks approval); ADVISORY notifies.
    The PO's own commitment is already reflected in open commitments, so additional=0."""
    s = get_control(db, po.tenant_id)
    if s.mode == "NONE" or s.controlling_version_id is None:
        return []
    cc_ids = set(db.execute(
        select(PoDistribution.code_combination_id)
        .join(PoLine, PoLine.id == PoDistribution.po_line_id)
        .where(PoLine.po_header_id == po.id)).scalars().all())
    overages = []
    for cc_id in cc_ids:
        res = check_budget(db, po.tenant_id, cc_id, Decimal("0"))
        if res["over"]:
            overages.append({"code_combination_id": cc_id, **res})
    if not overages:
        return []
    from app.services import notifications
    cc_map = {c.id: c for c in db.execute(select(GlCodeCombination).where(
        GlCodeCombination.id.in_([o["code_combination_id"] for o in overages]))).scalars().all()}
    detail = "; ".join(
        f"{cc_map[o['code_combination_id']].concatenated_segments}: "
        f"projected ${o['projected']} > budget ${o['budget']}" for o in overages)
    if s.mode == "ABSOLUTE":
        raise BudgetError(f"PO {po.po_number} exceeds budget — {detail}")
    # ADVISORY: alert the Board, allow the PO.
    notifications.create_notification(
        db, tenant_id=po.tenant_id, category="BUDGET_OVERRUN",
        message=f"PO {po.po_number} over budget (advisory): {detail}",
        entity_type="PoHeader", entity_id=po.id, recipient_role_code="BOARD_MEMBER")
    return overages
