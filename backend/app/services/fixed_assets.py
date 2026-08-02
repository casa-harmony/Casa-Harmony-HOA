"""Fixed Assets service: asset master, straight-line depreciation (GL draft batch),
disposal with gain/loss, depreciation forecast, and reserve study tracking.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.fixed_assets import (
    FaAsset,
    FaDepreciationEntry,
    ReserveComponent,
    ReserveStudy,
)
from app.models.gl import GlJeLine
from app.services import subledger_accounting as sla
from app.services.distributions import resolve_combination
from app.services.periods import period_name, period_parts

CENT = Decimal("0.01")
_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


class AssetError(ValueError):
    pass


def _parse_period(pname: str) -> tuple[int, int]:
    mon, yr = pname.split("-")
    return int(yr), _MONTHS.index(mon.upper()) + 1


def next_asset_number(db: Session, tenant_id) -> str:
    n = db.execute(select(func.count(FaAsset.id)).where(FaAsset.tenant_id == tenant_id)).scalar_one()
    return f"FA-{n + 1:05d}"


def create_asset(db: Session, *, tenant_id, name, cost, in_service_date: date, life_months,
                 asset_combination_id, accum_depr_combination_id=None, depr_expense_combination_id=None,
                 salvage_value=0, category=None, description=None, fund_value=None,
                 created_by=None) -> FaAsset:
    cc = resolve_combination(db, tenant_id, asset_combination_id)
    if life_months <= 0:
        raise AssetError("Life (months) must be positive")
    if Decimal(str(cost)) <= 0:
        raise AssetError("Cost must be positive")
    for opt in (accum_depr_combination_id, depr_expense_combination_id):
        if opt:
            resolve_combination(db, tenant_id, opt)
    asset = FaAsset(
        tenant_id=tenant_id, asset_number=next_asset_number(db, tenant_id), name=name,
        description=description, category=category,
        fund_value=fund_value or cc.fund_value, cost_center_value=cc.cost_center_value,
        asset_combination_id=cc.id, accum_depr_combination_id=accum_depr_combination_id,
        depr_expense_combination_id=depr_expense_combination_id,
        cost=Decimal(str(cost)).quantize(CENT), salvage_value=Decimal(str(salvage_value)).quantize(CENT),
        in_service_date=in_service_date, life_months=life_months, status="ACTIVE",
        created_by=created_by, updated_by=created_by)
    db.add(asset)
    db.flush()
    return asset


def monthly_depreciation(asset: FaAsset) -> Decimal:
    base = Decimal(asset.cost) - Decimal(asset.salvage_value)
    if base <= 0 or asset.life_months <= 0:
        return Decimal("0")
    return (base / asset.life_months).quantize(CENT)


def depreciation_forecast(asset: FaAsset) -> list[dict]:
    """Remaining straight-line schedule from current accumulated depreciation."""
    base = Decimal(asset.cost) - Decimal(asset.salvage_value)
    monthly = monthly_depreciation(asset)
    out = []
    accum = Decimal(asset.accumulated_depreciation)
    y, m = asset.in_service_date.year, asset.in_service_date.month
    # Advance to the first not-yet-depreciated month.
    months_done = int((accum / monthly)) if monthly > 0 else 0
    for _ in range(months_done):
        m += 1
        if m > 12:
            m, y = 1, y + 1
    while accum < base and len(out) < asset.life_months + 1:
        amt = min(monthly, base - accum)
        if amt <= 0:
            break
        accum += amt
        out.append({"period": f"{_MONTHS[m - 1]}-{y}", "amount": amt, "accumulated": accum})
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


def run_depreciation(db: Session, tenant_id, pname: str, created_by=None) -> dict:
    """Depreciate all eligible active assets for a period in one draft GL batch."""
    pyear, pnum = _parse_period(pname)
    period_end = date(pyear, pnum, 28)
    structure = sla.get_primary_structure(db, tenant_id)
    assets = db.execute(select(FaAsset).where(
        FaAsset.tenant_id == tenant_id, FaAsset.status == "ACTIVE")).scalars().all()

    run_date = date(pyear, pnum, 1)
    batch = header = None
    line_num = 0
    total = Decimal("0")
    count = 0
    for a in assets:
        if a.in_service_date > period_end:
            continue
        if not (a.depr_expense_combination_id and a.accum_depr_combination_id):
            continue
        base = Decimal(a.cost) - Decimal(a.salvage_value)
        remaining = base - Decimal(a.accumulated_depreciation)
        if remaining <= 0:
            a.status = "FULLY_DEPRECIATED"
            continue
        # Idempotent: skip if already depreciated for this period.
        if db.execute(select(FaDepreciationEntry).where(
                FaDepreciationEntry.asset_id == a.id,
                FaDepreciationEntry.period_name == pname)).first():
            continue
        amt = min(monthly_depreciation(a), remaining)
        if amt <= 0:
            continue
        if batch is None:
            from app.models.gl import GlJeBatch
            seq = db.execute(select(func.count(GlJeBatch.id)).where(
                GlJeBatch.tenant_id == tenant_id, GlJeBatch.source == "FA")).scalar_one() + 1
            bname = f"Depreciation {pname} #{seq}"
            batch = sla._new_batch(db, tenant_id, "FA", run_date, bname, created_by)
            header = sla._add_header(db, batch, structure.id, "Depreciation", "Fixed Assets",
                                     run_date, "FA_DEPRECIATION", None, bname, created_by)
        line_num += 1
        db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=line_num,
                        code_combination_id=a.depr_expense_combination_id, entered_dr=amt, entered_cr=0,
                        fund_value=a.fund_value, description=f"Depreciation {a.asset_number}",
                        created_by=created_by, updated_by=created_by))
        line_num += 1
        db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=line_num,
                        code_combination_id=a.accum_depr_combination_id, entered_dr=0, entered_cr=amt,
                        fund_value=a.fund_value, description=f"Accum depreciation {a.asset_number}",
                        created_by=created_by, updated_by=created_by))
        db.add(FaDepreciationEntry(tenant_id=tenant_id, asset_id=a.id, period_name=pname,
                                   period_year=pyear, period_num=pnum, amount=amt,
                                   je_header_id=header.id, created_by=created_by, updated_by=created_by))
        a.accumulated_depreciation = (Decimal(a.accumulated_depreciation) + amt).quantize(CENT)
        if a.accumulated_depreciation >= base:
            a.status = "FULLY_DEPRECIATED"
        total += amt
        count += 1
    if batch is not None:
        db.flush()
        db.refresh(batch)
        sla._set_control_totals(batch)
    db.flush()
    return {"period": pname, "assets_depreciated": count, "total": total,
            "batch_id": batch.id if batch else None}


def dispose_asset(db: Session, asset: FaAsset, *, disposal_date: date, proceeds=0,
                  cash_combination_id=None, gain_loss_combination_id=None, created_by=None) -> dict:
    if asset.status == "DISPOSED":
        raise AssetError("Asset already disposed")
    structure = sla.get_primary_structure(db, asset.tenant_id)
    cost = Decimal(asset.cost)
    accum = Decimal(asset.accumulated_depreciation)
    proceeds = Decimal(str(proceeds)).quantize(CENT)
    remainder = (cost - accum - proceeds).quantize(CENT)  # >0 loss, <0 gain

    batch = sla._new_batch(db, asset.tenant_id, "FA", disposal_date,
                           f"Disposal {asset.asset_number}", created_by)
    header = sla._add_header(db, batch, structure.id, "Disposal", "Fixed Assets",
                             disposal_date, "FA_DISPOSAL", asset.id,
                             f"Disposal {asset.asset_number}", created_by)
    n = 0

    def line(cc_id, dr, cr, desc):
        nonlocal n
        n += 1
        db.add(GlJeLine(tenant_id=asset.tenant_id, header_id=header.id, line_num=n,
                        code_combination_id=cc_id, entered_dr=dr, entered_cr=cr,
                        fund_value=asset.fund_value, description=desc,
                        created_by=created_by, updated_by=created_by))

    line(asset.asset_combination_id, Decimal("0"), cost, "Retire asset cost")
    if accum > 0 and asset.accum_depr_combination_id:
        line(asset.accum_depr_combination_id, accum, Decimal("0"), "Reverse accumulated depreciation")
    if proceeds > 0:
        if not cash_combination_id:
            raise AssetError("Cash account required when proceeds are received")
        cc = resolve_combination(db, asset.tenant_id, cash_combination_id)
        line(cc.id, proceeds, Decimal("0"), "Disposal proceeds")
    if remainder != 0:
        if not gain_loss_combination_id:
            raise AssetError("Gain/Loss account required to balance the disposal")
        gl = resolve_combination(db, asset.tenant_id, gain_loss_combination_id)
        if remainder > 0:
            line(gl.id, remainder, Decimal("0"), "Loss on disposal")
        else:
            line(gl.id, Decimal("0"), -remainder, "Gain on disposal")
    db.flush()
    db.refresh(batch)
    sla._set_control_totals(batch)
    asset.status = "DISPOSED"
    asset.disposal_date = disposal_date
    asset.disposal_proceeds = proceeds
    db.flush()
    return {"batch_id": batch.id, "loss": remainder if remainder > 0 else Decimal("0"),
            "gain": -remainder if remainder < 0 else Decimal("0")}


# --- Reserve studies -------------------------------------------------------
def create_study(db, *, tenant_id, name, study_year, notes=None, created_by=None) -> ReserveStudy:
    s = ReserveStudy(tenant_id=tenant_id, name=name, study_year=study_year, notes=notes,
                     status="ACTIVE", created_by=created_by, updated_by=created_by)
    db.add(s)
    db.flush()
    return s


def add_component(db, *, tenant_id, study_id, name, **kw) -> ReserveComponent:
    study = db.get(ReserveStudy, study_id)
    if study is None or study.tenant_id != tenant_id:
        raise AssetError("Reserve study not found")
    c = ReserveComponent(tenant_id=tenant_id, study_id=study_id, name=name,
                         created_by=kw.get("created_by"), updated_by=kw.get("created_by"),
                         category=kw.get("category"), fund_value=kw.get("fund_value", "RESV"),
                         asset_id=kw.get("asset_id"),
                         useful_life_years=kw.get("useful_life_years"),
                         remaining_life_years=kw.get("remaining_life_years"),
                         replacement_cost=Decimal(str(kw.get("replacement_cost", 0))).quantize(CENT),
                         planned_year=kw.get("planned_year"),
                         planned_amount=Decimal(str(kw.get("planned_amount", 0))).quantize(CENT))
    db.add(c)
    db.flush()
    return c


def reserve_vs_actual(db, tenant_id, study_id) -> list[dict]:
    """Planned reserve spend vs actual asset additions, by component (fund + planned year)."""
    comps = db.execute(select(ReserveComponent).where(
        ReserveComponent.tenant_id == tenant_id,
        ReserveComponent.study_id == study_id)).scalars().all()
    out = []
    for c in comps:
        actual = Decimal("0")
        if c.planned_year:
            actual = Decimal(db.execute(
                select(func.coalesce(func.sum(FaAsset.cost), 0)).where(
                    FaAsset.tenant_id == tenant_id, FaAsset.fund_value == c.fund_value,
                    func.extract("year", FaAsset.in_service_date) == c.planned_year)).scalar_one())
        out.append({"component": c.name, "category": c.category or "", "fund_value": c.fund_value,
                    "planned_year": c.planned_year, "planned_amount": Decimal(c.planned_amount),
                    "actual": actual, "variance": Decimal(c.planned_amount) - actual})
    return out
