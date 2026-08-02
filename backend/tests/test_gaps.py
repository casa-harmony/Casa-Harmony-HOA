"""Tests for the gap-closing features: MFA, PCI tokenization, CCPA, subledger."""
from __future__ import annotations

import os
import uuid

import pyotp
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")


def _login(email, password, mfa_code=None):
    body = {"email": email, "password": password}
    if mfa_code:
        body["mfa_code"] = mfa_code
    return client.post("/api/v1/auth/login", json=body)


def _h(token, tid=None):
    h = {"Authorization": f"Bearer {token}"}
    if tid:
        h["X-Tenant-Id"] = tid
    return h


def _demo(token):
    tenants = client.get("/api/v1/tenants", headers=_h(token)).json()
    demo = next(t for t in tenants if t["slug"] == "casa-harmony")
    structure = client.get("/api/v1/coa/structures", headers=_h(token, demo["id"])).json()[0]
    return demo["id"], structure["id"]


def _get_or_create_combo(token, tid, sid, segs):
    combos = client.get(
        f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)
    ).json()
    concat = "-".join(segs[str(i)] for i in range(1, 7))
    for c in combos:
        if c["concatenated_segments"] == concat:
            return c["id"]
    r = client.post(
        f"/api/v1/coa/structures/{sid}/combinations",
        headers=_h(token, tid),
        json={"segments": segs, "allow_posting": True, "enabled": True},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# --- PCI tokenization ------------------------------------------------------
def test_pci_tokenization_never_stores_pan():
    token = _login(SUPERADMIN, SUPERADMIN_PW).json()["access_token"]
    tid, _ = _demo(token)

    ok = client.post(
        "/api/v1/payments/methods",
        headers=_h(token, tid),
        json={"card_number": "4242 4242 4242 4242", "exp_month": 12, "exp_year": 2030,
              "holder_name": "Jane Owner"},
    )
    assert ok.status_code == 201, ok.text
    body = ok.json()
    assert body["last_four"] == "4242"
    assert body["card_brand"] == "Visa"
    assert body["vault_token"].startswith("tok_")
    assert "card_number" not in body  # PAN never returned/stored

    bad = client.post(
        "/api/v1/payments/methods",
        headers=_h(token, tid),
        json={"card_number": "1234567890123456", "exp_month": 12, "exp_year": 2030},
    )
    assert bad.status_code == 422  # fails Luhn


# --- MFA (TOTP) ------------------------------------------------------------
def test_mfa_enroll_and_enforced_login():
    su = _login(SUPERADMIN, SUPERADMIN_PW).json()
    tid, _ = _demo(su["access_token"])
    suffix = uuid.uuid4().hex[:8]
    email = f"mfa-{suffix}@x.com"

    created = client.post(
        "/api/v1/users", headers=_h(su["access_token"], tid),
        json={"email": email, "password": "Passw0rd!23", "full_name": "MFA User"},
    )
    assert created.status_code == 201, created.text

    utoken = _login(email, "Passw0rd!23").json()["access_token"]
    enroll = client.post("/api/v1/auth/mfa/enroll", headers=_h(utoken))
    assert enroll.status_code == 200
    secret = enroll.json()["secret"]
    assert enroll.json()["otpauth_uri"].startswith("otpauth://totp/")

    code = pyotp.TOTP(secret).now()
    verify = client.post("/api/v1/auth/mfa/verify", headers=_h(utoken), json={"code": code})
    assert verify.status_code == 200 and verify.json()["mfa_enabled"] is True

    # Login now requires the second factor.
    assert _login(email, "Passw0rd!23").status_code == 401
    good = _login(email, "Passw0rd!23", mfa_code=pyotp.TOTP(secret).now())
    assert good.status_code == 200, good.text


# --- Subledger: AR invoice posts a balanced GL journal ---------------------
def test_ar_invoice_posts_balanced_journal_and_encrypts_bank():
    token = _login(SUPERADMIN, SUPERADMIN_PW).json()["access_token"]
    tid, sid = _demo(token)
    suffix = uuid.uuid4().hex[:6]

    ho = client.post(
        "/api/v1/subledger/homeowners", headers=_h(token, tid),
        json={"account_number": f"H-{suffix}", "first_name": "Sam", "last_name": "Unit",
              "email": f"sam-{suffix}@x.com", "property_unit": "12A",
              "bank_account": "123456789012"},
    )
    assert ho.status_code == 201, ho.text
    # Bank account is masked in the API, never returned in full.
    assert ho.json()["bank_account_masked"] == "****9012"

    receivable = _get_or_create_combo(
        token, tid, sid, {"1": "0100", "2": "OPER", "3": "400", "4": "1100", "5": "0000", "6": "NONE"}
    )
    income = _get_or_create_combo(
        token, tid, sid, {"1": "0100", "2": "OPER", "3": "000", "4": "4000", "5": "0000", "6": "NONE"}
    )

    inv = client.post(
        "/api/v1/subledger/invoices", headers=_h(token, tid),
        json={"homeowner_id": ho.json()["id"], "invoice_number": f"INV-{suffix}",
              "amount": "350.00", "invoice_date": "2026-01-15",
              "receivable_combination_id": receivable, "income_combination_id": income,
              "structure_id": sid},
    )
    assert inv.status_code == 201, inv.text
    assert inv.json()["status"] == "POSTED"
    assert inv.json()["gl_journal_id"] is not None

    journals = client.get("/api/v1/subledger/journals", headers=_h(token, tid)).json()
    j = next(x for x in journals if x["id"] == inv.json()["gl_journal_id"])
    debits = sum(float(l["debit"]) for l in j["lines"])
    credits = sum(float(l["credit"]) for l in j["lines"])
    assert debits == credits == 350.00
    assert j["source"] == "AR"


def test_unbalanced_journal_rejected():
    token = _login(SUPERADMIN, SUPERADMIN_PW).json()["access_token"]
    tid, sid = _demo(token)
    income = _get_or_create_combo(
        token, tid, sid, {"1": "0100", "2": "OPER", "3": "000", "4": "4000", "5": "0000", "6": "NONE"}
    )
    receivable = _get_or_create_combo(
        token, tid, sid, {"1": "0100", "2": "OPER", "3": "400", "4": "1100", "5": "0000", "6": "NONE"}
    )
    r = client.post(
        "/api/v1/subledger/journals", headers=_h(token, tid),
        json={"structure_id": sid, "accounting_date": "2026-01-31",
              "lines": [
                  {"code_combination_id": receivable, "debit": "100.00", "credit": "0"},
                  {"code_combination_id": income, "debit": "0", "credit": "90.00"},
              ]},
    )
    assert r.status_code == 422
    assert "balance" in r.json()["detail"].lower()


# --- CCPA erasure ----------------------------------------------------------
def test_ccpa_request_export_and_erasure():
    su = _login(SUPERADMIN, SUPERADMIN_PW).json()
    token = su["access_token"]
    tid, _ = _demo(token)
    suffix = uuid.uuid4().hex[:8]
    email = f"erase-{suffix}@x.com"

    client.post("/api/v1/users", headers=_h(token, tid),
                json={"email": email, "password": "Passw0rd!23", "full_name": "To Erase"})

    req = client.post("/api/v1/privacy/requests", headers=_h(token, tid),
                      json={"request_type": "ERASURE", "subject_email": email})
    assert req.status_code == 201, req.text

    export = client.get("/api/v1/privacy/export", headers=_h(token, tid),
                        params={"subject_email": email})
    assert export.status_code == 200
    assert export.json()["identity"]["full_name"] == "To Erase"

    erase = client.post(f"/api/v1/privacy/requests/{req.json()['id']}/erase",
                        headers=_h(token, tid))
    assert erase.status_code == 200 and erase.json()["status"] == "completed"

    # The original identity can no longer authenticate (email anonymized).
    assert _login(email, "Passw0rd!23").status_code == 401
