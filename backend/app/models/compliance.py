"""Compliance-oriented models (PCI DSS payment tokenization stub).

No Primary Account Number (PAN) is ever stored. Only an opaque vault token plus
the last four digits and brand are retained — the standard PCI DSS tokenization
pattern that keeps cardholder data out of scope for the application database.
"""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class DataSubjectRequest(Base, TenantMixin, TimestampMixin):
    """CCPA / privacy data-subject request (access, portability, erasure).

    Provides the audit-able workflow record required to honor consumer rights:
    Right to Know (ACCESS/PORTABILITY) and Right to Delete (ERASURE).
    """

    __tablename__ = "data_subject_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    request_type: Mapped[str] = mapped_column(String(20), nullable=False)  # ACCESS|PORTABILITY|ERASURE
    subject_user_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    subject_email: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="received", nullable=False)
    # received | processing | completed | denied
    notes: Mapped[str | None] = mapped_column(String(1000))


class PaymentToken(Base, TenantMixin, TimestampMixin):
    __tablename__ = "payment_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    homeowner_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    # Opaque reference returned by the PCI-compliant payment vault/gateway.
    vault_token: Mapped[str] = mapped_column(String(255), nullable=False)
    card_brand: Mapped[str | None] = mapped_column(String(20))
    last_four: Mapped[str | None] = mapped_column(String(4))
    exp_month: Mapped[int | None] = mapped_column(Integer)
    exp_year: Mapped[int | None] = mapped_column(Integer)
    holder_name: Mapped[str | None] = mapped_column(String(120))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
