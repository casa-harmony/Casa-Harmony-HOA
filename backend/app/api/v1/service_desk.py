from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from decimal import Decimal

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.identity import Tenant
from app.models.procurement import PoHeader
from app.models.service_desk import ServiceTicket, ServiceTicketComment
from app.models.subledger import ArHomeowner
from app.models.workflow import ApprovalRequest
from app.schemas.approvals import ActIn
from app.schemas.procurement import PoOut
from app.schemas.service_desk import TicketCreate, TicketOut, TicketToPo, TicketUpdate, TicketCommentIn, TicketCommentOut
from app.services import approvals, audit
from app.services.distributions import DistributionError
from app.services.po_service import create_po
from app.services.sd_reports import build_service_request_workbook

router = APIRouter(
    prefix="/service-desk", tags=["service-desk"], dependencies=[Depends(require_active_tenant)]
)


def _get_ticket(db: Session, ticket_id: uuid.UUID, tenant_id: uuid.UUID) -> ServiceTicket:
    t = db.get(ServiceTicket, ticket_id)
    if t is None or t.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    return t


def _ticket_out(ticket: ServiceTicket, homeowner: ArHomeowner | None) -> dict:
    return {
        "id": ticket.id,
        "ticket_number": ticket.ticket_number,
        "subject": ticket.subject,
        "description": ticket.description,
        "category": ticket.category,
        "priority": ticket.priority,
        "status": ticket.status,
        "homeowner_id": ticket.homeowner_id,
        "unit": homeowner.property_unit if homeowner else None,
        "reported_by": f"{homeowner.first_name} {homeowner.last_name}" if homeowner else None,
        "vendor_id": ticket.vendor_id,
        "estimated_cost": ticket.estimated_cost,
        "po_header_id": ticket.po_header_id,
        "created_at": ticket.created_at,
    }


@router.get("/tickets", response_model=list[TicketOut])
def list_tickets(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ticket.manage")),
):
    rows = db.execute(
        select(ServiceTicket, ArHomeowner)
        .outerjoin(ArHomeowner, ArHomeowner.id == ServiceTicket.homeowner_id)
        .where(ServiceTicket.tenant_id == principal.tenant_id)
        .order_by(ServiceTicket.created_at.desc())
    ).all()
    return [_ticket_out(t, h) for t, h in rows]


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ticket.manage")),
):
    ticket = _get_ticket(db, ticket_id, principal.tenant_id)
    homeowner = db.get(ArHomeowner, ticket.homeowner_id) if ticket.homeowner_id else None
    return _ticket_out(ticket, homeowner)


@router.post("/tickets", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
def create_ticket(
    payload: TicketCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ticket.manage")),
):
    seq = db.execute(
        select(func.count(ServiceTicket.id)).where(ServiceTicket.tenant_id == principal.tenant_id)
    ).scalar_one()
    ticket = ServiceTicket(
        tenant_id=principal.tenant_id, ticket_number=f"TKT-{seq + 1:06d}",
        created_by=principal.user.id, updated_by=principal.user.id, **payload.model_dump(),
    )
    db.add(ticket)
    db.flush()
    homeowner = db.get(ArHomeowner, ticket.homeowner_id) if ticket.homeowner_id else None
    audit.record(db, action="CREATE", entity_type="ServiceTicket", entity_id=ticket.id,
                 after={"ticket_number": ticket.ticket_number, "subject": ticket.subject})
    return _ticket_out(ticket, homeowner)


@router.patch("/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(
    ticket_id: uuid.UUID,
    payload: TicketUpdate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ticket.manage")),
):
    ticket = _get_ticket(db, ticket_id, principal.tenant_id)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(ticket, k, v)
    ticket.updated_by = principal.user.id
    audit.record(db, action="UPDATE", entity_type="ServiceTicket", entity_id=ticket.id)
    homeowner = db.get(ArHomeowner, ticket.homeowner_id) if ticket.homeowner_id else None
    return _ticket_out(ticket, homeowner)


@router.post("/tickets/{ticket_id}/create-po", response_model=PoOut, status_code=status.HTTP_201_CREATED)
def ticket_to_po(
    ticket_id: uuid.UUID,
    payload: TicketToPo,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("po.manage")),
):
    """Integration hook: a service ticket drives an expense via a Purchase Order."""
    ticket = _get_ticket(db, ticket_id, principal.tenant_id)
    if ticket.po_header_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ticket already has a PO")
    if ticket.vendor_id is None or not ticket.estimated_cost:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Ticket needs a vendor and an estimated cost to create a PO",
        )
    # High-value work orders must be approved before they can spend.
    amount = Decimal(ticket.estimated_cost)
    needs = approvals.required_levels(db, principal.tenant_id, "WORK_ORDER", amount)
    if needs > 0:
        req = db.execute(
            select(ApprovalRequest).where(
                ApprovalRequest.tenant_id == principal.tenant_id,
                ApprovalRequest.document_type == "WORK_ORDER",
                ApprovalRequest.document_id == ticket.id,
            )
        ).scalar_one_or_none()
        if req is None or req.status != "APPROVED":
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "This work order requires approval before a PO can be created",
            )
    try:
        po = create_po(
            db, tenant_id=principal.tenant_id, vendor_id=ticket.vendor_id,
            order_date=date.today(), description=f"From ticket {ticket.ticket_number}: {ticket.subject}",
            lines=[{
                "item_description": payload.item_description or ticket.subject,
                "quantity": 1, "unit_price": ticket.estimated_cost,
                "distributions": [{"code_combination_id": payload.code_combination_id,
                                   "amount": ticket.estimated_cost}],
            }],
            created_by=principal.user.id,
        )
    except DistributionError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    ticket.po_header_id = po.id
    ticket.status = "IN_PROGRESS"
    audit.record(db, action="TICKET_TO_PO", entity_type="ServiceTicket", entity_id=ticket.id,
                 after={"po_number": po.po_number})
    return po


# --- Work-order approval (high-value tickets) ------------------------------
@router.post("/tickets/{ticket_id}/submit-for-approval")
def submit_for_approval(
    ticket_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("ticket.manage")),
):
    ticket = _get_ticket(db, ticket_id, principal.tenant_id)
    if not ticket.estimated_cost:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Set an estimated cost before requesting approval")
    req = approvals.submit(
        db, tenant_id=principal.tenant_id, document_type="WORK_ORDER",
        document_id=ticket.id, amount=Decimal(ticket.estimated_cost),
        submitted_by=principal.user.id,
    )
    audit.record(db, action="SUBMIT", entity_type="ServiceTicket", entity_id=ticket.id)
    return {"request_id": req.id, "status": req.status,
            "required_levels": req.required_levels, "current_level": req.current_level}


@router.post("/tickets/{ticket_id}/approve")
def approve_ticket(
    ticket_id: uuid.UUID,
    payload: ActIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("po.approve")),
):
    ticket = _get_ticket(db, ticket_id, principal.tenant_id)
    req = db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.tenant_id == principal.tenant_id,
            ApprovalRequest.document_type == "WORK_ORDER",
            ApprovalRequest.document_id == ticket.id,
        )
    ).scalar_one_or_none()
    if req is None or req.status != "PENDING":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No pending approval for this ticket")
    approvals.act(db, request=req, approver_id=principal.user.id,
                  approve=payload.approve, comments=payload.comments)
    audit.record(db, action="APPROVE" if payload.approve else "REJECT",
                 entity_type="ServiceTicket", entity_id=ticket.id)
    return {"status": req.status, "current_level": req.current_level}


# --- Cost summary export (by Fund/Project) ---------------------------------
@router.get("/cost-summary/export")
def export_cost_summary(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("report.read")),
):
    tenant = db.get(Tenant, principal.tenant_id)
    xlsx = build_service_request_workbook(db, principal.tenant_id, tenant.name if tenant else "HOA")
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="service_requests.xlsx"'},
    )


@router.get("/tickets/{ticket_id}/comments", response_model=list[TicketCommentOut])
def get_comments(ticket_id: uuid.UUID, db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("service.read"))):
    _get_ticket(db, ticket_id, p.tenant_id)
    rows = db.execute(select(ServiceTicketComment).where(ServiceTicketComment.ticket_id == ticket_id).order_by(ServiceTicketComment.created_at)).scalars().all()
    # Note: author and role are normally joined from users/roles. For the mock compatibility:
    out = []
    for r in rows:
        out.append({"id": r.id, "author": "Staff", "role": "Property Manager", "at": r.created_at, "body": r.body})
    return out

@router.post("/tickets/{ticket_id}/comments", response_model=TicketCommentOut)
def post_comment(ticket_id: uuid.UUID, payload: TicketCommentIn, db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("service.read"))):
    _get_ticket(db, ticket_id, p.tenant_id)
    c = ServiceTicketComment(tenant_id=p.tenant_id, ticket_id=ticket_id, author_id=p.user.id, body=payload.body)
    db.add(c)
    db.flush()
    return {"id": c.id, "author": "Staff", "role": "Property Manager", "at": c.created_at, "body": c.body}
