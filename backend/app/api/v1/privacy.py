"""CCPA / privacy: data-subject requests (Right to Know & Right to Delete)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.compliance import DataSubjectRequest
from app.models.identity import Membership, Role, Tenant, User
from app.models.subledger import ArHomeowner
from app.schemas.security_ext import DataSubjectRequestCreate, DataSubjectRequestOut
from app.services import audit
from app.services.reports_pdf import build_compliance_report_pdf

router = APIRouter(
    prefix="/privacy", tags=["privacy"], dependencies=[Depends(require_active_tenant)]
)


@router.get("/requests", response_model=list[DataSubjectRequestOut])
def list_requests(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("privacy.manage")),
):
    return db.execute(
        select(DataSubjectRequest)
        .where(DataSubjectRequest.tenant_id == principal.tenant_id)
        .order_by(DataSubjectRequest.created_at.desc())
    ).scalars().all()


@router.post("/requests", response_model=DataSubjectRequestOut, status_code=status.HTTP_201_CREATED)
def create_request(
    payload: DataSubjectRequestCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("privacy.manage")),
):
    subject = db.execute(
        select(User).where(User.email == payload.subject_email.lower())
    ).scalar_one_or_none()
    dsr = DataSubjectRequest(
        tenant_id=principal.tenant_id,
        request_type=payload.request_type,
        subject_user_id=subject.id if subject else None,
        subject_email=payload.subject_email.lower(),
        notes=payload.notes,
        created_by=principal.user.id,
        updated_by=principal.user.id,
    )
    db.add(dsr)
    db.flush()
    audit.record(db, action="CREATE", entity_type="DataSubjectRequest", entity_id=dsr.id,
                 after={"type": dsr.request_type, "subject": dsr.subject_email})
    return dsr


@router.get("/export")
def export_subject_data(
    subject_email: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("privacy.manage")),
):
    """Right to Know: machine-readable export of the subject's data in this HOA."""
    email = subject_email.lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()

    memberships = []
    if user:
        rows = db.execute(
            select(Membership, Tenant, Role)
            .join(Tenant, Tenant.id == Membership.tenant_id)
            .join(Role, Role.id == Membership.role_id)
            .where(Membership.user_id == user.id, Membership.tenant_id == principal.tenant_id)
        ).all()
        memberships = [
            {"tenant": t.name, "role": r.code} for (_m, t, r) in rows
        ]
    homeowners = db.execute(
        select(ArHomeowner).where(
            ArHomeowner.tenant_id == principal.tenant_id, ArHomeowner.email == email
        )
    ).scalars().all()

    return {
        "subject_email": email,
        "identity": None
        if not user
        else {
            "user_id": str(user.id),
            "full_name": user.full_name,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat(),
        },
        "memberships": memberships,
        "ar_accounts": [
            {"account_number": h.account_number, "property_unit": h.property_unit}
            for h in homeowners
        ],
        "generated_for": "CCPA Right to Know",
    }


@router.post("/requests/{request_id}/erase")
def fulfill_erasure(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("privacy.manage")),
):
    """Right to Delete: anonymize the subject's PII while preserving ledger integrity."""
    dsr = db.get(DataSubjectRequest, request_id)
    if dsr is None or dsr.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    if dsr.request_type != "ERASURE":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Request is not an erasure")

    anon = f"erased+{uuid.uuid4().hex[:12]}@anonymized.invalid"
    # Anonymize AR homeowner PII in this tenant.
    homeowners = db.execute(
        select(ArHomeowner).where(
            ArHomeowner.tenant_id == principal.tenant_id,
            ArHomeowner.email == (dsr.subject_email or ""),
        )
    ).scalars().all()
    for h in homeowners:
        h.first_name = "REDACTED"
        h.last_name = "REDACTED"
        h.email = anon
        h.bank_account = None
        h.status = "erased"

    # Anonymize the user identity (kept for referential/audit integrity).
    if dsr.subject_user_id:
        user = db.get(User, dsr.subject_user_id)
        if user and not user.is_superadmin:
            user.email = anon
            user.full_name = "REDACTED"
            user.is_active = False
            user.mfa_secret = None
            user.mfa_enabled = False

    dsr.status = "completed"
    dsr.updated_by = principal.user.id
    audit.record(db, action="ERASURE", entity_type="DataSubjectRequest", entity_id=dsr.id,
                 after={"status": "completed"})
    return {"status": "completed", "anonymized": anon}


@router.get("/compliance-report/export")
def export_compliance_report(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("privacy.manage")),
):
    """Auditor-facing compliance controls summary (SOC 2 / PCI / ISO / CCPA) as PDF."""
    tenant = db.get(Tenant, principal.tenant_id)
    pdf = build_compliance_report_pdf(db, principal.tenant_id, tenant.name if tenant else "HOA")
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="compliance_summary.pdf"'},
    )
