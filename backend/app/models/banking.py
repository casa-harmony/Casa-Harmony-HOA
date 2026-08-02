"""Bank setup (≈ Oracle Cash Management / AP_BANKS_ALL family).

* :class:`ApBank`            ≈ AP_BANKS_ALL / CE_BANKS
* :class:`ApBankAccount`     ≈ AP_BANK_ACCOUNTS_ALL / CE_BANK_ACCOUNTS
* :class:`ApBankAccountUse`  ≈ AP_BANK_ACCOUNT_USES_ALL

Account numbers are encrypted at rest. Bank name + routing data can be enriched
from a public routing-number API (see ``services/bank_lookup.py``).
"""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto_types import EncryptedString
from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class ApBank(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ap_banks"
    __table_args__ = (
        UniqueConstraint("tenant_id", "routing_number", name="uq_bank_routing"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    bank_name: Mapped[str] = mapped_column(String(200), nullable=False)
    routing_number: Mapped[str] = mapped_column(String(9), nullable=False, index=True)
    branch_name: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)

    accounts: Mapped[list["ApBankAccount"]] = relationship(
        back_populates="bank", cascade="all, delete-orphan"
    )


class ApBankAccount(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ap_bank_accounts"

    id: Mapped[uuid.UUID] = uuid_pk()
    bank_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_banks.id", ondelete="CASCADE"), index=True
    )
    account_name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Encrypted at rest; only the masked last-four is exposed by the API.
    account_number: Mapped[str | None] = mapped_column(EncryptedString(255))
    account_type: Mapped[str] = mapped_column(String(20), default="CHECKING", nullable=False)
    # GL cash account this bank account maps to (for reconciliation/posting).
    cash_combination_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="SET NULL")
    )
    # Single functional currency — fixed USD.
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)

    bank: Mapped["ApBank"] = relationship(back_populates="accounts")
    uses: Mapped[list["ApBankAccountUse"]] = relationship(
        back_populates="bank_account", cascade="all, delete-orphan"
    )


class ApBankAccountUse(Base, TenantMixin, TimestampMixin):
    """How a bank account is used: AP disbursement, AR receipt, payroll, etc."""

    __tablename__ = "ap_bank_account_uses"

    id: Mapped[uuid.UUID] = uuid_pk()
    bank_account_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_bank_accounts.id", ondelete="CASCADE"), index=True
    )
    use_type: Mapped[str] = mapped_column(String(30), nullable=False)  # AP_DISBURSEMENT|AR_RECEIPT|PAYROLL
    primary_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    bank_account: Mapped["ApBankAccount"] = relationship(back_populates="uses")
