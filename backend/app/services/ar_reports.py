"""Accounts Receivable analytics & exports: aging, collections, fund AR summary.

Aging buckets a homeowner's open balance by how far past due each invoice is, as of
a given date — the basis for delinquency tracking and collections. All figures are
tenant-scoped (RLS) and fund-segmented.
"""
from __future__ import annotations

import io
import uuid
from datetime import date
from decimal import Decimal

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.subledger import ArHomeowner, ArInvoice, ArReceipt

_HEAD_FILL = PatternFill("solid", fgColor="1F2937")
_HEAD_FONT = Font(color="FFFFFF", bold=True)
_BOLD = Font(bold=True)

# Open invoice statuses that still represent a receivable.
_OPEN_STATUSES = ("DRAFT", "ACCOUNTED", "POSTED")
BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"]


def _bucket(due: date | None, as_of: date) -> str:
    if due is None or due >= as_of:
        return "Current"
    days = (as_of - due).days
    if days <= 30:
        return "1-30"
    if days <= 60:
        return "31-60"
    if days <= 90:
        return "61-90"
    return "90+"


def compute_aging(db: Session, tenant_id: uuid.UUID, as_of: date) -> dict:
    """Return per-homeowner aging rows + bucket totals."""
    rows = db.execute(
        select(ArInvoice, ArHomeowner)
        .join(ArHomeowner, ArHomeowner.id == ArInvoice.homeowner_id)
        .where(ArInvoice.tenant_id == tenant_id, ArInvoice.status.in_(_OPEN_STATUSES))
    ).all()

    per_home: dict[uuid.UUID, dict] = {}
    totals = {b: Decimal("0") for b in BUCKETS}
    for inv, ho in rows:
        balance = Decimal(inv.amount) - Decimal(inv.amount_paid or 0)
        if balance <= 0:
            continue
        b = _bucket(inv.due_date, as_of)
        entry = per_home.setdefault(ho.id, {
            "account_number": ho.account_number,
            "name": f"{ho.first_name} {ho.last_name}",
            "buckets": {k: Decimal("0") for k in BUCKETS},
            "total": Decimal("0"),
        })
        entry["buckets"][b] += balance
        entry["total"] += balance
        totals[b] += balance

    grand = sum(totals.values(), Decimal("0"))
    return {"as_of": as_of, "rows": list(per_home.values()), "totals": totals, "grand_total": grand}


def _header_row(ws, row, headers):
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=row, column=i, value=h)
        c.fill, c.font = _HEAD_FILL, _HEAD_FONT


def build_ar_aging_workbook(db, tenant_id, as_of, tenant_name) -> bytes:
    data = compute_aging(db, tenant_id, as_of)
    wb = Workbook()
    ws = wb.active
    ws.title = "AR Aging"
    ws["A1"] = f"{tenant_name} — AR Aging as of {as_of.isoformat()}"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Account", "Homeowner", *BUCKETS, "Total"])
    r = 4
    for row in sorted(data["rows"], key=lambda x: x["account_number"]):
        ws.cell(row=r, column=1, value=row["account_number"])
        ws.cell(row=r, column=2, value=row["name"])
        for i, b in enumerate(BUCKETS, start=3):
            ws.cell(row=r, column=i, value=float(row["buckets"][b]))
        ws.cell(row=r, column=8, value=float(row["total"]))
        r += 1
    ws.cell(row=r, column=2, value="TOTAL").font = _BOLD
    for i, b in enumerate(BUCKETS, start=3):
        ws.cell(row=r, column=i, value=float(data["totals"][b])).font = _BOLD
    ws.cell(row=r, column=8, value=float(data["grand_total"])).font = _BOLD
    for col, w in {"A": 12, "B": 26, "C": 12, "D": 12, "E": 12, "F": 12, "G": 12, "H": 14}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_collections_workbook(db, tenant_id, start: date, end: date, tenant_name) -> bytes:
    rows = db.execute(
        select(ArReceipt, ArHomeowner)
        .join(ArHomeowner, ArHomeowner.id == ArReceipt.homeowner_id)
        .where(ArReceipt.tenant_id == tenant_id,
               ArReceipt.receipt_date >= start, ArReceipt.receipt_date <= end)
        .order_by(ArReceipt.receipt_date)
    ).all()
    wb = Workbook()
    ws = wb.active
    ws.title = "Collections"
    ws["A1"] = f"{tenant_name} — Collections {start.isoformat()} to {end.isoformat()}"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Date", "Receipt", "Homeowner", "Method", "Amount"])
    r = 4
    total = Decimal("0")
    by_method: dict[str, Decimal] = {}
    for rec, ho in rows:
        ws.cell(row=r, column=1, value=rec.receipt_date.isoformat())
        ws.cell(row=r, column=2, value=rec.receipt_number)
        ws.cell(row=r, column=3, value=f"{ho.first_name} {ho.last_name}")
        ws.cell(row=r, column=4, value=rec.payment_method)
        ws.cell(row=r, column=5, value=float(rec.amount))
        total += Decimal(rec.amount)
        by_method[rec.payment_method] = by_method.get(rec.payment_method, Decimal("0")) + Decimal(rec.amount)
        r += 1
    r += 1
    ws.cell(row=r, column=2, value="TOTAL COLLECTED").font = _BOLD
    ws.cell(row=r, column=5, value=float(total)).font = _BOLD
    r += 2
    ws.cell(row=r, column=2, value="By method").font = _BOLD
    for m, amt in by_method.items():
        r += 1
        ws.cell(row=r, column=2, value=m)
        ws.cell(row=r, column=5, value=float(amt))
    for col, w in {"A": 12, "B": 16, "C": 26, "D": 10, "E": 14}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_fund_ar_summary_workbook(db, tenant_id, as_of, tenant_name) -> bytes:
    rows = db.execute(
        select(ArInvoice).where(
            ArInvoice.tenant_id == tenant_id, ArInvoice.status.in_(_OPEN_STATUSES)
        )
    ).scalars().all()
    by_fund: dict[str, Decimal] = {}
    for inv in rows:
        bal = Decimal(inv.amount) - Decimal(inv.amount_paid or 0)
        if bal > 0:
            by_fund[inv.fund] = by_fund.get(inv.fund, Decimal("0")) + bal
    wb = Workbook()
    ws = wb.active
    ws.title = "AR by Fund"
    ws["A1"] = f"{tenant_name} — Outstanding AR by Fund as of {as_of.isoformat()}"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Fund", "Outstanding Receivable"])
    r = 4
    total = Decimal("0")
    for fund, amt in sorted(by_fund.items()):
        ws.cell(row=r, column=1, value=fund)
        ws.cell(row=r, column=2, value=float(amt))
        total += amt
        r += 1
    ws.cell(row=r, column=1, value="TOTAL").font = _BOLD
    ws.cell(row=r, column=2, value=float(total)).font = _BOLD
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 24
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
