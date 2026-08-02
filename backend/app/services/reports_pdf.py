"""PDF exports (reportlab): fund-based board report + compliance summary.

Board-ready PDFs for HOA directors and an auditor-facing controls summary
(SOC 2 / PCI DSS / ISO 27001 / CCPA readiness).
"""
from __future__ import annotations

import io
import uuid
from decimal import Decimal

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.services.reports import _TYPE_LABEL, _fund_statement_data

_TABLE_STYLE = TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F2937")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
    ("FONTSIZE", (0, 0), (-1, -1), 9),
])


def _money(v: Decimal) -> str:
    return f"${v:,.2f}" if v >= 0 else f"(${abs(v):,.2f})"


def build_board_report_pdf(db: Session, tenant_id: uuid.UUID, period_name: str, tenant_name: str) -> bytes:
    data = _fund_statement_data(db, tenant_id, period_name)
    funds = sorted(data.keys())
    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, title=f"{tenant_name} Board Report")
    story = [
        Paragraph(tenant_name, styles["Title"]),
        Paragraph(f"Board Financial Report — {period_name}", styles["Heading2"]),
        Paragraph("Fund-based · Functional currency USD", styles["Normal"]),
        Spacer(1, 0.3 * inch),
    ]

    def section(title, types):
        story.append(Paragraph(title, styles["Heading3"]))
        rows = [["Fund", "Type", "Account", "Balance"]]
        total = Decimal("0")
        for fund in funds:
            for at in types:
                for acct, bal in data.get(fund, {}).get(at, []):
                    rows.append([fund, _TYPE_LABEL[at], acct, _money(bal)])
                    total += bal
        rows.append(["", "", "TOTAL", _money(total)])
        t = Table(rows, colWidths=[0.8 * inch, 1.6 * inch, 2.8 * inch, 1.3 * inch])
        t.setStyle(_TABLE_STYLE)
        story.append(t)
        story.append(Spacer(1, 0.25 * inch))
        return total

    story.append(Paragraph("Balance Sheet", styles["Heading2"]))
    assets = section("Assets", ["A"])
    section("Liabilities", ["L"])
    section("Fund Balance / Equity", ["O"])
    story.append(Paragraph("Statement of Revenues & Expenses", styles["Heading2"]))
    rev = section("Revenue", ["R"])
    exp = section("Expenses", ["E"])
    story.append(Paragraph(f"<b>Net Surplus / (Deficit): {_money(rev - exp)}</b>", styles["Normal"]))

    doc.build(story)
    return buf.getvalue()


# Implemented controls mapped to frameworks (auditor-facing summary).
_CONTROLS = [
    ("Multi-tenant isolation", "SOC 2 CC6.1 / ISO A.9", "PostgreSQL Row-Level Security; app role is NOBYPASSRLS"),
    ("Role-based access control", "SOC 2 CC6.3", "Granular permissions; least-privilege system roles"),
    ("Authentication + MFA", "SOC 2 CC6.1 / PCI 8", "JWT + bcrypt; TOTP multi-factor available"),
    ("Encryption at rest", "PCI 3 / ISO A.10", "Fernet field encryption for PII/financial data"),
    ("Encryption in transit", "PCI 4 / SOC 2 CC6.7", "TLS terminated at platform (see deployment)"),
    ("Card data handling", "PCI 3.2 / 3.4", "Tokenization only — no PAN stored (vault token + last four)"),
    ("Audit logging", "SOC 2 CC7.2 / ISO A.12", "Immutable who-columns + before/after change history"),
    ("Data-subject rights", "CCPA 1798.100/.105", "Access, portability, and erasure request workflow"),
    ("Segregation of duties", "SOC 2 CC6.3", "Multi-level approval hierarchies for POs/invoices/batches"),
    ("Financial integrity", "SOC 2 CC8.1", "Balanced GL batches, control totals, fund self-balancing"),
]


def build_compliance_report_pdf(db: Session, tenant_id: uuid.UUID, tenant_name: str) -> bytes:
    audit_count = db.execute(
        select(func.count(AuditLog.id)).where(AuditLog.tenant_id == tenant_id)
    ).scalar_one()
    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, title=f"{tenant_name} Compliance Summary")
    story = [
        Paragraph(tenant_name, styles["Title"]),
        Paragraph("Compliance Controls Summary (SOC 2 / PCI DSS / ISO 27001 / CCPA)", styles["Heading2"]),
        Paragraph(f"Audit-trail entries recorded for this HOA: <b>{audit_count}</b>", styles["Normal"]),
        Spacer(1, 0.25 * inch),
    ]
    rows = [["Control", "Framework", "Implementation", "Status"]]
    for name, fw, impl in _CONTROLS:
        rows.append([Paragraph(name, styles["BodyText"]), Paragraph(fw, styles["BodyText"]),
                     Paragraph(impl, styles["BodyText"]), "Implemented"])
    t = Table(rows, colWidths=[1.5 * inch, 1.3 * inch, 2.9 * inch, 0.9 * inch])
    t.setStyle(_TABLE_STYLE)
    story.append(t)
    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph(
        "Note: Controls are implemented in the platform. Formal SOC 2 Type II and "
        "ISO 27001 certification require an independent external audit.", styles["Italic"]))
    doc.build(story)
    return buf.getvalue()
