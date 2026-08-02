"""Cash Management & Bank Reconciliation services.

Statement lines are imported, then either matched to an existing payment/receipt
or cleared via an **adjustment** that posts a draft GL batch (Dr/Cr the bank's
cash account vs an offset account). A statement reconciles when every line is
reconciled. Cash position is reported per Fund.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.cash import CeBankAccount, CeStatementHeader, CeStatementLine
from app.models.gl import GlJeLine
from app.models.payments import ApPayment
from app.models.subledger import ArReceipt
from app.services import subledger_accounting as sla

CENT = Decimal("0.01")


class CashError(ValueError):
    pass


def create_bank_account(db: Session, *, tenant_id, account_code, name, fund_value="OPER",
                        bank_name=None, account_number=None, routing_number=None,
                        gl_cash_combination_id=None, created_by=None) -> CeBankAccount:
    if db.execute(select(CeBankAccount).where(CeBankAccount.tenant_id == tenant_id,
                  CeBankAccount.account_code == account_code)).scalar_one_or_none():
        raise CashError("Bank account code already exists")
    acct = CeBankAccount(
        tenant_id=tenant_id, account_code=account_code, name=name, fund_value=fund_value,
        bank_name=bank_name, account_number=account_number, routing_number=routing_number,
        gl_cash_combination_id=gl_cash_combination_id, created_by=created_by, updated_by=created_by)
    db.add(acct)
    db.flush()
    return acct


def import_statement(db: Session, *, tenant_id, ce_bank_account_id, statement_date: date,
                     opening_balance, closing_balance, lines: list[dict], created_by=None) -> CeStatementHeader:
    acct = db.get(CeBankAccount, ce_bank_account_id)
    if acct is None or acct.tenant_id != tenant_id:
        raise CashError("Bank account not found")
    header = CeStatementHeader(
        tenant_id=tenant_id, ce_bank_account_id=ce_bank_account_id, statement_date=statement_date,
        opening_balance=Decimal(str(opening_balance or 0)).quantize(CENT),
        closing_balance=Decimal(str(closing_balance or 0)).quantize(CENT),
        status="OPEN", created_by=created_by, updated_by=created_by)
    db.add(header)
    db.flush()
    for i, ln in enumerate(lines, start=1):
        db.add(CeStatementLine(
            tenant_id=tenant_id, header_id=header.id, line_num=i,
            line_date=ln.get("line_date"), description=ln.get("description"),
            reference=ln.get("reference"),
            amount=Decimal(str(ln["amount"])).quantize(CENT),
            created_by=created_by, updated_by=created_by))
    db.flush()
    return header


def _get_line(db, line_id, tenant_id) -> CeStatementLine:
    ln = db.get(CeStatementLine, line_id)
    if ln is None or ln.tenant_id != tenant_id:
        raise CashError("Statement line not found")
    return ln


def match_line(db: Session, *, tenant_id, line_id, payment_id=None, receipt_id=None) -> CeStatementLine:
    ln = _get_line(db, line_id, tenant_id)
    if ln.reconciled:
        raise CashError("Line already reconciled")
    if payment_id:
        pmt = db.get(ApPayment, payment_id)
        if pmt is None or pmt.tenant_id != tenant_id:
            raise CashError("Payment not found")
        ln.match_type, ln.matched_payment_id = "PAYMENT", pmt.id
    elif receipt_id:
        rcpt = db.get(ArReceipt, receipt_id)
        if rcpt is None or rcpt.tenant_id != tenant_id:
            raise CashError("Receipt not found")
        ln.match_type, ln.matched_receipt_id = "RECEIPT", rcpt.id
    else:
        raise CashError("Provide a payment_id or receipt_id to match")
    ln.reconciled = True
    db.flush()
    return ln


def create_adjustment(db: Session, *, tenant_id, line_id, offset_combination_id,
                      gl_date: date, description: str | None = None, created_by=None) -> CeStatementLine:
    """Clear a statement line via a GL adjustment (draft batch).

    Signed by the line amount: deposit (+) → Dr Cash / Cr offset; withdrawal (−) →
    Dr offset / Cr Cash. The cash side uses the bank account's GL cash combination.
    """
    ln = _get_line(db, line_id, tenant_id)
    if ln.reconciled:
        raise CashError("Line already reconciled")
    acct = db.get(CeBankAccount, ln.header.ce_bank_account_id)
    if acct is None or acct.gl_cash_combination_id is None:
        raise CashError("Bank account has no GL cash account configured")
    from app.services.distributions import resolve_combination
    offset = resolve_combination(db, tenant_id, offset_combination_id)

    structure = sla.get_primary_structure(db, tenant_id)
    amt = Decimal(ln.amount)
    # Batch name must be unique per tenant — key it on the statement line id.
    batch_name = f"CE Adj {acct.account_code} {str(ln.id)[:8]}"
    je_name = description or f"Bank adjustment {acct.account_code} {ln.reference or ''}".strip()
    batch = sla._new_batch(db, tenant_id, "CE", gl_date, batch_name, created_by)
    header = sla._add_header(db, batch, structure.id, "Cash Management", "Cash Management",
                             gl_date, "CE_ADJUSTMENT", ln.id, je_name, created_by)
    cash_cc_id = acct.gl_cash_combination_id
    mag = abs(amt)
    if amt >= 0:  # cash increases
        cash_dr, cash_cr, off_dr, off_cr = mag, Decimal("0"), Decimal("0"), mag
    else:         # cash decreases
        cash_dr, cash_cr, off_dr, off_cr = Decimal("0"), mag, mag, Decimal("0")
    db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=1,
                    code_combination_id=cash_cc_id, entered_dr=cash_dr, entered_cr=cash_cr,
                    fund_value=acct.fund_value, description="Cash", created_by=created_by, updated_by=created_by))
    db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=2,
                    code_combination_id=offset.id, entered_dr=off_dr, entered_cr=off_cr,
                    fund_value=offset.fund_value, description="Adjustment offset",
                    created_by=created_by, updated_by=created_by))
    db.flush()
    db.refresh(batch)
    sla._set_control_totals(batch)
    ln.match_type = "ADJUSTMENT"
    ln.adjustment_je_header_id = header.id
    ln.reconciled = True
    db.flush()
    return ln


def reconcile_statement(db: Session, header: CeStatementHeader, user_id=None) -> CeStatementHeader:
    unrec = db.execute(
        select(func.count(CeStatementLine.id)).where(
            CeStatementLine.header_id == header.id, CeStatementLine.reconciled.is_(False))
    ).scalar_one()
    if unrec > 0:
        raise CashError(f"{unrec} line(s) still unreconciled")
    header.status = "RECONCILED"
    header.reconciled_by = user_id
    header.reconciled_at = datetime.now(timezone.utc)
    db.flush()
    return header


def cash_position(db: Session, tenant_id) -> list[dict]:
    """Per bank account: latest closing balance + deposits/withdrawals + open items."""
    accounts = db.execute(
        select(CeBankAccount).where(CeBankAccount.tenant_id == tenant_id,
                                    CeBankAccount.active.is_(True))
        .order_by(CeBankAccount.fund_value, CeBankAccount.account_code)
    ).scalars().all()
    out = []
    for a in accounts:
        latest = db.execute(
            select(CeStatementHeader).where(CeStatementHeader.ce_bank_account_id == a.id)
            .order_by(CeStatementHeader.statement_date.desc())
        ).scalars().first()
        deposits = withdrawals = Decimal("0")
        open_items = 0
        if latest:
            for ln in latest.lines:
                if Decimal(ln.amount) >= 0:
                    deposits += Decimal(ln.amount)
                else:
                    withdrawals += Decimal(ln.amount)
                if not ln.reconciled:
                    open_items += 1
        out.append({
            "bank_account_id": a.id, "account_code": a.account_code, "name": a.name,
            "fund_value": a.fund_value,
            "closing_balance": Decimal(latest.closing_balance) if latest else Decimal("0"),
            "deposits": deposits, "withdrawals": withdrawals, "open_items": open_items,
            "statement_date": latest.statement_date if latest else None,
        })
    return out
