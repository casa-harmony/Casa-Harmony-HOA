"""Service Desk — the 'Service Desk' half of the Service Desk + ERP product.

A minimal ticketing model with an integration hook into Procurement: a ticket
with an estimated cost and a vendor can spawn a Purchase Order, so service
requests drive expenses through the same approval + GL pipeline.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class ServiceTicket(Base, TenantMixin, TimestampMixin):
    __tablename__ = "service_tickets"
    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_number", name="uq_ticket_number"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    ticket_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(20), default="MAINTENANCE", nullable=False)
    # MAINTENANCE|COMPLAINT|REQUEST|VIOLATION
    priority: Mapped[str] = mapped_column(String(10), default="MEDIUM", nullable=False)  # LOW|MEDIUM|HIGH
    status: Mapped[str] = mapped_column(String(15), default="OPEN", nullable=False)
    # OPEN|IN_PROGRESS|RESOLVED|CLOSED
    homeowner_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_homeowners.id", ondelete="SET NULL")
    )
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    # Expense integration hook fields.
    vendor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_suppliers.id", ondelete="SET NULL")
    )
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    po_header_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("po_headers.id", ondelete="SET NULL")
    )


class ServiceTicketComment(Base, TenantMixin, TimestampMixin):
    __tablename__ = "service_ticket_comments"

    id: Mapped[uuid.UUID] = uuid_pk()
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("service_tickets.id", ondelete="CASCADE")
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)

