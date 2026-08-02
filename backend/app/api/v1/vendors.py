from __future__ import annotations

import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from openpyxl import Workbook, load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.masters import ApSupplier
from app.models.supplier_ext import ApSupplierBankAccount, ApSupplierContact, ApSupplierSite
from app.schemas.financials import VendorCreate, VendorOut, VendorUpdate
from app.schemas.supplier_ext import (
    ContactCreate,
    ContactOut,
    ImportResult,
    SiteCreate,
    SiteOut,
    SupplierBankCreate,
    SupplierBankOut,
)
from app.services import audit

router = APIRouter(
    prefix="/vendors", tags=["vendors"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _vendor(db: Session, vid: uuid.UUID, tenant_id: uuid.UUID) -> ApSupplier:
    v = db.get(ApSupplier, vid)
    if v is None or v.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return v


def _mask(n: str | None) -> str | None:
    if not n:
        return None
    return f"****{n[-4:]}" if len(n) >= 4 else "****"


@router.get("", response_model=list[VendorOut])
def list_vendors(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("vendor.manage")),
):
    return db.execute(
        select(ApSupplier).where(ApSupplier.tenant_id == principal.tenant_id)
        .order_by(ApSupplier.vendor_number)
    ).scalars().all()


@router.post("", response_model=VendorOut, status_code=status.HTTP_201_CREATED)
def create_vendor(
    payload: VendorCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("vendor.manage")),
):
    if db.execute(
        select(ApSupplier).where(
            ApSupplier.tenant_id == principal.tenant_id,
            ApSupplier.vendor_number == payload.vendor_number,
        )
    ).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Vendor number already exists")
    v = ApSupplier(
        tenant_id=principal.tenant_id, created_by=principal.user.id,
        updated_by=principal.user.id, **payload.model_dump(),
    )
    db.add(v)
    db.flush()
    audit.record(db, action="CREATE", entity_type="ApSupplier", entity_id=v.id,
                 after={"vendor_number": v.vendor_number})
    return v


# --- Detail & edit ---------------------------------------------------------
@router.get("/{vendor_id}", response_model=VendorOut)
def get_vendor(vendor_id: uuid.UUID, db: Session = Depends(get_db),
               principal: Principal = Depends(require_permission("vendor.manage"))):
    return _vendor(db, vendor_id, principal.tenant_id)


@router.patch("/{vendor_id}", response_model=VendorOut)
def update_vendor(vendor_id: uuid.UUID, payload: VendorUpdate, db: Session = Depends(get_db),
                  principal: Principal = Depends(require_permission("vendor.manage"))):
    v = _vendor(db, vendor_id, principal.tenant_id)
    for k, val in payload.model_dump(exclude_unset=True).items():
        setattr(v, k, val)
    v.updated_by = principal.user.id
    audit.record(db, action="UPDATE", entity_type="ApSupplier", entity_id=v.id)
    return v


# --- Sites -----------------------------------------------------------------
@router.get("/{vendor_id}/sites", response_model=list[SiteOut])
def list_sites(vendor_id: uuid.UUID, db: Session = Depends(get_db),
               principal: Principal = Depends(require_permission("vendor.manage"))):
    _vendor(db, vendor_id, principal.tenant_id)
    return db.execute(select(ApSupplierSite).where(
        ApSupplierSite.tenant_id == principal.tenant_id,
        ApSupplierSite.supplier_id == vendor_id).order_by(ApSupplierSite.site_code)).scalars().all()


@router.post("/{vendor_id}/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
def create_site(vendor_id: uuid.UUID, payload: SiteCreate, db: Session = Depends(get_db),
                principal: Principal = Depends(require_permission("vendor.manage"))):
    _vendor(db, vendor_id, principal.tenant_id)
    if db.execute(select(ApSupplierSite).where(
        ApSupplierSite.tenant_id == principal.tenant_id, ApSupplierSite.supplier_id == vendor_id,
        ApSupplierSite.site_code == payload.site_code)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Site code already exists for this supplier")
    s = ApSupplierSite(tenant_id=principal.tenant_id, supplier_id=vendor_id,
                       created_by=principal.user.id, updated_by=principal.user.id, **payload.model_dump())
    db.add(s)
    db.flush()
    audit.record(db, action="CREATE", entity_type="ApSupplierSite", entity_id=s.id,
                 after={"site_code": s.site_code})
    return s


# --- Contacts --------------------------------------------------------------
@router.get("/{vendor_id}/contacts", response_model=list[ContactOut])
def list_contacts(vendor_id: uuid.UUID, db: Session = Depends(get_db),
                  principal: Principal = Depends(require_permission("vendor.manage"))):
    _vendor(db, vendor_id, principal.tenant_id)
    return db.execute(select(ApSupplierContact).where(
        ApSupplierContact.tenant_id == principal.tenant_id,
        ApSupplierContact.supplier_id == vendor_id)).scalars().all()


@router.post("/{vendor_id}/contacts", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def create_contact(vendor_id: uuid.UUID, payload: ContactCreate, db: Session = Depends(get_db),
                   principal: Principal = Depends(require_permission("vendor.manage"))):
    _vendor(db, vendor_id, principal.tenant_id)
    c = ApSupplierContact(tenant_id=principal.tenant_id, supplier_id=vendor_id,
                          created_by=principal.user.id, updated_by=principal.user.id, **payload.model_dump())
    db.add(c)
    db.flush()
    audit.record(db, action="CREATE", entity_type="ApSupplierContact", entity_id=c.id)
    return c


# --- Supplier bank accounts (tokenized) ------------------------------------
@router.get("/{vendor_id}/bank-accounts", response_model=list[SupplierBankOut])
def list_supplier_banks(vendor_id: uuid.UUID, db: Session = Depends(get_db),
                        principal: Principal = Depends(require_permission("vendor.manage"))):
    _vendor(db, vendor_id, principal.tenant_id)
    rows = db.execute(select(ApSupplierBankAccount).where(
        ApSupplierBankAccount.tenant_id == principal.tenant_id,
        ApSupplierBankAccount.supplier_id == vendor_id)).scalars().all()
    return [SupplierBankOut(id=b.id, bank_name=b.bank_name, routing_number=b.routing_number,
                            account_number_masked=_mask(b.account_number), account_type=b.account_type,
                            is_primary=b.is_primary, active=b.active) for b in rows]


@router.post("/{vendor_id}/bank-accounts", response_model=SupplierBankOut, status_code=status.HTTP_201_CREATED)
def create_supplier_bank(vendor_id: uuid.UUID, payload: SupplierBankCreate, db: Session = Depends(get_db),
                         principal: Principal = Depends(require_permission("vendor.manage"))):
    _vendor(db, vendor_id, principal.tenant_id)
    b = ApSupplierBankAccount(
        tenant_id=principal.tenant_id, supplier_id=vendor_id, bank_name=payload.bank_name,
        routing_number=payload.routing_number, account_number=payload.account_number,
        account_type=payload.account_type, is_primary=payload.is_primary,
        created_by=principal.user.id, updated_by=principal.user.id)
    db.add(b)
    db.flush()
    audit.record(db, action="CREATE", entity_type="ApSupplierBankAccount", entity_id=b.id,
                 after={"bank": b.bank_name, "last_four": _mask(payload.account_number)})
    return SupplierBankOut(id=b.id, bank_name=b.bank_name, routing_number=b.routing_number,
                           account_number_masked=_mask(payload.account_number), account_type=b.account_type,
                           is_primary=b.is_primary, active=b.active)


# --- Export / import (xlsx) ------------------------------------------------
EXPORT_HEADERS = ["vendor_number", "name", "tax_id", "email", "phone", "is_1099", "income_tax_type"]


@router.get("/export/xlsx")
def export_vendors(db: Session = Depends(get_db),
                   principal: Principal = Depends(require_permission("vendor.manage"))):
    rows = db.execute(select(ApSupplier).where(ApSupplier.tenant_id == principal.tenant_id)
                      .order_by(ApSupplier.vendor_number)).scalars().all()
    wb = Workbook()
    ws = wb.active
    ws.title = "Suppliers"
    ws.append(EXPORT_HEADERS)
    for v in rows:
        ws.append([v.vendor_number, v.name, v.tax_id or "", v.email or "", v.phone or "",
                   "Y" if v.is_1099 else "N", v.income_tax_type or ""])
    buf = io.BytesIO()
    wb.save(buf)
    return Response(content=buf.getvalue(), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="suppliers.xlsx"'})


@router.post("/import/xlsx", response_model=ImportResult)
async def import_vendors(file: UploadFile, db: Session = Depends(get_db),
                         principal: Principal = Depends(require_permission("vendor.manage"))):
    """Import suppliers from an xlsx with a header row matching the export columns."""
    try:
        wb = load_workbook(io.BytesIO(await file.read()), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not read the uploaded workbook")
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return ImportResult(created=0, skipped=0)
    header = [str(h).strip().lower() if h else "" for h in rows[0]]
    idx = {h: i for i, h in enumerate(header)}
    if "vendor_number" not in idx or "name" not in idx:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Header must include at least vendor_number and name")
    existing = {v.vendor_number for v in db.execute(
        select(ApSupplier).where(ApSupplier.tenant_id == principal.tenant_id)).scalars()}
    created = skipped = 0
    errors: list[str] = []

    def cell(row, key):
        return row[idx[key]] if key in idx and idx[key] < len(row) else None

    for n, row in enumerate(rows[1:], start=2):
        num = cell(row, "vendor_number")
        name = cell(row, "name")
        if not num or not name:
            skipped += 1
            continue
        num = str(num).strip()
        if num in existing:
            skipped += 1
            continue
        is_1099 = str(cell(row, "is_1099") or "").strip().upper() in ("Y", "YES", "TRUE", "1")
        try:
            db.add(ApSupplier(
                tenant_id=principal.tenant_id, vendor_number=num, name=str(name).strip(),
                tax_id=(str(cell(row, "tax_id")).strip() or None) if cell(row, "tax_id") else None,
                email=(str(cell(row, "email")).strip() or None) if cell(row, "email") else None,
                phone=(str(cell(row, "phone")).strip() or None) if cell(row, "phone") else None,
                is_1099=is_1099,
                income_tax_type=(str(cell(row, "income_tax_type")).strip() or None) if cell(row, "income_tax_type") else None,
                created_by=principal.user.id, updated_by=principal.user.id))
            db.flush()
            existing.add(num)
            created += 1
        except Exception as exc:  # pragma: no cover
            errors.append(f"row {n}: {exc}")
    audit.record(db, action="IMPORT", entity_type="ApSupplier",
                 after={"created": created, "skipped": skipped})
    return ImportResult(created=created, skipped=skipped, errors=errors[:20])
