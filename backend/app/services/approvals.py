"""Configurable multi-level approval state machine.

Required levels are derived from the document amount against the hierarchy's
amount-banded rules: every rule whose ``min_amount <= amount`` is a level that must
approve, in ascending ``level_num`` order. With no enabled hierarchy a document is
auto-approved (single implicit level).
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.workflow import (
    ApprovalAction,
    ApprovalHierarchy,
    ApprovalRequest,
    ApprovalRule,
)


class ApprovalError(ValueError):
    pass


def _rules_for(db: Session, tenant_id: uuid.UUID, document_type: str) -> list[ApprovalRule]:
    hierarchy = db.execute(
        select(ApprovalHierarchy).where(
            ApprovalHierarchy.tenant_id == tenant_id,
            ApprovalHierarchy.document_type == document_type,
            ApprovalHierarchy.enabled.is_(True),
        )
    ).scalar_one_or_none()
    if hierarchy is None:
        return []
    return list(
        db.execute(
            select(ApprovalRule).where(ApprovalRule.hierarchy_id == hierarchy.id)
            .order_by(ApprovalRule.level_num)
        ).scalars()
    )


def required_levels(db: Session, tenant_id: uuid.UUID, document_type: str, amount: Decimal) -> int:
    rules = _rules_for(db, tenant_id, document_type)
    return sum(1 for r in rules if r.min_amount <= amount)


def approver_role_for_level(
    db: Session, tenant_id: uuid.UUID, document_type: str, level: int
) -> uuid.UUID | None:
    rules = _rules_for(db, tenant_id, document_type)
    for r in rules:
        if r.level_num == level:
            return r.approver_role_id
    return None


def submit(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    document_type: str,
    document_id: uuid.UUID,
    amount: Decimal,
    submitted_by: uuid.UUID | None,
) -> ApprovalRequest:
    existing = db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.tenant_id == tenant_id,
            ApprovalRequest.document_type == document_type,
            ApprovalRequest.document_id == document_id,
        )
    ).scalar_one_or_none()
    if existing and existing.status == "PENDING":
        return existing

    levels = required_levels(db, tenant_id, document_type, amount)
    req = ApprovalRequest(
        tenant_id=tenant_id, document_type=document_type, document_id=document_id,
        amount=amount, required_levels=levels, current_level=1,
        status="APPROVED" if levels == 0 else "PENDING",
        submitted_by=submitted_by, created_by=submitted_by, updated_by=submitted_by,
    )
    db.add(req)
    db.flush()
    return req


def act(
    db: Session,
    *,
    request: ApprovalRequest,
    approver_id: uuid.UUID,
    approve: bool,
    comments: str | None = None,
) -> ApprovalRequest:
    if request.status != "PENDING":
        raise ApprovalError(f"Request is already {request.status}")

    db.add(ApprovalAction(
        tenant_id=request.tenant_id, request_id=request.id, level_num=request.current_level,
        approver_id=approver_id, action="APPROVED" if approve else "REJECTED",
        comments=comments, created_by=approver_id, updated_by=approver_id,
    ))
    if not approve:
        request.status = "REJECTED"
    elif request.current_level >= request.required_levels:
        request.status = "APPROVED"
    else:
        request.current_level += 1
    db.flush()
    return request
