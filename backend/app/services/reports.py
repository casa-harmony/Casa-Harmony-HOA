"""Financial report exports (xlsx): trial balance (fund-based) and homeowner ledger."""
from __future__ import annotations

import io
import uuid
from decimal import Decimal

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.budget import GlBudget
from app.models.gl import GlBalance, GlJeBatch, GlJeLine
from app.models.kff import GlCodeCombination
from app.models.masters import ApSupplier
from app.models.payables import ApInvoice
from app.models.subledger import ArHomeowner, ArInvoice, ArReceipt

_HEAD_FILL = PatternFill("solid", fgColor="1F2937")
_HEAD_FONT = Font(color="FFFFFF", bold=True)
_BOLD = Font(bold=True)


def _header_row(ws, row, headers):
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=row, column=i, value=h)
        c.fill = _HEAD_FILL
        c.font = _HEAD_FONT
        c.alignment = Alignment(horizontal="left")


def build_trial_balance_workbook(
    db: Session, tenant_id: uuid.UUID, period_name: str, tenant_name: str
) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Trial Balance"
    ws["A1"] = f"{tenant_name} — Trial Balance ({period_name})"
    ws["A1"].font = Font(size=14, bold=True)
    ws["A2"] = "Functional currency: USD"

    rows = db.execute(
        select(GlBalance, GlCodeCombination)
        .join(GlCodeCombination, GlCodeCombination.id == GlBalance.code_combination_id)
        .where(GlBalance.tenant_id == tenant_id, GlBalance.period_name == period_name)
        .order_by(GlBalance.fund_value, GlCodeCombination.concatenated_segments)
    ).all()

    _header_row(ws, 4, ["Fund", "Account (code combination)", "Type", "Debit", "Credit"])
    r = 5
    total_dr = total_cr = Decimal("0")
    for bal, cc in rows:
        net = bal.period_net_dr - bal.period_net_cr
        debit = net if net > 0 else Decimal("0")
        credit = -net if net < 0 else Decimal("0")
        ws.cell(row=r, column=1, value=bal.fund_value)
        ws.cell(row=r, column=2, value=cc.concatenated_segments)
        ws.cell(row=r, column=3, value=cc.account_type or "")
        ws.cell(row=r, column=4, value=float(debit))
        ws.cell(row=r, column=5, value=float(credit))
        total_dr += debit
        total_cr += credit
        r += 1

    ws.cell(row=r, column=2, value="TOTAL").font = _BOLD
    ws.cell(row=r, column=4, value=float(total_dr)).font = _BOLD
    ws.cell(row=r, column=5, value=float(total_cr)).font = _BOLD
    for col, w in {"A": 10, "B": 40, "C": 8, "D": 16, "E": 16}.items():
        ws.column_dimensions[col].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _fund_statement_data(db: Session, tenant_id: uuid.UUID, period_name: str):
    """Aggregate posted balances by fund and account type for fund-based statements."""
    rows = db.execute(
        select(GlBalance, GlCodeCombination)
        .join(GlCodeCombination, GlCodeCombination.id == GlBalance.code_combination_id)
        .where(GlBalance.tenant_id == tenant_id, GlBalance.period_name == period_name)
    ).all()
    # fund -> account_type -> [(account, balance)]
    data: dict[str, dict[str, list[tuple[str, Decimal]]]] = {}
    for bal, cc in rows:
        fund = bal.fund_value or "—"
        at = cc.account_type or "?"
        net = bal.period_net_dr - bal.period_net_cr
        # Credit-normal accounts (L/O/R) carry a positive balance as a credit.
        balance = net if at in ("A", "E") else -net
        data.setdefault(fund, {}).setdefault(at, []).append((cc.concatenated_segments, balance))
    return data


_TYPE_LABEL = {"A": "Assets", "L": "Liabilities", "O": "Fund Balance / Equity",
               "R": "Revenue", "E": "Expenses"}


def build_financial_statements_workbook(
    db: Session, tenant_id: uuid.UUID, period_name: str, tenant_name: str
) -> bytes:
    """Fund-based Balance Sheet + Statement of Revenues & Expenses (xlsx)."""
    data = _fund_statement_data(db, tenant_id, period_name)
    wb = Workbook()

    def _section(ws, row, title, types, funds):
        ws.cell(row=row, column=1, value=title).font = _BOLD
        row += 1
        _header_row(ws, row, ["Fund", "Type", "Account", "Balance"])
        row += 1
        grand = Decimal("0")
        for fund in sorted(funds):
            for at in types:
                for acct, bal in data.get(fund, {}).get(at, []):
                    ws.cell(row=row, column=1, value=fund)
                    ws.cell(row=row, column=2, value=_TYPE_LABEL[at])
                    ws.cell(row=row, column=3, value=acct)
                    ws.cell(row=row, column=4, value=float(bal))
                    grand += bal
                    row += 1
        ws.cell(row=row, column=3, value=f"TOTAL {title}").font = _BOLD
        ws.cell(row=row, column=4, value=float(grand)).font = _BOLD
        return row + 2, grand

    funds = set(data.keys())

    bs = wb.active
    bs.title = "Balance Sheet"
    bs["A1"] = f"{tenant_name} — Balance Sheet ({period_name})"
    bs["A1"].font = Font(size=14, bold=True)
    nrow, _ = _section(bs, 3, "Assets", ["A"], funds)
    nrow, _ = _section(bs, nrow, "Liabilities", ["L"], funds)
    _section(bs, nrow, "Fund Balance / Equity", ["O"], funds)
    for col, w in {"A": 10, "B": 22, "C": 36, "D": 16}.items():
        bs.column_dimensions[col].width = w

    inc = wb.create_sheet("Revenues & Expenses")
    inc["A1"] = f"{tenant_name} — Statement of Revenues & Expenses ({period_name})"
    inc["A1"].font = Font(size=14, bold=True)
    nrow, rev = _section(inc, 3, "Revenue", ["R"], funds)
    nrow, exp = _section(inc, nrow, "Expenses", ["E"], funds)
    inc.cell(row=nrow, column=3, value="NET SURPLUS / (DEFICIT)").font = _BOLD
    inc.cell(row=nrow, column=4, value=float(rev - exp)).font = _BOLD
    for col, w in {"A": 10, "B": 22, "C": 36, "D": 16}.items():
        inc.column_dimensions[col].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def compute_budget_vs_actual(db: Session, tenant_id: uuid.UUID, period_name: str) -> list[dict]:
    """Per code-combination budget vs actual for a period (revenue/expense focus).

    Actual is the period's natural-sign activity: expenses dr−cr, revenue cr−dr.
    """
    budgets = {
        b.code_combination_id: b for b in db.execute(
            select(GlBudget).where(
                GlBudget.tenant_id == tenant_id, GlBudget.period_name == period_name
            )
        ).scalars()
    }
    balances = db.execute(
        select(GlBalance, GlCodeCombination)
        .join(GlCodeCombination, GlCodeCombination.id == GlBalance.code_combination_id)
        .where(GlBalance.tenant_id == tenant_id, GlBalance.period_name == period_name)
    ).all()
    actual_by_cc = {cc.id: (bal, cc) for bal, cc in balances}

    rows = []
    ccids = set(budgets) | set(actual_by_cc)
    for ccid in ccids:
        bal_cc = actual_by_cc.get(ccid)
        bud = budgets.get(ccid)
        cc = bal_cc[1] if bal_cc else None
        at = cc.account_type if cc else "?"
        if bal_cc:
            net = bal_cc[0].period_net_dr - bal_cc[0].period_net_cr
            actual = net if at in ("A", "E") else -net
        else:
            actual = Decimal("0")
        budget = bud.amount if bud else Decimal("0")
        rows.append({
            "account": cc.concatenated_segments if cc else str(ccid),
            "fund": (cc.fund_value if cc else (bud.fund_value if bud else "")) or "",
            "type": at,
            "budget": budget,
            "actual": actual,
            "variance": budget - actual,
        })
    rows.sort(key=lambda r: (r["fund"], r["account"]))
    return rows


def build_budget_vs_actual_workbook(db, tenant_id, period_name, tenant_name) -> bytes:
    rows = compute_budget_vs_actual(db, tenant_id, period_name)
    wb = Workbook()
    ws = wb.active
    ws.title = "Budget vs Actual"
    ws["A1"] = f"{tenant_name} — Budget vs Actual ({period_name})"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Fund", "Account", "Type", "Budget", "Actual", "Variance"])
    r = 4
    tb = ta = tv = Decimal("0")
    for row in rows:
        ws.cell(row=r, column=1, value=row["fund"])
        ws.cell(row=r, column=2, value=row["account"])
        ws.cell(row=r, column=3, value=row["type"])
        ws.cell(row=r, column=4, value=float(row["budget"]))
        ws.cell(row=r, column=5, value=float(row["actual"]))
        ws.cell(row=r, column=6, value=float(row["variance"]))
        tb += row["budget"]; ta += row["actual"]; tv += row["variance"]
        r += 1
    ws.cell(row=r, column=2, value="TOTAL").font = _BOLD
    ws.cell(row=r, column=4, value=float(tb)).font = _BOLD
    ws.cell(row=r, column=5, value=float(ta)).font = _BOLD
    ws.cell(row=r, column=6, value=float(tv)).font = _BOLD
    for col, w in {"A": 10, "B": 36, "C": 8, "D": 14, "E": 14, "F": 14}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _mask_tin(tin: str | None) -> str:
    if not tin:
        return "—"
    digits = "".join(c for c in tin if c.isdigit())
    return f"***-**-{digits[-4:]}" if len(digits) >= 4 else "****"


def build_1099_workbook(db: Session, tenant_id: uuid.UUID, year: int, tenant_name: str) -> bytes:
    """Yearly 1099 report: total **payments** to 1099-reportable vendors in a year.

    Payment-basis: sums active (non-void) AP payments by payment_date year.
    """
    from app.models.payments import ApPayment

    rows = db.execute(
        select(ApPayment, ApSupplier)
        .join(ApSupplier, ApSupplier.id == ApPayment.vendor_id)
        .where(
            ApPayment.tenant_id == tenant_id,
            ApSupplier.is_1099.is_(True),
            ApPayment.status == "CREATED",
        )
    ).all()

    by_vendor: dict = {}
    for pmt, v in rows:
        if pmt.payment_date.year != year:
            continue
        e = by_vendor.setdefault(v.id, {
            "name": v.tax_reporting_name or v.name, "tin": _mask_tin(v.tax_id),
            "type": v.income_tax_type or "1099-NEC",
            "state": "Yes" if v.state_reportable else "No", "total": Decimal("0"),
        })
        e["total"] += Decimal(pmt.amount)

    wb = Workbook()
    ws = wb.active
    ws.title = f"1099 {year}"
    ws["A1"] = f"{tenant_name} — 1099 Vendor Payments ({year})"
    ws["A1"].font = Font(size=14, bold=True)
    ws["A2"] = "Basis: AP invoices accounted in the calendar year. Functional currency USD."
    _header_row(ws, 4, ["Vendor (reporting name)", "TIN", "Form", "State reportable", "Total"])
    r = 5
    grand = Decimal("0")
    for e in sorted(by_vendor.values(), key=lambda x: x["name"]):
        ws.cell(row=r, column=1, value=e["name"])
        ws.cell(row=r, column=2, value=e["tin"])
        ws.cell(row=r, column=3, value=e["type"])
        ws.cell(row=r, column=4, value=e["state"])
        ws.cell(row=r, column=5, value=float(e["total"]))
        grand += e["total"]
        r += 1
    ws.cell(row=r, column=4, value="TOTAL").font = _BOLD
    ws.cell(row=r, column=5, value=float(grand)).font = _BOLD
    for col, w in {"A": 32, "B": 14, "C": 12, "D": 16, "E": 14}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_batch_workbook(db: Session, batch: GlJeBatch) -> bytes:
    """GL journal batch summary: headers, lines, KFF accounts, and control totals."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Batch Summary"
    ws["A1"] = f"GL Journal Batch — {batch.batch_name}"
    ws["A1"].font = Font(size=14, bold=True)
    ws["A2"] = (f"Source {batch.source} · Period {batch.period_name} · Status {batch.status} · "
                f"Control Dr {batch.control_total_dr} / Cr {batch.control_total_cr}")

    _header_row(ws, 4, ["Journal", "Line", "Account (code combination)", "Fund",
                        "Debit", "Credit", "Description"])
    r = 5
    total_dr = total_cr = Decimal("0")
    for header in batch.headers:
        lines = db.execute(
            select(GlJeLine, GlCodeCombination)
            .join(GlCodeCombination, GlCodeCombination.id == GlJeLine.code_combination_id)
            .where(GlJeLine.header_id == header.id).order_by(GlJeLine.line_num)
        ).all()
        for line, cc in lines:
            ws.cell(row=r, column=1, value=header.je_name)
            ws.cell(row=r, column=2, value=line.line_num)
            ws.cell(row=r, column=3, value=cc.concatenated_segments)
            ws.cell(row=r, column=4, value=line.fund_value)
            ws.cell(row=r, column=5, value=float(line.entered_dr))
            ws.cell(row=r, column=6, value=float(line.entered_cr))
            ws.cell(row=r, column=7, value=line.description or "")
            total_dr += line.entered_dr
            total_cr += line.entered_cr
            r += 1
    ws.cell(row=r, column=3, value="TOTAL").font = _BOLD
    ws.cell(row=r, column=5, value=float(total_dr)).font = _BOLD
    ws.cell(row=r, column=6, value=float(total_cr)).font = _BOLD
    for col, w in {"A": 22, "B": 6, "C": 36, "D": 8, "E": 14, "F": 14, "G": 28}.items():
        ws.column_dimensions[col].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_homeowner_ledger_workbook(
    db: Session, tenant_id: uuid.UUID, homeowner: ArHomeowner
) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Homeowner Ledger"
    ws["A1"] = f"Homeowner Ledger — {homeowner.first_name} {homeowner.last_name}"
    ws["A1"].font = Font(size=14, bold=True)
    ws["A2"] = f"Account {homeowner.account_number} · Unit {homeowner.property_unit or '—'}"

    # Charges (invoices) and payments (receipts) merged chronologically.
    invoices = db.execute(
        select(ArInvoice).where(
            ArInvoice.tenant_id == tenant_id, ArInvoice.homeowner_id == homeowner.id
        )
    ).scalars().all()
    receipts = db.execute(
        select(ArReceipt).where(
            ArReceipt.tenant_id == tenant_id, ArReceipt.homeowner_id == homeowner.id
        )
    ).scalars().all()

    events = []
    for inv in invoices:
        events.append((inv.invoice_date, f"{inv.invoice_type} {inv.invoice_number}",
                       Decimal(inv.amount), Decimal("0")))
    for rec in receipts:
        events.append((rec.receipt_date, f"Payment {rec.receipt_number}",
                       Decimal("0"), Decimal(rec.amount)))
    events.sort(key=lambda e: e[0])

    _header_row(ws, 4, ["Date", "Description", "Charge", "Payment", "Balance"])
    r = 5
    balance = Decimal("0")
    for d, desc, charge, payment in events:
        balance += charge - payment
        ws.cell(row=r, column=1, value=d.isoformat())
        ws.cell(row=r, column=2, value=desc)
        ws.cell(row=r, column=3, value=float(charge))
        ws.cell(row=r, column=4, value=float(payment))
        ws.cell(row=r, column=5, value=float(balance))
        r += 1
    ws.cell(row=r, column=2, value="BALANCE DUE").font = _BOLD
    ws.cell(row=r, column=5, value=float(balance)).font = _BOLD
    for col, w in {"A": 12, "B": 32, "C": 14, "D": 14, "E": 14}.items():
        ws.column_dimensions[col].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_period_close_checklist(db, tenant_id, tenant_name) -> bytes:
    """Period-close checklist: per period, GL batch counts by status + period status."""
    from collections import defaultdict
    from app.models.gl import GlJeBatch
    from app.models.period import AccountingPeriod

    batches = db.execute(
        select(GlJeBatch.period_name, GlJeBatch.status, func.count(GlJeBatch.id))
        .where(GlJeBatch.tenant_id == tenant_id)
        .group_by(GlJeBatch.period_name, GlJeBatch.status)
    ).all()
    counts: dict = defaultdict(lambda: defaultdict(int))
    for pname, status, n in batches:
        counts[pname][status] = n
    periods = {p.period_name: p for p in db.execute(
        select(AccountingPeriod).where(AccountingPeriod.tenant_id == tenant_id)).scalars().all()}

    wb = Workbook(); ws = wb.active; ws.title = "Period Close Checklist"
    ws["A1"] = f"{tenant_name} — Period Close Checklist"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Period", "Status", "Draft", "Submitted", "Approved", "Posted", "Ready to close"])
    r = 4
    all_periods = sorted(set(counts) | set(periods))
    for pname in all_periods:
        c = counts.get(pname, {})
        pstatus = periods[pname].status if pname in periods else "OPEN (implicit)"
        draft, sub = c.get("DRAFT", 0), c.get("SUBMITTED", 0)
        ws.cell(row=r, column=1, value=pname)
        ws.cell(row=r, column=2, value=pstatus)
        ws.cell(row=r, column=3, value=draft)
        ws.cell(row=r, column=4, value=sub)
        ws.cell(row=r, column=5, value=c.get("APPROVED", 0))
        ws.cell(row=r, column=6, value=c.get("POSTED", 0))
        ws.cell(row=r, column=7, value="YES" if (draft + sub) == 0 else "NO — open batches")
        r += 1
    for col, w in {"A": 12, "B": 16, "C": 8, "D": 11, "E": 10, "F": 9, "G": 18}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def build_budget_vs_actual_v2_workbook(db, tenant_id, version_id, tenant_name) -> bytes:
    """Budget vs Actual for a budget version, by Fund / Cost Center / account."""
    from app.services import budgeting
    rows = budgeting.budget_vs_actual(db, tenant_id, version_id)
    wb = Workbook(); ws = wb.active; ws.title = "Budget vs Actual"
    ws["A1"] = f"{tenant_name} — Budget vs Actual"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Fund", "Cost Center", "Account", "Budget", "Actual", "Variance"])
    r = 4
    tb = ta = Decimal("0")
    for row in rows:
        ws.cell(row=r, column=1, value=row["fund_value"])
        ws.cell(row=r, column=2, value=row["cost_center"])
        ws.cell(row=r, column=3, value=row["account"])
        ws.cell(row=r, column=4, value=float(row["budget"]))
        ws.cell(row=r, column=5, value=float(row["actual"]))
        ws.cell(row=r, column=6, value=float(row["variance"]))
        tb += row["budget"]; ta += row["actual"]
        r += 1
    ws.cell(row=r, column=3, value="TOTAL").font = _BOLD
    ws.cell(row=r, column=4, value=float(tb)).font = _BOLD
    ws.cell(row=r, column=5, value=float(ta)).font = _BOLD
    ws.cell(row=r, column=6, value=float(tb - ta)).font = _BOLD
    for col, w in {"A": 10, "B": 14, "C": 28, "D": 14, "E": 14, "F": 14}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def build_budget_spread_workbook(db, tenant_id, version_id, tenant_name) -> bytes:
    """Period spread grid: account × 12 months for a budget version."""
    from collections import defaultdict
    from app.models.budgeting import BudgetLine, BudgetVersion
    from app.models.kff import GlCodeCombination

    v = db.get(BudgetVersion, version_id)
    lines = db.execute(
        select(BudgetLine, GlCodeCombination)
        .join(GlCodeCombination, GlCodeCombination.id == BudgetLine.code_combination_id)
        .where(BudgetLine.version_id == version_id)
    ).all()
    grid: dict = defaultdict(lambda: [Decimal("0")] * 12)
    label: dict = {}
    for ln, cc in lines:
        grid[cc.id][ln.period_num - 1] += Decimal(ln.amount)
        label[cc.id] = (cc.fund_value, cc.concatenated_segments)

    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    wb = Workbook(); ws = wb.active; ws.title = "Budget Spread"
    ws["A1"] = f"{tenant_name} — Budget Spread ({v.name if v else ''})"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Fund", "Account", *months, "Annual"])
    r = 4
    for cc_id, vals in sorted(grid.items(), key=lambda kv: label[kv[0]]):
        fund, acct = label[cc_id]
        ws.cell(row=r, column=1, value=fund)
        ws.cell(row=r, column=2, value=acct)
        for i, val in enumerate(vals):
            ws.cell(row=r, column=3 + i, value=float(val))
        ws.cell(row=r, column=15, value=float(sum(vals)))
        r += 1
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def build_asset_register_workbook(db, tenant_id, tenant_name) -> bytes:
    """Fixed asset register with cost, accumulated depreciation, and NBV."""
    from app.models.fixed_assets import FaAsset
    assets = db.execute(select(FaAsset).where(FaAsset.tenant_id == tenant_id)
                        .order_by(FaAsset.asset_number)).scalars().all()
    wb = Workbook(); ws = wb.active; ws.title = "Asset Register"
    ws["A1"] = f"{tenant_name} — Fixed Asset Register"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Asset #", "Name", "Category", "Fund", "In service", "Cost",
                        "Accum Depr", "NBV", "Status"])
    r = 4
    tc = tn = Decimal("0")
    for a in assets:
        nbv = Decimal(a.cost) - Decimal(a.accumulated_depreciation)
        ws.cell(row=r, column=1, value=a.asset_number)
        ws.cell(row=r, column=2, value=a.name)
        ws.cell(row=r, column=3, value=a.category or "")
        ws.cell(row=r, column=4, value=a.fund_value)
        ws.cell(row=r, column=5, value=a.in_service_date.isoformat())
        ws.cell(row=r, column=6, value=float(a.cost))
        ws.cell(row=r, column=7, value=float(a.accumulated_depreciation))
        ws.cell(row=r, column=8, value=float(nbv))
        ws.cell(row=r, column=9, value=a.status)
        tc += Decimal(a.cost); tn += nbv
        r += 1
    ws.cell(row=r, column=5, value="TOTAL").font = _BOLD
    ws.cell(row=r, column=6, value=float(tc)).font = _BOLD
    ws.cell(row=r, column=8, value=float(tn)).font = _BOLD
    for col, w in {"A": 12, "B": 28, "C": 16, "D": 8, "E": 12, "F": 14, "G": 14, "H": 14, "I": 16}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def build_depreciation_forecast_workbook(db, tenant_id, tenant_name) -> bytes:
    """Forward straight-line depreciation forecast per active asset, by period."""
    from collections import defaultdict
    from app.models.fixed_assets import FaAsset
    from app.services.fixed_assets import depreciation_forecast
    assets = db.execute(select(FaAsset).where(
        FaAsset.tenant_id == tenant_id, FaAsset.status == "ACTIVE")
        .order_by(FaAsset.asset_number)).scalars().all()
    by_period: dict = defaultdict(Decimal)
    for a in assets:
        for row in depreciation_forecast(a):
            by_period[row["period"]] += row["amount"]
    wb = Workbook(); ws = wb.active; ws.title = "Depreciation Forecast"
    ws["A1"] = f"{tenant_name} — Depreciation Forecast"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Period", "Forecast Depreciation"])
    r = 4
    def _key(p):
        m, y = p.split("-"); months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
        return (int(y), months.index(m))
    for period in sorted(by_period, key=_key):
        ws.cell(row=r, column=1, value=period)
        ws.cell(row=r, column=2, value=float(by_period[period]))
        r += 1
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 22
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def build_reserve_utilization_workbook(db, tenant_id, study_id, tenant_name) -> bytes:
    """Reserve study planned vs actual by component (Fund/year)."""
    from app.services.fixed_assets import reserve_vs_actual
    rows = reserve_vs_actual(db, tenant_id, study_id)
    wb = Workbook(); ws = wb.active; ws.title = "Reserve vs Actual"
    ws["A1"] = f"{tenant_name} — Reserve Study: Planned vs Actual"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Component", "Category", "Fund", "Planned Year", "Planned", "Actual", "Variance"])
    r = 4
    tp = ta = Decimal("0")
    for row in rows:
        ws.cell(row=r, column=1, value=row["component"])
        ws.cell(row=r, column=2, value=row["category"])
        ws.cell(row=r, column=3, value=row["fund_value"])
        ws.cell(row=r, column=4, value=row["planned_year"])
        ws.cell(row=r, column=5, value=float(row["planned_amount"]))
        ws.cell(row=r, column=6, value=float(row["actual"]))
        ws.cell(row=r, column=7, value=float(row["variance"]))
        tp += row["planned_amount"]; ta += row["actual"]
        r += 1
    ws.cell(row=r, column=4, value="TOTAL").font = _BOLD
    ws.cell(row=r, column=5, value=float(tp)).font = _BOLD
    ws.cell(row=r, column=6, value=float(ta)).font = _BOLD
    ws.cell(row=r, column=7, value=float(tp - ta)).font = _BOLD
    for col, w in {"A": 24, "B": 16, "C": 8, "D": 12, "E": 14, "F": 14, "G": 14}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def build_assessment_register_workbook(db, tenant_id, start, end, tenant_name) -> bytes:
    """AR assessment register: invoices by date with homeowner, type, balance."""
    rows = db.execute(
        select(ArInvoice, ArHomeowner)
        .join(ArHomeowner, ArHomeowner.id == ArInvoice.homeowner_id)
        .where(ArInvoice.tenant_id == tenant_id,
               ArInvoice.invoice_date >= start, ArInvoice.invoice_date <= end)
        .order_by(ArInvoice.invoice_date)
    ).all()
    wb = Workbook(); ws = wb.active; ws.title = "Assessment Register"
    ws["A1"] = f"{tenant_name} — Assessment Register {start.isoformat()} to {end.isoformat()}"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Date", "Invoice #", "Homeowner", "Type", "Amount", "Paid", "Balance", "Status"])
    r = 4
    ta = tb = Decimal("0")
    for inv, h in rows:
        bal = Decimal(inv.amount) - Decimal(inv.amount_paid)
        ws.cell(row=r, column=1, value=inv.invoice_date.isoformat())
        ws.cell(row=r, column=2, value=inv.invoice_number)
        ws.cell(row=r, column=3, value=f"{h.first_name} {h.last_name}")
        ws.cell(row=r, column=4, value=inv.invoice_type)
        ws.cell(row=r, column=5, value=float(inv.amount))
        ws.cell(row=r, column=6, value=float(inv.amount_paid))
        ws.cell(row=r, column=7, value=float(bal))
        ws.cell(row=r, column=8, value=inv.status)
        ta += Decimal(inv.amount); tb += bal
        r += 1
    ws.cell(row=r, column=4, value="TOTAL").font = _BOLD
    ws.cell(row=r, column=5, value=float(ta)).font = _BOLD
    ws.cell(row=r, column=7, value=float(tb)).font = _BOLD
    for col, w in {"A": 12, "B": 14, "C": 26, "D": 18, "E": 12, "F": 12, "G": 12, "H": 10}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def build_document_index_workbook(db, tenant_id, tenant_name) -> bytes:
    """Index of all document attachments."""
    from app.models.documents import DocumentAttachment
    docs = db.execute(select(DocumentAttachment).where(
        DocumentAttachment.tenant_id == tenant_id)
        .order_by(DocumentAttachment.created_at.desc())).scalars().all()
    wb = Workbook(); ws = wb.active; ws.title = "Document Index"
    ws["A1"] = f"{tenant_name} — Document Index"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Uploaded", "Entity", "Entity ID", "Filename", "Type", "Size (bytes)"])
    r = 4
    for d in docs:
        ws.cell(row=r, column=1, value=str(d.created_at))
        ws.cell(row=r, column=2, value=d.entity_type)
        ws.cell(row=r, column=3, value=str(d.entity_id))
        ws.cell(row=r, column=4, value=d.filename)
        ws.cell(row=r, column=5, value=d.content_type)
        ws.cell(row=r, column=6, value=d.size_bytes)
        r += 1
    for col, w in {"A": 26, "B": 14, "C": 38, "D": 30, "E": 24, "F": 14}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def build_resident_statement_workbook(db, tenant_id, homeowner, tenant_name) -> bytes:
    """Resident-facing statement: open assessments + payment history + balance."""
    open_invs = db.execute(select(ArInvoice).where(
        ArInvoice.tenant_id == tenant_id, ArInvoice.homeowner_id == homeowner.id,
        ArInvoice.status.in_(("DRAFT", "ACCOUNTED", "POSTED")))
        .order_by(ArInvoice.due_date)).scalars().all()
    receipts = db.execute(select(ArReceipt).where(
        ArReceipt.tenant_id == tenant_id, ArReceipt.homeowner_id == homeowner.id)
        .order_by(ArReceipt.receipt_date.desc())).scalars().all()
    wb = Workbook(); ws = wb.active; ws.title = "Statement"
    ws["A1"] = f"{tenant_name} — Statement"
    ws["A1"].font = Font(size=14, bold=True)
    ws["A2"] = f"{homeowner.first_name} {homeowner.last_name} · Account {homeowner.account_number}"
    _header_row(ws, 4, ["Invoice", "Type", "Invoice Date", "Due", "Amount", "Paid", "Balance"])
    r = 5
    bal = Decimal("0")
    for i in open_invs:
        b = Decimal(i.amount) - Decimal(i.amount_paid or 0)
        ws.cell(row=r, column=1, value=i.invoice_number)
        ws.cell(row=r, column=2, value=i.invoice_type)
        ws.cell(row=r, column=3, value=i.invoice_date.isoformat())
        ws.cell(row=r, column=4, value=i.due_date.isoformat() if i.due_date else "")
        ws.cell(row=r, column=5, value=float(i.amount))
        ws.cell(row=r, column=6, value=float(i.amount_paid or 0))
        ws.cell(row=r, column=7, value=float(b))
        bal += b
        r += 1
    ws.cell(row=r, column=6, value="Balance due").font = _BOLD
    ws.cell(row=r, column=7, value=float(bal)).font = _BOLD
    r += 2
    ws.cell(row=r, column=1, value="Recent Payments").font = _BOLD
    r += 1
    _header_row(ws, r, ["Receipt", "Date", "Method", "Amount"]); r += 1
    for rc in receipts[:20]:
        ws.cell(row=r, column=1, value=rc.receipt_number)
        ws.cell(row=r, column=2, value=rc.receipt_date.isoformat())
        ws.cell(row=r, column=3, value=rc.payment_method)
        ws.cell(row=r, column=4, value=float(rc.amount))
        r += 1
    for col, w in {"A": 16, "B": 18, "C": 14, "D": 12, "E": 12, "F": 12, "G": 12}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def build_delinquency_aging_workbook(db, tenant_id, as_of, tenant_name) -> bytes:
    """Delinquency aging by homeowner + a by-Fund summary."""
    from app.services.collections import BUCKETS, aging, aging_by_fund
    rows = aging(db, tenant_id, as_of)
    wb = Workbook(); ws = wb.active; ws.title = "Aging by Homeowner"
    ws["A1"] = f"{tenant_name} — Delinquency Aging as of {as_of.isoformat()}"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Account", "Homeowner", *BUCKETS, "Total"])
    r = 4
    totals = {b: Decimal("0") for b in BUCKETS}
    grand = Decimal("0")
    for e in rows:
        ws.cell(row=r, column=1, value=e["account_number"])
        ws.cell(row=r, column=2, value=e["name"])
        for i, b in enumerate(BUCKETS, start=3):
            ws.cell(row=r, column=i, value=float(e["buckets"][b]))
            totals[b] += e["buckets"][b]
        ws.cell(row=r, column=8, value=float(e["total"]))
        grand += e["total"]
        r += 1
    ws.cell(row=r, column=2, value="TOTAL").font = _BOLD
    for i, b in enumerate(BUCKETS, start=3):
        ws.cell(row=r, column=i, value=float(totals[b])).font = _BOLD
    ws.cell(row=r, column=8, value=float(grand)).font = _BOLD

    fs = wb.create_sheet("Aging by Fund")
    _header_row(fs, 1, ["Fund", *BUCKETS])
    rr = 2
    for fund, b in sorted(aging_by_fund(db, tenant_id, as_of).items()):
        fs.cell(row=rr, column=1, value=fund)
        for i, name in enumerate(BUCKETS, start=2):
            fs.cell(row=rr, column=i, value=float(b[name]))
        rr += 1
    for col, w in {"A": 16, "B": 26}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def build_collection_effectiveness_workbook(db, tenant_id, start, end, tenant_name) -> bytes:
    from app.services.collections import collection_effectiveness
    m = collection_effectiveness(db, tenant_id, start, end)
    wb = Workbook(); ws = wb.active; ws.title = "Collection Effectiveness"
    ws["A1"] = f"{tenant_name} — Collection Effectiveness {start.isoformat()} to {end.isoformat()}"
    ws["A1"].font = Font(size=14, bold=True)
    rows = [("Billed", m["billed"]), ("Collected", m["collected"]), ("Collection rate %", m["rate_pct"])]
    for i, (k, v) in enumerate(rows, start=3):
        ws.cell(row=i, column=1, value=k).font = _BOLD
        ws.cell(row=i, column=2, value=float(v))
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 16
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()
