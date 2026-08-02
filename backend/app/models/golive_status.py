"""Go-live activation status + backup run log (per tenant / system).

``GoLiveStatus`` records whether a tenant has been activated for production use,
gated by validation + required security items. ``BackupRun`` logs scheduled/manual
database backups for audit and restore-readiness evidence.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class GoLiveStatus(Base, TenantMixin, TimestampMixin):
    __tablename__ = "go_live_status"

    id: Mapped[uuid.UUID] = uuid_pk()
    is_live: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    went_live_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    went_live_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    last_validation_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_validation_passed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class BackupRun(Base, TenantMixin, TimestampMixin):
    __tablename__ = "backup_runs"

    id: Mapped[uuid.UUID] = uuid_pk()
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="SUCCESS", nullable=False)  # SUCCESS|FAILED
    encrypted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
