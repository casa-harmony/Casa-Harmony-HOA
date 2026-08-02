from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.distribution_set import DistributionSet, DistributionSetLine
from app.models.identity import Tenant
from app.models.masters import PaymentTerm, VendorType
from app.models.notifications import ApMatchTolerance
from app.models.payments import PaymentMethod
from app.schemas.ap_config import (
    DistributionSetCreate,
    DistributionSetOut,
    PaymentTermCreate,
    PaymentTermOut,
    VendorTypeCreate,
    VendorTypeOut,
)
from app.schemas.notifications import ToleranceIn, ToleranceOut
from app.schemas.payments import PaymentMethodCreate, PaymentMethodOut
from app.services import audit
from app.services.distributions import DistributionError, resolve_combination
from app.services.distribution_sets import DistributionSetError, validate_percentages
from app.services.reports import build_1099_workbook

router = APIRouter(
    prefix="/ap-config", tags=["ap-config"], dependencies=[Depends(require_active_tenant)]
)

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# --- Payment terms ---------------------------------------------------------
@router.get("/payment-terms", response_model=list[PaymentTermOut])
def list_payment_terms(db: Session = Depends(get_db),
                       p: Principal = Depends(require_permission("ap.config"))):
    return db.execute(select(PaymentTerm).where(PaymentTerm.tenant_id == p.tenant_id)
                      .order_by(PaymentTerm.name)).scalars().all()


@router.post("/payment-terms", response_model=PaymentTermOut, status_code=status.HTTP_201_CREATED)
def create_payment_term(payload: PaymentTermCreate, db: Session = Depends(get_db),
                        p: Principal = Depends(require_permission("ap.config"))):
    if db.execute(select(PaymentTerm).where(PaymentTerm.tenant_id == p.tenant_id,
                  PaymentTerm.name == payload.name)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Payment term name already exists")
    t = PaymentTerm(tenant_id=p.tenant_id, created_by=p.user.id, updated_by=p.user.id,
                    **payload.model_dump())
    db.add(t)
    db.flush()
    audit.record(db, action="CREATE", entity_type="PaymentTerm", entity_id=t.id,
                 after={"name": t.name})
    return t


# --- Vendor types ----------------------------------------------------------
@router.get("/vendor-types", response_model=list[VendorTypeOut])
def list_vendor_types(db: Session = Depends(get_db),
                      p: Principal = Depends(require_permission("ap.config"))):
    return db.execute(select(VendorType).where(VendorType.tenant_id == p.tenant_id)
                      .order_by(VendorType.name)).scalars().all()


@router.post("/vendor-types", response_model=VendorTypeOut, status_code=status.HTTP_201_CREATED)
def create_vendor_type(payload: VendorTypeCreate, db: Session = Depends(get_db),
                       p: Principal = Depends(require_permission("ap.config"))):
    if db.execute(select(VendorType).where(VendorType.tenant_id == p.tenant_id,
                  VendorType.code == payload.code)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Vendor type code already exists")
    vt = VendorType(tenant_id=p.tenant_id, created_by=p.user.id, updated_by=p.user.id,
                    **payload.model_dump())
    db.add(vt)
    db.flush()
    audit.record(db, action="CREATE", entity_type="VendorType", entity_id=vt.id,
                 after={"code": vt.code})
    return vt


# --- Distribution sets -----------------------------------------------------
@router.get("/distribution-sets", response_model=list[DistributionSetOut])
def list_distribution_sets(db: Session = Depends(get_db),
                           p: Principal = Depends(require_permission("ap.config"))):
    return db.execute(select(DistributionSet).where(DistributionSet.tenant_id == p.tenant_id)
                      .order_by(DistributionSet.name)).scalars().all()


@router.post("/distribution-sets", response_model=DistributionSetOut, status_code=status.HTTP_201_CREATED)
def create_distribution_set(payload: DistributionSetCreate, db: Session = Depends(get_db),
                            p: Principal = Depends(require_permission("ap.config"))):
    if db.execute(select(DistributionSet).where(DistributionSet.tenant_id == p.tenant_id,
                  DistributionSet.name == payload.name)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Distribution set name already exists")
    try:
        validate_percentages([ln.percent for ln in payload.lines])
    except DistributionSetError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    dset = DistributionSet(tenant_id=p.tenant_id, name=payload.name,
                           description=payload.description, active=payload.active,
                           created_by=p.user.id, updated_by=p.user.id)
    db.add(dset)
    db.flush()
    for i, ln in enumerate(payload.lines, start=1):
        try:
            cc = resolve_combination(db, p.tenant_id, ln.code_combination_id)
        except DistributionError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        db.add(DistributionSetLine(
            tenant_id=p.tenant_id, distribution_set_id=dset.id, line_num=i,
            code_combination_id=cc.id, percent=ln.percent, fund_value=cc.fund_value,
            description=ln.description, created_by=p.user.id, updated_by=p.user.id,
        ))
    db.flush()
    db.refresh(dset)
    audit.record(db, action="CREATE", entity_type="DistributionSet", entity_id=dset.id,
                 after={"name": dset.name, "lines": len(payload.lines)})
    return dset


# --- Payment methods -------------------------------------------------------
@router.get("/payment-methods", response_model=list[PaymentMethodOut])
def list_payment_methods(db: Session = Depends(get_db),
                         p: Principal = Depends(require_permission("ap.config"))):
    return db.execute(select(PaymentMethod).where(PaymentMethod.tenant_id == p.tenant_id)
                      .order_by(PaymentMethod.name)).scalars().all()


@router.post("/payment-methods", response_model=PaymentMethodOut, status_code=status.HTTP_201_CREATED)
def create_payment_method(payload: PaymentMethodCreate, db: Session = Depends(get_db),
                          p: Principal = Depends(require_permission("ap.config"))):
    if db.execute(select(PaymentMethod).where(PaymentMethod.tenant_id == p.tenant_id,
                  PaymentMethod.code == payload.code)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Payment method code already exists")
    pm = PaymentMethod(tenant_id=p.tenant_id, created_by=p.user.id, updated_by=p.user.id,
                       **payload.model_dump())
    db.add(pm)
    db.flush()
    audit.record(db, action="CREATE", entity_type="PaymentMethod", entity_id=pm.id,
                 after={"code": pm.code})
    return pm


# --- Matching tolerances ---------------------------------------------------
@router.get("/match-tolerance", response_model=ToleranceOut)
def get_tolerance(db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("ap.config"))):
    tol = db.execute(select(ApMatchTolerance).where(
        ApMatchTolerance.tenant_id == p.tenant_id)).scalar_one_or_none()
    if tol is None:
        return ToleranceOut(amount_tolerance_pct=0, quantity_tolerance_pct=0, require_receipt=False)
    return tol


@router.put("/match-tolerance", response_model=ToleranceOut)
def set_tolerance(payload: ToleranceIn, db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("ap.config"))):
    tol = db.execute(select(ApMatchTolerance).where(
        ApMatchTolerance.tenant_id == p.tenant_id)).scalar_one_or_none()
    if tol is None:
        tol = ApMatchTolerance(tenant_id=p.tenant_id, created_by=p.user.id, updated_by=p.user.id)
        db.add(tol)
    tol.amount_tolerance_pct = payload.amount_tolerance_pct
    tol.quantity_tolerance_pct = payload.quantity_tolerance_pct
    tol.require_receipt = payload.require_receipt
    db.flush()
    audit.record(db, action="UPDATE", entity_type="ApMatchTolerance", entity_id=tol.id,
                 after={"amount_pct": str(tol.amount_tolerance_pct)})
    return tol


# --- 1099 yearly report ----------------------------------------------------
@router.get("/1099/export")
def export_1099(year: int, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("report.read"))):
    tenant = db.get(Tenant, p.tenant_id)
    xlsx = build_1099_workbook(db, p.tenant_id, year, tenant.name if tenant else "HOA")
    return Response(content=xlsx, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="1099_{year}.xlsx"'})
