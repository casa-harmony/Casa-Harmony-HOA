"""Configurable multi-level approval hierarchies + approval state machine.

A hierarchy targets a document type (PO, AP_INVOICE, CONTRACT). Its rules define
amount-banded approval levels, each assigned to an approver role. When a document
is submitted, an ApprovalRequest is opened and advances level-by-level until the
required levels (by document amount) are satisfied or it is rejected.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

DOCUMENT_TYPES = ("PO", "AP_INVOICE", "CONTRACT", "GL_BATCH", "WORK_ORDER")


class ApprovalHierarchy(Base, TenantMixin, TimestampMixin):
    __tablename__ = "approval_hierarchies"
    __table_args__ = (
        UniqueConstraint("tenant_id", "document_type", name="uq_hierarchy_doctype"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    document_type: Mapped[str] = mapped_column(String(20), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    rules: Mapped[list["ApprovalRule"]] = relationship(
        back_populates="hierarchy", cascade="all, delete-orphan",
        order_by="ApprovalRule.level_num",
    )


class ApprovalRule(Base, TenantMixin, TimestampMixin):
    """One approval level: amounts in [min_amount, max_amount] need this role."""

    __tablename__ = "approval_rules"
    __table_args__ = (
        UniqueConstraint("hierarchy_id", "level_num", name="uq_rule_level"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    hierarchy_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("approval_hierarchies.id", ondelete="CASCADE"), index=True
    )
    level_num: Mapped[int] = mapped_column(Integer, nullable=False)
    min_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
    max_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))  # NULL = no upper bound
    approver_role_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("roles.id", ondelete="RESTRICT")
    )

    hierarchy: Mapped["ApprovalHierarchy"] = relationship(back_populates="rules")


class ApprovalRequest(Base, TenantMixin, TimestampMixin):
    __tablename__ = "approval_requests"
    __table_args__ = (
        UniqueConstraint("tenant_id", "document_type", "document_id", name="uq_request_doc"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    document_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(15), default="PENDING", nullable=False)
    # PENDING|APPROVED|REJECTED
    current_level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    required_levels: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))

    actions: Mapped[list["ApprovalAction"]] = relationship(
        back_populates="request", cascade="all, delete-orphan", order_by="ApprovalAction.level_num"
    )


class ApprovalAction(Base, TenantMixin, TimestampMixin):
    __tablename__ = "approval_actions"

    id: Mapped[uuid.UUID] = uuid_pk()
    request_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("approval_requests.id", ondelete="CASCADE"), index=True
    )
    level_num: Mapped[int] = mapped_column(Integer, nullable=False)
    approver_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(15), nullable=False)  # APPROVED|REJECTED
    comments: Mapped[str | None] = mapped_column(Text)
    acted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    request: Mapped["ApprovalRequest"] = relationship(back_populates="actions")
