from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.banking import ApBank, ApBankAccount, ApBankAccountUse
from app.schemas.financials import (
    BankAccountCreate,
    BankAccountOut,
    BankCreate,
    BankOut,
    RoutingLookupOut,
)
from app.services import audit
from app.services.bank_lookup import lookup_routing

router = APIRouter(
    prefix="/banks", tags=["banks"], dependencies=[Depends(require_active_tenant)]
)


def _mask(n: str | None) -> str | None:
    if not n:
        return None
    return f"****{n[-4:]}" if len(n) >= 4 else "****"


@router.get("/routing-lookup/{routing_number}", response_model=RoutingLookupOut)
def routing_lookup(
    routing_number: str,
    principal: Principal = Depends(require_permission("bank.manage")),
):
    """Enrich a routing number via the public routing-number API (best-effort)."""
    data = lookup_routing(routing_number)
    if not data:
        return RoutingLookupOut(bank_name=None, routing_number=routing_number, found=False)
    return RoutingLookupOut(found=True, **data)


@router.get("", response_model=list[BankOut])
def list_banks(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("bank.manage")),
):
    return db.execute(
        select(ApBank).where(ApBank.tenant_id == principal.tenant_id).order_by(ApBank.bank_name)
    ).scalars().all()


@router.post("", response_model=BankOut, status_code=status.HTTP_201_CREATED)
def create_bank(
    payload: BankCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("bank.manage")),
):
    enrich = lookup_routing(payload.routing_number) or {}
    bank_name = payload.bank_name or enrich.get("bank_name")
    if not bank_name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "bank_name is required (routing lookup did not resolve a name)",
        )
    bank = ApBank(
        tenant_id=principal.tenant_id, routing_number=payload.routing_number,
        bank_name=bank_name, branch_name=payload.branch_name,
        city=enrich.get("city"), state=enrich.get("state"), address=enrich.get("address"),
        created_by=principal.user.id, updated_by=principal.user.id,
    )
    db.add(bank)
    db.flush()
    audit.record(db, action="CREATE", entity_type="ApBank", entity_id=bank.id,
                 after={"routing_number": bank.routing_number})
    return bank


@router.post("/accounts", response_model=BankAccountOut, status_code=status.HTTP_201_CREATED)
def create_bank_account(
    payload: BankAccountCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("bank.manage")),
):
    bank = db.get(ApBank, payload.bank_id)
    if bank is None or bank.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bank not found")
    acct = ApBankAccount(
        tenant_id=principal.tenant_id, bank_id=payload.bank_id,
        account_name=payload.account_name, account_number=payload.account_number,
        account_type=payload.account_type, cash_combination_id=payload.cash_combination_id,
        created_by=principal.user.id, updated_by=principal.user.id,
    )
    db.add(acct)
    db.flush()
    db.add(ApBankAccountUse(
        tenant_id=principal.tenant_id, bank_account_id=acct.id,
        use_type=payload.use_type, primary_flag=True,
        created_by=principal.user.id, updated_by=principal.user.id,
    ))
    db.flush()
    audit.record(db, action="CREATE", entity_type="ApBankAccount", entity_id=acct.id,
                 after={"account_name": acct.account_name, "last_four": _mask(payload.account_number)})
    return BankAccountOut(
        id=acct.id, bank_id=acct.bank_id, account_name=acct.account_name,
        account_number_masked=_mask(payload.account_number), account_type=acct.account_type,
        currency=acct.currency, status=acct.status,
    )


@router.get("/accounts", response_model=list[BankAccountOut])
def list_bank_accounts(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("bank.manage")),
):
    rows = db.execute(
        select(ApBankAccount).where(ApBankAccount.tenant_id == principal.tenant_id)
    ).scalars().all()
    return [
        BankAccountOut(
            id=a.id, bank_id=a.bank_id, account_name=a.account_name,
            account_number_masked=_mask(a.account_number), account_type=a.account_type,
            currency=a.currency, status=a.status,
        )
        for a in rows
    ]
