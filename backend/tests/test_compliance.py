"""P19: Go-live hardening — health, checklist, manual items, package export."""
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


def test_health_metrics():
    token, tid = _ctx()
    h = client.get("/api/v1/compliance/health", headers=_h(token, tid)).json()
    assert h["gl_balanced"] is True  # double-entry must always balance
    assert h["coa_structures"] >= 1
    assert h["superadmin_exists"] is True
    assert "budget_control_mode" in h


def test_checklist_has_auto_and_manual_items():
    token, tid = _ctx()
    cl = client.get("/api/v1/compliance/checklist", headers=_h(token, tid)).json()
    codes = {i["code"] for i in cl["items"]}
    assert "gl_integrity" in codes  # automated
    assert "rotate_cloud_keys" in codes  # manual go-live item
    assert "PASS" in cl["summary"] and "go_live_ready" in cl


def test_mark_manual_item_done_flips_status():
    token, tid = _ctx()
    r = client.put("/api/v1/compliance/items/rotate_cloud_keys", headers=_h(token, tid),
                   json={"status": "DONE", "notes": "Rotated 2026-06-22"})
    assert r.status_code == 200 and r.json()["status"] == "DONE"
    cl = client.get("/api/v1/compliance/checklist", headers=_h(token, tid)).json()
    item = next(i for i in cl["items"] if i["code"] == "rotate_cloud_keys")
    assert item["status"] == "PASS"


def test_unknown_item_404():
    token, tid = _ctx()
    r = client.put("/api/v1/compliance/items/not_a_real_item", headers=_h(token, tid),
                   json={"status": "DONE"})
    assert r.status_code == 404


def test_golive_package_export():
    token, tid = _ctx()
    r = client.get("/api/v1/compliance/package/export", headers=_h(token, tid))
    assert r.status_code == 200 and r.content[:2] == b"PK"
