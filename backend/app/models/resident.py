"""Resident portal identities (owners & renters) and their unit links.

A *resident* is a self-service portal login — distinct from a platform ``User``
(staff/admin) and from the HOA itself (which the codebase calls the *tenant*).
``resident_type`` is OWNER or RENTER.

A resident has ONE login (``username`` unique within the HOA) and may be linked to
many units via :class:`ResidentUnit`. Each unit is an AR account (``ar_homeowners``
row). The (unit#, username) pair is unique, so a resident cannot be linked to the
same unit twice — while still allowing co-owners/renters to share a unit and a
single resident to hold several units.
"""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto_types import EncryptedString
from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

RESIDENT_TYPES = ("OWNER", "RENTER")


class Resident(Base, TenantMixin, TimestampMixin):
    __tablename__ = "residents"
    __table_args__ = (
        UniqueConstraint("tenant_id", "username", name="uq_resident_username"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    username: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    resident_type: Mapped[str] = mapped_column(String(10), default="OWNER", nullable=False)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    # Sensitive contact detail — encrypted at rest.
    phone: Mapped[str | None] = mapped_column(EncryptedString(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Force a password change on next login (set when the account is created).
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Resident MFA is a one-time code by email or SMS (no authenticator apps —
    # residents aren't tech-savvy). Enabled by default for security.
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    mfa_channel: Mapped[str] = mapped_column(String(10), default="EMAIL", nullable=False)  # EMAIL|SMS

    units: Mapped[list["ResidentUnit"]] = relationship(
        back_populates="resident", cascade="all, delete-orphan"
    )


class ResidentUnit(Base, TenantMixin, TimestampMixin):
    """Links a resident to a unit (an ``ar_homeowners`` AR account)."""

    __tablename__ = "resident_units"
    __table_args__ = (
        # The (unit#, username) uniqueness: a resident links a unit at most once.
        UniqueConstraint("tenant_id", "unit_number", "resident_id", name="uq_resident_unit"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    resident_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("residents.id", ondelete="CASCADE"), index=True
    )
    homeowner_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_homeowners.id", ondelete="CASCADE"), index=True
    )
    unit_number: Mapped[str] = mapped_column(String(40), nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    resident: Mapped["Resident"] = relationship(back_populates="units")
