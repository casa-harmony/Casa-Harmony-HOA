"""Legacy data migration tracking.

A MigrationBatch is one import run for one entity type (DRY_RUN, COMMITTED, or
ROLLED_BACK). Each MigrationRecord ties a source row (``source_ref`` — the legacy
key) to the created target row, giving idempotency (skip already-migrated source
refs), rollback (delete created targets), and an AICPA-ready audit trail.
"""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class MigrationBatch(Base, TenantMixin, TimestampMixin):
    __tablename__ = "migration_batches"

    id: Mapped[uuid.UUID] = uuid_pk()
    batch_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    source_filename: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(15), default="DRY_RUN", nullable=False)
    # DRY_RUN|COMMITTED|ROLLED_BACK
    mode: Mapped[str] = mapped_column(String(10), default="ADD", nullable=False)
    # ADD|UPDATE|UPSERT (NetSuite-style import type)
    total_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    errors: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    records: Mapped[list["MigrationRecord"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan")


class MigrationRecord(Base, TenantMixin, TimestampMixin):
    __tablename__ = "migration_records"

    id: Mapped[uuid.UUID] = uuid_pk()
    batch_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("migration_batches.id", ondelete="CASCADE"), index=True)
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    source_ref: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    row_num: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    action: Mapped[str] = mapped_column(String(10), default="CREATE", nullable=False)
    # CREATE|SKIP|ERROR
    message: Mapped[str | None] = mapped_column(Text)

    batch: Mapped["MigrationBatch"] = relationship(back_populates="records")
