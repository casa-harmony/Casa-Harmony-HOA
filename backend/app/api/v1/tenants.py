from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import Principal, get_principal, require_permission, require_superadmin
from app.models.identity import Tenant, User, Role, Membership
from app.schemas.tenant import TenantCreate, TenantOut, TenantUpdate, TenantAdminCreate
from app.services import audit, notifications
from app.services.provisioning import provision_tenant
from app.services.readiness import get_tenant_readiness
from app.core.security import create_password_reset_token, hash_password
from sqlalchemy import text

router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.get("", response_model=list[TenantOut])
def list_tenants(
    include_demo: bool = False,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_principal),
):
    """SUPERADMIN sees all HOAs; others see only HOAs they are a member of.

    Either way, demo/sample communities (``is_demo``) are excluded from this
    listing unless ``include_demo`` is passed — a display toggle on the
    Communities admin screen, not a security boundary. It has no effect on the
    topbar community switcher, which is built from the caller's own
    memberships at login and never calls this endpoint; a staff member who
    belongs to a demo tenant can still work in it as normal, they just won't
    see it listed here unless they ask to.
    """
    if principal.is_superadmin:
        stmt = select(Tenant)
        if not include_demo:
            stmt = stmt.where(Tenant.is_demo.is_(False))
        rows = db.execute(stmt.order_by(Tenant.name)).scalars().all()
        return rows
    # Non-superadmin: restrict to memberships.
    from app.models.identity import Membership

    stmt = (
        select(Tenant)
        .join(Membership, Membership.tenant_id == Tenant.id)
        .where(Membership.user_id == principal.user.id, Membership.is_active.is_(True))
    )
    if not include_demo:
        stmt = stmt.where(Tenant.is_demo.is_(False))
    rows = db.execute(stmt.order_by(Tenant.name)).scalars().unique().all()
    return rows


def _provision_or_conflict(**kwargs) -> Tenant:
    from sqlalchemy.exc import IntegrityError

    db = kwargs["db"]
    try:
        with db.begin_nested():
            return provision_tenant(**kwargs)
    except IntegrityError as exc:
        if "slug" not in str(exc.orig):
            raise
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Slug '{kwargs['slug']}' already in use"
        ) from exc


@router.post("", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantCreate,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_superadmin),
):
    if db.execute(select(Tenant).where(Tenant.slug == payload.slug)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Slug '{payload.slug}' already in use")

    # Slugs are unique platform-wide, but the sandbox partition hides the other
    # side's rows from the check above — so a collision across the partition
    # surfaces only as the unique-index violation. Translate it to the same 409
    # rather than letting it become a 500.
    tenant = _provision_or_conflict(
        db=db,
        slug=payload.slug,
        name=payload.name,
        admin_email=payload.admin_email,
        admin_password=payload.admin_password,
        admin_name=payload.admin_name,
        legal_name=payload.legal_name,
        num_units=payload.num_units,
        address_line1=payload.address_line1,
        address_line2=payload.address_line2,
        city=payload.city,
        state=payload.state,
        postal_code=payload.postal_code,
        monthly_dues=payload.monthly_dues,
        kind=payload.kind,
        is_demo=payload.is_demo,
        create_default_coa=payload.create_default_coa,
        actor_id=principal.user.id,
    )

    return tenant


@router.get("/{tenant_id}", response_model=TenantOut)
def get_tenant(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("tenant.read")),
):
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    if not principal.is_superadmin and principal.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this HOA")
    return tenant


@router.patch("/{tenant_id}", response_model=TenantOut)
def update_tenant(
    tenant_id: uuid.UUID,
    payload: TenantUpdate,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("tenant.update")),
):
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    if not principal.is_superadmin and principal.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this HOA")

    # Suspending/activating a tenant locks out every user in the HOA — a
    # platform action. SYSADMIN holds tenant.update (editing configuration)
    # but not tenant.suspend, so a HOA admin must never be able to freeze
    # their own community (or anyone else's). Only the platform SUPERADMIN
    # may change tenant status.
    if "status" in payload.model_fields_set and not principal.is_superadmin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the platform SUPERADMIN may suspend or activate a tenant",
        )

    before = {"name": tenant.name, "status": tenant.status}
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(tenant, k, v)
    tenant.updated_by = principal.user.id
    audit.record(
        db, action="UPDATE", entity_type="Tenant", entity_id=tenant.id,
        before=before, after=payload.model_dump(exclude_unset=True), tenant_id=tenant.id,
        ip_address=getattr(request.state, "client_ip", None),
    )
    return tenant


@router.post("/{tenant_id}/admins", status_code=status.HTTP_201_CREATED)
def create_tenant_admin(
    tenant_id: uuid.UUID,
    payload: TenantAdminCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("user.manage")),
):
    if principal.tenant_id != tenant_id and not principal.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized to manage this tenant")
        
    role = db.execute(
        select(Role).where(Role.code == payload.role_code, (Role.tenant_id == tenant_id) | (Role.tenant_id.is_(None)))
    ).scalars().first()
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Role '{payload.role_code}' not found")
        
    user = db.execute(select(User).where(User.email == payload.email.lower())).scalar_one_or_none()
    created = False
    if not user:
        if not payload.password and not payload.send_invite:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Must provide password or send_invite for new users")
        # An invited user gets an unusable random hash; the emailed reset token
        # is bound to its password version, so it dies once they set a password.
        user = User(
            email=payload.email.lower(),
            full_name=payload.full_name,
            job_title=payload.job_title,
            hashed_password=(
                hash_password(payload.password)
                if payload.password
                else hash_password(secrets.token_urlsafe(32))
            ),
            is_superadmin=False,
            must_change_password=True,  # superadmin-set password → force change on first login
        )
        db.add(user)
        db.flush()
        created = True
    else:
        # Existing account: apply the superadmin-set password / profile fields.
        # job_title lives on User, not Membership — Membership has no such column.
        if payload.password:
            user.hashed_password = hash_password(payload.password)
            user.must_change_password = True
        if payload.job_title is not None:
            user.job_title = payload.job_title
        if payload.full_name:
            user.full_name = payload.full_name

    membership = db.execute(
        select(Membership).where(Membership.user_id == user.id, Membership.tenant_id == tenant_id, Membership.role_id == role.id)
    ).scalar_one_or_none()
    
    if not membership:
        membership = Membership(
            tenant_id=tenant_id,
            user_id=user.id,
            role_id=role.id,
            is_active=True,
            created_by=principal.user.id,
            updated_by=principal.user.id,
        )
        db.add(membership)

    if created and payload.send_invite and not payload.password:
        token = create_password_reset_token(user.id, user.hashed_password)
        notifications.send_password_invite(user.email, token)

    db.commit()
    return {"message": "Admin created successfully"}


@router.get("/{tenant_id}/readiness")
def get_readiness(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_principal),
):
    if principal.tenant_id != tenant_id and not principal.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized to read this tenant")
    
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
        
    return get_tenant_readiness(db, tenant_id)


TENANT_TABLES_CHILD_FIRST = [
    # AR / collections / statements
    "statement_deliveries", "statement_runs", "dunning_logs", "dunning_rules",
    "payment_plan_installments", "payment_plans", "liens", "collection_cases",
    "ar_receipts", "ar_invoices", "ar_late_fee_rules", "ar_billing_plan_lines",
    "ar_billing_plans", "ar_homeowners",
    # resident portal
    "resident_units", "resident_otp_challenges", "residents",
    # AP / PO / receiving / vendors
    "ap_invoice_holds", "ap_invoice_distributions", "ap_payment_links",
    "ap_payment_schedules", "ap_payments", "ap_invoices",
    "rcv_transactions", "rcv_lines", "rcv_headers",
    "po_encumbrances", "po_lines", "purchase_orders",
    "supplier_bank_accounts", "supplier_contacts", "supplier_sites", "vendors",
    "distribution_sets", "payment_terms", "vendor_types",
    # cash / gateway / payments
    "gateway_transactions", "gateway_configs", "payment_tokens",
    "bank_statement_lines", "bank_statements", "bank_accounts", "banks",
    # GL / budget / periods / encumbrance
    "gl_journal_lines", "gl_journals", "gl_batches", "gl_posting_runs",
    "gl_balances", "gl_budget_lines", "gl_budgets",
    "budget_control", "budget_lines", "budget_versions",
    "encumbrance_settings", "accounting_periods",
    # fixed assets
    "reserve_study_components", "reserve_studies", "fixed_assets",
    # COA / KFF
    "code_combinations", "cross_validation_rules", "value_set_values",
    "value_sets", "coa_segments", "coa_structures",
    # service desk / approvals / notifications / compliance / migration
    "service_tickets", "approval_requests", "approval_rules",
    "approval_hierarchies", "notifications", "compliance_items",
    "migration_records", "migration_batches", "golive_status", "backup_runs",
    "scheduler_configs", "job_runs", "document_attachments",
    # identity (memberships before roles; tenant roles are tenant-scoped)
    "memberships", "audit_logs",
]


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenant(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_superadmin),
):
    if settings.ENVIRONMENT == "production":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tenant deletion is disabled in production environments.")

    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
        
    if tenant.slug == "casa-harmony":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot purge the protected demo tenant.")

    existing = {r[0] for r in db.execute(text(
        "SELECT c.table_name FROM information_schema.columns c "
        "WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'"
    )).all()}
    tables = [t for t in TENANT_TABLES_CHILD_FIRST if t in existing]

    tid = str(tenant_id)

    # Users who hold a membership here — captured before those rows are deleted,
    # so the orphan sweep below never touches users who belonged only to other
    # (still-existing) HOAs.
    affected = {r[0] for r in db.execute(text(
        "SELECT DISTINCT user_id FROM memberships WHERE tenant_id = :tid"
    ), {"tid": tid}).all()}

    for table in tables:
        db.execute(text(f"DELETE FROM {table} WHERE tenant_id = :tid"), {"tid": tid})
        
    db.execute(text("DELETE FROM role_permissions WHERE role_id IN "
                    "(SELECT id FROM roles WHERE tenant_id = :tid)"), {"tid": tid})
    db.execute(text("DELETE FROM roles WHERE tenant_id = :tid"), {"tid": tid})
    db.execute(text("DELETE FROM tenants WHERE id = :tid"), {"tid": tid})

    # Remove only users orphaned by THIS purge — their last membership was in
    # this tenant — and record who was removed.
    if affected:
        affected_sql = ",".join(f"'{u}'" for u in affected)
        orphans = db.execute(text(
            f"SELECT id, email FROM users u WHERE u.id IN ({affected_sql}) "
            "AND u.is_superadmin = false "
            "AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)"
        )).all()
        for uid, email in orphans:
            db.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": str(uid)})
            audit.record(
                db, action="DELETE", entity_type="User", entity_id=uid,
                after={"email": email, "reason": "orphaned by tenant deletion"},
                tenant_id=None,
            )

    return None
