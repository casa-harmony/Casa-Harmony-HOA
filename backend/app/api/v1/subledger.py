from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.compliance import PaymentToken
from app.models.identity import Tenant
from app.models.subledger import ArHomeowner, ArInvoice, ArReceipt, GlJournal
from app.schemas.subledger import (
    AgingOut,
    AssessmentRunIn,
    AssessmentRunOut,
    HomeownerCreate,
    HomeownerOut,
    InvoiceCreate,
    InvoiceOut,
    JournalCreate,
    JournalOut,
    PayInvoiceIn,
    ReceiptCreate,
    ReceiptOut,
)
from app.services import audit
from app.services import ar_reports
from app.services.gl_posting import PostingError, post_ar_invoice, post_journal
from app.services.reports import build_homeowner_ledger_workbook
from app.services.subledger_accounting import (
    AccountingError,
    create_accounting_for_ar_invoice,
    create_accounting_for_ar_invoices_bulk,
    create_accounting_for_ar_receipt,
)
from app.services.distributions import DistributionError

XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _tenant_name(db: Session, tenant_id: uuid.UUID) -> str:
    t = db.get(Tenant, tenant_id)
    return t.name if t else "HOA"

router = APIRouter(
    prefix="/subledger", tags=["subledger"], dependencies=[Depends(require_active_tenant)]
)


def _mask(account: str | None) -> str | None:
    if not account:
        return None
    return f"****{account[-4:]}" if len(account) >= 4 else "****"


def _homeowner_out(h: ArHomeowner) -> HomeownerOut:
    return HomeownerOut(
        id=h.id,
        account_number=h.account_number,
        first_name=h.first_name,
        last_name=h.last_name,
        email=h.email,
        property_unit=h.property_unit,
        bank_account_masked=_mask(h.bank_account),
        status=h.status,
    )


# --- AR Homeowners ---------------------------------------------------------
@router.get("/homeowners", response_model=list[HomeownerOut])
def list_homeowners(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ar.manage")),
):
    rows = db.execute(
        select(ArHomeowner).where(ArHomeowner.tenant_id == principal.tenant_id)
        .order_by(ArHomeowner.account_number)
    ).scalars().all()
    return [_homeowner_out(h) for h in rows]


@router.post("/homeowners", response_model=HomeownerOut, status_code=status.HTTP_201_CREATED)
def create_homeowner(
    payload: HomeownerCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ar.manage")),
):
    h = ArHomeowner(
        tenant_id=principal.tenant_id,
        created_by=principal.user.id,
        updated_by=principal.user.id,
        **payload.model_dump(),
    )
    db.add(h)
    db.flush()
    audit.record(db, action="CREATE", entity_type="ArHomeowner", entity_id=h.id,
                 after={"account_number": h.account_number})
    return _homeowner_out(h)


# --- AR Invoices (post to GL) ---------------------------------------------
@router.get("/invoices", response_model=list[InvoiceOut])
def list_invoices(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ar.manage")),
):
    return db.execute(
        select(ArInvoice).where(ArInvoice.tenant_id == principal.tenant_id)
        .order_by(ArInvoice.invoice_date.desc())
    ).scalars().all()


@router.post("/invoices", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
def create_invoice(
    payload: InvoiceCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ar.manage")),
):
    homeowner = db.get(ArHomeowner, payload.homeowner_id)
    if homeowner is None or homeowner.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Homeowner not found")

    invoice = ArInvoice(
        tenant_id=principal.tenant_id,
        homeowner_id=payload.homeowner_id,
        invoice_number=payload.invoice_number,
        description=payload.description,
        amount=payload.amount,
        invoice_date=payload.invoice_date,
        due_date=payload.due_date,
        created_by=principal.user.id,
        updated_by=principal.user.id,
    )
    db.add(invoice)
    db.flush()
    try:
        post_ar_invoice(
            db,
            invoice=invoice,
            structure_id=payload.structure_id,
            receivable_ccid=payload.receivable_combination_id,
            income_ccid=payload.income_combination_id,
            created_by=principal.user.id,
        )
    except PostingError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="POST", entity_type="ArInvoice", entity_id=invoice.id,
                 after={"invoice_number": invoice.invoice_number, "amount": str(invoice.amount)})
    return invoice


# --- GL Journals -----------------------------------------------------------
@router.get("/journals", response_model=list[JournalOut])
def list_journals(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("gl.journal.manage")),
):
    return db.execute(
        select(GlJournal).where(GlJournal.tenant_id == principal.tenant_id)
        .order_by(GlJournal.accounting_date.desc())
    ).scalars().all()


@router.post("/journals", response_model=JournalOut, status_code=status.HTTP_201_CREATED)
def create_journal(
    payload: JournalCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("gl.journal.manage")),
):
    try:
        journal = post_journal(
            db,
            tenant_id=principal.tenant_id,
            structure_id=payload.structure_id,
            accounting_date=payload.accounting_date,
            description=payload.description,
            source="Manual",
            created_by=principal.user.id,
            lines=[ln.model_dump() for ln in payload.lines],
        )
    except PostingError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="POST", entity_type="GlJournal", entity_id=journal.id,
                 after={"journal_number": journal.journal_number})
    return journal


# --- AR Receipts -----------------------------------------------------------
@router.get("/receipts", response_model=list[ReceiptOut])
def list_receipts(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ar.receipt.manage")),
):
    return db.execute(
        select(ArReceipt).where(ArReceipt.tenant_id == principal.tenant_id)
        .order_by(ArReceipt.receipt_date.desc())
    ).scalars().all()


@router.post("/receipts", response_model=ReceiptOut, status_code=status.HTTP_201_CREATED)
def create_receipt(
    payload: ReceiptCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ar.receipt.manage")),
):
    ho = db.get(ArHomeowner, payload.homeowner_id)
    if ho is None or ho.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Homeowner not found")
    receipt = ArReceipt(
        tenant_id=principal.tenant_id, homeowner_id=payload.homeowner_id,
        applied_invoice_id=payload.applied_invoice_id, receipt_number=payload.receipt_number,
        amount=payload.amount, receipt_date=payload.receipt_date,
        payment_method=payload.payment_method, status="APPLIED",
        created_by=principal.user.id, updated_by=principal.user.id,
    )
    db.add(receipt)
    db.flush()
    # Apply to the invoice balance if specified.
    if payload.applied_invoice_id:
        inv = db.get(ArInvoice, payload.applied_invoice_id)
        if inv and inv.tenant_id == principal.tenant_id:
            inv.amount_paid = (inv.amount_paid or Decimal("0")) + payload.amount
            if inv.amount_paid >= inv.amount:
                inv.status = "PAID"
    # Subledger Accounting: Dr Cash / Cr Receivable (draft GL batch).
    try:
        create_accounting_for_ar_receipt(db, receipt, fund=payload.fund,
                                         created_by=principal.user.id)
    except (AccountingError, DistributionError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Accounting failed: {exc}")
    audit.record(db, action="CREATE", entity_type="ArReceipt", entity_id=receipt.id,
                 after={"receipt_number": receipt.receipt_number, "amount": str(receipt.amount)})
    return receipt


# --- Bulk monthly assessment billing (scales to ~1000 homeowners) ----------
@router.post("/assessment-run", response_model=AssessmentRunOut)
def assessment_run(
    payload: AssessmentRunIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ar.manage")),
):
    homeowners = db.execute(
        select(ArHomeowner).where(
            ArHomeowner.tenant_id == principal.tenant_id, ArHomeowner.status == "active"
        )
    ).scalars().all()
    seq = db.execute(
        select(func.count(ArInvoice.id)).where(ArInvoice.tenant_id == principal.tenant_id)
    ).scalar_one()
    created = 0
    for ho in homeowners:
        seq += 1
        db.add(ArInvoice(
            tenant_id=principal.tenant_id, homeowner_id=ho.id,
            invoice_number=f"{payload.number_prefix}-{seq:06d}",
            invoice_type=payload.invoice_type, amount=payload.amount,
            invoice_date=payload.invoice_date, due_date=payload.due_date,
            description=f"{payload.invoice_type} {payload.invoice_date.isoformat()}",
            status="DRAFT", created_by=principal.user.id, updated_by=principal.user.id,
        ))
        created += 1
    db.flush()
    audit.record(db, action="ASSESSMENT_RUN", entity_type="ArInvoice",
                 after={"count": created})
    return AssessmentRunOut(invoices_created=created,
                            total_billed=payload.amount * created)


# --- Homeowner ledger export ----------------------------------------------
@router.get("/homeowners/{homeowner_id}/ledger/export")
def export_homeowner_ledger(
    homeowner_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    ho = db.get(ArHomeowner, homeowner_id)
    if ho is None or ho.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Homeowner not found")
    xlsx = build_homeowner_ledger_workbook(db, principal.tenant_id, ho)
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="ledger_{ho.account_number}.xlsx"'},
    )


# --- AR invoice accounting (Subledger Accounting → draft GL batch) ----------
@router.post("/invoices/{invoice_id}/account", response_model=InvoiceOut)
def account_invoice(
    invoice_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ar.manage")),
):
    inv = db.get(ArInvoice, invoice_id)
    if inv is None or inv.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    if inv.status != "DRAFT":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invoice is {inv.status}")
    try:
        create_accounting_for_ar_invoice(db, inv, created_by=principal.user.id)
    except (AccountingError, DistributionError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Accounting failed: {exc}")
    audit.record(db, action="ACCOUNT", entity_type="ArInvoice", entity_id=inv.id)
    return inv


@router.post("/invoices/account-run")
def account_run(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ar.manage")),
):
    """Account all DRAFT AR invoices into one GL batch (monthly assessment posting)."""
    try:
        batch = create_accounting_for_ar_invoices_bulk(
            db, principal.tenant_id, date.today(), created_by=principal.user.id
        )
    except (AccountingError, DistributionError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Accounting failed: {exc}")
    if batch is None:
        return {"batch_id": None, "message": "No draft invoices to account"}
    audit.record(db, action="ACCOUNT_RUN", entity_type="GlJeBatch", entity_id=batch.id)
    return {"batch_id": batch.id, "batch_name": batch.batch_name}


# --- Online payment (PCI stub) → receipt + accounting ----------------------
@router.post("/invoices/{invoice_id}/pay", response_model=ReceiptOut, status_code=status.HTTP_201_CREATED)
def pay_invoice(
    invoice_id: uuid.UUID,
    payload: PayInvoiceIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ar.receipt.manage")),
):
    """Record an online payment against an invoice using a tokenized method (no PAN)."""
    inv = db.get(ArInvoice, invoice_id)
    if inv is None or inv.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    if payload.payment_method == "CARD" and payload.payment_token_id:
        tok = db.get(PaymentToken, payload.payment_token_id)
        if tok is None or tok.tenant_id != principal.tenant_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment method not found")
    seq = db.execute(
        select(func.count(ArReceipt.id)).where(ArReceipt.tenant_id == principal.tenant_id)
    ).scalar_one()
    receipt = ArReceipt(
        tenant_id=principal.tenant_id, homeowner_id=inv.homeowner_id,
        applied_invoice_id=inv.id,
        receipt_number=payload.receipt_number or f"PAY-{seq + 1:06d}",
        amount=payload.amount, receipt_date=date.today(),
        payment_method=payload.payment_method, status="APPLIED",
        created_by=principal.user.id, updated_by=principal.user.id,
    )
    db.add(receipt)
    db.flush()
    inv.amount_paid = (inv.amount_paid or Decimal("0")) + payload.amount
    if inv.amount_paid >= inv.amount:
        inv.status = "PAID"
    try:
        create_accounting_for_ar_receipt(db, receipt, fund=payload.fund, created_by=principal.user.id)
    except (AccountingError, DistributionError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Accounting failed: {exc}")
    audit.record(db, action="PAYMENT", entity_type="ArReceipt", entity_id=receipt.id,
                 after={"invoice": inv.invoice_number, "amount": str(payload.amount)})
    return receipt


# --- AR analytics & reports -------------------------------------------------
@router.get("/aging", response_model=AgingOut)
def aging(
    as_of: date | None = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    data = ar_reports.compute_aging(db, principal.tenant_id, as_of or date.today())
    return AgingOut(
        as_of=data["as_of"],
        totals={k: float(v) for k, v in data["totals"].items()},
        grand_total=float(data["grand_total"]),
        rows=[{"account_number": r["account_number"], "name": r["name"],
               "buckets": {k: float(v) for k, v in r["buckets"].items()},
               "total": float(r["total"])} for r in data["rows"]],
    )


def _xlsx(content: bytes, filename: str) -> Response:
    return Response(content=content, media_type=XLSX_MEDIA,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/ar-aging/export")
def export_aging(
    as_of: date | None = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    d = as_of or date.today()
    xlsx = ar_reports.build_ar_aging_workbook(db, principal.tenant_id, d, _tenant_name(db, principal.tenant_id))
    return _xlsx(xlsx, f"ar_aging_{d.isoformat()}.xlsx")


@router.get("/collections/export")
def export_collections(
    start: date,
    end: date,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    xlsx = ar_reports.build_collections_workbook(db, principal.tenant_id, start, end, _tenant_name(db, principal.tenant_id))
    return _xlsx(xlsx, f"collections_{start.isoformat()}_{end.isoformat()}.xlsx")


@router.get("/ar-summary/export")
def export_ar_summary(
    as_of: date | None = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    d = as_of or date.today()
    xlsx = ar_reports.build_fund_ar_summary_workbook(db, principal.tenant_id, d, _tenant_name(db, principal.tenant_id))
    return _xlsx(xlsx, f"ar_by_fund_{d.isoformat()}.xlsx")
