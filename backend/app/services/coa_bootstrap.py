"""Provision a default Oracle-style HOA Chart of Accounts for a new tenant.

Creates a 6-segment COA structure (the mandated minimum) with value sets and a
starter set of values, ready for the SYSADMIN/Controller to extend up to 15
segments. Demonstrates fund accounting via the Fund segment (Operating, Reserve,
Special) and balancing via the Association Code segment.
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.kff import (
    KffSegment,
    KffStructure,
    KffValueSet,
    KffValueSetValue,
)

# (segment_number, name, prompt, column, qualifier, value_set_code)
_SEGMENTS = [
    (1, "Association Code", "Association", "SEGMENT1", "balancing", "HOA_ASSOC"),
    (2, "Fund", "Fund", "SEGMENT2", "fund", "HOA_FUND"),
    (3, "Cost Center", "Cost Center", "SEGMENT3", "cost_center", "HOA_CC"),
    (4, "Natural Account", "Account", "SEGMENT4", "natural_account", "HOA_ACCT"),
    (5, "Sub-Account", "Sub-Account", "SEGMENT5", "none", "HOA_SUBACCT"),
    (6, "Project Code", "Project", "SEGMENT6", "none", "HOA_PROJECT"),
]

# value_set_code -> (name, format, max_size, numbers_only, [(value, desc, acct_type), ...])
_VALUE_SETS = {
    "HOA_ASSOC": ("HOA Association", "NUMBER", 4, True, [
        ("0100", "Casa Harmony Master Association", None),
    ]),
    "HOA_FUND": ("HOA Fund", "CHAR", 4, False, [
        ("OPER", "Operating Fund", None),
        ("RESV", "Reserve Fund", None),
        ("SPEC", "Special Assessment Fund", None),
    ]),
    "HOA_CC": ("HOA Cost Center", "NUMBER", 3, True, [
        ("000", "General / Unassigned", None),
        ("100", "Landscaping", None),
        ("200", "Pool & Amenities", None),
        ("300", "Security", None),
        ("400", "Administration", None),
    ]),
    "HOA_ACCT": ("HOA Natural Account", "NUMBER", 4, True, [
        ("1000", "Operating Cash", "A"),
        ("1010", "Reserve Cash", "A"),
        ("1100", "Assessments Receivable", "A"),
        ("2000", "Accounts Payable", "L"),
        ("2100", "Prepaid Assessments", "L"),
        ("3000", "Fund Balance", "O"),
        ("4000", "Assessment Income", "R"),
        ("4100", "Interest Income", "R"),
        ("5000", "Landscaping Expense", "E"),
        ("5100", "Utilities Expense", "E"),
        ("5200", "Repairs & Maintenance", "E"),
        ("6000", "Reserve Funding Transfer", "E"),
    ]),
    "HOA_SUBACCT": ("HOA Sub-Account", "NUMBER", 4, True, [
        ("0000", "Default Sub-Account", None),
    ]),
    "HOA_PROJECT": ("HOA Project", "CHAR", 10, False, [
        ("NONE", "No Project", None),
    ]),
}


def provision_default_coa(
    db: Session, tenant_id: uuid.UUID, actor_id: uuid.UUID | None = None
) -> KffStructure:
    structure = KffStructure(
        tenant_id=tenant_id,
        structure_code="HOA_COA",
        title="HOA Chart of Accounts",
        description="Default 6-segment HOA accounting flexfield.",
        segment_separator="-",
        enabled=True,
        is_coa=True,
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(structure)
    db.flush()

    vs_by_code: dict[str, KffValueSet] = {}
    for code, (name, fmt, max_size, numbers_only, values) in _VALUE_SETS.items():
        vs = KffValueSet(
            tenant_id=tenant_id,
            code=code,
            name=name,
            validation_type="INDEPENDENT",
            format_type=fmt,
            max_size=max_size,
            uppercase_only=fmt == "CHAR",
            numbers_only=numbers_only,
            created_by=actor_id,
            updated_by=actor_id,
        )
        db.add(vs)
        db.flush()
        vs_by_code[code] = vs
        for value, desc, acct_type in values:
            db.add(
                KffValueSetValue(
                    tenant_id=tenant_id,
                    value_set_id=vs.id,
                    value=value,
                    description=desc,
                    account_type=acct_type,
                    created_by=actor_id,
                    updated_by=actor_id,
                )
            )

    for num, name, prompt, column, qualifier, vs_code in _SEGMENTS:
        db.add(
            KffSegment(
                tenant_id=tenant_id,
                structure_id=structure.id,
                segment_number=num,
                name=name,
                prompt=prompt,
                column_name=column,
                qualifier=qualifier,
                value_set_id=vs_by_code[vs_code].id,
                required=qualifier in ("balancing", "fund", "natural_account") or num <= 4,
                created_by=actor_id,
                updated_by=actor_id,
            )
        )

    db.flush()
    return structure
