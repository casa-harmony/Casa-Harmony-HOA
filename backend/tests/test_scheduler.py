"""P26: scheduled-run config, manual triggers, and run log."""
from __future__ import annotations

import os
import uuid

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
    income = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
                  if c["natural_account_value"] == "4000" and c["fund_value"] == "OPER")
    return token, tid, income


def test_config_default_serializes():
    """A tenant with no saved config must still serialize (transient defaults set)."""
    from app.models.scheduling import SchedulerConfig
    from app.schemas.scheduling import SchedulerConfigOut
    transient = SchedulerConfig(monthly_statements_enabled=False, board_packet_enabled=False,
                                day_of_month=1, attach_statement_pdf=True, attach_board_pdf=True,
                                dunning_enabled=False)
    out = SchedulerConfigOut.model_validate(transient)
    assert out.attach_statement_pdf is True and out.day_of_month == 1


def test_config_and_manual_triggers():
    token, tid, income = _ctx()
    # Seed a billable homeowner so statements have content.
    sfx = uuid.uuid4().hex[:6]
    ho = client.post("/api/v1/subledger/homeowners", headers=_h(token, tid), json={
        "account_number": f"SC-{sfx}", "first_name": "Sched", "last_name": "Ule",
        "property_unit": f"S{sfx[:3]}", "email": "sched@example.com"}).json()
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"SC {sfx}", "lines": [{"income_combination_id": income, "amount": "60.00"}]}).json()
    client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                json={"invoice_date": "2025-01-01", "due_days": 30, "homeowner_ids": [ho["id"]]})

    # Reset to a known disabled baseline (config persists across runs).
    base = client.put("/api/v1/scheduler/config", headers=_h(token, tid), json={
        "monthly_statements_enabled": False, "board_packet_enabled": False, "day_of_month": 1}).json()
    assert base["monthly_statements_enabled"] is False

    saved = client.put("/api/v1/scheduler/config", headers=_h(token, tid), json={
        "monthly_statements_enabled": True, "board_packet_enabled": True, "day_of_month": 1}).json()
    assert saved["monthly_statements_enabled"] is True and saved["day_of_month"] == 1

    r1 = client.post("/api/v1/scheduler/run/statements", headers=_h(token, tid))
    assert r1.status_code == 200 and r1.json()["status"] == "SUCCESS"
    r2 = client.post("/api/v1/scheduler/run/board-packet", headers=_h(token, tid))
    assert r2.status_code == 200 and r2.json()["status"] == "SUCCESS"

    runs = client.get("/api/v1/scheduler/runs", headers=_h(token, tid)).json()
    names = {r["job_name"] for r in runs}
    assert "MONTHLY_STATEMENTS" in names and "BOARD_PACKET" in names

    assert client.post("/api/v1/scheduler/run/bogus", headers=_h(token, tid)).status_code == 404
