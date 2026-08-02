"""P22: resident portal — dashboard, notifications, documents, statement, isolation."""
from __future__ import annotations

import io
import os
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")


def _h(token, tid):
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": tid}


def _admin_ctx():
    token = client.post("/api/v1/auth/login",
                        json={"email": SUPERADMIN, "password": SUPERADMIN_PW}).json()["access_token"]
    tid = next(t for t in client.get("/api/v1/tenants",
               headers={"Authorization": f"Bearer {token}"}).json()
               if t["slug"] == "casa-harmony")["id"]
    sid = client.get("/api/v1/coa/structures", headers=_h(token, tid)).json()[0]["id"]
    income = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
                  if c["natural_account_value"] == "4000" and c["fund_value"] == "OPER")
    return token, tid, income


def _homeowner(token, tid, unit):
    sfx = uuid.uuid4().hex[:6]
    return client.post("/api/v1/subledger/homeowners", headers=_h(token, tid), json={
        "account_number": f"P22-{sfx}", "first_name": "Port", "last_name": "Resident",
        "property_unit": unit}).json()


def _portal_login(slug, username, password):
    r = client.post("/api/v1/portal/login", json={"hoa_slug": slug, "username": username, "password": password}).json()
    if not r.get("mfa_required"):
        return r["access_token"]
    v = client.post("/api/v1/portal/login/verify",
                    json={"challenge_id": r["challenge_id"], "code": r["dev_otp"]}).json()
    return v["access_token"]


def test_portal_dashboard_documents_isolation():
    token, tid, income = _admin_ctx()
    sfx = uuid.uuid4().hex[:6]
    h1 = _homeowner(token, tid, f"A{sfx[:3]}")
    h2 = _homeowner(token, tid, f"B{sfx[:3]}")

    # Bill H1 an overdue assessment (2025) so dashboard/notifications have data.
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"Portal Plan {sfx}", "lines": [{"income_combination_id": income, "amount": "150.00"}]}).json()
    client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                json={"invoice_date": "2025-01-01", "due_days": 30, "homeowner_ids": [h1["id"]]})

    # Attach a document to H1.
    up = client.post("/api/v1/documents", headers=_h(token, tid),
                     data={"entity_type": "HOMEOWNER", "entity_id": h1["id"], "homeowner_id": h1["id"]},
                     files={"file": ("welcome.pdf", io.BytesIO(b"hello resident"), "application/pdf")})
    assert up.status_code == 201, up.text

    # Create a resident linked to H1 only.
    uname = f"res{sfx}"
    res = client.post("/api/v1/residents", headers=_h(token, tid), json={
        "username": uname, "password": "Resident!Pass1", "full_name": "Port Resident",
        "resident_type": "OWNER", "email": "res@example.com", "mfa_channel": "EMAIL"})
    assert res.status_code == 201, res.text
    rid = res.json()["id"]
    client.post(f"/api/v1/residents/{rid}/units", headers=_h(token, tid),
                json={"homeowner_id": h1["id"], "is_primary": True})

    # Resident logs in (dev OTP) and sees only their data.
    ptok = _portal_login("casa-harmony", uname, "Resident!Pass1")
    ph = {"Authorization": f"Bearer {ptok}"}

    dash = client.get("/api/v1/portal/dashboard", headers=ph).json()
    assert dash["units"] == 1 and float(dash["total_balance"]) == 150.0

    notifs = client.get("/api/v1/portal/notifications", headers=ph).json()
    assert any(n["category"] == "OVERDUE" for n in notifs)

    units = client.get("/api/v1/portal/units", headers=ph).json()
    assert len(units) == 1 and units[0]["homeowner_id"] == h1["id"]

    docs = client.get(f"/api/v1/portal/units/{h1['id']}/documents", headers=ph).json()
    assert len(docs) == 1
    dl = client.get(f"/api/v1/portal/documents/{docs[0]['id']}/download", headers=ph)
    assert dl.status_code == 200 and dl.content == b"hello resident"

    stmt = client.get(f"/api/v1/portal/units/{h1['id']}/statement/export", headers=ph)
    assert stmt.status_code == 200 and stmt.content[:2] == b"PK"

    # Isolation: cannot touch a unit they don't own.
    assert client.get(f"/api/v1/portal/units/{h2['id']}/invoices", headers=ph).status_code == 404
    assert client.get(f"/api/v1/portal/units/{h2['id']}/documents", headers=ph).status_code == 404
