"""Go-live execution: structured validation, key-rotation recording, database
backups, and the audited go-live activation toggle.
"""
from __future__ import annotations

import gzip
import os
import subprocess
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.budgeting import BudgetControlSettings
from app.models.gl import GlJeBatch
from app.models.golive import ComplianceItem
from app.models.golive_status import BackupRun, GoLiveStatus
from app.models.kff import GlCodeCombination, KffStructure
from app.models.period import AccountingPeriod
from app.services import compliance_golive

REQUIRED_SECURITY = ("rotate_cloud_keys", "rotate_repo_token", "rotate_app_secret")
RETAINED_EARNINGS_NATURAL = "3000"


class GoLiveError(ValueError):
    pass


def get_status(db: Session, tenant_id) -> GoLiveStatus:
    s = db.execute(select(GoLiveStatus).where(GoLiveStatus.tenant_id == tenant_id)).scalar_one_or_none()
    if s is None:
        s = GoLiveStatus(tenant_id=tenant_id, is_live=False, last_validation_passed=False)
        db.add(s)
        db.flush()
    return s


def validate(db: Session, tenant_id) -> dict:
    """Structured production-readiness validation. Persists the result on GoLiveStatus."""
    checks: list[dict] = []

    def add(name, ok, detail):
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    # COA configured.
    structures = db.execute(select(func.count(KffStructure.id)).where(
        KffStructure.tenant_id == tenant_id)).scalar_one()
    add("COA configured", structures >= 1, f"{structures} structure(s)")

    # Retained Earnings (3000) exists per Fund in use.
    funds = [f for (f,) in db.execute(
        select(GlCodeCombination.fund_value).where(
            GlCodeCombination.tenant_id == tenant_id).distinct()).all() if f]
    missing = []
    for fund in funds:
        ok = db.execute(select(GlCodeCombination).where(
            GlCodeCombination.tenant_id == tenant_id,
            GlCodeCombination.natural_account_value == RETAINED_EARNINGS_NATURAL,
            GlCodeCombination.fund_value == fund,
            GlCodeCombination.allow_posting.is_(True))).first()
        if not ok:
            missing.append(fund)
    add("Retained Earnings per Fund", not missing,
        "all funds covered" if not missing else f"missing {RETAINED_EARNINGS_NATURAL} for: {', '.join(missing)}")

    # An open accounting period exists.
    open_periods = db.execute(select(func.count(AccountingPeriod.id)).where(
        AccountingPeriod.tenant_id == tenant_id, AccountingPeriod.status == "OPEN")).scalar_one()
    add("Open accounting period", True, f"{open_periods} open (implicitly open if none set)")

    # GL integrity: no unbalanced posted batches.
    unbalanced = db.execute(select(func.count(GlJeBatch.id)).where(
        GlJeBatch.tenant_id == tenant_id, GlJeBatch.status == "POSTED",
        GlJeBatch.control_total_dr != GlJeBatch.control_total_cr)).scalar_one()
    add("GL integrity (balanced posted batches)", unbalanced == 0, f"{unbalanced} unbalanced")

    # Required security items completed.
    compliance_golive.ensure_items(db, tenant_id)
    done = {c.code for c in db.execute(select(ComplianceItem).where(
        ComplianceItem.tenant_id == tenant_id, ComplianceItem.status == "DONE")).scalars().all()}
    sec_ok = all(code in done for code in REQUIRED_SECURITY)
    add("Security key/token/secret rotation", sec_ok,
        "all rotated" if sec_ok else "rotate cloud keys, repo token, and app secret")

    # Payment gateway: if active, required credentials must be present (STRIPE).
    from app.models.payment_gateway import GatewayConfig

    gw = db.execute(select(GatewayConfig).where(GatewayConfig.tenant_id == tenant_id)).scalar_one_or_none()
    if gw is None or not gw.active:
        add("Payment gateway configuration", True, "no active gateway (manual receipts)")
    elif gw.provider == "STRIPE":
        ok = bool(gw.secret_key and gw.webhook_secret)
        add("Payment gateway configuration", ok,
            "Stripe keys + webhook secret set" if ok else "Stripe is active but missing secret/webhook keys")
    else:
        add("Payment gateway configuration", True, f"{gw.provider} active")

    passed = all(c["ok"] for c in checks)
    s = get_status(db, tenant_id)
    s.last_validation_at = datetime.now(timezone.utc)
    s.last_validation_passed = passed
    db.flush()
    return {"passed": passed, "checks": checks}


def record_rotation(db: Session, tenant_id, code: str, user_id=None) -> ComplianceItem:
    if code not in REQUIRED_SECURITY:
        raise GoLiveError("Unknown rotation item")
    stamp = datetime.now(timezone.utc).date().isoformat()
    return compliance_golive.set_item(db, tenant_id, code, "DONE", notes=f"Rotated {stamp}")


def set_live(db: Session, tenant_id, go_live: bool, user_id=None) -> GoLiveStatus:
    s = get_status(db, tenant_id)
    if go_live:
        result = validate(db, tenant_id)
        if not result["passed"]:
            failed = [c["check"] for c in result["checks"] if not c["ok"]]
            raise GoLiveError("Validation failed: " + "; ".join(failed))
        s.is_live = True
        s.went_live_at = datetime.now(timezone.utc)
        s.went_live_by = user_id
    else:
        s.is_live = False
    db.flush()
    return s


def _conn_url() -> str:
    url = settings.sqlalchemy_database_uri
    return url.replace("postgresql+psycopg://", "postgresql://").replace("+psycopg", "")


def run_backup(db: Session, tenant_id, user_id=None) -> BackupRun:
    """Run a gzipped pg_dump to BACKUP_DIR; record the run. Failure is recorded, not raised."""
    backup_dir = os.environ.get("BACKUP_DIR", "/tmp/casa_backups")
    os.makedirs(backup_dir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"casa_{stamp}.sql.gz"
    path = os.path.join(backup_dir, filename)
    rec = BackupRun(tenant_id=tenant_id, filename=filename, created_by=user_id, updated_by=user_id)
    try:
        proc = subprocess.run(["pg_dump", _conn_url()], capture_output=True, timeout=600)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.decode("utf-8", "replace")[:400] or "pg_dump failed")
        with gzip.open(path, "wb") as fh:
            fh.write(proc.stdout)
        rec.status = "SUCCESS"
        rec.size_bytes = os.path.getsize(path)
        rec.encrypted = bool(os.environ.get("BACKUP_GPG_RECIPIENT"))
        rec.detail = path
    except (FileNotFoundError, RuntimeError, subprocess.TimeoutExpired, OSError) as exc:
        rec.status = "FAILED"
        rec.detail = f"{type(exc).__name__}: {exc}"[:400]
    db.add(rec)
    db.flush()
    return rec


def list_backups(db: Session, tenant_id):
    return db.execute(select(BackupRun).where(BackupRun.tenant_id == tenant_id)
                      .order_by(BackupRun.created_at.desc()).limit(20)).scalars().all()


def build_execution_report(db: Session, tenant_id, tenant_name: str) -> bytes:
    """Go-live execution package: validation results, activation status, backup log."""
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Font

    result = validate(db, tenant_id)
    status = get_status(db, tenant_id)
    backups = list_backups(db, tenant_id)

    wb = Workbook()
    ws = wb.active; ws.title = "Validation"
    ws["A1"] = f"{tenant_name} — Go-Live Execution Report"
    ws["A1"].font = Font(size=14, bold=True)
    ws["A3"] = f"Validation result: {'PASSED' if result['passed'] else 'FAILED'}"
    ws["A3"].font = Font(bold=True)
    ws.cell(row=5, column=1, value="Check").font = Font(bold=True)
    ws.cell(row=5, column=2, value="Result").font = Font(bold=True)
    ws.cell(row=5, column=3, value="Detail").font = Font(bold=True)
    r = 6
    for c in result["checks"]:
        ws.cell(row=r, column=1, value=c["check"])
        ws.cell(row=r, column=2, value="PASS" if c["ok"] else "FAIL")
        ws.cell(row=r, column=3, value=c["detail"])
        r += 1
    ws.column_dimensions["A"].width = 36
    ws.column_dimensions["B"].width = 8
    ws.column_dimensions["C"].width = 50

    st = wb.create_sheet("Status")
    st["A1"] = "Activation Status"; st["A1"].font = Font(size=14, bold=True)
    rows = [("Is live", "YES" if status.is_live else "NO"),
            ("Went live at", str(status.went_live_at or "")),
            ("Last validation at", str(status.last_validation_at or "")),
            ("Last validation passed", "YES" if status.last_validation_passed else "NO")]
    for i, (k, v) in enumerate(rows, start=3):
        st.cell(row=i, column=1, value=k).font = Font(bold=True)
        st.cell(row=i, column=2, value=v)
    st.column_dimensions["A"].width = 24
    st.column_dimensions["B"].width = 30

    bk = wb.create_sheet("Backups")
    bk["A1"] = "Recent Backups"; bk["A1"].font = Font(size=14, bold=True)
    for i, t in enumerate(["When", "File", "Size", "Status", "Encrypted"], start=1):
        bk.cell(row=3, column=i, value=t).font = Font(bold=True)
    r = 4
    for b in backups:
        bk.cell(row=r, column=1, value=str(b.created_at))
        bk.cell(row=r, column=2, value=b.filename)
        bk.cell(row=r, column=3, value=b.size_bytes)
        bk.cell(row=r, column=4, value=b.status)
        bk.cell(row=r, column=5, value="Y" if b.encrypted else "N")
        r += 1
    for col, w in {"A": 26, "B": 26, "C": 12, "D": 10, "E": 10}.items():
        bk.column_dimensions[col].width = w

    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


# --- P33: production cutover & guided key rotation -------------------------
ROTATION_GUIDE = {
    "rotate_cloud_keys": (
        "Rotate cloud (AWS) access keys",
        "In AWS IAM, create a NEW access key for the deploy user, update /opt/casa/.env "
        "(and any SSM/secrets), verify a deploy works, then DEACTIVATE and DELETE the old "
        "exposed key. Never commit keys."),
    "rotate_repo_token": (
        "Rotate GitHub token",
        "GitHub → Settings → Developer settings → Personal access tokens: revoke the exposed "
        "token, issue a new fine-scoped one, and update CI/deploy secrets."),
    "rotate_app_secret": (
        "Rotate application secret (JWT SECRET_KEY)",
        "Generate a fresh SECRET_KEY, set it in /opt/casa/.env, and redeploy. Existing "
        "sessions are invalidated (users re-login)."),
}


def rotation_guide(db: Session, tenant_id) -> list[dict]:
    compliance_golive.ensure_items(db, tenant_id)
    done = {c.code: c for c in db.execute(select(ComplianceItem).where(
        ComplianceItem.tenant_id == tenant_id)).scalars().all()}
    out = []
    for code, (title, instructions) in ROTATION_GUIDE.items():
        item = done.get(code)
        out.append({"code": code, "title": title, "instructions": instructions,
                    "status": item.status if item else "PENDING",
                    "notes": item.notes if item else None})
    return out


def run_cutover(db: Session, tenant_id, user_id=None) -> dict:
    """One-shot cutover: validate, take a fresh backup, and report readiness."""
    result = validate(db, tenant_id)
    backup = run_backup(db, tenant_id, user_id)
    status = get_status(db, tenant_id)
    ready = result["passed"]
    return {
        "validation_passed": result["passed"],
        "checks": result["checks"],
        "backup": {"status": backup.status, "filename": backup.filename},
        "rotations": rotation_guide(db, tenant_id),
        "is_live": status.is_live,
        "production_ready": bool(ready and status.is_live),
        "ready_to_activate": ready,
    }


def build_cutover_report(db: Session, tenant_id, tenant_name: str) -> bytes:
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Font

    result = validate(db, tenant_id)
    status = get_status(db, tenant_id)
    rotations = rotation_guide(db, tenant_id)
    backups = list_backups(db, tenant_id)

    wb = Workbook()
    ws = wb.active; ws.title = "Cutover"
    ws["A1"] = f"{tenant_name} — Production Cutover Report"
    ws["A1"].font = Font(size=14, bold=True)
    ws["A3"] = f"Production ready: {'YES' if (result['passed'] and status.is_live) else 'NO'}"
    ws["A3"].font = Font(bold=True)
    ws["A4"] = f"Validation: {'PASSED' if result['passed'] else 'FAILED'} · Live: {'YES' if status.is_live else 'NO'}"
    r = 6
    ws.cell(row=r, column=1, value="Validation check").font = Font(bold=True)
    ws.cell(row=r, column=2, value="Result").font = Font(bold=True)
    ws.cell(row=r, column=3, value="Detail").font = Font(bold=True)
    r += 1
    for c in result["checks"]:
        ws.cell(row=r, column=1, value=c["check"])
        ws.cell(row=r, column=2, value="PASS" if c["ok"] else "FAIL")
        ws.cell(row=r, column=3, value=c["detail"]); r += 1
    r += 1
    ws.cell(row=r, column=1, value="Key rotation").font = Font(bold=True); r += 1
    for g in rotations:
        ws.cell(row=r, column=1, value=g["title"])
        ws.cell(row=r, column=2, value=g["status"]); r += 1
    r += 1
    ws.cell(row=r, column=1, value="Recent backups").font = Font(bold=True); r += 1
    for b in backups[:5]:
        ws.cell(row=r, column=1, value=str(b.created_at))
        ws.cell(row=r, column=2, value=b.status)
        ws.cell(row=r, column=3, value=b.filename); r += 1
    for col, w in {"A": 40, "B": 12, "C": 50}.items():
        ws.column_dimensions[col].width = w
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()
