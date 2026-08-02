"""Oracle EBS-style Key Flexfield (KFF) for the Chart of Accounts.

Faithful mapping of the Oracle General Ledger Accounting Flexfield model:

* :class:`KffStructure`           ≈ FND_ID_FLEX_STRUCTURES   (the COA structure)
* :class:`KffSegment`             ≈ FND_ID_FLEX_SEGMENTS     (ordered segments)
* :class:`KffValueSet`            ≈ FND_FLEX_VALUE_SETS      (validation domains)
* :class:`KffValueSetValue`       ≈ FND_FLEX_VALUES          (segment values)
* :class:`KffCrossValidationRule` ≈ FND_FLEX_CROSS_VALIDATION_RULES (+ lines)
* :class:`GlCodeCombination`      ≈ GL_CODE_COMBINATIONS     (SEGMENT1..N)

Each structure supports up to :data:`MAX_SEGMENTS` segments (min 6 mandated).
Single functional currency (USD) — no currency segment/columns anywhere.
"""
from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

#: Maximum configurable segments per structure (Oracle uses 30; we expose 15,
#: comfortably satisfying the "10+ configurable segments" requirement).
MAX_SEGMENTS = 15

#: Segment qualifiers (Oracle "flexfield qualifiers"). Exactly one balancing and
#: one natural-account qualifier are required per balanced COA structure.
SEGMENT_QUALIFIERS = (
    "balancing",          # GL_BALANCING — trial balance must net to zero per value
    "natural_account",    # GL_ACCOUNT  — drives account type (A/L/O/R/E)
    "cost_center",        # FA_COST_CTR
    "fund",               # fund accounting discriminator (Operating/Reserve/Special)
    "intercompany",       # GL_INTERCOMPANY
    "management",         # secondary management segment
    "secondary_tracking", # secondary tracking
    "none",
)

#: Account types carried by natural-account values (Oracle value attribute).
ACCOUNT_TYPES = ("A", "L", "O", "R", "E")  # Asset, Liability, Owner's Equity, Revenue, Expense


class KffStructure(Base, TenantMixin, TimestampMixin):
    __tablename__ = "kff_structures"
    __table_args__ = (
        UniqueConstraint("tenant_id", "structure_code", name="uq_kff_structure_code"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    structure_code: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    segment_separator: Mapped[str] = mapped_column(String(1), default="-", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_coa: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    segments: Mapped[list["KffSegment"]] = relationship(
        back_populates="structure",
        cascade="all, delete-orphan",
        order_by="KffSegment.segment_number",
    )


class KffValueSet(Base, TenantMixin, TimestampMixin):
    __tablename__ = "kff_value_sets"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_value_set_code"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    validation_type: Mapped[str] = mapped_column(String(20), default="INDEPENDENT", nullable=False)
    # NONE | INDEPENDENT | DEPENDENT | TABLE
    format_type: Mapped[str] = mapped_column(String(10), default="CHAR", nullable=False)  # CHAR|NUMBER
    max_size: Mapped[int] = mapped_column(Integer, default=25, nullable=False)
    uppercase_only: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    zero_fill: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    numbers_only: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    values: Mapped[list["KffValueSetValue"]] = relationship(
        back_populates="value_set", cascade="all, delete-orphan"
    )


class KffValueSetValue(Base, TenantMixin, TimestampMixin):
    __tablename__ = "kff_value_set_values"
    __table_args__ = (
        UniqueConstraint("value_set_id", "value", name="uq_value_set_value"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    value_set_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("kff_value_sets.id", ondelete="CASCADE"), index=True
    )
    value: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str | None] = mapped_column(String(240))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    summary_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # parent/rollup
    allow_posting: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)  # detail postable
    parent_value: Mapped[str | None] = mapped_column(String(60))  # for DEPENDENT/hierarchy
    # Natural-account value attribute → account type (A/L/O/R/E). NULL otherwise.
    account_type: Mapped[str | None] = mapped_column(String(1))
    start_date: Mapped[Date | None] = mapped_column(Date)
    end_date: Mapped[Date | None] = mapped_column(Date)

    value_set: Mapped["KffValueSet"] = relationship(back_populates="values")


class KffSegment(Base, TenantMixin, TimestampMixin):
    __tablename__ = "kff_segments"
    __table_args__ = (
        UniqueConstraint("structure_id", "segment_number", name="uq_segment_number"),
        UniqueConstraint("structure_id", "column_name", name="uq_segment_column"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    structure_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("kff_structures.id", ondelete="CASCADE"), index=True
    )
    segment_number: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..MAX_SEGMENTS (display order)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    prompt: Mapped[str] = mapped_column(String(120), nullable=False)
    column_name: Mapped[str] = mapped_column(String(20), nullable=False)  # SEGMENT1..SEGMENTn
    value_set_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("kff_value_sets.id", ondelete="SET NULL")
    )
    qualifier: Mapped[str] = mapped_column(String(30), default="none", nullable=False)
    displayed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    default_value: Mapped[str | None] = mapped_column(String(60))

    structure: Mapped["KffStructure"] = relationship(back_populates="segments")
    value_set: Mapped["KffValueSet | None"] = relationship()


class KffCrossValidationRule(Base, TenantMixin, TimestampMixin):
    """Cross-validation rule preventing invalid segment-value combinations."""

    __tablename__ = "kff_cross_validation_rules"

    id: Mapped[uuid.UUID] = uuid_pk()
    structure_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("kff_structures.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    error_message: Mapped[str | None] = mapped_column(String(240))

    lines: Mapped[list["KffCrossValidationRuleLine"]] = relationship(
        back_populates="rule", cascade="all, delete-orphan"
    )


class KffCrossValidationRuleLine(Base, TenantMixin, TimestampMixin):
    """INCLUDE/EXCLUDE range over one segment (Oracle rule-element pair)."""

    __tablename__ = "kff_cross_validation_rule_lines"

    id: Mapped[uuid.UUID] = uuid_pk()
    rule_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kff_cross_validation_rules.id", ondelete="CASCADE"),
        index=True,
    )
    include_exclude: Mapped[str] = mapped_column(String(10), default="INCLUDE", nullable=False)
    segment_number: Mapped[int] = mapped_column(Integer, nullable=False)
    low_value: Mapped[str] = mapped_column(String(60), nullable=False)
    high_value: Mapped[str] = mapped_column(String(60), nullable=False)

    rule: Mapped["KffCrossValidationRule"] = relationship(back_populates="lines")


class GlCodeCombination(Base, TenantMixin, TimestampMixin):
    """A validated account code combination (GL_CODE_COMBINATIONS).

    SEGMENT1..SEGMENT15 mirror Oracle's discrete segment columns; values are
    interpreted positionally per the structure's :class:`KffSegment` rows.
    """

    __tablename__ = "gl_code_combinations"
    __table_args__ = (
        UniqueConstraint(
            "structure_id", "concatenated_segments", name="uq_ccid_concat"
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    structure_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("kff_structures.id", ondelete="CASCADE"), index=True
    )
    concatenated_segments: Mapped[str] = mapped_column(String(800), nullable=False, index=True)
    # Denormalised key qualifier values for fast reporting / fund accounting.
    balancing_segment_value: Mapped[str | None] = mapped_column(String(60), index=True)
    natural_account_value: Mapped[str | None] = mapped_column(String(60), index=True)
    cost_center_value: Mapped[str | None] = mapped_column(String(60))
    fund_value: Mapped[str | None] = mapped_column(String(60), index=True)
    account_type: Mapped[str | None] = mapped_column(String(1))  # derived A/L/O/R/E
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_posting: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    summary_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    start_date_active: Mapped[Date | None] = mapped_column(Date)
    end_date_active: Mapped[Date | None] = mapped_column(Date)

    # Discrete Oracle-style segment columns (SEGMENT1..SEGMENT15).
    segment1: Mapped[str | None] = mapped_column(String(60))
    segment2: Mapped[str | None] = mapped_column(String(60))
    segment3: Mapped[str | None] = mapped_column(String(60))
    segment4: Mapped[str | None] = mapped_column(String(60))
    segment5: Mapped[str | None] = mapped_column(String(60))
    segment6: Mapped[str | None] = mapped_column(String(60))
    segment7: Mapped[str | None] = mapped_column(String(60))
    segment8: Mapped[str | None] = mapped_column(String(60))
    segment9: Mapped[str | None] = mapped_column(String(60))
    segment10: Mapped[str | None] = mapped_column(String(60))
    segment11: Mapped[str | None] = mapped_column(String(60))
    segment12: Mapped[str | None] = mapped_column(String(60))
    segment13: Mapped[str | None] = mapped_column(String(60))
    segment14: Mapped[str | None] = mapped_column(String(60))
    segment15: Mapped[str | None] = mapped_column(String(60))
