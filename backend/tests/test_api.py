"""End-to-end API tests including multi-tenant RLS isolation.

Requires a running PostgreSQL reachable via the POSTGRES_* env vars and the
migrations + seed already applied. Run:  pytest -q
"""
from __future__ import annotations

import os

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")


def _login(email: str, password: str) -> dict:
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def _auth(token: str, tenant_id: str | None = None) -> dict:
    h = {"Authorization": f"Bearer {token}"}
    if tenant_id:
        h["X-Tenant-Id"] = tenant_id
    return h


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_superadmin_can_provision_tenants_and_rls_isolation():
    sa = _login(SUPERADMIN, SUPERADMIN_PW)
    token = sa["access_token"]
    assert sa["is_superadmin"] is True

    # Create two isolated HOAs (unique slugs per run).
    import uuid as _uuid

    suffix = _uuid.uuid4().hex[:8]
    t1 = client.post("/api/v1/tenants", headers=_auth(token),
                     json={"name": f"Alpha HOA {suffix}", "slug": f"alpha-{suffix}"})
    t2 = client.post("/api/v1/tenants", headers=_auth(token),
                     json={"name": f"Beta HOA {suffix}", "slug": f"beta-{suffix}"})
    assert t1.status_code == 201 and t2.status_code == 201, (t1.text, t2.text)
    tid1, tid2 = t1.json()["id"], t2.json()["id"]

    # Each tenant got its own default COA structure.
    s1 = client.get("/api/v1/coa/structures", headers=_auth(token, tid1)).json()
    s2 = client.get("/api/v1/coa/structures", headers=_auth(token, tid2)).json()
    assert len(s1) == 1 and len(s2) == 1
    assert s1[0]["id"] != s2[0]["id"]

    # --- Create a tenant-scoped admin user and grant membership in tenant 1 only ---
    u = client.post("/api/v1/users", headers=_auth(token, tid1),
                    json={"email": f"admin-{suffix}@x.com", "password": "Passw0rd!23",
                          "full_name": "Alpha Admin"}).json()
    roles = client.get("/api/v1/roles", headers=_auth(token, tid1)).json()
    sysadmin_role = next(r for r in roles if r["code"] == "SYSADMIN")
    m = client.post("/api/v1/memberships", headers=_auth(token, tid1),
                    json={"user_id": u["id"], "role_id": sysadmin_role["id"]})
    assert m.status_code == 201, m.text

    # --- That admin logs in and can see tenant 1 but NOT tenant 2 ---
    admin = _login(f"admin-{suffix}@x.com", "Passw0rd!23")
    assert {mm["tenant_id"] for mm in admin["memberships"]} == {tid1}
    atoken = admin["access_token"]

    # Allowed in tenant 1.
    ok = client.get("/api/v1/coa/structures", headers=_auth(atoken, tid1))
    assert ok.status_code == 200 and len(ok.json()) == 1

    # RLS / RBAC blocks access to tenant 2 (no membership there).
    denied = client.get("/api/v1/coa/structures", headers=_auth(atoken, tid2))
    assert denied.status_code == 403, denied.text


def test_code_combination_validation_and_export():
    sa = _login(SUPERADMIN, SUPERADMIN_PW)
    token = sa["access_token"]
    # Use the seeded demo HOA.
    tenants = client.get("/api/v1/tenants", headers=_auth(token)).json()
    demo = next(t for t in tenants if t["slug"] == "casa-harmony")
    tid = demo["id"]
    structure = client.get("/api/v1/coa/structures", headers=_auth(token, tid)).json()[0]
    sid = structure["id"]

    # Invalid natural account → rejected by KFF validation.
    bad = client.post(f"/api/v1/coa/structures/{sid}/combinations", headers=_auth(token, tid),
                      json={"segments": {"1": "0100", "2": "OPER", "3": "100",
                                         "4": "9999", "5": "0000", "6": "NONE"}})
    assert bad.status_code == 422, bad.text

    # Valid combination → accepted, account type derived from natural account.
    # Idempotent: the DB persists across runs, so tolerate a pre-existing combo
    # (409) and verify the derived account type from the listing either way.
    concat = "0100-OPER-200-5100-0000-NONE"
    good = client.post(f"/api/v1/coa/structures/{sid}/combinations", headers=_auth(token, tid),
                       json={"segments": {"1": "0100", "2": "OPER", "3": "200",
                                          "4": "5100", "5": "0000", "6": "NONE"}})
    assert good.status_code in (201, 409, 422), good.text
    if good.status_code == 201:
        assert good.json()["account_type"] == "E"
        assert good.json()["concatenated_segments"] == concat
    combos = client.get(f"/api/v1/coa/structures/{sid}/combinations",
                        headers=_auth(token, tid)).json()
    match = next(c for c in combos if c["concatenated_segments"] == concat)
    assert match["account_type"] == "E"  # derived from natural account 5100 (Expense)

    # xlsx export downloads.
    exp = client.get(f"/api/v1/coa/structures/{sid}/export", headers=_auth(token, tid))
    assert exp.status_code == 200
    assert exp.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert exp.content[:2] == b"PK"  # xlsx is a zip archive
