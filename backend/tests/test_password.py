"""Password management: change, forgot/reset, first-login flag (staff + residents)."""
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


def _ah(token, tid=None):
    h = {"Authorization": f"Bearer {token}"}
    if tid:
        h["X-Tenant-Id"] = tid
    return h


# ---------------- Staff ----------------
def test_staff_admin_created_user_must_change_password():
    admin, tid = _admin()
    sfx = uuid.uuid4().hex[:6]
    email = f"clerk_{sfx}@casa.example"
    r = client.post("/api/v1/users", headers=_ah(admin, tid),
                    json={"email": email, "full_name": "Clerk", "password": "TempPass123"})
    assert r.status_code == 201, r.text
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "TempPass123"}).json()
    assert login["must_change_password"] is True  # forced on first login

    tok = login["access_token"]
    # Wrong current password is rejected.
    assert client.post("/api/v1/auth/change-password", headers=_ah(tok),
                       json={"current_password": "nope", "new_password": "BrandNew999"}).status_code == 400
    ok = client.post("/api/v1/auth/change-password", headers=_ah(tok),
                     json={"current_password": "TempPass123", "new_password": "BrandNew999"})
    assert ok.status_code == 200
    # New password works and clears the flag; old password fails.
    relogin = client.post("/api/v1/auth/login", json={"email": email, "password": "BrandNew999"}).json()
    assert relogin["must_change_password"] is False
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "TempPass123"}).status_code == 401


def test_staff_forgot_and_reset():
    admin, tid = _admin()
    sfx = uuid.uuid4().hex[:6]
    email = f"reset_{sfx}@casa.example"
    client.post("/api/v1/users", headers=_ah(admin, tid),
                json={"email": email, "full_name": "Reset Me", "password": "InitPass123"})
    fr = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert fr.status_code == 200
    token = fr.json()["dev_reset_token"]  # development convenience
    rr = client.post("/api/v1/auth/reset-password",
                     json={"token": token, "new_password": "ResetPass456"})
    assert rr.status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "ResetPass456"}).status_code == 200
    # Token is single-use (bound to the old password version).
    again = client.post("/api/v1/auth/reset-password",
                        json={"token": token, "new_password": "Another789"})
    assert again.status_code == 400


def test_forgot_password_unknown_email_is_generic():
    r = client.post("/api/v1/auth/forgot-password", json={"email": "nobody@nowhere.example"})
    assert r.status_code == 200 and "dev_reset_token" not in r.json()  # no enumeration


# ---------------- Residents ----------------
def _new_resident(admin, tid, sfx):
    r = client.post("/api/v1/residents", headers=_ah(admin, tid), json={
        "username": f"res_{sfx}", "password": "ResInit123", "full_name": "Res Test",
        "resident_type": "OWNER", "email": f"res_{sfx}@casa.example",
    })
    assert r.status_code == 201, r.text
    return f"res_{sfx}"


def _portal_login(username, password):
    r = client.post("/api/v1/portal/login",
                    json={"hoa_slug": "casa-harmony", "username": username, "password": password}).json()
    v = client.post("/api/v1/portal/login/verify",
                    json={"challenge_id": r["challenge_id"], "code": r["dev_otp"]})
    return v.json()["access_token"], r


def test_resident_change_password_and_flag():
    admin, tid = _admin()
    sfx = uuid.uuid4().hex[:6]
    user = _new_resident(admin, tid, sfx)
    token, login = _portal_login(user, "ResInit123")
    me = client.get("/api/v1/portal/me", headers=_ah(token)).json()
    assert me["must_change_password"] is True
    ok = client.post("/api/v1/portal/change-password", headers=_ah(token),
                     json={"current_password": "ResInit123", "new_password": "ResNew4567"})
    assert ok.status_code == 200
    token2, _ = _portal_login(user, "ResNew4567")
    assert client.get("/api/v1/portal/me", headers=_ah(token2)).json()["must_change_password"] is False


def test_resident_forgot_and_reset():
    admin, tid = _admin()
    sfx = uuid.uuid4().hex[:6]
    user = _new_resident(admin, tid, sfx)
    fr = client.post("/api/v1/portal/forgot-password",
                     json={"hoa_slug": "casa-harmony", "username": user}).json()
    rr = client.post("/api/v1/portal/reset-password", json={
        "challenge_id": fr["challenge_id"], "code": fr["dev_otp"], "new_password": "ResReset999"})
    assert rr.status_code == 200
    token, _ = _portal_login(user, "ResReset999")
    assert client.get("/api/v1/portal/me", headers=_ah(token)).status_code == 200
