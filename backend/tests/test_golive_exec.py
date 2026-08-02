"""P20: Go-live execution — validation, rotation, backup, activation gate."""
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
    tid = next(t for t in client.get("/api/v1/tenants",
               headers={"Authorization": f"Bearer {token}"}).json()
               if t["slug"] == "casa-harmony")["id"]
    sid = client.get("/api/v1/coa/structures", headers=_h(token, tid)).json()[0]["id"]
    return token, tid, sid


def _ensure_retained_earnings(token, tid, sid):
    """Create a 3000 Retained Earnings combination for each Fund (clone an existing combo)."""
    struct = client.get(f"/api/v1/coa/structures/{sid}", headers=_h(token, tid)).json()
    segs = struct["segments"]
    combos = client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
    funds = sorted({c["fund_value"] for c in combos if c["fund_value"]})
    for fund in funds:
        src = next(c for c in combos if c["fund_value"] == fund)
        seg_map = {}
        for s in segs:
            q = s["qualifier"]
            if q == "natural_account":
                seg_map[s["segment_number"]] = "3000"
            elif q == "balancing":
                seg_map[s["segment_number"]] = src["balancing_segment_value"]
            elif q == "cost_center":
                seg_map[s["segment_number"]] = src["cost_center_value"] or "000"
            elif q == "fund":
                seg_map[s["segment_number"]] = fund
        client.post(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid),
                    json={"segments": seg_map, "allow_posting": True})  # 409 if exists is fine


def test_validate_and_activation_gate():
    token, tid, sid = _ctx()
    # Reset persistent state so the "blocked" precondition holds across re-runs.
    client.post("/api/v1/compliance/go-live/deactivate", headers=_h(token, tid))
    for code in ("rotate_cloud_keys", "rotate_repo_token", "rotate_app_secret"):
        client.put(f"/api/v1/compliance/items/{code}", headers=_h(token, tid), json={"status": "PENDING"})
    # Fresh validation exposes the security + RE checks.
    v = client.post("/api/v1/compliance/go-live/validate", headers=_h(token, tid)).json()
    names = {c["check"] for c in v["checks"]}
    assert "Security key/token/secret rotation" in names
    assert "Retained Earnings per Fund" in names

    # Before rotation, activation is blocked.
    blocked = client.post("/api/v1/compliance/go-live/activate", headers=_h(token, tid))
    assert blocked.status_code == 422

    # Record key/token/secret rotation + ensure RE accounts exist.
    for code in ("rotate_cloud_keys", "rotate_repo_token", "rotate_app_secret"):
        r = client.post(f"/api/v1/compliance/go-live/rotate/{code}", headers=_h(token, tid))
        assert r.status_code == 200 and r.json()["status"] == "DONE"
    _ensure_retained_earnings(token, tid, sid)

    # Now validation passes and activation succeeds.
    v2 = client.post("/api/v1/compliance/go-live/validate", headers=_h(token, tid)).json()
    assert v2["passed"] is True, v2
    act = client.post("/api/v1/compliance/go-live/activate", headers=_h(token, tid))
    assert act.status_code == 200 and act.json()["is_live"] is True

    # Deactivate returns to non-live.
    deact = client.post("/api/v1/compliance/go-live/deactivate", headers=_h(token, tid))
    assert deact.status_code == 200 and deact.json()["is_live"] is False


def test_rotate_unknown_item_404():
    token, tid, sid = _ctx()
    r = client.post("/api/v1/compliance/go-live/rotate/not_real", headers=_h(token, tid))
    assert r.status_code == 404


def test_backup_records_run_and_report():
    token, tid, sid = _ctx()
    b = client.post("/api/v1/compliance/go-live/backup", headers=_h(token, tid))
    assert b.status_code == 200 and b.json()["status"] in ("SUCCESS", "FAILED")
    runs = client.get("/api/v1/compliance/go-live/backups", headers=_h(token, tid)).json()
    assert len(runs) >= 1
    rep = client.get("/api/v1/compliance/go-live/execution-report/export", headers=_h(token, tid))
    assert rep.status_code == 200 and rep.content[:2] == b"PK"
