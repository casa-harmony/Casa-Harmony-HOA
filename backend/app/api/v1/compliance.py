from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.identity import Tenant
from app.schemas.golive import ItemUpdate
from app.services import audit, compliance_golive, golive_exec
from app.services.golive_exec import GoLiveError

router = APIRouter(
    prefix="/compliance", tags=["compliance"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/health")
def health(db: Session = Depends(get_db),
           p: Principal = Depends(require_permission("compliance.manage"))):
    return compliance_golive.run_health(db, p.tenant_id)


@router.get("/checklist")
def checklist(db: Session = Depends(get_db),
              p: Principal = Depends(require_permission("compliance.manage"))):
    return compliance_golive.checklist(db, p.tenant_id)


@router.put("/items/{code}")
def update_item(code: str, payload: ItemUpdate, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("compliance.manage"))):
    try:
        c = compliance_golive.set_item(db, p.tenant_id, code, payload.status, payload.notes)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    audit.record(db, action="UPDATE", entity_type="ComplianceItem", entity_id=c.id,
                 after={"code": code, "status": payload.status})
    return {"code": c.code, "status": c.status, "notes": c.notes}


@router.get("/package/export")
def export_package(db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("compliance.manage"))):
    t = db.get(Tenant, p.tenant_id)
    content = compliance_golive.build_golive_package(db, p.tenant_id, t.name if t else "HOA")
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="go_live_package.xlsx"'})


# --- Go-live execution (P20) ----------------------------------------------
def _status_dict(s):
    return {"is_live": s.is_live, "went_live_at": str(s.went_live_at) if s.went_live_at else None,
            "last_validation_at": str(s.last_validation_at) if s.last_validation_at else None,
            "last_validation_passed": s.last_validation_passed}


@router.get("/go-live/status")
def go_live_status(db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("compliance.manage"))):
    return _status_dict(golive_exec.get_status(db, p.tenant_id))


@router.post("/go-live/validate")
def go_live_validate(db: Session = Depends(get_db),
                     p: Principal = Depends(require_permission("compliance.manage"))):
    res = golive_exec.validate(db, p.tenant_id)
    audit.record(db, action="GOLIVE_VALIDATE", entity_type="GoLiveStatus",
                 after={"passed": res["passed"]})
    return res


@router.post("/go-live/rotate/{code}")
def go_live_rotate(code: str, db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("compliance.manage"))):
    try:
        c = golive_exec.record_rotation(db, p.tenant_id, code, p.user.id)
    except GoLiveError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    audit.record(db, action="ROTATE_SECRET", entity_type="ComplianceItem", entity_id=c.id,
                 after={"code": code})
    return {"code": c.code, "status": c.status, "notes": c.notes}


@router.post("/go-live/activate")
def go_live_activate(db: Session = Depends(get_db),
                     p: Principal = Depends(require_permission("compliance.manage"))):
    try:
        s = golive_exec.set_live(db, p.tenant_id, True, p.user.id)
    except GoLiveError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="GO_LIVE", entity_type="GoLiveStatus", entity_id=s.id)
    return _status_dict(s)


@router.post("/go-live/deactivate")
def go_live_deactivate(db: Session = Depends(get_db),
                       p: Principal = Depends(require_permission("compliance.manage"))):
    s = golive_exec.set_live(db, p.tenant_id, False, p.user.id)
    audit.record(db, action="GO_LIVE_OFF", entity_type="GoLiveStatus", entity_id=s.id)
    return _status_dict(s)


@router.post("/go-live/backup")
def go_live_backup(db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("compliance.manage"))):
    rec = golive_exec.run_backup(db, p.tenant_id, p.user.id)
    audit.record(db, action="BACKUP", entity_type="BackupRun", entity_id=rec.id,
                 after={"status": rec.status, "file": rec.filename})
    return {"filename": rec.filename, "status": rec.status, "size_bytes": rec.size_bytes,
            "encrypted": rec.encrypted, "detail": rec.detail}


@router.get("/go-live/backups")
def go_live_backups(db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("compliance.manage"))):
    return [{"filename": b.filename, "status": b.status, "size_bytes": b.size_bytes,
             "encrypted": b.encrypted, "when": str(b.created_at)}
            for b in golive_exec.list_backups(db, p.tenant_id)]


@router.get("/cutover/guide")
def cutover_guide(db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("compliance.manage"))):
    return golive_exec.rotation_guide(db, p.tenant_id)


@router.post("/cutover/execute")
def cutover_execute(db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("compliance.manage"))):
    res = golive_exec.run_cutover(db, p.tenant_id, p.user.id)
    audit.record(db, action="CUTOVER", entity_type="GoLiveStatus",
                 after={"validation_passed": res["validation_passed"],
                        "production_ready": res["production_ready"]})
    return res


@router.get("/cutover/report/export")
def cutover_report(db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("compliance.manage"))):
    t = db.get(Tenant, p.tenant_id)
    content = golive_exec.build_cutover_report(db, p.tenant_id, t.name if t else "HOA")
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="cutover_report.xlsx"'})


@router.get("/go-live/execution-report/export")
def export_execution_report(db: Session = Depends(get_db),
                            p: Principal = Depends(require_permission("compliance.manage"))):
    t = db.get(Tenant, p.tenant_id)
    content = golive_exec.build_execution_report(db, p.tenant_id, t.name if t else "HOA")
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="go_live_execution.xlsx"'})
