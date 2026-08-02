from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.collections import DelinquencyCase, Lien, PaymentPlan, PaymentPlanInstallment
from app.models.identity import Tenant
from app.schemas.collections import (
    AgingRow,
    CaseOut,
    EffectivenessOut,
    EscalateIn,
    LienCreate,
    LienOut,
    LienStatusIn,
    OpenCaseIn,
    PayInstallmentIn,
    PlanCreate,
    PlanDetail,
    PlanOut,
    WriteOffIn,
)
from app.services import audit, collections, reports
from app.services.collections import CollectionsError
from app.services.distributions import DistributionError

router = APIRouter(
    prefix="/collections", tags=["collections"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _err(exc):
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


def _tname(db, tid):
    t = db.get(Tenant, tid)
    return t.name if t else "HOA"


@router.get("/aging", response_model=list[AgingRow])
def aging(as_of: date | None = None, db: Session = Depends(get_db),
          p: Principal = Depends(require_permission("collections.manage"))):
    return collections.aging(db, p.tenant_id, as_of or date.today())


@router.get("/effectiveness", response_model=EffectivenessOut)
def effectiveness(start: date, end: date, db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("collections.manage"))):
    return collections.collection_effectiveness(db, p.tenant_id, start, end)


# --- Cases / escalation ----------------------------------------------------
@router.get("/cases", response_model=list[CaseOut])
def list_cases(db: Session = Depends(get_db),
               p: Principal = Depends(require_permission("collections.manage"))):
    return db.execute(select(DelinquencyCase).where(DelinquencyCase.tenant_id == p.tenant_id)
                      .order_by(DelinquencyCase.opened_date.desc())).scalars().all()


@router.post("/cases", response_model=CaseOut, status_code=status.HTTP_201_CREATED)
def open_case(payload: OpenCaseIn, db: Session = Depends(get_db),
              p: Principal = Depends(require_permission("collections.manage"))):
    case = collections.open_case(db, p.tenant_id, payload.homeowner_id, payload.as_of,
                                 notes=payload.notes, created_by=p.user.id)
    audit.record(db, action="OPEN_CASE", entity_type="DelinquencyCase", entity_id=case.id)
    return case


def _get_case(db, hid, tid) -> DelinquencyCase:
    c = db.execute(select(DelinquencyCase).where(
        DelinquencyCase.tenant_id == tid, DelinquencyCase.homeowner_id == hid)).scalar_one_or_none()
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")
    return c


@router.post("/cases/{homeowner_id}/notice", response_model=CaseOut)
def send_notice(homeowner_id: uuid.UUID, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("collections.manage"))):
    case = _get_case(db, homeowner_id, p.tenant_id)
    collections.send_notice(db, case, date.today())
    audit.record(db, action="NOTICE", entity_type="DelinquencyCase", entity_id=case.id)
    return case


@router.post("/cases/{homeowner_id}/escalate", response_model=CaseOut)
def escalate(homeowner_id: uuid.UUID, payload: EscalateIn, db: Session = Depends(get_db),
             p: Principal = Depends(require_permission("collections.manage"))):
    case = _get_case(db, homeowner_id, p.tenant_id)
    try:
        collections.escalate(db, case, payload.to_stage)
    except CollectionsError as exc:
        _err(exc)
    audit.record(db, action="ESCALATE", entity_type="DelinquencyCase", entity_id=case.id,
                 after={"stage": case.stage})
    return case


# --- Payment plans ---------------------------------------------------------
@router.get("/payment-plans", response_model=list[PlanOut])
def list_plans(db: Session = Depends(get_db),
               p: Principal = Depends(require_permission("collections.manage"))):
    return db.execute(select(PaymentPlan).where(PaymentPlan.tenant_id == p.tenant_id)
                      .order_by(PaymentPlan.plan_number.desc())).scalars().all()


@router.post("/payment-plans", response_model=PlanDetail, status_code=status.HTTP_201_CREATED)
def create_plan(payload: PlanCreate, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("collections.manage"))):
    try:
        plan = collections.create_payment_plan(
            db, tenant_id=p.tenant_id, homeowner_id=payload.homeowner_id,
            total_amount=payload.total_amount, installments=payload.installments,
            start_date=payload.start_date, frequency_days=payload.frequency_days,
            notes=payload.notes, created_by=p.user.id)
    except CollectionsError as exc:
        _err(exc)
    audit.record(db, action="CREATE", entity_type="PaymentPlan", entity_id=plan.id,
                 after={"plan_number": plan.plan_number})
    return plan


@router.get("/payment-plans/{plan_id}", response_model=PlanDetail)
def get_plan(plan_id: uuid.UUID, db: Session = Depends(get_db),
             p: Principal = Depends(require_permission("collections.manage"))):
    plan = db.get(PaymentPlan, plan_id)
    if plan is None or plan.tenant_id != p.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    return plan


@router.post("/payment-plans/installments/{installment_id}/pay", response_model=PlanDetail)
def pay_installment(installment_id: uuid.UUID, payload: PayInstallmentIn, db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("collections.manage"))):
    inst = db.get(PaymentPlanInstallment, installment_id)
    if inst is None or inst.tenant_id != p.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Installment not found")
    collections.pay_installment(db, inst, payload.amount)
    audit.record(db, action="PAY_INSTALLMENT", entity_type="PaymentPlanInstallment", entity_id=inst.id)
    return db.get(PaymentPlan, inst.plan_id)


# --- Liens -----------------------------------------------------------------
@router.get("/liens", response_model=list[LienOut])
def list_liens(db: Session = Depends(get_db),
               p: Principal = Depends(require_permission("collections.manage"))):
    return db.execute(select(Lien).where(Lien.tenant_id == p.tenant_id)
                      .order_by(Lien.lien_number.desc())).scalars().all()


@router.post("/liens", response_model=LienOut, status_code=status.HTTP_201_CREATED)
def create_lien(payload: LienCreate, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("collections.manage"))):
    try:
        lien = collections.create_lien(db, tenant_id=p.tenant_id, homeowner_id=payload.homeowner_id,
                                       amount=payload.amount, reference=payload.reference,
                                       notes=payload.notes, created_by=p.user.id)
    except CollectionsError as exc:
        _err(exc)
    audit.record(db, action="CREATE", entity_type="Lien", entity_id=lien.id,
                 after={"lien_number": lien.lien_number})
    return lien


@router.post("/liens/{lien_id}/status", response_model=LienOut)
def set_lien_status(lien_id: uuid.UUID, payload: LienStatusIn, db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("collections.manage"))):
    lien = db.get(Lien, lien_id)
    if lien is None or lien.tenant_id != p.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lien not found")
    try:
        collections.set_lien_status(db, lien, payload.status, payload.on_date)
    except CollectionsError as exc:
        _err(exc)
    audit.record(db, action=f"LIEN_{payload.status}", entity_type="Lien", entity_id=lien.id)
    return lien


# --- Write-off + reports ---------------------------------------------------
@router.post("/write-off")
def write_off(payload: WriteOffIn, db: Session = Depends(get_db),
              p: Principal = Depends(require_permission("collections.manage"))):
    try:
        res = collections.write_off_invoice(
            db, tenant_id=p.tenant_id, invoice_id=payload.invoice_id,
            expense_combination_id=payload.expense_combination_id, gl_date=payload.gl_date,
            created_by=p.user.id)
    except (CollectionsError, DistributionError) as exc:
        _err(exc)
    audit.record(db, action="WRITE_OFF", entity_type="ArInvoice", entity_id=payload.invoice_id,
                 after={"amount": str(res["amount"])})
    return {"batch_id": str(res["batch_id"]), "amount": str(res["amount"])}


@router.get("/aging/export")
def export_aging(as_of: date | None = None, db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("report.read"))):
    d = as_of or date.today()
    content = reports.build_delinquency_aging_workbook(db, p.tenant_id, d, _tname(db, p.tenant_id))
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="delinquency_aging_{d}.xlsx"'})


@router.get("/effectiveness/export")
def export_effectiveness(start: date, end: date, db: Session = Depends(get_db),
                         p: Principal = Depends(require_permission("report.read"))):
    content = reports.build_collection_effectiveness_workbook(db, p.tenant_id, start, end, _tname(db, p.tenant_id))
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="collection_effectiveness.xlsx"'})
