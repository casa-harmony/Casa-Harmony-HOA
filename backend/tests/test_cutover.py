"""P33: production cutover — rotation guide, execute, report."""
from __future__ import annotations

import os

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")


def _h(token, tid):
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": tid}


def _ctx():
    token = client.post("/api/v1/auth/login",
                        json={"email": SUPERADMIN, "password": SUPERADMIN_PW}).json()["access_token"]
    tid = next(t for t in client.get("/api/v1/tenants?include_demo=true",
               headers={"Authorization": f"Bearer {token}"}).json()
               if t["slug"] == "casa-harmony")["id"]
    return token, tid


def test_rotation_guide_lists_three_items():
    token, tid = _ctx()
    guide = client.get("/api/v1/compliance/cutover/guide", headers=_h(token, tid)).json()
    codes = {g["code"] for g in guide}
    assert codes == {"rotate_cloud_keys", "rotate_repo_token", "rotate_app_secret"}
    assert all(g["instructions"] and "status" in g for g in guide)


def test_cutover_execute_returns_validation_and_readiness():
    token, tid = _ctx()
    res = client.post("/api/v1/compliance/cutover/execute", headers=_h(token, tid))
    assert res.status_code == 200, res.text
    body = res.json()
    assert "validation_passed" in body and "production_ready" in body
    assert "backup" in body and body["backup"]["status"] in ("SUCCESS", "FAILED")
    assert len(body["rotations"]) == 3


def test_cutover_report_export():
    token, tid = _ctx()
    r = client.get("/api/v1/compliance/cutover/report/export", headers=_h(token, tid))
    assert r.status_code == 200 and r.content[:2] == b"PK"
