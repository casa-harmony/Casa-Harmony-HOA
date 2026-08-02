from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.identity import Tenant
from app.models.kff import (
    GlCodeCombination,
    KffCrossValidationRule,
    KffCrossValidationRuleLine,
    KffSegment,
    KffStructure,
    KffValueSet,
    KffValueSetValue,
)
from app.schemas.kff import (
    CodeCombinationCreate,
    CodeCombinationOut,
    CrossValidationRuleCreate,
    CrossValidationRuleOut,
    SegmentCreate,
    SegmentOut,
    SegmentUpdate,
    StructureCreate,
    StructureDetailOut,
    StructureOut,
    StructureUpdate,
    ValueCreate,
    ValueOut,
    ValueSetCreate,
    ValueSetOut,
)
from app.services import audit
from app.services.export import build_coa_workbook
from app.services.kff import FlexValidationError, create_combination

router = APIRouter(prefix="/coa", tags=["coa"], dependencies=[Depends(require_active_tenant)])


def _get_structure(db: Session, structure_id: uuid.UUID, tenant_id: uuid.UUID) -> KffStructure:
    s = db.get(KffStructure, structure_id)
    if s is None or s.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Structure not found")
    return s


# --- Structures ------------------------------------------------------------
@router.get("/structures", response_model=list[StructureOut])
def list_structures(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.read")),
):
    return db.execute(
        select(KffStructure).where(KffStructure.tenant_id == principal.tenant_id)
        .order_by(KffStructure.structure_code)
    ).scalars().all()


@router.post("/structures", response_model=StructureOut, status_code=status.HTTP_201_CREATED)
def create_structure(
    payload: StructureCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.structure.manage")),
):
    s = KffStructure(
        tenant_id=principal.tenant_id,
        created_by=principal.user.id,
        updated_by=principal.user.id,
        **payload.model_dump(),
    )
    db.add(s)
    db.flush()
    audit.record(db, action="CREATE", entity_type="KffStructure", entity_id=s.id,
                 after={"code": s.structure_code})
    return s


@router.get("/structures/{structure_id}", response_model=StructureDetailOut)
def get_structure(
    structure_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.read")),
):
    s = _get_structure(db, structure_id, principal.tenant_id)
    return StructureDetailOut(
        **StructureOut.model_validate(s).model_dump(),
        segments=[SegmentOut.model_validate(seg) for seg in s.segments],
    )


@router.patch("/structures/{structure_id}", response_model=StructureOut)
def update_structure(
    structure_id: uuid.UUID,
    payload: StructureUpdate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.structure.manage")),
):
    s = _get_structure(db, structure_id, principal.tenant_id)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    s.updated_by = principal.user.id
    audit.record(db, action="UPDATE", entity_type="KffStructure", entity_id=s.id)
    return s


# --- Segments --------------------------------------------------------------
@router.post(
    "/structures/{structure_id}/segments",
    response_model=SegmentOut,
    status_code=status.HTTP_201_CREATED,
)
def add_segment(
    structure_id: uuid.UUID,
    payload: SegmentCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.segment.manage")),
):
    s = _get_structure(db, structure_id, principal.tenant_id)
    dup = db.execute(
        select(KffSegment).where(
            KffSegment.structure_id == s.id, KffSegment.segment_number == payload.segment_number
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, "Segment number already used")
    if payload.value_set_id and db.get(KffValueSet, payload.value_set_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "value_set_id not found")

    seg = KffSegment(
        tenant_id=principal.tenant_id,
        structure_id=s.id,
        column_name=f"SEGMENT{payload.segment_number}",
        created_by=principal.user.id,
        updated_by=principal.user.id,
        **payload.model_dump(),
    )
    db.add(seg)
    db.flush()
    audit.record(db, action="CREATE", entity_type="KffSegment", entity_id=seg.id,
                 after={"name": seg.name, "number": seg.segment_number})
    return seg


@router.patch("/segments/{segment_id}", response_model=SegmentOut)
def update_segment(
    segment_id: uuid.UUID,
    payload: SegmentUpdate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.segment.manage")),
):
    seg = db.get(KffSegment, segment_id)
    if seg is None or seg.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Segment not found")
    data = payload.model_dump(exclude_unset=True)
    if "segment_number" in data:
        data["column_name"] = f"SEGMENT{data['segment_number']}"
    for k, v in data.items():
        setattr(seg, k, v)
    if "column_name" in data:
        seg.column_name = data["column_name"]
    seg.updated_by = principal.user.id
    audit.record(db, action="UPDATE", entity_type="KffSegment", entity_id=seg.id)
    return seg


@router.delete("/segments/{segment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_segment(
    segment_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.segment.manage")),
):
    seg = db.get(KffSegment, segment_id)
    if seg is None or seg.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Segment not found")
    db.delete(seg)
    audit.record(db, action="DELETE", entity_type="KffSegment", entity_id=segment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Value sets & values ---------------------------------------------------
@router.get("/value-sets", response_model=list[ValueSetOut])
def list_value_sets(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.read")),
):
    return db.execute(
        select(KffValueSet).where(KffValueSet.tenant_id == principal.tenant_id)
        .order_by(KffValueSet.code)
    ).scalars().all()


@router.post("/value-sets", response_model=ValueSetOut, status_code=status.HTTP_201_CREATED)
def create_value_set(
    payload: ValueSetCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.valueset.manage")),
):
    if db.execute(
        select(KffValueSet).where(
            KffValueSet.tenant_id == principal.tenant_id, KffValueSet.code == payload.code
        )
    ).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Value set code already exists")
    vs = KffValueSet(
        tenant_id=principal.tenant_id,
        created_by=principal.user.id,
        updated_by=principal.user.id,
        **payload.model_dump(),
    )
    db.add(vs)
    db.flush()
    audit.record(db, action="CREATE", entity_type="KffValueSet", entity_id=vs.id,
                 after={"code": vs.code})
    return vs


@router.get("/value-sets/{value_set_id}/values", response_model=list[ValueOut])
def list_values(
    value_set_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.read")),
):
    vs = db.get(KffValueSet, value_set_id)
    if vs is None or vs.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Value set not found")
    return db.execute(
        select(KffValueSetValue).where(KffValueSetValue.value_set_id == vs.id)
        .order_by(KffValueSetValue.value)
    ).scalars().all()


@router.post(
    "/value-sets/{value_set_id}/values",
    response_model=ValueOut,
    status_code=status.HTTP_201_CREATED,
)
def add_value(
    value_set_id: uuid.UUID,
    payload: ValueCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.valueset.manage")),
):
    vs = db.get(KffValueSet, value_set_id)
    if vs is None or vs.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Value set not found")
    value = payload.value.upper() if vs.uppercase_only else payload.value
    if db.execute(
        select(KffValueSetValue).where(
            KffValueSetValue.value_set_id == vs.id, KffValueSetValue.value == value
        )
    ).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Value already exists in this set")
    row = KffValueSetValue(
        tenant_id=principal.tenant_id,
        value_set_id=vs.id,
        created_by=principal.user.id,
        updated_by=principal.user.id,
        **{**payload.model_dump(), "value": value},
    )
    db.add(row)
    db.flush()
    audit.record(db, action="CREATE", entity_type="KffValueSetValue", entity_id=row.id,
                 after={"value": row.value})
    return row


# --- Cross-validation rules ------------------------------------------------
@router.get(
    "/structures/{structure_id}/cross-validation-rules",
    response_model=list[CrossValidationRuleOut],
)
def list_cv_rules(
    structure_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.read")),
):
    _get_structure(db, structure_id, principal.tenant_id)
    return db.execute(
        select(KffCrossValidationRule).where(
            KffCrossValidationRule.structure_id == structure_id
        )
    ).scalars().all()


@router.post(
    "/structures/{structure_id}/cross-validation-rules",
    response_model=CrossValidationRuleOut,
    status_code=status.HTTP_201_CREATED,
)
def create_cv_rule(
    structure_id: uuid.UUID,
    payload: CrossValidationRuleCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.structure.manage")),
):
    s = _get_structure(db, structure_id, principal.tenant_id)
    rule = KffCrossValidationRule(
        tenant_id=principal.tenant_id,
        structure_id=s.id,
        name=payload.name,
        description=payload.description,
        error_message=payload.error_message,
        enabled=payload.enabled,
        created_by=principal.user.id,
        updated_by=principal.user.id,
    )
    db.add(rule)
    db.flush()
    for ln in payload.lines:
        db.add(
            KffCrossValidationRuleLine(
                tenant_id=principal.tenant_id,
                rule_id=rule.id,
                created_by=principal.user.id,
                updated_by=principal.user.id,
                **ln.model_dump(),
            )
        )
    db.flush()
    db.refresh(rule)
    audit.record(db, action="CREATE", entity_type="KffCrossValidationRule", entity_id=rule.id)
    return rule


# --- Code combinations -----------------------------------------------------
@router.get("/structures/{structure_id}/combinations", response_model=list[CodeCombinationOut])
def list_combinations(
    structure_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.read")),
):
    _get_structure(db, structure_id, principal.tenant_id)
    return db.execute(
        select(GlCodeCombination).where(GlCodeCombination.structure_id == structure_id)
        .order_by(GlCodeCombination.concatenated_segments)
    ).scalars().all()


@router.post(
    "/structures/{structure_id}/combinations",
    response_model=CodeCombinationOut,
    status_code=status.HTTP_201_CREATED,
)
def create_code_combination(
    structure_id: uuid.UUID,
    payload: CodeCombinationCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.combination.manage")),
):
    s = _get_structure(db, structure_id, principal.tenant_id)
    try:
        cc = create_combination(
            db, s, principal.tenant_id, payload.segments,
            allow_posting=payload.allow_posting, enabled=payload.enabled,
            start_date_active=payload.start_date_active, end_date_active=payload.end_date_active,
            created_by=principal.user.id,
        )
    except FlexValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="CREATE", entity_type="GlCodeCombination", entity_id=cc.id,
                 after={"code": cc.concatenated_segments})
    return cc


# --- Export ----------------------------------------------------------------
@router.get("/structures/{structure_id}/export")
def export_structure(
    structure_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("coa.export")),
):
    s = _get_structure(db, structure_id, principal.tenant_id)
    tenant = db.get(Tenant, principal.tenant_id)
    xlsx = build_coa_workbook(db, s, tenant.name if tenant else "HOA")
    filename = f"coa_{s.structure_code}.xlsx"
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
