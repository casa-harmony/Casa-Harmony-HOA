"""NetSuite-style legacy → ERP data migration engine.

Modeled on the NetSuite CSV Import Assistant:

* **External IDs** — every source row carries the legacy key (``external_id``), stored
  on the migration record. It provides idempotency and lets one file reference records
  loaded by another (an invoice line points at its vendor by ``vendor_number``).
* **Import modes** — ADD (create, skip existing), UPDATE (update existing, error if
  missing), UPSERT (add-or-update), keyed off the external id / natural key.
* **Header + line (sublist) documents** — a transactional importer declares
  ``line_columns``; input rows sharing the same external id form one document (header
  from the first row, lines collected), exactly like a NetSuite transaction import.
* **Load order** — Setup → Masters → Open Transactions → Historical, surfaced per
  entity so the cutover runs in dependency order.
* **Import jobs + results** — each run is a MigrationBatch with per-row results
  (action + message) and a downloadable xlsx, and is fully reversible (rollback).

Open AR/AP documents load as DRAFT (no GL post) so a batch is fully reversible; staff
post them through the normal controlled flow at cutover.
"""
from __future__ import annotations

import csv
import io
from datetime import date
from decimal import Decimal, InvalidOperation

from openpyxl import Workbook, load_workbook
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.kff import GlCodeCombination
from app.models.masters import ApSupplier
from app.models.migration import MigrationBatch, MigrationRecord
from app.models.collections import DelinquencyCase
from app.models.supplier_ext import ApSupplierBankAccount
from app.models.payables import ApInvoice, ApInvoiceDistribution, ApInvoiceLine
from app.models.payments import ApPayment
from app.models.procurement import PoDistribution, PoHeader, PoLine
from app.models.subledger import ArHomeowner, ArInvoice, ArReceipt

CENT = Decimal("0.01")
MODES = ("ADD", "UPDATE", "UPSERT")


class MigrationError(ValueError):
    pass


# --- file parsing ----------------------------------------------------------
def parse_rows(filename: str, data: bytes) -> list[dict]:
    if filename and filename.lower().endswith((".xlsx", ".xlsm")):
        ws = load_workbook(io.BytesIO(data), data_only=True).active
        headers = [str(c.value).strip().lower() if c.value is not None else "" for c in ws[1]]
        rows = []
        for r in ws.iter_rows(min_row=2, values_only=True):
            if not any(v is not None and str(v).strip() for v in r):
                continue
            rows.append({headers[i]: r[i] for i in range(min(len(headers), len(r)))})
        return rows
    text = data.decode("utf-8-sig", errors="replace")
    return [{(k or "").strip().lower(): v for k, v in rec.items()}
            for rec in csv.DictReader(io.StringIO(text))]


def _norm(name: str) -> str:
    return "".join(ch for ch in str(name).strip().lower() if ch.isalnum())


def apply_mapping(rows: list[dict], entity_type: str, mapping: dict | None = None) -> list[dict]:
    """Rename source columns to the importer's canonical columns (NetSuite field mapping).

    ``mapping`` is an explicit {source_header: canonical_column} override; unmapped
    columns are auto-matched by normalized name (case/space/punctuation-insensitive).
    """
    canon = _columns_for(entity_type)
    by_norm = {_norm(c): c for c in canon}
    override = {_norm(k): v for k, v in (mapping or {}).items()}
    out = []
    for row in rows:
        mapped = {}
        for src, val in row.items():
            n = _norm(src)
            target = override.get(n) or by_norm.get(n)
            if target:
                mapped[target] = val
            else:
                mapped[src] = val  # keep unrecognized columns (harmless)
        out.append(mapped)
    return out


def auto_map(headers: list[str], entity_type: str) -> dict:
    """Suggest a {source_header: canonical_column} mapping for a preview/mapping grid."""
    by_norm = {_norm(c): c for c in _columns_for(entity_type)}
    return {h: by_norm[_norm(h)] for h in headers if _norm(h) in by_norm}


def _s(row, key):
    v = row.get(key)
    return str(v).strip() if v is not None and str(v).strip() != "" else None


def _dec(v):
    try:
        return Decimal(str(v).replace(",", "").replace("$", "")).quantize(CENT)
    except (InvalidOperation, AttributeError, ValueError):
        return None


def _parse_date(v):
    s = _s({"d": v}, "d")
    if not s:
        return date.today()
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return date.today()


# --- reference resolution (external id ledger + natural keys) --------------
def resolve_external(db: Session, tenant_id, entity_type: str, external_id: str):
    """Target id created for a given (entity_type, external_id) in a prior batch."""
    row = db.execute(select(MigrationRecord.target_id).where(
        MigrationRecord.tenant_id == tenant_id,
        MigrationRecord.entity_type == entity_type,
        MigrationRecord.source_ref == external_id,
        MigrationRecord.action.in_(("CREATE", "UPDATE")),
        MigrationRecord.target_id.isnot(None)).order_by(
        MigrationRecord.created_at.desc())).first()
    return row[0] if row else None


def find_homeowner(db, tenant_id, key):
    return db.execute(select(ArHomeowner).where(
        ArHomeowner.tenant_id == tenant_id, ArHomeowner.account_number == key)).scalar_one_or_none()


def find_vendor(db, tenant_id, key):
    return db.execute(select(ApSupplier).where(
        ApSupplier.tenant_id == tenant_id, ApSupplier.vendor_number == key)).scalar_one_or_none()


def find_combination(db, tenant_id, seg):
    return db.execute(select(GlCodeCombination).where(
        GlCodeCombination.tenant_id == tenant_id,
        GlCodeCombination.concatenated_segments == seg)).scalar_one_or_none()


# --- simple master/document importers --------------------------------------
def _homeowner_validate(db, tenant_id, row):
    acct = _s(row, "account_number")
    if not acct or not _s(row, "first_name") or not _s(row, "last_name"):
        return None, "account_number, first_name, last_name are required"
    return acct, None


def _homeowner_exists(db, tenant_id, row):
    ho = find_homeowner(db, tenant_id, _s(row, "account_number"))
    return ho.id if ho else None


def _homeowner_create(db, tenant_id, row, created_by):
    ho = ArHomeowner(tenant_id=tenant_id, account_number=_s(row, "account_number"),
                     first_name=_s(row, "first_name"), last_name=_s(row, "last_name"),
                     email=_s(row, "email"), property_unit=_s(row, "property_unit"),
                     status="active", created_by=created_by, updated_by=created_by)
    db.add(ho); db.flush()
    return ho.id


def _homeowner_update(db, tenant_id, target_id, row, created_by):
    ho = db.get(ArHomeowner, target_id)
    for col in ("first_name", "last_name", "email", "property_unit"):
        val = _s(row, col)
        if val is not None:
            setattr(ho, col, val)
    ho.updated_by = created_by
    db.flush()


def _vendor_validate(db, tenant_id, row):
    vno = _s(row, "vendor_number")
    if not vno or not _s(row, "name"):
        return None, "vendor_number and name are required"
    return vno, None


def _vendor_exists(db, tenant_id, row):
    v = find_vendor(db, tenant_id, _s(row, "vendor_number"))
    return v.id if v else None


def _vendor_create(db, tenant_id, row, created_by):
    v = ApSupplier(tenant_id=tenant_id, vendor_number=_s(row, "vendor_number"),
                   name=_s(row, "name"), email=_s(row, "email"),
                   payment_terms=_s(row, "payment_terms") or "NET30",
                   status="active", created_by=created_by, updated_by=created_by)
    db.add(v); db.flush()
    return v.id


def _vendor_update(db, tenant_id, target_id, row, created_by):
    v = db.get(ApSupplier, target_id)
    if _s(row, "name"):
        v.name = _s(row, "name")
    for col in ("email", "payment_terms"):
        val = _s(row, col)
        if val is not None:
            setattr(v, col, val)
    v.updated_by = created_by
    db.flush()


def _opening_validate(db, tenant_id, row):
    acct = _s(row, "account_number")
    if not acct:
        return None, "account_number is required"
    if _dec(row.get("amount")) is None:
        return None, "amount must be numeric"
    if not _s(row, "income_account") or not _s(row, "fund"):
        return None, "income_account and fund are required"
    if find_homeowner(db, tenant_id, acct) is None:
        return None, f"homeowner {acct} not found (load homeowners first)"
    if find_combination(db, tenant_id, _s(row, "income_account")) is None:
        return None, f"income account {_s(row, 'income_account')} not found in COA"
    return f"{acct}:OPENING", None


def _opening_create(db, tenant_id, row, created_by):
    ho = find_homeowner(db, tenant_id, _s(row, "account_number"))
    cc = find_combination(db, tenant_id, _s(row, "income_account"))
    n = db.execute(select(func.count(ArInvoice.id)).where(ArInvoice.tenant_id == tenant_id)).scalar_one()
    d = _parse_date(row.get("invoice_date"))
    inv = ArInvoice(tenant_id=tenant_id, homeowner_id=ho.id,
                    invoice_number=f"OPEN-{n + 1:06d}", description="Opening balance (migrated)",
                    invoice_type="OPENING", amount=_dec(row.get("amount")), invoice_date=d,
                    due_date=d, status="DRAFT", fund=_s(row, "fund"),
                    income_combination_id=cc.id, created_by=created_by, updated_by=created_by)
    db.add(inv); db.flush()
    return inv.id


# --- header + line (sublist) document importers ----------------------------
def _validate_lines(db, tenant_id, lines):
    """Common per-line validation: numeric amount + resolvable account + fund."""
    for ln in lines:
        if _dec(ln.get("amount")) is None:
            return "every line needs a numeric amount"
        if not _s(ln, "account") or find_combination(db, tenant_id, _s(ln, "account")) is None:
            return f"line account {_s(ln, 'account')!r} not found in COA"
        if not _s(ln, "fund"):
            return "every line needs a fund"
    return None


def _ap_invoice_validate(db, tenant_id, header, lines):
    ext = _s(header, "external_id")
    if not ext:
        return None, "external_id is required"
    if not _s(header, "vendor_number") or find_vendor(db, tenant_id, _s(header, "vendor_number")) is None:
        return None, f"vendor {_s(header, 'vendor_number')} not found (load vendors first)"
    err = _validate_lines(db, tenant_id, lines)
    return (None, err) if err else (ext, None)


def _ap_invoice_create(db, tenant_id, header, lines, created_by):
    vendor = find_vendor(db, tenant_id, _s(header, "vendor_number"))
    total = sum(_dec(ln.get("amount")) for ln in lines)
    d = _parse_date(header.get("invoice_date"))
    inv = ApInvoice(tenant_id=tenant_id, vendor_id=vendor.id,
                    invoice_number=_s(header, "invoice_number") or _s(header, "external_id"),
                    invoice_date=d, gl_date=d, due_date=d, amount=total, status="DRAFT",
                    approval_status="DRAFT", description=_s(header, "description") or "Migrated open invoice",
                    created_by=created_by, updated_by=created_by)
    db.add(inv); db.flush()
    for i, ln in enumerate(lines, start=1):
        cc = find_combination(db, tenant_id, _s(ln, "account"))
        line = ApInvoiceLine(tenant_id=tenant_id, invoice_id=inv.id, line_num=i,
                             description=_s(ln, "line_description"), amount=_dec(ln.get("amount")),
                             created_by=created_by, updated_by=created_by)
        db.add(line); db.flush()
        db.add(ApInvoiceDistribution(tenant_id=tenant_id, invoice_line_id=line.id, distribution_num=1,
                                     code_combination_id=cc.id, amount=_dec(ln.get("amount")),
                                     fund_value=_s(ln, "fund"), created_by=created_by, updated_by=created_by))
    db.flush()
    return inv.id


def _po_validate(db, tenant_id, header, lines):
    ext = _s(header, "external_id")
    if not ext:
        return None, "external_id is required"
    if not _s(header, "vendor_number") or find_vendor(db, tenant_id, _s(header, "vendor_number")) is None:
        return None, f"vendor {_s(header, 'vendor_number')} not found (load vendors first)"
    for ln in lines:
        if not _s(ln, "item_description"):
            return None, "every line needs an item_description"
    err = _validate_lines(db, tenant_id, lines)
    return (None, err) if err else (ext, None)


def _po_create(db, tenant_id, header, lines, created_by):
    vendor = find_vendor(db, tenant_id, _s(header, "vendor_number"))
    po = PoHeader(tenant_id=tenant_id, vendor_id=vendor.id,
                  po_number=_s(header, "po_number") or _s(header, "external_id"),
                  description=_s(header, "description") or "Migrated PO/contract",
                  order_date=_parse_date(header.get("order_date")), status="INCOMPLETE",
                  approval_status="DRAFT", created_by=created_by, updated_by=created_by)
    db.add(po); db.flush()
    total = Decimal("0")
    for i, ln in enumerate(lines, start=1):
        qty = _dec(ln.get("quantity")) or Decimal("1")
        amt = _dec(ln.get("amount"))
        unit = _dec(ln.get("unit_price")) or (amt / qty if qty else amt)
        cc = find_combination(db, tenant_id, _s(ln, "account"))
        line = PoLine(tenant_id=tenant_id, po_header_id=po.id, line_num=i,
                      item_description=_s(ln, "item_description"), quantity=qty,
                      unit_price=unit, line_amount=amt, created_by=created_by, updated_by=created_by)
        db.add(line); db.flush()
        db.add(PoDistribution(tenant_id=tenant_id, po_line_id=line.id, distribution_num=1,
                              code_combination_id=cc.id, amount=amt, fund_value=_s(ln, "fund"),
                              quantity_ordered=qty, created_by=created_by, updated_by=created_by))
        total += amt
    po.amount = total
    db.flush()
    return po.id


# --- historical importers (receipts, vendor payments/1099, delinquency) ----
def _ar_receipt_validate(db, tenant_id, row):
    ext = _s(row, "external_id") or _s(row, "receipt_number")
    if not ext:
        return None, "external_id (or receipt_number) is required"
    if _dec(row.get("amount")) is None:
        return None, "amount must be numeric"
    acct = _s(row, "account_number")
    if not acct or find_homeowner(db, tenant_id, acct) is None:
        return None, f"homeowner {acct} not found (load homeowners first)"
    return ext, None


def _ar_receipt_create(db, tenant_id, row, created_by):
    ho = find_homeowner(db, tenant_id, _s(row, "account_number"))
    applied = None
    inv_no = _s(row, "invoice_number")
    if inv_no:
        inv = db.execute(select(ArInvoice).where(
            ArInvoice.tenant_id == tenant_id, ArInvoice.homeowner_id == ho.id,
            ArInvoice.invoice_number == inv_no)).scalar_one_or_none()
        applied = inv.id if inv else None
    rcpt = ArReceipt(tenant_id=tenant_id, homeowner_id=ho.id, applied_invoice_id=applied,
                     receipt_number=_s(row, "receipt_number") or _s(row, "external_id"),
                     amount=_dec(row.get("amount")), receipt_date=_parse_date(row.get("receipt_date")),
                     payment_method=(_s(row, "payment_method") or "CHECK").upper(), status="APPLIED",
                     created_by=created_by, updated_by=created_by)
    db.add(rcpt); db.flush()
    return rcpt.id


def _ap_payment_validate(db, tenant_id, row):
    ext = _s(row, "external_id") or _s(row, "payment_number")
    if not ext:
        return None, "external_id (or payment_number) is required"
    if _dec(row.get("amount")) is None:
        return None, "amount must be numeric"
    vno = _s(row, "vendor_number")
    if not vno or find_vendor(db, tenant_id, vno) is None:
        return None, f"vendor {vno} not found (load vendors first)"
    return ext, None


def _ap_payment_create(db, tenant_id, row, created_by):
    vendor = find_vendor(db, tenant_id, _s(row, "vendor_number"))
    pay = ApPayment(tenant_id=tenant_id, vendor_id=vendor.id,
                    payment_number=_s(row, "payment_number") or _s(row, "external_id"),
                    payment_date=_parse_date(row.get("payment_date")), amount=_dec(row.get("amount")),
                    reference=_s(row, "reference"), memo=_s(row, "memo"), status="CREATED",
                    created_by=created_by, updated_by=created_by)
    db.add(pay); db.flush()
    return pay.id


def _delinquency_validate(db, tenant_id, row):
    acct = _s(row, "account_number")
    if not acct or find_homeowner(db, tenant_id, acct) is None:
        return None, f"homeowner {acct} not found (load homeowners first)"
    stage = (_s(row, "stage") or "NOTICE").upper()
    if stage not in ("NOTICE", "PAYMENT_PLAN", "LIEN", "RESOLVED"):
        return None, f"invalid stage {stage}"
    return acct, None


def _delinquency_exists(db, tenant_id, row):
    ho = find_homeowner(db, tenant_id, _s(row, "account_number"))
    case = db.execute(select(DelinquencyCase.id).where(
        DelinquencyCase.tenant_id == tenant_id, DelinquencyCase.homeowner_id == ho.id)).first()
    return case[0] if case else None


def _delinquency_create(db, tenant_id, row, created_by):
    ho = find_homeowner(db, tenant_id, _s(row, "account_number"))
    case = DelinquencyCase(tenant_id=tenant_id, homeowner_id=ho.id,
                           stage=(_s(row, "stage") or "NOTICE").upper(),
                           opened_date=_parse_date(row.get("opened_date")),
                           balance_at_open=_dec(row.get("balance")) or Decimal("0"),
                           notes=_s(row, "notes"), created_by=created_by, updated_by=created_by)
    db.add(case); db.flush()
    return case.id


def _vendor_bank_validate(db, tenant_id, row):
    ext = _s(row, "external_id")
    if not ext:
        return None, "external_id is required"
    vno = _s(row, "vendor_number")
    if not vno or find_vendor(db, tenant_id, vno) is None:
        return None, f"vendor {vno} not found (load vendors first)"
    if not _s(row, "bank_name"):
        return None, "bank_name is required"
    return ext, None


def _vendor_bank_create(db, tenant_id, row, created_by):
    vendor = find_vendor(db, tenant_id, _s(row, "vendor_number"))
    acct = ApSupplierBankAccount(
        tenant_id=tenant_id, supplier_id=vendor.id, bank_name=_s(row, "bank_name"),
        routing_number=_s(row, "routing_number"), account_number=_s(row, "account_number"),
        account_type=(_s(row, "account_type") or "CHECKING").upper(),
        is_primary=str(_s(row, "is_primary") or "").lower() in ("1", "true", "yes", "y"),
        created_by=created_by, updated_by=created_by)
    db.add(acct); db.flush()
    return acct.id


IMPORTERS: dict = {
    "HOMEOWNER": {
        "label": "Homeowners / units", "kind": "MASTER", "load_order": 10,
        "columns": ["account_number", "first_name", "last_name", "email", "property_unit"],
        "key": "account_number", "modes": ("ADD", "UPDATE", "UPSERT"),
        "validate": _homeowner_validate, "exists": _homeowner_exists,
        "create": _homeowner_create, "update": _homeowner_update, "target_model": ArHomeowner,
    },
    "VENDOR": {
        "label": "Vendors / suppliers", "kind": "MASTER", "load_order": 20,
        "columns": ["vendor_number", "name", "email", "payment_terms"],
        "key": "vendor_number", "modes": ("ADD", "UPDATE", "UPSERT"),
        "validate": _vendor_validate, "exists": _vendor_exists,
        "create": _vendor_create, "update": _vendor_update, "target_model": ApSupplier,
    },
    "VENDOR_BANK": {
        "label": "Vendor bank accounts (tokenized)", "kind": "MASTER", "load_order": 25,
        "columns": ["external_id", "vendor_number", "bank_name", "routing_number",
                    "account_number", "account_type", "is_primary"],
        "key": "external_id", "modes": ("ADD",),
        "validate": _vendor_bank_validate, "exists": None,
        "create": _vendor_bank_create, "update": None, "target_model": ApSupplierBankAccount,
    },
    "AR_OPENING": {
        "label": "AR opening balances (open invoices)", "kind": "OPEN_TXN", "load_order": 50,
        "columns": ["account_number", "amount", "income_account", "fund", "invoice_date"],
        "key": "account_number", "modes": ("ADD",),
        "validate": _opening_validate, "exists": None,
        "create": _opening_create, "update": None, "target_model": ArInvoice,
    },
    "AP_OPEN_INVOICE": {
        "label": "Open AP invoices (header + lines + distributions)", "kind": "OPEN_TXN",
        "load_order": 55, "key": "external_id", "modes": ("ADD",),
        "columns": ["external_id", "vendor_number", "invoice_number", "invoice_date", "description"],
        "line_columns": ["line_description", "account", "fund", "amount"],
        "validate_doc": _ap_invoice_validate, "create_doc": _ap_invoice_create,
        "target_model": ApInvoice,
    },
    "PO_OPEN": {
        "label": "Purchase orders / contracts (header + lines + distributions)", "kind": "OPEN_TXN",
        "load_order": 60, "key": "external_id", "modes": ("ADD",),
        "columns": ["external_id", "vendor_number", "po_number", "order_date", "description"],
        "line_columns": ["item_description", "quantity", "unit_price", "account", "fund"],
        "validate_doc": _po_validate, "create_doc": _po_create, "target_model": PoHeader,
    },
    "DELINQUENCY_CASE": {
        "label": "Delinquency cases", "kind": "OPEN_TXN", "load_order": 65,
        "columns": ["account_number", "stage", "opened_date", "balance", "notes"],
        "key": "account_number", "modes": ("ADD",),
        "validate": _delinquency_validate, "exists": _delinquency_exists,
        "create": _delinquency_create, "update": None, "target_model": DelinquencyCase,
    },
    "AR_RECEIPT": {
        "label": "Historical AR receipts / payments", "kind": "HISTORICAL", "load_order": 70,
        "columns": ["external_id", "account_number", "receipt_number", "amount",
                    "receipt_date", "payment_method", "invoice_number"],
        "key": "external_id", "modes": ("ADD",),
        "validate": _ar_receipt_validate, "exists": None,
        "create": _ar_receipt_create, "update": None, "target_model": ArReceipt,
    },
    "AP_PAYMENT": {
        "label": "Historical vendor payments (1099)", "kind": "HISTORICAL", "load_order": 75,
        "columns": ["external_id", "vendor_number", "payment_number", "amount",
                    "payment_date", "reference", "memo"],
        "key": "external_id", "modes": ("ADD",),
        "validate": _ap_payment_validate, "exists": None,
        "create": _ap_payment_create, "update": None, "target_model": ApPayment,
    },
}


def _next_batch_number(db, tenant_id) -> str:
    n = db.execute(select(func.count(MigrationBatch.id)).where(
        MigrationBatch.tenant_id == tenant_id)).scalar_one()
    return f"MIG-{n + 1:05d}"


def _add_record(db, batch, tenant_id, external_id, row_num, action, message, created_by, target_id=None):
    rec = MigrationRecord(tenant_id=tenant_id, batch_id=batch.id, entity_type=batch.entity_type,
                          source_ref=external_id or f"row{row_num}", row_num=row_num,
                          action=action, message=message, target_id=target_id,
                          created_by=created_by, updated_by=created_by)
    db.add(rec)
    return rec


def _group_documents(imp, rows):
    """Group line rows into documents keyed by the external-id column (NetSuite sublist)."""
    key = imp["key"]
    docs: dict = {}
    order: list = []
    for i, row in enumerate(rows, start=1):
        ext = _s(row, key)
        if ext is None:
            order.append((None, [(i, row)]))  # invalid header surfaced later
            continue
        if ext not in docs:
            docs[ext] = []
            order.append((ext, docs[ext]))
        docs[ext].append((i, row))
    return order


def run_migration(db: Session, *, tenant_id, entity_type, rows, filename=None,
                  dry_run=True, mode="ADD", mapping=None, created_by=None) -> MigrationBatch:
    if entity_type not in IMPORTERS:
        raise MigrationError(f"Unknown entity type: {entity_type}")
    imp = IMPORTERS[entity_type]
    if mode not in imp.get("modes", ("ADD",)):
        raise MigrationError(f"{entity_type} does not support mode {mode}")
    rows = apply_mapping(rows, entity_type, mapping)
    batch = MigrationBatch(
        tenant_id=tenant_id, batch_number=_next_batch_number(db, tenant_id), entity_type=entity_type,
        source_filename=filename, status="DRY_RUN" if dry_run else "COMMITTED", mode=mode,
        total_rows=len(rows), created_by=created_by, updated_by=created_by)
    db.add(batch); db.flush()

    if imp.get("line_columns"):
        _run_documents(db, batch, imp, rows, tenant_id, dry_run, mode, created_by)
    else:
        _run_simple(db, batch, imp, rows, tenant_id, dry_run, mode, created_by)
    db.flush()
    return batch


def _apply(db, batch, imp, tenant_id, external_id, row, dry_run, mode, created_by, row_num):
    """Resolve existence and apply ADD/UPDATE/UPSERT for one record. Returns action."""
    existing = imp["exists"](db, tenant_id, row) if imp.get("exists") else \
        resolve_external(db, tenant_id, batch.entity_type, external_id)
    if existing:
        if mode == "ADD":
            _add_record(db, batch, tenant_id, external_id, row_num, "SKIP",
                        "already exists", created_by, target_id=existing)
            batch.skipped += 1
            return
        # UPDATE / UPSERT
        if not imp.get("update"):
            _add_record(db, batch, tenant_id, external_id, row_num, "ERROR",
                        "entity does not support updates", created_by)
            batch.errors += 1
            return
        if dry_run:
            _add_record(db, batch, tenant_id, external_id, row_num, "PREVIEW",
                        "would update", created_by, target_id=existing)
        else:
            imp["update"](db, tenant_id, existing, row, created_by)
            _add_record(db, batch, tenant_id, external_id, row_num, "UPDATE",
                        None, created_by, target_id=existing)
        batch.updated += 1
        return
    # not existing
    if mode == "UPDATE":
        _add_record(db, batch, tenant_id, external_id, row_num, "ERROR",
                    "not found for update", created_by)
        batch.errors += 1
        return
    if dry_run:
        _add_record(db, batch, tenant_id, external_id, row_num, "PREVIEW",
                    "would create", created_by)
        batch.created += 1
        return
    target_id = imp["create"](db, tenant_id, row, created_by)
    _add_record(db, batch, tenant_id, external_id, row_num, "CREATE", None, created_by, target_id=target_id)
    batch.created += 1


def _run_simple(db, batch, imp, rows, tenant_id, dry_run, mode, created_by):
    seen: set[str] = set()
    for i, row in enumerate(rows, start=1):
        external_id, err = imp["validate"](db, tenant_id, row)
        if err:
            _add_record(db, batch, tenant_id, external_id, i, "ERROR", err, created_by)
            batch.errors += 1
            continue
        if external_id in seen:
            _add_record(db, batch, tenant_id, external_id, i, "SKIP",
                        "duplicate within file", created_by)
            batch.skipped += 1
            continue
        seen.add(external_id)
        try:
            _apply(db, batch, imp, tenant_id, external_id, row, dry_run, mode, created_by, i)
        except Exception as exc:  # pragma: no cover - row-level failure isolated
            _add_record(db, batch, tenant_id, external_id, i, "ERROR", str(exc)[:300], created_by)
            batch.errors += 1


def _run_documents(db, batch, imp, rows, tenant_id, dry_run, mode, created_by):
    """Header+line documents: group rows by external id, validate header + lines, create."""
    for external_id, group in _group_documents(imp, rows):
        first_row = group[0][1]
        first_num = group[0][0]
        line_rows = [r for (_, r) in group]
        ext, err = imp["validate_doc"](db, tenant_id, first_row, line_rows)
        if err:
            _add_record(db, batch, tenant_id, external_id, first_num, "ERROR", err, created_by)
            batch.errors += 1
            continue
        existing = resolve_external(db, tenant_id, batch.entity_type, ext)
        if existing:
            _add_record(db, batch, tenant_id, ext, first_num, "SKIP", "already exists",
                        created_by, target_id=existing)
            batch.skipped += 1
            continue
        if dry_run:
            _add_record(db, batch, tenant_id, ext, first_num, "PREVIEW",
                        f"would create ({len(line_rows)} line(s))", created_by)
            batch.created += 1
            continue
        try:
            target_id = imp["create_doc"](db, tenant_id, first_row, line_rows, created_by)
            _add_record(db, batch, tenant_id, ext, first_num, "CREATE",
                        f"{len(line_rows)} line(s)", created_by, target_id=target_id)
            batch.created += 1
        except Exception as exc:  # pragma: no cover - doc-level failure isolated
            _add_record(db, batch, tenant_id, ext, first_num, "ERROR", str(exc)[:300], created_by)
            batch.errors += 1


def rollback_batch(db: Session, batch: MigrationBatch) -> int:
    if batch.status != "COMMITTED":
        raise MigrationError(f"Only COMMITTED batches can be rolled back (is {batch.status})")
    model = IMPORTERS[batch.entity_type]["target_model"]
    removed = 0
    for rec in db.execute(select(MigrationRecord).where(
            MigrationRecord.batch_id == batch.id,
            MigrationRecord.action.in_(("CREATE", "UPDATE"))).order_by(
            MigrationRecord.row_num.desc())).scalars():
        # Only CREATE rows have deletable targets; UPDATE rows are left in place
        # (the prior values are not snapshotted) but their refs are freed.
        if rec.action == "CREATE" and rec.target_id:
            obj = db.get(model, rec.target_id)
            if obj is not None:
                db.delete(obj)
                removed += 1
        rec.action = "REVERTED"
    batch.status = "ROLLED_BACK"
    db.flush()
    return removed


def _columns_for(entity_type: str) -> list[str]:
    imp = IMPORTERS[entity_type]
    return imp["columns"] + imp.get("line_columns", [])


def template_workbook(entity_type: str) -> bytes:
    if entity_type not in IMPORTERS:
        raise MigrationError(f"Unknown entity type: {entity_type}")
    wb = Workbook(); ws = wb.active; ws.title = entity_type[:31]
    ws.append(_columns_for(entity_type))
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def entity_catalog() -> list[dict]:
    """Entities in NetSuite-style load order (Setup → Masters → Open Txn → Historical)."""
    out = []
    for et, imp in sorted(IMPORTERS.items(), key=lambda kv: kv[1]["load_order"]):
        out.append({"entity_type": et, "label": imp["label"], "kind": imp["kind"],
                    "load_order": imp["load_order"], "modes": list(imp.get("modes", ("ADD",))),
                    "columns": imp["columns"], "line_columns": imp.get("line_columns", []),
                    "key": imp["key"]})
    return out


def report_workbook(db: Session, batch: MigrationBatch) -> bytes:
    rows = db.execute(select(MigrationRecord).where(
        MigrationRecord.batch_id == batch.id).order_by(MigrationRecord.row_num)).scalars().all()
    wb = Workbook(); ws = wb.active; ws.title = "Migration Report"
    from openpyxl.styles import Font
    ws["A1"] = f"Migration {batch.batch_number} — {batch.entity_type} ({batch.mode}, {batch.status})"
    ws["A1"].font = Font(size=14, bold=True)
    ws["A2"] = (f"Rows {batch.total_rows} · created {batch.created} · updated {batch.updated} "
                f"· skipped {batch.skipped} · errors {batch.errors}")
    ws.append([]); ws.append(["Row", "External ID", "Action", "Target ID", "Message"])
    for r in rows:
        ws.append([r.row_num, r.source_ref, r.action, str(r.target_id or ""), r.message or ""])
    for col, w in {"A": 6, "B": 26, "C": 10, "D": 38, "E": 50}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()
