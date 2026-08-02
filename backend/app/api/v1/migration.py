from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.migration import MigrationBatch, MigrationRecord
from app.services import audit, migration
from pydantic import BaseModel

router = APIRouter(prefix="/migration", tags=["migration"], dependencies=[Depends(require_active_tenant)])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class BatchOut(BaseModel):
    id: uuid.UUID
    batch_number: str
    entity_type: str
    source_filename: str | None
    status: str
    mode: str
    total_rows: int
    created: int
    updated: int
    skipped: int
    errors: int

    class Config:
        from_attributes = True


class RecordOut(BaseModel):
    row_num: int
    source_ref: str
    action: str
    target_id: uuid.UUID | None
    message: str | None

    class Config:
        from_attributes = True


@router.get("/entities")
def entities(p: Principal = Depends(require_permission("data.migrate"))):
    return migration.entity_catalog()


@router.get("/template/{entity_type}")
def template(entity_type: str, p: Principal = Depends(require_permission("data.migrate"))):
    try:
        content = migration.template_workbook(entity_type)
    except migration.MigrationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return Response(content=content, media_type=XLSX, headers={
        "Content-Disposition": f'attachment; filename="{entity_type.lower()}_template.xlsx"'})


@router.post("/preview")
async def preview(entity_type: str = Form(...), file: UploadFile = File(...),
                  p: Principal = Depends(require_permission("data.migrate"))):
    """Detect headers + sample rows and suggest a field mapping (mapping-grid step)."""
    if entity_type not in migration.IMPORTERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown entity type: {entity_type}")
    rows = migration.parse_rows(file.filename or "", await file.read())
    headers = list(rows[0].keys()) if rows else []
    return {"headers": headers, "row_count": len(rows),
            "suggested_mapping": migration.auto_map(headers, entity_type),
            "canonical_columns": migration._columns_for(entity_type),
            "sample": rows[:5]}


@router.post("/run", response_model=BatchOut)
async def run(entity_type: str = Form(...), dry_run: bool = Form(True), mode: str = Form("ADD"),
              mapping: str | None = Form(None),
              file: UploadFile = File(...), db: Session = Depends(get_db),
              p: Principal = Depends(require_permission("data.migrate"))):
    data = await file.read()
    import json
    try:
        mapping_dict = json.loads(mapping) if mapping else None
    except json.JSONDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "mapping must be valid JSON")
    try:
        rows = migration.parse_rows(file.filename or "", data)
        batch = migration.run_migration(db, tenant_id=p.tenant_id, entity_type=entity_type,
                                        rows=rows, filename=file.filename, dry_run=dry_run,
                                        mode=mode.upper(), mapping=mapping_dict, created_by=p.user.id)
    except migration.MigrationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    audit.record(db, action="MIGRATION_RUN", entity_type="MigrationBatch", entity_id=batch.id,
                 after={"entity": entity_type, "mode": mode, "dry_run": dry_run,
                        "created": batch.created, "updated": batch.updated,
                        "skipped": batch.skipped, "errors": batch.errors})
    return batch  # get_db commits on teardown (keeps the RLS GUC live for serialization)


@router.get("/batches", response_model=list[BatchOut])
def batches(db: Session = Depends(get_db),
            p: Principal = Depends(require_permission("data.migrate"))):
    return db.execute(select(MigrationBatch).where(MigrationBatch.tenant_id == p.tenant_id)
                      .order_by(MigrationBatch.created_at.desc())).scalars().all()


@router.get("/batches/{batch_id}/records", response_model=list[RecordOut])
def records(batch_id: uuid.UUID, db: Session = Depends(get_db),
            p: Principal = Depends(require_permission("data.migrate"))):
    return db.execute(select(MigrationRecord).where(
        MigrationRecord.tenant_id == p.tenant_id, MigrationRecord.batch_id == batch_id)
        .order_by(MigrationRecord.row_num)).scalars().all()


@router.post("/batches/{batch_id}/rollback", response_model=BatchOut)
def rollback(batch_id: uuid.UUID, db: Session = Depends(get_db),
             p: Principal = Depends(require_permission("data.migrate"))):
    batch = db.get(MigrationBatch, batch_id)
    if batch is None or batch.tenant_id != p.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found")
    try:
        removed = migration.rollback_batch(db, batch)
    except migration.MigrationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    audit.record(db, action="MIGRATION_ROLLBACK", entity_type="MigrationBatch",
                 entity_id=batch.id, after={"removed": removed})
    return batch


@router.get("/batches/{batch_id}/report")
def report(batch_id: uuid.UUID, db: Session = Depends(get_db),
           p: Principal = Depends(require_permission("data.migrate"))):
    batch = db.get(MigrationBatch, batch_id)
    if batch is None or batch.tenant_id != p.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found")
    content = migration.report_workbook(db, batch)
    return Response(content=content, media_type=XLSX, headers={
        "Content-Disposition": f'attachment; filename="{batch.batch_number}_report.xlsx"'})
