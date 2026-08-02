"""Supplier extensions: sites, contacts, and (tokenized) bank accounts.

* ApSupplierSite        ≈ AP_SUPPLIER_SITES_ALL — multiple sites per supplier
                          (pay site, purchasing site) with address + term override.
* ApSupplierContact     ≈ AP_SUPPLIER_CONTACTS
* ApSupplierBankAccount  the vendor's bank account we DISBURSE to (ACH/EFT/wire).
                          The account number is encrypted at rest.
"""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto_types import EncryptedString
from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class ApSupplierSite(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ap_supplier_sites"
    __table_args__ = (
        UniqueConstraint("tenant_id", "supplier_id", "site_code", name="uq_supplier_site_code"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_suppliers.id", ondelete="CASCADE"), index=True
    )
    site_code: Mapped[str] = mapped_column(String(40), nullable=False)  # e.g. MAIN, REMIT
    site_name: Mapped[str | None] = mapped_column(String(120))
    pay_site: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    purchasing_site: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    address_line1: Mapped[str | None] = mapped_column(String(200))
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(60))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    # Optional per-site payment term override.
    payment_term_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("payment_terms.id", ondelete="SET NULL")
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    supplier: Mapped["object"] = relationship("ApSupplier", backref="sites")


class ApSupplierContact(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ap_supplier_contacts"

    id: Mapped[uuid.UUID] = uuid_pk()
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_suppliers.id", ondelete="CASCADE"), index=True
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_supplier_sites.id", ondelete="SET NULL")
    )
    first_name: Mapped[str] = mapped_column(String(80), nullable=False)
    last_name: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str | None] = mapped_column(String(80))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(40))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ApSupplierBankAccount(Base, TenantMixin, TimestampMixin):
    """The vendor's own bank account we pay into (encrypted)."""

    __tablename__ = "ap_supplier_bank_accounts"

    id: Mapped[uuid.UUID] = uuid_pk()
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_suppliers.id", ondelete="CASCADE"), index=True
    )
    bank_name: Mapped[str] = mapped_column(String(200), nullable=False)
    routing_number: Mapped[str | None] = mapped_column(String(9))
    # Encrypted at rest; only a masked last-four is exposed by the API.
    account_number: Mapped[str | None] = mapped_column(EncryptedString(255))
    account_type: Mapped[str] = mapped_column(String(20), default="CHECKING", nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
