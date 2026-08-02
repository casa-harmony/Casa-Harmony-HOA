"""Subledger Accounting (SLA) — "Create Accounting".

Transforms approved subledger documents (AP invoices, AR invoices, AR receipts)
into **draft GL journal batches** (GL_JE_BATCHES → HEADERS → LINES), preserving
fund segregation: liability/cash offsets are booked *per fund* so every fund's
sub-ledger nets to zero, mirroring Oracle EBS SLA + HOA fund-accounting rules.

The resulting batch is DRAFT and must be reviewed/approved by a GL accountant and
posted to GL_BALANCES (see ``gl_batch.py``).
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.gl import GlJeBatch, GlJeHeader, GlJeLine
from app.models.kff import GlCodeCombination, KffStructure
from app.models.payables import ApInvoice, ApInvoiceDistribution, ApInvoiceLine
from app.models.subledger import ArInvoice, ArReceipt
from app.models.kff import GlCodeCombination
from app.services.distributions import DistributionError
from app.services.periods import period_name

# Natural-account conventions for automatic offsets (seeded combinations).
AP_LIABILITY = "2000"   # Accounts Payable
AR_RECEIVABLE = "1100"  # Assessments Receivable
CASH_OPER = "1000"      # Operating Cash
CASH_RESV = "1010"      # Reserve Cash
ASSESSMENT_INCOME = "4000"  # Assessment Income


class AccountingError(ValueError):
    pass


def _assert_period_open(db: Session, tenant_id, gl_date) -> None:
    """Block subledger accounting into a closed period (GL lock-down)."""
    from app.services.period_close import PeriodClosedError, assert_open
    try:
        assert_open(db, tenant_id, gl_date)
    except PeriodClosedError as exc:
        raise AccountingError(str(exc))


def get_primary_structure(db: Session, tenant_id: uuid.UUID) -> KffStructure:
    s = db.execute(
        select(KffStructure).where(
            KffStructure.tenant_id == tenant_id, KffStructure.is_coa.is_(True),
            KffStructure.enabled.is_(True),
        ).order_by(KffStructure.created_at)
    ).scalars().first()
    if s is None:
        raise AccountingError("No enabled COA structure for tenant")
    return s


def _account(
    db: Session, tenant_id: uuid.UUID, structure_id: uuid.UUID, natural: str, fund: str
) -> GlCodeCombination:
    """Find an enabled, postable combination for a natural account + fund."""
    cc = db.execute(
        select(GlCodeCombination).where(
            GlCodeCombination.tenant_id == tenant_id,
            GlCodeCombination.structure_id == structure_id,
            GlCodeCombination.natural_account_value == natural,
            GlCodeCombination.fund_value == fund,
            GlCodeCombination.enabled.is_(True),
            GlCodeCombination.allow_posting.is_(True),
        )
    ).scalars().first()
    if cc is None:
        raise DistributionError(
            f"Missing GL account for natural {natural} / fund {fund}. "
            "Create the code combination before posting."
        )
    return cc


def _new_batch(
    db: Session, tenant_id: uuid.UUID, source: str, acct_date: date,
    name: str, created_by: uuid.UUID | None,
) -> GlJeBatch:
    batch = GlJeBatch(
        tenant_id=tenant_id, batch_name=name, source=source,
        accounting_date=acct_date, period_name=period_name(acct_date),
        status="DRAFT", created_by=created_by, updated_by=created_by,
    )
    db.add(batch)
    db.flush()
    return batch


def _add_header(db, batch, structure_id, category, source, acct_date, doc_type, doc_id, name, by):
    h = GlJeHeader(
        tenant_id=batch.tenant_id, batch_id=batch.id, structure_id=structure_id,
        je_name=name, je_category=category, je_source=source,
        accounting_date=acct_date, period_name=period_name(acct_date),
        status="DRAFT", source_doc_type=doc_type, source_doc_id=doc_id,
        created_by=by, updated_by=by,
    )
    db.add(h)
    db.flush()
    return h


def _set_control_totals(batch: GlJeBatch) -> None:
    dr = cr = Decimal("0")
    for h in batch.headers:
        for ln in h.lines:
            dr += ln.entered_dr
            cr += ln.entered_cr
    batch.control_total_dr = dr
    batch.control_total_cr = cr


def create_accounting_for_ap_invoice(
    db: Session, invoice: ApInvoice, created_by: uuid.UUID | None = None
) -> GlJeBatch:
    """Dr expense distributions / Cr Accounts Payable (per fund)."""
    _assert_period_open(db, invoice.tenant_id, invoice.gl_date)
    structure = get_primary_structure(db, invoice.tenant_id)
    dists = db.execute(
        select(ApInvoiceDistribution)
        .join(ApInvoiceLine, ApInvoiceLine.id == ApInvoiceDistribution.invoice_line_id)
        .where(ApInvoiceLine.invoice_id == invoice.id)
    ).scalars().all()
    if not dists:
        raise AccountingError("Invoice has no distributions to account")

    batch = _new_batch(db, invoice.tenant_id, "AP", invoice.gl_date,
                       f"AP {invoice.invoice_number}", created_by)
    header = _add_header(db, batch, structure.id, "Purchase Invoices", "Payables",
                         invoice.gl_date, "AP_INVOICE", invoice.id,
                         f"AP {invoice.invoice_number}", created_by)

    line_num = 0
    by_fund: dict[str, Decimal] = defaultdict(Decimal)
    for d in dists:
        line_num += 1
        db.add(GlJeLine(
            tenant_id=invoice.tenant_id, header_id=header.id, line_num=line_num,
            code_combination_id=d.code_combination_id, entered_dr=d.amount, entered_cr=0,
            fund_value=d.fund_value, description="Expense", created_by=created_by,
            updated_by=created_by,
        ))
        by_fund[d.fund_value] += d.amount

    # Credit AP liability per fund so each fund balances independently.
    for fund, total in by_fund.items():
        line_num += 1
        ap_acct = _account(db, invoice.tenant_id, structure.id, AP_LIABILITY, fund)
        db.add(GlJeLine(
            tenant_id=invoice.tenant_id, header_id=header.id, line_num=line_num,
            code_combination_id=ap_acct.id, entered_dr=0, entered_cr=total,
            fund_value=fund, description="Accounts Payable", created_by=created_by,
            updated_by=created_by,
        ))

    db.flush()
    db.refresh(batch)
    _set_control_totals(batch)
    invoice.gl_je_header_id = header.id
    invoice.status = "ACCOUNTED"  # draft GL batch created; awaits GL posting

    # Open a payment schedule so the invoice becomes payable.
    from app.models.payments import ApPaymentSchedule

    if not db.execute(
        select(ApPaymentSchedule).where(ApPaymentSchedule.invoice_id == invoice.id)
    ).first():
        db.add(ApPaymentSchedule(
            tenant_id=invoice.tenant_id, invoice_id=invoice.id,
            due_date=invoice.due_date or invoice.invoice_date, gross_amount=invoice.amount,
            amount_paid=Decimal("0"), status="UNPAID",
            created_by=created_by, updated_by=created_by,
        ))
    db.flush()
    return batch


def create_accounting_for_ar_invoice(
    db: Session, invoice: ArInvoice, created_by: uuid.UUID | None = None
) -> GlJeBatch:
    """Dr Assessments Receivable / Cr Assessment Income (per the invoice's fund)."""
    _assert_period_open(db, invoice.tenant_id, invoice.invoice_date)
    structure = get_primary_structure(db, invoice.tenant_id)
    fund = invoice.fund or "OPER"
    recv = _account(db, invoice.tenant_id, structure.id, AR_RECEIVABLE, fund)
    if invoice.income_combination_id:
        income = db.get(GlCodeCombination, invoice.income_combination_id)
        if income is None or income.tenant_id != invoice.tenant_id:
            raise DistributionError("Invalid income account on invoice")
    else:
        income = _account(db, invoice.tenant_id, structure.id, ASSESSMENT_INCOME, fund)

    batch = _new_batch(db, invoice.tenant_id, "AR", invoice.invoice_date,
                       f"AR {invoice.invoice_number}", created_by)
    header = _add_header(db, batch, structure.id, "Assessments", "Receivables",
                         invoice.invoice_date, "AR_INVOICE", invoice.id,
                         f"AR {invoice.invoice_number}", created_by)
    db.add(GlJeLine(
        tenant_id=invoice.tenant_id, header_id=header.id, line_num=1,
        code_combination_id=recv.id, entered_dr=invoice.amount, entered_cr=0,
        fund_value=fund, description="Assessments Receivable",
        created_by=created_by, updated_by=created_by,
    ))
    db.add(GlJeLine(
        tenant_id=invoice.tenant_id, header_id=header.id, line_num=2,
        code_combination_id=income.id, entered_dr=0, entered_cr=invoice.amount,
        fund_value=fund, description="Assessment Income",
        created_by=created_by, updated_by=created_by,
    ))
    db.flush()
    db.refresh(batch)
    _set_control_totals(batch)
    invoice.gl_je_header_id = header.id
    invoice.status = "ACCOUNTED"
    db.flush()
    return batch


def create_accounting_for_ar_invoices_bulk(
    db: Session, tenant_id: uuid.UUID, acct_date: date, created_by: uuid.UUID | None = None
) -> GlJeBatch | None:
    """Account all DRAFT AR invoices into ONE batch (monthly assessment posting).

    One JE header per invoice (Dr Receivable / Cr Income, per fund). Returns the
    batch, or None if there is nothing to account.
    """
    invoices = db.execute(
        select(ArInvoice).where(
            ArInvoice.tenant_id == tenant_id, ArInvoice.status == "DRAFT"
        )
    ).scalars().all()
    if not invoices:
        return None
    structure = get_primary_structure(db, tenant_id)
    base = f"AR Assessments {period_name(acct_date)}"
    prior = db.execute(
        select(func.count(GlJeBatch.id)).where(
            GlJeBatch.tenant_id == tenant_id, GlJeBatch.batch_name.like(f"{base}%")
        )
    ).scalar_one()
    name = base if prior == 0 else f"{base} #{prior + 1}"
    batch = _new_batch(db, tenant_id, "AR", acct_date, name, created_by)
    # Cache account lookups by fund so a 1000-invoice run does O(funds) queries.
    recv_cache: dict[str, GlCodeCombination] = {}
    income_cache: dict[str, GlCodeCombination] = {}
    for inv in invoices:
        fund = inv.fund or "OPER"
        if fund not in recv_cache:
            recv_cache[fund] = _account(db, tenant_id, structure.id, AR_RECEIVABLE, fund)
            income_cache[fund] = _account(db, tenant_id, structure.id, ASSESSMENT_INCOME, fund)
        recv = recv_cache[fund]
        income = (db.get(GlCodeCombination, inv.income_combination_id)
                  if inv.income_combination_id else income_cache[fund])
        header = _add_header(db, batch, structure.id, "Assessments", "Receivables",
                             acct_date, "AR_INVOICE", inv.id, f"AR {inv.invoice_number}", created_by)
        db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=1,
                        code_combination_id=recv.id, entered_dr=inv.amount, entered_cr=0,
                        fund_value=fund, description="Assessments Receivable",
                        created_by=created_by, updated_by=created_by))
        db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=2,
                        code_combination_id=income.id, entered_dr=0, entered_cr=inv.amount,
                        fund_value=fund, description="Assessment Income",
                        created_by=created_by, updated_by=created_by))
        inv.gl_je_header_id = header.id
        inv.status = "ACCOUNTED"
    db.flush()
    db.refresh(batch)
    _set_control_totals(batch)
    db.flush()
    return batch


def create_accounting_for_ar_receipt(
    db: Session, receipt: ArReceipt, fund: str = "OPER", created_by: uuid.UUID | None = None
) -> GlJeBatch:
    """Dr Cash / Cr Assessments Receivable (homeowner payment)."""
    structure = get_primary_structure(db, receipt.tenant_id)
    cash_natural = CASH_RESV if fund == "RESV" else CASH_OPER
    cash = _account(db, receipt.tenant_id, structure.id, cash_natural, fund)
    recv = _account(db, receipt.tenant_id, structure.id, AR_RECEIVABLE, fund)

    batch = _new_batch(db, receipt.tenant_id, "AR", receipt.receipt_date,
                       f"AR Receipt {receipt.receipt_number}", created_by)
    header = _add_header(db, batch, structure.id, "Receipts", "Receivables",
                         receipt.receipt_date, "AR_RECEIPT", receipt.id,
                         f"AR Receipt {receipt.receipt_number}", created_by)
    db.add(GlJeLine(
        tenant_id=receipt.tenant_id, header_id=header.id, line_num=1,
        code_combination_id=cash.id, entered_dr=receipt.amount, entered_cr=0,
        fund_value=fund, description="Cash", created_by=created_by, updated_by=created_by,
    ))
    db.add(GlJeLine(
        tenant_id=receipt.tenant_id, header_id=header.id, line_num=2,
        code_combination_id=recv.id, entered_dr=0, entered_cr=receipt.amount,
        fund_value=fund, description="Assessments Receivable", created_by=created_by,
        updated_by=created_by,
    ))
    db.flush()
    db.refresh(batch)
    _set_control_totals(batch)
    receipt.status = "ACCOUNTED"  # draft GL batch created; awaits GL posting
    db.flush()
    return batch


def _cash_natural(fund: str) -> str:
    return CASH_RESV if fund == "RESV" else CASH_OPER


def _payment_fund_split(db: Session, applications) -> dict:
    """Per-fund amount of a payment, derived from the paid invoices' AP distributions
    (scaled by the applied amount when an invoice is partially paid)."""
    from collections import defaultdict
    from app.models.payables import ApInvoice, ApInvoiceDistribution, ApInvoiceLine

    by_fund: dict[str, Decimal] = defaultdict(Decimal)
    for app in applications:
        inv = db.get(ApInvoice, app.invoice_id)
        if inv is None or not inv.amount:
            continue
        ratio = Decimal(app.amount_applied) / Decimal(inv.amount)
        dists = db.execute(
            select(ApInvoiceDistribution)
            .join(ApInvoiceLine, ApInvoiceLine.id == ApInvoiceDistribution.invoice_line_id)
            .where(ApInvoiceLine.invoice_id == inv.id)
        ).scalars().all()
        for d in dists:
            by_fund[d.fund_value] += (Decimal(d.amount) * ratio)
    # Quantize and fix any rounding drift against the application total on the largest fund.
    total = sum((Decimal(a.amount_applied) for a in applications), Decimal("0")).quantize(Decimal("0.01"))
    rounded = {f: amt.quantize(Decimal("0.01")) for f, amt in by_fund.items()}
    drift = total - sum(rounded.values(), Decimal("0"))
    if rounded and drift:
        big = max(rounded, key=lambda f: rounded[f])
        rounded[big] += drift
    return rounded


def _payment_je(db, payment, by_fund, *, reverse: bool, name: str, created_by):
    """Build a balanced JE batch for a payment. Normal: Dr AP / Cr Cash per fund."""
    structure = get_primary_structure(db, payment.tenant_id)
    batch = _new_batch(db, payment.tenant_id, "AP", payment.payment_date, name, created_by)
    header = _add_header(db, batch, structure.id, "Payments", "Payables",
                         payment.payment_date, "AP_PAYMENT", payment.id, name, created_by)
    line_num = 0
    for fund, amt in by_fund.items():
        if amt == 0:
            continue
        ap = _account(db, payment.tenant_id, structure.id, AP_LIABILITY, fund)
        cash = _account(db, payment.tenant_id, structure.id, _cash_natural(fund), fund)
        # Normal payment: Dr AP, Cr Cash. Reversal (void): Dr Cash, Cr AP.
        ap_dr, ap_cr = (Decimal("0"), amt) if reverse else (amt, Decimal("0"))
        cash_dr, cash_cr = (amt, Decimal("0")) if reverse else (Decimal("0"), amt)
        line_num += 1
        db.add(GlJeLine(tenant_id=payment.tenant_id, header_id=header.id, line_num=line_num,
                        code_combination_id=ap.id, entered_dr=ap_dr, entered_cr=ap_cr,
                        fund_value=fund, description="Accounts Payable",
                        created_by=created_by, updated_by=created_by))
        line_num += 1
        db.add(GlJeLine(tenant_id=payment.tenant_id, header_id=header.id, line_num=line_num,
                        code_combination_id=cash.id, entered_dr=cash_dr, entered_cr=cash_cr,
                        fund_value=fund, description="Cash",
                        created_by=created_by, updated_by=created_by))
    db.flush()
    db.refresh(batch)
    _set_control_totals(batch)
    db.flush()
    return batch, header


def create_accounting_for_payment(db, payment, applications, created_by=None):
    by_fund = _payment_fund_split(db, applications)
    batch, header = _payment_je(db, payment, by_fund, reverse=False,
                                name=f"AP Payment {payment.payment_number}", created_by=created_by)
    payment.gl_je_header_id = header.id
    db.flush()
    return batch


def create_payment_reversal(db, payment, applications, created_by=None):
    by_fund = _payment_fund_split(db, applications)
    batch, header = _payment_je(db, payment, by_fund, reverse=True,
                                name=f"Void AP Payment {payment.payment_number}", created_by=created_by)
    payment.void_je_header_id = header.id
    db.flush()
    return batch
