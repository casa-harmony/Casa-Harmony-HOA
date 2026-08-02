"""Period close & GL lock-down + year-end roll-forward.

Closing a period posts any remaining APPROVED batches, blocks if draft/submitted
batches remain, then marks the period CLOSED. Once CLOSED, posting (and back-posting)
to that period is rejected. Year-end roll-forward builds a draft closing batch that
zeroes income/expense into a Retained Earnings / Fund Balance account per Fund.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.gl import GlBalance, GlJeBatch, GlJeLine
from app.models.kff import GlCodeCombination
from app.models.period import AccountingPeriod
from app.services import subledger_accounting as sla
from app.services.periods import period_name, period_parts

CENT = Decimal("0.01")


class PeriodError(ValueError):
    pass


class PeriodClosedError(PeriodError):
    pass


def _month_bounds(year: int, num: int) -> tuple[date, date]:
    start = date(year, num, 1)
    end = date(year + 1, 1, 1) if num == 12 else date(year, num + 1, 1)
    from datetime import timedelta
    return start, end - timedelta(days=1)


def ensure_period(db: Session, tenant_id, pname: str, pyear: int, pnum: int) -> AccountingPeriod:
    p = db.execute(select(AccountingPeriod).where(
        AccountingPeriod.tenant_id == tenant_id, AccountingPeriod.period_name == pname
    )).scalar_one_or_none()
    if p is None:
        start, end = _month_bounds(pyear, pnum)
        p = AccountingPeriod(tenant_id=tenant_id, period_name=pname, period_year=pyear,
                             period_num=pnum, start_date=start, end_date=end, status="OPEN")
        db.add(p)
        db.flush()
    return p


def get_status(db: Session, tenant_id, pname: str) -> str:
    p = db.execute(select(AccountingPeriod).where(
        AccountingPeriod.tenant_id == tenant_id, AccountingPeriod.period_name == pname
    )).scalar_one_or_none()
    return p.status if p else "OPEN"  # no row → implicitly open (backward compatible)


def assert_open(db: Session, tenant_id, gl_date: date) -> None:
    """Raise if the period covering gl_date is CLOSED."""
    if get_status(db, tenant_id, period_name(gl_date)) == "CLOSED":
        raise PeriodClosedError(
            f"Accounting period {period_name(gl_date)} is closed; posting is not allowed"
        )


def set_status(db: Session, tenant_id, pname: str, status: str, user_id=None) -> AccountingPeriod:
    from datetime import datetime, timezone
    pn, py, pnum = pname, *(_parse(pname))
    p = ensure_period(db, tenant_id, pname, py, pnum)
    p.status = status
    if status == "CLOSED":
        p.closed_by = user_id
        p.closed_at = datetime.now(timezone.utc)
    else:
        p.closed_by = None
        p.closed_at = None
    db.flush()
    return p


_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def _parse(pname: str) -> tuple[int, int]:
    """'FEB-2026' -> (2026, 2)."""
    mon, yr = pname.split("-")
    return int(yr), _MONTHS.index(mon.upper()) + 1


def close_period(db: Session, tenant_id, pname: str, user_id=None) -> AccountingPeriod:
    from app.services.gl_batch import post_batch
    # 1) Post any remaining APPROVED batches in this period (final GL run).
    approved = db.execute(select(GlJeBatch).where(
        GlJeBatch.tenant_id == tenant_id, GlJeBatch.period_name == pname,
        GlJeBatch.status == "APPROVED")).scalars().all()
    for b in approved:
        post_batch(db, b)
    # 2) Block close if unfinished (draft/submitted) batches remain in the period.
    pending = db.execute(select(func.count(GlJeBatch.id)).where(
        GlJeBatch.tenant_id == tenant_id, GlJeBatch.period_name == pname,
        GlJeBatch.status.in_(("DRAFT", "SUBMITTED")))).scalar_one()
    if pending:
        raise PeriodError(
            f"Cannot close {pname}: {pending} draft/submitted GL batch(es) still open")
    return set_status(db, tenant_id, pname, "CLOSED", user_id)


def open_period(db, tenant_id, pname, user_id=None):
    return set_status(db, tenant_id, pname, "OPEN", user_id)


def reopen_period(db, tenant_id, pname, user_id=None):
    return set_status(db, tenant_id, pname, "OPEN", user_id)


def list_periods(db: Session, tenant_id) -> list[AccountingPeriod]:
    return db.execute(select(AccountingPeriod).where(
        AccountingPeriod.tenant_id == tenant_id)
        .order_by(AccountingPeriod.period_year, AccountingPeriod.period_num)).scalars().all()


def _is_income(cc: GlCodeCombination) -> bool:
    if cc.account_type:
        return cc.account_type.upper() in ("REVENUE", "INCOME")
    return (cc.natural_account_value or "").startswith("4")


def _is_expense(cc: GlCodeCombination) -> bool:
    if cc.account_type:
        return cc.account_type.upper() in ("EXPENSE",)
    return (cc.natural_account_value or "").startswith(("5", "6"))


def year_end_roll_forward(db: Session, tenant_id, year: int,
                          retained_earnings_natural: str = "3000", created_by=None) -> GlJeBatch:
    """Build a DRAFT closing batch that zeroes income/expense into Retained Earnings
    per Fund, dated Jan 1 of the following year."""
    structure = sla.get_primary_structure(db, tenant_id)
    rows = db.execute(
        select(GlBalance, GlCodeCombination)
        .join(GlCodeCombination, GlCodeCombination.id == GlBalance.code_combination_id)
        .where(GlBalance.tenant_id == tenant_id, GlBalance.period_year == year)
    ).all()
    # Aggregate net per combination, and surplus per fund.
    per_cc: dict = {}
    surplus_by_fund: dict = {}
    for bal, cc in rows:
        if not (_is_income(cc) or _is_expense(cc)):
            continue
        net = Decimal(bal.period_net_dr) - Decimal(bal.period_net_cr)  # dr-positive
        e = per_cc.setdefault(cc.id, {"cc": cc, "net": Decimal("0")})
        e["net"] += net
    if not per_cc:
        raise PeriodError(f"No income/expense balances found for {year}")

    close_date = date(year + 1, 1, 1)
    batch = sla._new_batch(db, tenant_id, "GL", close_date, f"Year-End Close {year}", created_by)
    header = sla._add_header(db, batch, structure.id, "Close", "Manual", close_date,
                             "YEAR_END", None, f"Year-End Close {year}", created_by)
    line_num = 0
    for e in per_cc.values():
        cc, net = e["cc"], e["net"].quantize(CENT)
        if net == 0:
            continue
        line_num += 1
        # Reverse the account's net to zero it: credit if it holds a debit balance, etc.
        dr = Decimal("0") if net > 0 else -net
        cr = net if net > 0 else Decimal("0")
        db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=line_num,
                        code_combination_id=cc.id, entered_dr=dr, entered_cr=cr,
                        fund_value=cc.fund_value, description="Year-end close",
                        created_by=created_by, updated_by=created_by))
        # Surplus contribution per fund = -net (income net is negative → positive surplus).
        surplus_by_fund[cc.fund_value] = surplus_by_fund.get(cc.fund_value, Decimal("0")) - net

    # Balancing Retained Earnings / Fund Balance line per fund.
    for fund, surplus in surplus_by_fund.items():
        surplus = surplus.quantize(CENT)
        if surplus == 0:
            continue
        re = db.execute(select(GlCodeCombination).where(
            GlCodeCombination.tenant_id == tenant_id,
            GlCodeCombination.structure_id == structure.id,
            GlCodeCombination.natural_account_value == retained_earnings_natural,
            GlCodeCombination.fund_value == fund,
            GlCodeCombination.enabled.is_(True),
            GlCodeCombination.allow_posting.is_(True))).scalars().first()
        if re is None:
            raise PeriodError(
                f"Missing Retained Earnings account {retained_earnings_natural}/{fund}; "
                "create the code combination before running year-end close")
        line_num += 1
        # Surplus → credit RE (equity increases); deficit → debit RE.
        dr = Decimal("0") if surplus > 0 else -surplus
        cr = surplus if surplus > 0 else Decimal("0")
        db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=line_num,
                        code_combination_id=re.id, entered_dr=dr, entered_cr=cr,
                        fund_value=fund, description="Retained earnings / fund balance",
                        created_by=created_by, updated_by=created_by))
    db.flush()
    db.refresh(batch)
    sla._set_control_totals(batch)
    db.flush()
    return batch
