"""Resident portal: email/SMS OTP MFA, login, unit scoping, isolation, payment."""
from __future__ import annotations

import os
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")


def _admin():
    token = client.post("/api/v1/auth/login",
                        json={"email": SUPERADMIN, "password": SUPERADMIN_PW}).json()["access_token"]
    tid = next(t for t in client.get("/api/v1/tenants?include_demo=true",
               headers={"Authorization": f"Bearer {token}"}).json()
               if t["slug"] == "casa-harmony")["id"]
    return token, tid


def _ah(token, tid):
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": tid}


def _ph(token):
    return {"Authorization": f"Bearer {token}"}


def _login_step1(username, password="ChangeMe!Owner1"):
    return client.post("/api/v1/portal/login",
                       json={"hoa_slug": "casa-harmony", "username": username, "password": password})


def _login_token(username, password="ChangeMe!Owner1"):
    """Full two-step login → resident token (uses dev_otp exposed in development)."""
    r = _login_step1(username, password)
    assert r.status_code == 200, r.text
    body = r.json()
    if not body["mfa_required"]:
        return body["access_token"]
    v = client.post("/api/v1/portal/login/verify",
                    json={"challenge_id": body["challenge_id"], "code": body["dev_otp"]})
    assert v.status_code == 200, v.text
    return v.json()["access_token"]


def test_mfa_challenge_then_token():
    r = _login_step1("owner1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mfa_required"] is True
    assert body["channel"] == "EMAIL"
    assert body["destination_masked"] and "@" in body["destination_masked"]
    assert body["dev_otp"]  # development convenience
    # The plaintext code is never the stored hash; verify issues a token.
    v = client.post("/api/v1/portal/login/verify",
                    json={"challenge_id": body["challenge_id"], "code": body["dev_otp"]})
    assert v.status_code == 200
    me = client.get("/api/v1/portal/me", headers=_ph(v.json()["access_token"])).json()
    assert me["username"] == "owner1"


def test_mfa_wrong_code_rejected():
    body = _login_step1("owner1").json()
    wrong = "000000" if body["dev_otp"] != "000000" else "111111"
    v = client.post("/api/v1/portal/login/verify",
                    json={"challenge_id": body["challenge_id"], "code": wrong})
    assert v.status_code == 401


def test_mfa_code_is_single_use():
    body = _login_step1("owner1").json()
    ok = client.post("/api/v1/portal/login/verify",
                     json={"challenge_id": body["challenge_id"], "code": body["dev_otp"]})
    assert ok.status_code == 200
    # Reusing the same code must fail (consumed).
    again = client.post("/api/v1/portal/login/verify",
                        json={"challenge_id": body["challenge_id"], "code": body["dev_otp"]})
    assert again.status_code == 401


def test_login_bad_password():
    assert _login_step1("owner1", "wrong").status_code == 401


def test_units_after_mfa():
    token = _login_token("owner1")
    units = client.get("/api/v1/portal/units", headers=_ph(token)).json()
    assert len(units) >= 1 and "balance" in units[0]


def test_resident_cannot_access_unlinked_unit():
    admin, tid = _admin()
    sfx = uuid.uuid4().hex[:6]
    o1 = _login_token("owner1")
    o1_home = client.get("/api/v1/portal/units", headers=_ph(o1)).json()[0]["homeowner_id"]
    homes = client.get("/api/v1/subledger/homeowners", headers=_ah(admin, tid)).json()
    other = next(h["id"] for h in homes if h["id"] != o1_home)
    res2 = client.post("/api/v1/residents", headers=_ah(admin, tid), json={
        "username": f"owner2_{sfx}", "password": "ChangeMe!Owner2", "full_name": "Owner Two",
        "resident_type": "OWNER", "email": f"owner2_{sfx}@casa.example",
    })
    assert res2.status_code == 201, res2.text
    client.post(f"/api/v1/residents/{res2.json()['id']}/units", headers=_ah(admin, tid),
                json={"homeowner_id": other, "is_primary": True})
    o2 = _login_token(f"owner2_{sfx}", "ChangeMe!Owner2")
    blocked = client.get(f"/api/v1/portal/units/{o1_home}/invoices", headers=_ph(o2))
    assert blocked.status_code == 404


def test_portal_pay_reduces_balance():
    admin, tid = _admin()
    client.post("/api/v1/subledger/assessment-run", headers=_ah(admin, tid), json={
        "invoice_date": "2026-07-01", "due_date": "2026-07-15", "amount": "150.00",
        "invoice_type": "ASSESSMENT", "number_prefix": "PORT",
    })
    o1 = _login_token("owner1")
    home = client.get("/api/v1/portal/units", headers=_ph(o1)).json()[0]["homeowner_id"]
    invs = client.get(f"/api/v1/portal/units/{home}/invoices", headers=_ph(o1)).json()
    target = next(i for i in invs if float(i["balance"]) > 0)
    pay = client.post("/api/v1/portal/pay", headers=_ph(o1),
                      json={"invoice_id": target["id"], "amount": target["balance"]})
    assert pay.status_code == 201, pay.text
    after = client.get(f"/api/v1/portal/units/{home}/invoices", headers=_ph(o1)).json()
    updated = next(i for i in after if i["id"] == target["id"])
    assert float(updated["balance"]) == 0.0 and updated["status"] == "PAID"


def test_token_scope_separation():
    admin, tid = _admin()
    o1 = _login_token("owner1")
    assert client.get("/api/v1/residents", headers=_ah(o1, tid)).status_code in (401, 403)
    assert client.get("/api/v1/portal/me", headers={"Authorization": f"Bearer {admin}"}).status_code == 401
