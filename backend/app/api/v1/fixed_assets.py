from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.fixed_assets import FaAsset, ReserveComponent, ReserveStudy
from app.models.identity import Tenant
from app.schemas.fixed_assets import (
    AssetCreate,
    AssetOut,
    ComponentCreate,
    ComponentOut,
    DeprRunIn,
    DisposeIn,
    ForecastRow,
    ReserveVsActualRow,
    StudyCreate,
    StudyOut,
)
from app.services import audit, fixed_assets, reports
from app.services.distributions import DistributionError
from app.services.fixed_assets import AssetError

router = APIRouter(
    prefix="/fixed-assets", tags=["fixed-assets"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _err(exc):
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


def _get_asset(db, aid, tenant_id) -> FaAsset:
    a = db.get(FaAsset, aid)
    if a is None or a.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    return a


@router.get("/assets", response_model=list[AssetOut])
def list_assets(db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("fa.manage"))):
    return db.execute(select(FaAsset).where(FaAsset.tenant_id == p.tenant_id)
                      .order_by(FaAsset.asset_number)).scalars().all()


@router.post("/assets", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
def create_asset(payload: AssetCreate, db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("fa.manage"))):
    try:
        a = fixed_assets.create_asset(db, tenant_id=p.tenant_id, created_by=p.user.id,
                                      **payload.model_dump())
    except (AssetError, DistributionError) as exc:
        _err(exc)
    audit.record(db, action="CREATE", entity_type="FaAsset", entity_id=a.id,
                 after={"asset_number": a.asset_number, "cost": str(a.cost)})
    return a


@router.get("/assets/{asset_id}/forecast", response_model=list[ForecastRow])
def forecast(asset_id: uuid.UUID, db: Session = Depends(get_db),
             p: Principal = Depends(require_permission("fa.manage"))):
    return fixed_assets.depreciation_forecast(_get_asset(db, asset_id, p.tenant_id))


@router.post("/assets/{asset_id}/dispose", response_model=AssetOut)
def dispose(asset_id: uuid.UUID, payload: DisposeIn, db: Session = Depends(get_db),
            p: Principal = Depends(require_permission("fa.manage"))):
    a = _get_asset(db, asset_id, p.tenant_id)
    try:
        res = fixed_assets.dispose_asset(
            db, a, disposal_date=payload.disposal_date, proceeds=payload.proceeds,
            cash_combination_id=payload.cash_combination_id,
            gain_loss_combination_id=payload.gain_loss_combination_id, created_by=p.user.id)
    except (AssetError, DistributionError) as exc:
        _err(exc)
    audit.record(db, action="DISPOSE", entity_type="FaAsset", entity_id=a.id,
                 after={k: str(v) for k, v in res.items()})
    return a


@router.post("/depreciation/run")
def run_depreciation(payload: DeprRunIn, db: Session = Depends(get_db),
                     p: Principal = Depends(require_permission("fa.manage"))):
    try:
        res = fixed_assets.run_depreciation(db, p.tenant_id, payload.period_name, created_by=p.user.id)
    except (AssetError, DistributionError) as exc:
        _err(exc)
    audit.record(db, action="DEPRECIATION_RUN", entity_type="FaAsset",
                 after={"period": res["period"], "assets": res["assets_depreciated"],
                        "total": str(res["total"])})
    return {"period": res["period"], "assets_depreciated": res["assets_depreciated"],
            "total": str(res["total"]), "batch_id": str(res["batch_id"]) if res["batch_id"] else None}


# --- Reserve studies -------------------------------------------------------
@router.get("/reserve-studies", response_model=list[StudyOut])
def list_studies(db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("fa.manage"))):
    return db.execute(select(ReserveStudy).where(ReserveStudy.tenant_id == p.tenant_id)
                      .order_by(ReserveStudy.study_year.desc())).scalars().all()


@router.post("/reserve-studies", response_model=StudyOut, status_code=status.HTTP_201_CREATED)
def create_study(payload: StudyCreate, db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("fa.manage"))):
    s = fixed_assets.create_study(db, tenant_id=p.tenant_id, created_by=p.user.id, **payload.model_dump())
    audit.record(db, action="CREATE", entity_type="ReserveStudy", entity_id=s.id)
    return s


@router.get("/reserve-studies/{study_id}/components", response_model=list[ComponentOut])
def list_components(study_id: uuid.UUID, db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("fa.manage"))):
    return db.execute(select(ReserveComponent).where(
        ReserveComponent.tenant_id == p.tenant_id,
        ReserveComponent.study_id == study_id).order_by(ReserveComponent.name)).scalars().all()


@router.post("/reserve-studies/{study_id}/components", response_model=ComponentOut,
             status_code=status.HTTP_201_CREATED)
def add_component(study_id: uuid.UUID, payload: ComponentCreate, db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("fa.manage"))):
    try:
        c = fixed_assets.add_component(db, tenant_id=p.tenant_id, study_id=study_id,
                                       created_by=p.user.id, **payload.model_dump())
    except AssetError as exc:
        _err(exc)
    return c


@router.get("/reserve-studies/{study_id}/vs-actual", response_model=list[ReserveVsActualRow])
def reserve_vs_actual(study_id: uuid.UUID, db: Session = Depends(get_db),
                      p: Principal = Depends(require_permission("fa.manage"))):
    return fixed_assets.reserve_vs_actual(db, p.tenant_id, study_id)


# --- Reports ---------------------------------------------------------------
def _tname(db, tid):
    t = db.get(Tenant, tid)
    return t.name if t else "HOA"


def _xlsx(content, filename):
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/reports/register/export")
def export_register(db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("report.read"))):
    return _xlsx(reports.build_asset_register_workbook(db, p.tenant_id, _tname(db, p.tenant_id)),
                 "asset_register.xlsx")


@router.get("/reports/depreciation-forecast/export")
def export_forecast(db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("report.read"))):
    return _xlsx(reports.build_depreciation_forecast_workbook(db, p.tenant_id, _tname(db, p.tenant_id)),
                 "depreciation_forecast.xlsx")


@router.get("/reserve-studies/{study_id}/utilization/export")
def export_reserve(study_id: uuid.UUID, db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("report.read"))):
    return _xlsx(reports.build_reserve_utilization_workbook(db, p.tenant_id, study_id, _tname(db, p.tenant_id)),
                 "reserve_utilization.xlsx")
