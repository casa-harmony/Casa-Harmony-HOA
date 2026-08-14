import sys

def patch_api():
    with open("app/api/v1/service_desk.py", "r") as f:
        content = f.read()

    if "TicketCommentIn" not in content:
        content = content.replace("TicketOut, TicketToPo, TicketUpdate", "TicketOut, TicketToPo, TicketUpdate, TicketCommentIn, TicketCommentOut")
    if "ServiceTicketComment" not in content:
        content = content.replace("from app.models.service_desk import ServiceTicket", "from app.models.service_desk import ServiceTicket, ServiceTicketComment")
        
    if "def get_comments" not in content:
        content += """

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
"""
        with open("app/api/v1/service_desk.py", "w") as f:
            f.write(content)

patch_api()
