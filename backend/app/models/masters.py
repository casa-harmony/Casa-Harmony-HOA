"""Supporting masters: suppliers (vendors) and FND lookups.

Cleaned Oracle EBS analogues — only the columns an HOA ERP actually needs, plus
the mandatory ``tenant_id`` + Who columns + status/approval fields.
"""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.crypto_types import EncryptedString
from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class PaymentTerm(Base, TenantMixin, TimestampMixin):
    """Payment terms (≈ AP_TERMS) — assignable to suppliers and AP invoices."""

    __tablename__ = "payment_terms"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_payment_term_name"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(60), nullable=False)        # e.g. NET30
    description: Mapped[str | None] = mapped_column(String(160))
    due_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    # Optional early-payment discount.
    discount_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    discount_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class VendorType(Base, TenantMixin, TimestampMixin):
    """Configurable vendor classification (Utility, Snow, Landscape, Refund, …)."""

    __tablename__ = "vendor_types"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_vendor_type_code"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class FndLookup(Base, TenantMixin, TimestampMixin):
    """Generic code/meaning lookup (≈ FND_LOOKUP_VALUES).

    e.g. lookup_type='INVOICE_TYPE', lookup_code='ASSESSMENT', meaning='Assessment'.
    """

    __tablename__ = "fnd_lookups"
    __table_args__ = (
        UniqueConstraint("tenant_id", "lookup_type", "lookup_code", name="uq_lookup"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    lookup_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    lookup_code: Mapped[str] = mapped_column(String(60), nullable=False)
    meaning: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(240))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ApSupplier(Base, TenantMixin, TimestampMixin):
    """Vendor master (≈ AP_SUPPLIERS / PO_VENDORS)."""

    __tablename__ = "ap_suppliers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "vendor_number", name="uq_supplier_number"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    vendor_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Trade / category shown on the Vendors screen (e.g. "Landscaping", "Plumbing").
    category: Mapped[str | None] = mapped_column(String(80))
    # Federal Tax ID / EIN — sensitive, encrypted at rest.
    tax_id: Mapped[str | None] = mapped_column(EncryptedString(255))
    # Legacy free-text terms (kept for back-compat); payment_term_id is authoritative.
    payment_terms: Mapped[str] = mapped_column(String(30), default="NET30", nullable=False)
    payment_term_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("payment_terms.id", ondelete="SET NULL")
    )
    vendor_type_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("vendor_types.id", ondelete="SET NULL")
    )
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(40))
    # Stored upper-case ("ACTIVE"/"INACTIVE") to match every other status field
    # in this codebase (PoHeader, ApInvoice, …) and what the frontend compares.
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)
    # Default KFF distribution for this supplier's invoices/POs.
    default_distribution_set_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("distribution_sets.id", ondelete="SET NULL")
    )
    default_expense_combination_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="SET NULL")
    )
    # --- 1099 / tax reporting ---
    is_1099: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    income_tax_type: Mapped[str | None] = mapped_column(String(20))  # e.g. 1099-NEC, 1099-MISC
    state_reportable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Legal name used on the 1099 if different from the display name.
    tax_reporting_name: Mapped[str | None] = mapped_column(String(200))
    # W-9 on file — a simple compliance flag; the actual document, if any,
    # lives in Documents. Missing paperwork blocks year-end 1099 reporting.
    w9_on_file: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
