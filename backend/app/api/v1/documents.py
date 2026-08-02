from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.documents import DocumentAttachment
from app.models.identity import Tenant
from app.schemas.documents import DocumentOut
from app.services import audit, documents_svc, reports
from app.services.documents_svc import DocumentError

router = APIRouter(
    prefix="/documents", tags=["documents"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("", response_model=list[DocumentOut])
def list_documents(entity_type: str | None = None, entity_id: uuid.UUID | None = None,
                   db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("document.manage"))):
    return documents_svc.list_documents(db, p.tenant_id, entity_type, entity_id)


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile,
    entity_type: str = Form(...),
    entity_id: uuid.UUID = Form(...),
    homeowner_id: uuid.UUID | None = Form(None),
    notes: str | None = Form(None),
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("document.manage")),
):
    data = await file.read()
    try:
        doc = documents_svc.save_document(
            db, tenant_id=p.tenant_id, entity_type=entity_type.upper(), entity_id=entity_id,
            filename=file.filename or "upload", content_type=file.content_type,
            data=data, homeowner_id=homeowner_id, notes=notes, uploaded_by=p.user.id)
    except DocumentError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="UPLOAD", entity_type="DocumentAttachment", entity_id=doc.id,
                 after={"filename": doc.filename, "entity": f"{doc.entity_type}:{doc.entity_id}"})
    return doc


def _get(db, doc_id, tenant_id) -> DocumentAttachment:
    d = db.get(DocumentAttachment, doc_id)
    if d is None or d.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return d


@router.get("/{doc_id}/download")
def download_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                      p: Principal = Depends(require_permission("document.manage"))):
    d = _get(db, doc_id, p.tenant_id)
    try:
        data = documents_svc.read_bytes(d)
    except DocumentError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return Response(content=data, media_type=d.content_type,
                    headers={"Content-Disposition": f'attachment; filename="{d.filename}"'})


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(doc_id: uuid.UUID, db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("document.manage"))):
    d = _get(db, doc_id, p.tenant_id)
    documents_svc.delete_document(db, d)
    audit.record(db, action="DELETE", entity_type="DocumentAttachment", entity_id=doc_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/index/export")
def export_index(db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("report.read"))):
    t = db.get(Tenant, p.tenant_id)
    content = reports.build_document_index_workbook(db, p.tenant_id, t.name if t else "HOA")
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="document_index.xlsx"'})
