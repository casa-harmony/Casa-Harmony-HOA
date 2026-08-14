"""Document attachment storage.

Backed by Cloudinary when credentials are configured (``CLOUDINARY_CLOUD_NAME``
+ key + secret, or one ``CLOUDINARY_URL``) — the same pluggable pattern used
for email in :mod:`app.services.notifications`. Files upload as Cloudinary's
"authenticated" delivery type, so a stored document is not reachable by its raw
URL; every fetch goes through a per-request signed URL, keeping access control
where it already lives: the API layer's tenant + permission check on
``GET /documents/{id}/download``, not Cloudinary's own link secrecy.

Falls back to local disk (``DOCS_DIR``, default ``/tmp/casa_docs``) when
unconfigured, so local dev works with no external account. That fallback does
not survive a redeploy — fine for a laptop, not for a hosted deployment.

``storage_key`` on ``DocumentAttachment`` is an opaque random id either way;
the Cloudinary public_id is derived from it plus the tenant, so no schema
change was needed to add cloud storage.
"""
from __future__ import annotations

import logging
import os
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.documents import DocumentAttachment

ALLOWED_ENTITIES = {"AR_INVOICE", "AP_INVOICE", "PO", "ASSET", "RESERVE_STUDY", "HOMEOWNER", "OTHER"}

logger = logging.getLogger("casa-harmony.documents")


class DocumentError(ValueError):
    pass


# --------------------------------------------------------------------------- #
# Cloudinary
# --------------------------------------------------------------------------- #

_configured = False


def _cloudinary_ready() -> bool:
    has_url = bool(settings.CLOUDINARY_URL)
    has_parts = bool(
        settings.CLOUDINARY_CLOUD_NAME and settings.CLOUDINARY_API_KEY and settings.CLOUDINARY_API_SECRET
    )
    return has_url or has_parts


def _configure() -> None:
    global _configured
    if _configured or not _cloudinary_ready():
        return
    import cloudinary

    if settings.CLOUDINARY_URL:
        os.environ.setdefault("CLOUDINARY_URL", settings.CLOUDINARY_URL)
        cloudinary.config(cloudinary_url=settings.CLOUDINARY_URL, secure=True)
    else:
        cloudinary.config(
            cloud_name=settings.CLOUDINARY_CLOUD_NAME,
            api_key=settings.CLOUDINARY_API_KEY,
            api_secret=settings.CLOUDINARY_API_SECRET,
            secure=True,
        )
    _configured = True


def _public_id(tenant_id, storage_key: str) -> str:
    folder = settings.CLOUDINARY_FOLDER.strip("/") or "casa-harmony/documents"
    return f"{folder}/{tenant_id}/{storage_key}"


def _cloudinary_upload(data: bytes, *, tenant_id, storage_key: str, filename: str) -> None:
    import cloudinary.uploader

    _configure()
    cloudinary.uploader.upload(
        data,
        resource_type="raw",
        type="authenticated",
        public_id=_public_id(tenant_id, storage_key),
        overwrite=False,
        use_filename=False,
        unique_filename=False,
        tags=["casa-harmony", "document"],
        context={"filename": filename},
    )


def _cloudinary_read(*, tenant_id, storage_key: str) -> bytes:
    import cloudinary.utils

    _configure()
    url, _opts = cloudinary.utils.cloudinary_url(
        _public_id(tenant_id, storage_key),
        resource_type="raw",
        type="authenticated",
        sign_url=True,
    )
    resp = httpx.get(url, timeout=30.0)
    if resp.status_code != 200:
        raise DocumentError(f"Could not fetch stored file (Cloudinary {resp.status_code})")
    return resp.content


def _cloudinary_delete(*, tenant_id, storage_key: str) -> None:
    import cloudinary.uploader

    _configure()
    try:
        cloudinary.uploader.destroy(
            _public_id(tenant_id, storage_key), resource_type="raw", type="authenticated"
        )
    except Exception:  # pragma: no cover - best-effort cleanup
        logger.exception("Cloudinary delete failed for %s", storage_key)


# --------------------------------------------------------------------------- #
# Local-disk fallback (dev only)
# --------------------------------------------------------------------------- #


def _docs_dir() -> str:
    d = os.environ.get("DOCS_DIR", "/tmp/casa_docs")
    os.makedirs(d, exist_ok=True)
    return d


def _local_path(storage_key: str) -> str:
    return os.path.join(_docs_dir(), storage_key)


# --------------------------------------------------------------------------- #
# Public API — unchanged signatures, so the FastAPI routes need no changes
# --------------------------------------------------------------------------- #


def save_document(db: Session, *, tenant_id, entity_type, entity_id, filename, content_type,
                  data: bytes, homeowner_id=None, notes=None, uploaded_by=None) -> DocumentAttachment:
    if entity_type not in ALLOWED_ENTITIES:
        raise DocumentError(f"Unsupported entity type: {entity_type}")
    if not data:
        raise DocumentError("Empty file")

    storage_key = uuid.uuid4().hex
    if _cloudinary_ready():
        _cloudinary_upload(data, tenant_id=tenant_id, storage_key=storage_key, filename=filename)
    else:
        with open(_local_path(storage_key), "wb") as fh:
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
    # Check local disk first — cheap, and covers files uploaded before
    # Cloudinary was configured on this deployment. Anything not found there
    # falls through to Cloudinary when it's configured.
    local = _local_path(doc.storage_key)
    if os.path.exists(local):
        with open(local, "rb") as fh:
            return fh.read()
    if _cloudinary_ready():
        return _cloudinary_read(tenant_id=doc.tenant_id, storage_key=doc.storage_key)
    raise DocumentError("Stored file not found")


def delete_document(db: Session, doc: DocumentAttachment) -> None:
    local = _local_path(doc.storage_key)
    if os.path.exists(local):
        os.remove(local)
    if _cloudinary_ready():
        _cloudinary_delete(tenant_id=doc.tenant_id, storage_key=doc.storage_key)
    db.delete(doc)
    db.flush()
