from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.dunning import DunningRule
from app.models.identity import Tenant
from pydantic import BaseModel

from app.schemas.dunning import DunningLogOut, DunningRuleIn, DunningRuleOut, DunningRunResult
from app.services import audit, dunning


class _RunIn(BaseModel):
    as_of: date | None = None
    homeowner_ids: list[uuid.UUID] | None = None

router = APIRouter(prefix="/dunning", tags=["dunning"], dependencies=[Depends(require_active_tenant)])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/rules", response_model=list[DunningRuleOut])
def list_rules(db: Session = Depends(get_db),
               p: Principal = Depends(require_permission("collections.manage"))):
    return db.execute(select(DunningRule).where(DunningRule.tenant_id == p.tenant_id)
                      .order_by(DunningRule.days_past_due)).scalars().all()


@router.post("/rules", response_model=DunningRuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(payload: DunningRuleIn, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("collections.manage"))):
    rule = DunningRule(tenant_id=p.tenant_id, created_by=p.user.id, updated_by=p.user.id,
                       **payload.model_dump())
    db.add(rule)
    db.flush()
    audit.record(db, action="CREATE", entity_type="DunningRule", entity_id=rule.id,
                 after={"name": rule.name, "dpd": rule.days_past_due, "action": rule.action})
    return rule


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: uuid.UUID, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("collections.manage"))):
    rule = db.get(DunningRule, rule_id)
    if rule is None or rule.tenant_id != p.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rule not found")
    db.delete(rule)
    db.flush()
    audit.record(db, action="DELETE", entity_type="DunningRule", entity_id=rule_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/logs", response_model=list[DunningLogOut])
def list_logs(db: Session = Depends(get_db),
              p: Principal = Depends(require_permission("collections.manage"))):
    return dunning.recent_logs(db, p.tenant_id)


@router.post("/run", response_model=DunningRunResult)
def run(payload: _RunIn | None = None, db: Session = Depends(get_db),
        p: Principal = Depends(require_permission("collections.manage"))):
    payload = payload or _RunIn()
    res = dunning.run_dunning(db, tenant_id=p.tenant_id, as_of=payload.as_of or date.today(),
                              homeowner_ids=payload.homeowner_ids, created_by=p.user.id)
    audit.record(db, action="RUN_DUNNING", entity_type="DunningLog", after=res)
    return res


@router.get("/effectiveness/export")
def effectiveness_export(start: date, end: date, db: Session = Depends(get_db),
                         p: Principal = Depends(require_permission("collections.manage"))):
    t = db.get(Tenant, p.tenant_id)
    content = dunning.build_effectiveness_workbook(db, p.tenant_id, start, end, t.name if t else "HOA")
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="dunning_effectiveness.xlsx"'})
