"""Key Flexfield domain logic: validation, qualifier derivation, code building.

Mirrors Oracle GL behaviour:
* segment-value validation against value sets (format + existence + enabled),
* flexfield-qualifier extraction (balancing, natural account, cost center, fund),
* account-type derivation from the natural-account value attribute,
* cross-validation rules (INCLUDE/EXCLUDE) enforcement,
* concatenation into the displayed code combination string.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.kff import (
    GlCodeCombination,
    KffCrossValidationRule,
    KffSegment,
    KffStructure,
    KffValueSetValue,
)


class FlexValidationError(ValueError):
    """Raised when a proposed code combination fails KFF validation."""


def _in_range(value: str, low: str, high: str) -> bool:
    """Range check — numeric when all operands are integers, else lexical."""
    try:
        return int(low) <= int(value) <= int(high)
    except ValueError:
        return low <= value <= high


def load_segments(db: Session, structure: KffStructure) -> list[KffSegment]:
    return list(
        db.execute(
            select(KffSegment)
            .where(KffSegment.structure_id == structure.id, KffSegment.enabled.is_(True))
            .order_by(KffSegment.segment_number)
        ).scalars()
    )


def _validate_value(db: Session, segment: KffSegment, value: str) -> KffValueSetValue | None:
    """Validate a single segment value against its value set; return the value row."""
    vs = segment.value_set
    if vs is None:
        return None  # free-form segment (no value set attached)

    if vs.numbers_only and not value.isdigit():
        raise FlexValidationError(f"Segment '{segment.name}' must be numeric: '{value}'")
    if len(value) > vs.max_size:
        raise FlexValidationError(
            f"Segment '{segment.name}' value '{value}' exceeds max size {vs.max_size}"
        )

    if vs.validation_type in ("INDEPENDENT", "DEPENDENT", "TABLE"):
        row = db.execute(
            select(KffValueSetValue).where(
                KffValueSetValue.value_set_id == vs.id, KffValueSetValue.value == value
            )
        ).scalar_one_or_none()
        if row is None:
            raise FlexValidationError(
                f"Value '{value}' is not defined in value set '{vs.code}' for segment "
                f"'{segment.name}'"
            )
        if not row.enabled:
            raise FlexValidationError(
                f"Value '{value}' in segment '{segment.name}' is disabled"
            )
        return row
    return None


def _apply_cross_validation(
    db: Session, structure: KffStructure, by_number: dict[int, str]
) -> None:
    rules = db.execute(
        select(KffCrossValidationRule).where(
            KffCrossValidationRule.structure_id == structure.id,
            KffCrossValidationRule.enabled.is_(True),
        )
    ).scalars().all()

    for rule in rules:
        includes = [ln for ln in rule.lines if ln.include_exclude == "INCLUDE"]
        excludes = [ln for ln in rule.lines if ln.include_exclude == "EXCLUDE"]

        # Combination qualifies for the rule only if it satisfies every INCLUDE line.
        qualifies = True
        for ln in includes:
            val = by_number.get(ln.segment_number, "")
            if not _in_range(val, ln.low_value, ln.high_value):
                qualifies = False
                break
        if includes and not qualifies:
            continue

        # Within the qualifying universe, any EXCLUDE hit rejects the combination.
        for ln in excludes:
            val = by_number.get(ln.segment_number, "")
            if _in_range(val, ln.low_value, ln.high_value):
                raise FlexValidationError(
                    rule.error_message
                    or f"Combination violates cross-validation rule '{rule.name}'"
                )


def validate_and_build(
    db: Session, structure: KffStructure, segments_in: dict[int, str]
) -> dict:
    """Validate a proposed combination and return GL_CODE_COMBINATIONS field values."""
    segments = load_segments(db, structure)
    if not segments:
        raise FlexValidationError("Structure has no enabled segments")

    by_number: dict[int, str] = {}
    column_values: dict[str, str] = {}
    qualifiers: dict[str, str] = {}
    account_type: str | None = None

    for seg in segments:
        raw = segments_in.get(seg.segment_number)
        if raw is None or raw == "":
            if seg.required:
                raise FlexValidationError(f"Segment '{seg.name}' is required")
            value = seg.default_value or ""
        else:
            value = raw.strip()
            if seg.value_set and seg.value_set.uppercase_only:
                value = value.upper()

        row = _validate_value(db, seg, value) if value else None
        by_number[seg.segment_number] = value
        column_values[seg.column_name.lower()] = value or None

        if seg.qualifier != "none" and value:
            qualifiers[seg.qualifier] = value
        if seg.qualifier == "natural_account" and row is not None:
            account_type = row.account_type

    _apply_cross_validation(db, structure, by_number)

    ordered = [by_number[s.segment_number] for s in segments]
    concatenated = structure.segment_separator.join(ordered)

    fields = {
        "structure_id": structure.id,
        "concatenated_segments": concatenated,
        "balancing_segment_value": qualifiers.get("balancing"),
        "natural_account_value": qualifiers.get("natural_account"),
        "cost_center_value": qualifiers.get("cost_center"),
        "fund_value": qualifiers.get("fund"),
        "account_type": account_type,
    }
    fields.update(column_values)
    return fields


def create_combination(
    db: Session,
    structure: KffStructure,
    tenant_id,
    segments_in: dict[int, str],
    *,
    allow_posting: bool = True,
    enabled: bool = True,
    start_date_active=None,
    end_date_active=None,
    created_by=None,
) -> GlCodeCombination:
    fields = validate_and_build(db, structure, segments_in)
    existing = db.execute(
        select(GlCodeCombination).where(
            GlCodeCombination.structure_id == structure.id,
            GlCodeCombination.concatenated_segments == fields["concatenated_segments"],
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise FlexValidationError(
            f"Code combination already exists: {fields['concatenated_segments']}"
        )

    ccid = GlCodeCombination(
        tenant_id=tenant_id,
        allow_posting=allow_posting,
        enabled=enabled,
        start_date_active=start_date_active,
        end_date_active=end_date_active,
        created_by=created_by,
        updated_by=created_by,
        **fields,
    )
    db.add(ccid)
    db.flush()
    return ccid
