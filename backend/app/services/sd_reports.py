"""Service Desk reporting: service-request register + cost summary by Fund/Project.

Cost is each ticket's estimated cost; Fund/Project are derived from the linked
Purchase Order's KFF distribution when a ticket has been converted to an expense.
"""
from __future__ import annotations

import io
import uuid
from decimal import Decimal

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.kff import GlCodeCombination
from app.models.procurement import PoDistribution, PoLine
from app.models.service_desk import ServiceTicket

_HEAD_FILL = PatternFill("solid", fgColor="1F2937")
_HEAD_FONT = Font(color="FFFFFF", bold=True)
_BOLD = Font(bold=True)


def _po_fund_project(db: Session, po_header_id: uuid.UUID) -> tuple[str, str]:
    """First distribution's Fund + Project for a ticket's linked PO."""
    row = db.execute(
        select(PoDistribution, GlCodeCombination)
        .join(PoLine, PoLine.id == PoDistribution.po_line_id)
        .join(GlCodeCombination, GlCodeCombination.id == PoDistribution.code_combination_id)
        .where(PoLine.po_header_id == po_header_id)
    ).first()
    if not row:
        return "Unassigned", "—"
    dist, cc = row
    # Project segment isn't denormalized; surface the full account for context.
    return dist.fund_value or "Unassigned", (cc.concatenated_segments or "—")


def _header_row(ws, row, headers):
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=row, column=i, value=h)
        c.fill, c.font = _HEAD_FILL, _HEAD_FONT


def build_service_request_workbook(db: Session, tenant_id: uuid.UUID, tenant_name: str) -> bytes:
    tickets = db.execute(
        select(ServiceTicket).where(ServiceTicket.tenant_id == tenant_id)
        .order_by(ServiceTicket.ticket_number)
    ).scalars().all()

    wb = Workbook()
    ws = wb.active
    ws.title = "Service Requests"
    ws["A1"] = f"{tenant_name} — Service Request Register"
    ws["A1"].font = Font(size=14, bold=True)
    _header_row(ws, 3, ["Ticket", "Subject", "Category", "Priority", "Status",
                        "Est. Cost", "Fund", "Project"])
    r = 4
    by_fund: dict[str, Decimal] = {}
    by_cat: dict[str, Decimal] = {}
    total = Decimal("0")
    for t in tickets:
        fund, project = ("—", "—")
        if t.po_header_id:
            fund, project = _po_fund_project(db, t.po_header_id)
        cost = Decimal(t.estimated_cost or 0)
        ws.cell(row=r, column=1, value=t.ticket_number)
        ws.cell(row=r, column=2, value=t.subject)
        ws.cell(row=r, column=3, value=t.category)
        ws.cell(row=r, column=4, value=t.priority)
        ws.cell(row=r, column=5, value=t.status)
        ws.cell(row=r, column=6, value=float(cost))
        ws.cell(row=r, column=7, value=fund)
        ws.cell(row=r, column=8, value=project)
        r += 1
        total += cost
        by_cat[t.category] = by_cat.get(t.category, Decimal("0")) + cost
        if t.po_header_id:
            by_fund[fund] = by_fund.get(fund, Decimal("0")) + cost
    ws.cell(row=r, column=5, value="TOTAL").font = _BOLD
    ws.cell(row=r, column=6, value=float(total)).font = _BOLD

    # Cost summary sheet (by Fund and by Category).
    s = wb.create_sheet("Cost Summary")
    s["A1"] = "Estimated cost by Fund (converted tickets)"
    s["A1"].font = _BOLD
    _header_row(s, 2, ["Fund", "Estimated Cost"])
    rr = 3
    for fund, amt in sorted(by_fund.items()):
        s.cell(row=rr, column=1, value=fund)
        s.cell(row=rr, column=2, value=float(amt))
        rr += 1
    rr += 1
    s.cell(row=rr, column=1, value="By Category").font = _BOLD
    rr += 1
    _header_row(s, rr, ["Category", "Estimated Cost"])
    rr += 1
    for cat, amt in sorted(by_cat.items()):
        s.cell(row=rr, column=1, value=cat)
        s.cell(row=rr, column=2, value=float(amt))
        rr += 1
    for sheet in (ws, s):
        sheet.column_dimensions["A"].width = 16
        sheet.column_dimensions["B"].width = 30
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
