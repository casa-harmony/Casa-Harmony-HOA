"""Document attachments — metadata for files attached to any business entity
(AR/AP invoices, contracts/POs, assets, etc.). File bytes are stored on the server
under a uuid storage key; downloads are permission-gated.
"""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class DocumentAttachment(Base, TenantMixin, TimestampMixin):
    __tablename__ = "document_attachments"

    id: Mapped[uuid.UUID] = uuid_pk()
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream", nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(64), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    # Optional homeowner link so residents can see their own documents in the portal.
    homeowner_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
