"""Document attachment storage. File bytes are written under DOCS_DIR keyed by a
random storage key; metadata lives in document_attachments. Downloads are gated by
the API layer (tenant + permission)."""
from __future__ import annotations

import os
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.documents import DocumentAttachment

ALLOWED_ENTITIES = {"AR_INVOICE", "AP_INVOICE", "PO", "ASSET", "RESERVE_STUDY", "HOMEOWNER", "OTHER"}


class DocumentError(ValueError):
    pass


def _docs_dir() -> str:
    d = os.environ.get("DOCS_DIR", "/tmp/casa_docs")
    os.makedirs(d, exist_ok=True)
    return d


def save_document(db: Session, *, tenant_id, entity_type, entity_id, filename, content_type,
                  data: bytes, homeowner_id=None, notes=None, uploaded_by=None) -> DocumentAttachment:
    if entity_type not in ALLOWED_ENTITIES:
        raise DocumentError(f"Unsupported entity type: {entity_type}")
    if not data:
        raise DocumentError("Empty file")
    storage_key = uuid.uuid4().hex
    path = os.path.join(_docs_dir(), storage_key)
    with open(path, "wb") as fh:
        fh.write(data)
    doc = DocumentAttachment(
        tenant_id=tenant_id, entity_type=entity_type, entity_id=entity_id, filename=filename,
        content_type=content_type or "application/octet-stream", size_bytes=len(data),
        storage_key=storage_key, notes=notes, homeowner_id=homeowner_id,
        uploaded_by=uploaded_by, created_by=uploaded_by, updated_by=uploaded_by)
    db.add(doc)
    db.flush()
    return doc


def list_documents(db: Session, tenant_id, entity_type=None, entity_id=None, homeowner_id=None):
    stmt = select(DocumentAttachment).where(DocumentAttachment.tenant_id == tenant_id)
    if entity_type:
        stmt = stmt.where(DocumentAttachment.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(DocumentAttachment.entity_id == entity_id)
    if homeowner_id:
        stmt = stmt.where(DocumentAttachment.homeowner_id == homeowner_id)
    return db.execute(stmt.order_by(DocumentAttachment.created_at.desc())).scalars().all()


def read_bytes(doc: DocumentAttachment) -> bytes:
    path = os.path.join(_docs_dir(), doc.storage_key)
    if not os.path.exists(path):
        raise DocumentError("Stored file not found")
    with open(path, "rb") as fh:
        return fh.read()


def delete_document(db: Session, doc: DocumentAttachment) -> None:
    path = os.path.join(_docs_dir(), doc.storage_key)
    if os.path.exists(path):
        os.remove(path)
    db.delete(doc)
    db.flush()
