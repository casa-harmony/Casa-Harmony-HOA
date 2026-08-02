from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.ar_billing import BillingPlan, LateFeeRule
from app.models.identity import Tenant
from app.schemas.ar_billing import (
    LateFeeRuleIn,
    LateFeeRuleOut,
    PlanCreate,
    PlanDetail,
    PlanOut,
    RunBillingIn,
    RunResult,
)
from app.services import ar_billing, audit, reports
from app.services.ar_billing import BillingError
from app.services.distributions import DistributionError

router = APIRouter(
    prefix="/ar-billing", tags=["ar-billing"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _err(exc):
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.get("/plans", response_model=list[PlanOut])
def list_plans(db: Session = Depends(get_db),
               p: Principal = Depends(require_permission("ar.manage"))):
    return db.execute(select(BillingPlan).where(BillingPlan.tenant_id == p.tenant_id)
                      .order_by(BillingPlan.name)).scalars().all()


@router.post("/plans", response_model=PlanDetail, status_code=status.HTTP_201_CREATED)
def create_plan(payload: PlanCreate, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("ar.manage"))):
    try:
        plan = ar_billing.create_plan(
            db, tenant_id=p.tenant_id, name=payload.name, plan_type=payload.plan_type,
            lines=[ln.model_dump() for ln in payload.lines], created_by=p.user.id)
    except (BillingError, DistributionError) as exc:
        _err(exc)
    audit.record(db, action="CREATE", entity_type="BillingPlan", entity_id=plan.id,
                 after={"name": plan.name})
    return plan


@router.get("/plans/{plan_id}", response_model=PlanDetail)
def get_plan(plan_id: uuid.UUID, db: Session = Depends(get_db),
             p: Principal = Depends(require_permission("ar.manage"))):
    plan = db.get(BillingPlan, plan_id)
    if plan is None or plan.tenant_id != p.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    return plan


@router.post("/plans/{plan_id}/run", response_model=RunResult)
def run_billing(plan_id: uuid.UUID, payload: RunBillingIn, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("ar.manage"))):
    try:
        res = ar_billing.run_billing(
            db, tenant_id=p.tenant_id, plan_id=plan_id, invoice_date=payload.invoice_date,
            due_days=payload.due_days, installments=payload.installments,
            homeowner_ids=payload.homeowner_ids, created_by=p.user.id)
    except (BillingError, DistributionError) as exc:
        _err(exc)
    audit.record(db, action="RUN_BILLING", entity_type="BillingPlan", entity_id=plan_id,
                 after={"invoices": res["invoices_created"], "total": str(res["total_billed"])})
    return RunResult(invoices_created=res["invoices_created"], total_billed=res["total_billed"])


# --- Late fees -------------------------------------------------------------
@router.get("/late-fee-rule", response_model=LateFeeRuleOut)
def get_rule(db: Session = Depends(get_db),
             p: Principal = Depends(require_permission("ar.manage"))):
    return ar_billing.get_late_fee_rule(db, p.tenant_id)


@router.put("/late-fee-rule", response_model=LateFeeRuleOut)
def put_rule(payload: LateFeeRuleIn, db: Session = Depends(get_db),
             p: Principal = Depends(require_permission("ar.manage"))):
    r = db.execute(select(LateFeeRule).where(LateFeeRule.tenant_id == p.tenant_id)).scalar_one_or_none()
    if r is None:
        r = LateFeeRule(tenant_id=p.tenant_id, created_by=p.user.id, updated_by=p.user.id)
        db.add(r)
    for k, v in payload.model_dump().items():
        setattr(r, k, v)
    db.flush()
    audit.record(db, action="UPDATE", entity_type="LateFeeRule", entity_id=r.id,
                 after={"active": r.active, "fee_type": r.fee_type})
    return r


@router.post("/late-fees/run", response_model=RunResult)
def run_late_fees(as_of: date, db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("ar.manage"))):
    try:
        res = ar_billing.apply_late_fees(db, tenant_id=p.tenant_id, as_of=as_of, created_by=p.user.id)
    except (BillingError, DistributionError) as exc:
        _err(exc)
    audit.record(db, action="RUN_LATE_FEES", entity_type="ArInvoice",
                 after={"charged": res["late_fees_charged"], "total": str(res["total"])})
    return RunResult(late_fees_charged=res["late_fees_charged"], total=res["total"])


@router.get("/register/export")
def export_register(start: date, end: date, db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("report.read"))):
    t = db.get(Tenant, p.tenant_id)
    content = reports.build_assessment_register_workbook(db, p.tenant_id, start, end, t.name if t else "HOA")
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="assessment_register_{start}_{end}.xlsx"'})
