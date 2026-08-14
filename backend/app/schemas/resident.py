from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


# --- Admin: resident management -------------------------------------------
class ResidentCreate(BaseModel):
    model_config = {"extra": "forbid"}

    username: str = Field(min_length=3, max_length=60)
    # Provide password OR send_invite (emails a one-time set-password link),
    # matching the admin invite pattern on POST /tenants/{id}/admins.
    password: str | None = Field(default=None, min_length=8, max_length=128)
    send_invite: bool = False
    full_name: str = Field(min_length=1, max_length=160)
    resident_type: str = Field(default="OWNER", pattern=r"^(OWNER|RENTER)$")
    email: str | None = None
    phone: str | None = None
    mfa_channel: str = Field(default="EMAIL", pattern=r"^(EMAIL|SMS)$")


class ResidentUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    is_active: bool | None = None


class ResidentOut(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    resident_type: str
    email: str | None
    is_active: bool
    unit_count: int = 0

    model_config = {"from_attributes": True}


class ResidentUnitLink(BaseModel):
    homeowner_id: uuid.UUID
    is_primary: bool = False
    unit_number: str | None = None  # defaults to the homeowner's property_unit


class ResidentUnitOut(BaseModel):
    id: uuid.UUID
    homeowner_id: uuid.UUID
    unit_number: str
    is_primary: bool

    model_config = {"from_attributes": True}


# --- Portal: resident-facing ----------------------------------------------
class PortalLogin(BaseModel):
    hoa_slug: str
    username: str
    password: str


class PortalResident(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    resident_type: str
    must_change_password: bool = False


class PortalToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    resident: PortalResident


class PortalLoginResult(BaseModel):
    """Step 1 result: either a code challenge (MFA) or a token (MFA disabled)."""
    mfa_required: bool
    challenge_id: uuid.UUID | None = None
    channel: str | None = None
    destination_masked: str | None = None
    dev_otp: str | None = None  # populated only in development (no provider)
    access_token: str | None = None
    token_type: str = "bearer"
    resident: PortalResident | None = None


class PortalVerify(BaseModel):
    challenge_id: uuid.UUID
    code: str = Field(min_length=4, max_length=10)


class PortalChangePassword(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class PortalForgot(BaseModel):
    hoa_slug: str
    username: str


class PortalReset(BaseModel):
    challenge_id: uuid.UUID
    code: str = Field(min_length=4, max_length=10)
    new_password: str = Field(min_length=8, max_length=128)


class PortalAcceptInvite(BaseModel):
    """Consumes the one-time set-password link emailed by POST /residents
    with send_invite=true (token-based, mirrors staff /auth/reset-password —
    distinct from the OTP-challenge PortalReset above since an invited
    resident has no password yet to authenticate a forgot-password request)."""
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class PortalUnit(BaseModel):
    homeowner_id: uuid.UUID
    unit_number: str
    account_number: str
    is_primary: bool
    balance: Decimal


class PortalInvoice(BaseModel):
    id: uuid.UUID
    invoice_number: str
    invoice_type: str
    amount: Decimal
    amount_paid: Decimal
    balance: Decimal
    invoice_date: date
    due_date: date | None
    status: str


class PortalReceipt(BaseModel):
    receipt_number: str
    amount: Decimal
    receipt_date: date
    payment_method: str


class PortalPay(BaseModel):
    invoice_id: uuid.UUID
    amount: Decimal = Field(gt=0)
    payment_token_id: uuid.UUID | None = None


class PortalDocument(BaseModel):
    id: uuid.UUID
    homeowner_id: uuid.UUID | None
    entity_type: str
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime


class PortalTicketIn(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    description: str | None = None
    category: str = Field(default="MAINTENANCE", pattern=r"^(MAINTENANCE|COMPLAINT|REQUEST|VIOLATION)$")
    priority: str = Field(default="MEDIUM", pattern=r"^(LOW|MEDIUM|HIGH)$")


class PortalTicketOut(BaseModel):
    id: uuid.UUID
    ticket_number: str
    subject: str
    description: str | None
    category: str
    priority: str
    status: str
    created_at: datetime


class PortalNotification(BaseModel):
    category: str  # OVERDUE | DUE_SOON | LATE_FEE | STATEMENT
    message: str
    homeowner_id: uuid.UUID
    unit_number: str
    due_date: date | None = None
    amount: Decimal | None = None


class PortalDashboard(BaseModel):
    total_balance: Decimal
    units: int
    open_invoices: int
    open_assessments: int
    open_special: int
    next_due_date: date | None = None
    recent_payments: list[PortalReceipt] = []
