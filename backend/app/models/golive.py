"""Go-live / compliance checklist items.

Manual go-live tasks (key rotation, backups, access review, etc.) are persisted per
tenant so admins can track completion. Automated checks (GL integrity, COA config,
audit logging) are computed live by the compliance service and merged in.
"""
from __future__ import annotations

import uuid

from sqlalchemy import String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class ComplianceItem(Base, TenantMixin, TimestampMixin):
    __tablename__ = "compliance_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_compliance_item_code"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(40), default="Go-Live", nullable=False)
    status: Mapped[str] = mapped_column(String(10), default="PENDING", nullable=False)
    # PENDING|DONE|NA
    notes: Mapped[str | None] = mapped_column(Text)
