from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.gl import GlBalance, GlJeBatch
from app.models.identity import Tenant
from app.schemas.gl import (
    GlBalanceOut,
    GlBatchDetailOut,
    GlBatchOut,
    PostingRunOut,
)
from app.services import audit
from app.services.gl_batch import (
    BatchError,
    approve_batch,
    post_all_approved,
    post_batch,
    submit_batch,
)
from app.models.budget import GlBudget
from app.models.kff import GlCodeCombination
from app.schemas.gl import BudgetCreate, BudgetOut, BudgetVsActualRow
from app.services.reports import (
    build_batch_workbook,
    build_budget_vs_actual_workbook,
    build_financial_statements_workbook,
    build_trial_balance_workbook,
    compute_budget_vs_actual,
)
from app.services.reports_docx import build_financial_statements_docx
from app.services.reports_pdf import build_board_report_pdf

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF = "application/pdf"

router = APIRouter(prefix="/gl", tags=["gl"], dependencies=[Depends(require_active_tenant)])


def _get_batch(db: Session, batch_id: uuid.UUID, tenant_id: uuid.UUID) -> GlJeBatch:
    b = db.get(GlJeBatch, batch_id)
    if b is None or b.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found")
    return b


@router.get("/batches", response_model=list[GlBatchOut])
def list_batches(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("gl.batch.manage")),
):
    return db.execute(
        select(GlJeBatch).where(GlJeBatch.tenant_id == principal.tenant_id)
        .order_by(GlJeBatch.created_at.desc())
    ).scalars().all()


@router.get("/batches/{batch_id}", response_model=GlBatchDetailOut)
def get_batch(
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("gl.batch.manage")),
):
    return _get_batch(db, batch_id, principal.tenant_id)


@router.post("/batches/{batch_id}/submit", response_model=GlBatchOut)
def submit(
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("gl.batch.manage")),
):
    batch = _get_batch(db, batch_id, principal.tenant_id)
    try:
        submit_batch(db, batch)
    except BatchError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="SUBMIT", entity_type="GlJeBatch", entity_id=batch.id)
    return batch


@router.post("/batches/{batch_id}/approve", response_model=GlBatchOut)
def approve(
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("gl.batch.approve")),
):
    batch = _get_batch(db, batch_id, principal.tenant_id)
    try:
        approve_batch(db, batch, principal.user.id)
    except BatchError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="APPROVE", entity_type="GlJeBatch", entity_id=batch.id)
    return batch


@router.post("/batches/{batch_id}/post", response_model=GlBatchOut)
def post(
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("gl.batch.approve")),
):
    batch = _get_batch(db, batch_id, principal.tenant_id)
    try:
        post_batch(db, batch)
    except BatchError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="POST", entity_type="GlJeBatch", entity_id=batch.id,
                 after={"status": batch.status})
    return batch


@router.post("/posting-runs", response_model=PostingRunOut)
def run_posting(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("gl.batch.approve")),
):
    """Trigger the nightly posting run: post all APPROVED batches for this HOA."""
    ids = post_all_approved(db, principal.tenant_id)
    audit.record(db, action="POSTING_RUN", entity_type="GlJeBatch",
                 after={"count": len(ids)})
    return PostingRunOut(posted_batch_ids=ids, count=len(ids))


@router.get("/batches/{batch_id}/export")
def export_batch(
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("gl.batch.manage")),
):
    batch = _get_batch(db, batch_id, principal.tenant_id)
    xlsx = build_batch_workbook(db, batch)
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="batch_{batch.batch_name}.xlsx"'},
    )


@router.get("/financial-statements/export")
def export_financial_statements(
    period: str,
    fmt: str = "xlsx",
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    """Fund-based Balance Sheet + Revenues & Expenses (xlsx or docx)."""
    tenant = db.get(Tenant, principal.tenant_id)
    name = tenant.name if tenant else "HOA"
    if fmt == "docx":
        content = build_financial_statements_docx(db, principal.tenant_id, period, name)
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ext = "docx"
    else:
        content = build_financial_statements_workbook(db, principal.tenant_id, period, name)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ext = "xlsx"
    return Response(
        content=content, media_type=media,
        headers={"Content-Disposition": f'attachment; filename="financial_statements_{period}.{ext}"'},
    )


@router.get("/budgets", response_model=list[BudgetOut])
def list_budgets(
    period: str | None = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    stmt = select(GlBudget).where(GlBudget.tenant_id == principal.tenant_id)
    if period:
        stmt = stmt.where(GlBudget.period_name == period)
    return db.execute(stmt).scalars().all()


@router.post("/budgets", response_model=BudgetOut, status_code=status.HTTP_201_CREATED)
def set_budget(
    payload: BudgetCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("budget.manage")),
):
    cc = db.get(GlCodeCombination, payload.code_combination_id)
    if cc is None or cc.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    existing = db.execute(
        select(GlBudget).where(
            GlBudget.tenant_id == principal.tenant_id,
            GlBudget.code_combination_id == payload.code_combination_id,
            GlBudget.period_name == payload.period_name,
        )
    ).scalar_one_or_none()
    if existing:  # upsert
        existing.amount = payload.amount
        existing.updated_by = principal.user.id
        db.flush()
        return existing
    b = GlBudget(
        tenant_id=principal.tenant_id, code_combination_id=payload.code_combination_id,
        period_name=payload.period_name, amount=payload.amount, budget_name=payload.budget_name,
        fund_value=cc.fund_value, created_by=principal.user.id, updated_by=principal.user.id,
    )
    db.add(b)
    db.flush()
    return b


@router.get("/budget-vs-actual", response_model=list[BudgetVsActualRow])
def budget_vs_actual(
    period: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    return compute_budget_vs_actual(db, principal.tenant_id, period)


@router.get("/budget-vs-actual/export")
def export_budget_vs_actual(
    period: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    tenant = db.get(Tenant, principal.tenant_id)
    xlsx = build_budget_vs_actual_workbook(db, principal.tenant_id, period, tenant.name if tenant else "HOA")
    return Response(content=xlsx, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="budget_vs_actual_{period}.xlsx"'})


@router.get("/board-report/export")
def export_board_report(
    period: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    tenant = db.get(Tenant, principal.tenant_id)
    pdf = build_board_report_pdf(db, principal.tenant_id, period, tenant.name if tenant else "HOA")
    return Response(content=pdf, media_type=PDF,
                    headers={"Content-Disposition": f'attachment; filename="board_report_{period}.pdf"'})


@router.get("/balances", response_model=list[GlBalanceOut])
def balances(
    period: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    return db.execute(
        select(GlBalance).where(
            GlBalance.tenant_id == principal.tenant_id, GlBalance.period_name == period
        )
    ).scalars().all()


@router.get("/trial-balance/export")
def export_trial_balance(
    period: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    tenant = db.get(Tenant, principal.tenant_id)
    xlsx = build_trial_balance_workbook(
        db, principal.tenant_id, period, tenant.name if tenant else "HOA"
    )
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="trial_balance_{period}.xlsx"'},
    )
