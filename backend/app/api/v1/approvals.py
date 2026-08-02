from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.workflow import ApprovalHierarchy, ApprovalRequest, ApprovalRule
from app.schemas.approvals import ApprovalRequestOut, HierarchyCreate, HierarchyOut
from app.services import audit

router = APIRouter(
    prefix="/approvals", tags=["approvals"], dependencies=[Depends(require_active_tenant)]
)


@router.get("/hierarchies", response_model=list[HierarchyOut])
def list_hierarchies(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("approval.config")),
):
    return db.execute(
        select(ApprovalHierarchy).where(ApprovalHierarchy.tenant_id == principal.tenant_id)
    ).scalars().all()


@router.post("/hierarchies", response_model=HierarchyOut, status_code=status.HTTP_201_CREATED)
def create_hierarchy(
    payload: HierarchyCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("approval.config")),
):
    if db.execute(
        select(ApprovalHierarchy).where(
            ApprovalHierarchy.tenant_id == principal.tenant_id,
            ApprovalHierarchy.document_type == payload.document_type,
        )
    ).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"A hierarchy already exists for {payload.document_type}")
    h = ApprovalHierarchy(
        tenant_id=principal.tenant_id, name=payload.name,
        document_type=payload.document_type, enabled=True,
        created_by=principal.user.id, updated_by=principal.user.id,
    )
    db.add(h)
    db.flush()
    for r in payload.rules:
        db.add(ApprovalRule(
            tenant_id=principal.tenant_id, hierarchy_id=h.id, level_num=r.level_num,
            min_amount=r.min_amount, max_amount=r.max_amount,
            approver_role_id=r.approver_role_id,
            created_by=principal.user.id, updated_by=principal.user.id,
        ))
    db.flush()
    db.refresh(h)
    audit.record(db, action="CREATE", entity_type="ApprovalHierarchy", entity_id=h.id,
                 after={"document_type": h.document_type})
    return h


@router.get("/requests", response_model=list[ApprovalRequestOut])
def list_requests(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_active_tenant),
):
    """Approvals dashboard: pending (or filtered) approval requests for this HOA."""
    stmt = select(ApprovalRequest).where(ApprovalRequest.tenant_id == principal.tenant_id)
    if status_filter:
        stmt = stmt.where(ApprovalRequest.status == status_filter.upper())
    return db.execute(stmt.order_by(ApprovalRequest.created_at.desc())).scalars().all()
