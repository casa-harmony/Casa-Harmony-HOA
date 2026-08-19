"""The in-app inbox: capture, extraction, access control, and the partition.

The inbox exists so testing an invite or an OTP does not need a real mailbox.
It also stores live reset tokens in the clear, so the access tests here matter
as much as the capture ones.
"""
from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import settings
from app.core.context import RequestContext, reset_context, set_context
from app.core.database import session_for
from app.main import app
from app.models.dev_mailbox import CapturedMessage
from app.services import notifications

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")


def _empty_inbox() -> None:
    db = session_for(tenant_id=None, is_superadmin=True, sandbox="any")
    try:
        db.execute(text("DELETE FROM dev_mailbox"))
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _clean_inbox():
    """Each test starts *and* ends with an empty inbox on both sides.

    Cleaning before matters as much as after: anything captured by an earlier
    module — or by a human poking the API — would otherwise be counted here.
    """
    reset_context()
    _empty_inbox()
    yield
    reset_context()
    _empty_inbox()


def _admin_headers():
    r = client.post("/api/v1/auth/login",
                    json={"email": SUPERADMIN, "password": SUPERADMIN_PW})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _count(sandbox):
    db = session_for(tenant_id=None, is_superadmin=True, sandbox=sandbox)
    try:
        return db.execute(text("SELECT count(*) FROM dev_mailbox")).scalar_one()
    finally:
        db.close()


def test_email_is_captured_when_no_provider_is_configured():
    original = notifications.settings.SENDGRID_API_KEY
    notifications.settings.SENDGRID_API_KEY = ""
    try:
        notifications._send_email("someone@example.com", "Hello", "Body text here")
    finally:
        notifications.settings.SENDGRID_API_KEY = original

    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        m = db.query(CapturedMessage).one()
        assert m.to_address == "someone@example.com"
        assert m.subject == "Hello"
        assert m.status == "NO_PROVIDER"
        assert m.channel == "EMAIL"
    finally:
        db.close()


def test_a_real_send_flow_lands_in_the_inbox_with_its_link():
    """The whole point: trigger a reset, read the link back without a mailbox."""
    r = client.post("/api/v1/auth/forgot-password", json={"email": SUPERADMIN})
    assert r.status_code == 200, r.text

    headers = _admin_headers()
    rows = client.get("/api/v1/dev-mailbox", headers=headers).json()
    assert len(rows) == 1
    assert rows[0]["to_address"] == SUPERADMIN
    assert "body" not in rows[0], "list rows must not ship message bodies"

    detail = client.get(f"/api/v1/dev-mailbox/{rows[0]['id']}", headers=headers).json()
    assert detail["links"], "the reset link should be extracted from the body"
    assert "token=" in detail["links"][0]
    assert detail["body"]


def test_otp_code_is_extracted():
    original = notifications.settings.SENDGRID_API_KEY
    notifications.settings.SENDGRID_API_KEY = ""
    try:
        notifications.send_otp("email", "resident@example.com", "481902")
    finally:
        notifications.settings.SENDGRID_API_KEY = original

    headers = _admin_headers()
    rows = client.get("/api/v1/dev-mailbox", headers=headers).json()
    detail = client.get(f"/api/v1/dev-mailbox/{rows[0]['id']}", headers=headers).json()
    assert "481902" in detail["codes"]


def test_inbox_requires_superadmin():
    """Bodies contain live tokens, so a tenant admin must not reach them."""
    r = client.get("/api/v1/dev-mailbox")
    assert r.status_code in (401, 403)


def test_capture_never_breaks_the_send(monkeypatch):
    """A broken inbox must not stop mail going out."""
    from app.services import dev_mailbox

    def boom(*_a, **_k):
        raise RuntimeError("database on fire")

    monkeypatch.setattr(dev_mailbox, "session_for", boom)
    original = notifications.settings.SENDGRID_API_KEY
    notifications.settings.SENDGRID_API_KEY = ""
    try:
        notifications._send_email("someone@example.com", "Hello", "Body")  # must not raise
    finally:
        notifications.settings.SENDGRID_API_KEY = original
    assert _count(False) == 0


def test_sandbox_and_live_captures_are_separated():
    """A developer must never read a real user's reset token, and vice versa."""
    original = notifications.settings.SENDGRID_API_KEY
    notifications.settings.SENDGRID_API_KEY = ""
    try:
        set_context(RequestContext(is_sandbox=True))
        notifications._send_email("dev@example.com", "Sandbox mail", "sandbox body")
        reset_context()
        notifications._send_email("real@example.com", "Live mail", "live body")
    finally:
        notifications.settings.SENDGRID_API_KEY = original
        reset_context()

    assert _count(True) == 1
    assert _count(False) == 1

    db = session_for(tenant_id=None, is_superadmin=True, sandbox=False)
    try:
        addrs = [r[0] for r in db.execute(text("SELECT to_address FROM dev_mailbox")).all()]
    finally:
        db.close()
    assert addrs == ["real@example.com"]

    # The live superadmin's API view sees only the live capture.
    rows = client.get("/api/v1/dev-mailbox", headers=_admin_headers()).json()
    assert [r["to_address"] for r in rows] == ["real@example.com"]


def test_clear_only_empties_the_callers_side():
    original = notifications.settings.SENDGRID_API_KEY
    notifications.settings.SENDGRID_API_KEY = ""
    try:
        set_context(RequestContext(is_sandbox=True))
        notifications._send_email("dev@example.com", "Sandbox mail", "sandbox body")
        reset_context()
        notifications._send_email("real@example.com", "Live mail", "live body")
    finally:
        notifications.settings.SENDGRID_API_KEY = original
        reset_context()

    r = client.post("/api/v1/dev-mailbox/clear", headers=_admin_headers())
    assert r.status_code == 204
    assert _count(False) == 0
    assert _count(True) == 1, "clearing the live inbox must not touch the sandbox"


def test_disabled_setting_hides_the_feature():
    original = settings.DEV_MAILBOX_ENABLED
    settings.DEV_MAILBOX_ENABLED = False
    try:
        r = client.get("/api/v1/dev-mailbox", headers=_admin_headers())
        assert r.status_code == 404
        # ...and nothing is captured while it is off.
        sg = notifications.settings.SENDGRID_API_KEY
        notifications.settings.SENDGRID_API_KEY = ""
        try:
            notifications._send_email("someone@example.com", "Hello", "Body")
        finally:
            notifications.settings.SENDGRID_API_KEY = sg
        assert _count(False) == 0
    finally:
        settings.DEV_MAILBOX_ENABLED = original


def test_inbox_is_capped():
    """Captured bodies are credentials; the table must not grow without bound."""
    original_cap = settings.DEV_MAILBOX_MAX_MESSAGES
    settings.DEV_MAILBOX_MAX_MESSAGES = 3
    sg = notifications.settings.SENDGRID_API_KEY
    notifications.settings.SENDGRID_API_KEY = ""
    try:
        for i in range(6):
            notifications._send_email(f"user{i}@example.com", f"Mail {i}", f"body {i}")
    finally:
        notifications.settings.SENDGRID_API_KEY = sg
        settings.DEV_MAILBOX_MAX_MESSAGES = original_cap

    assert _count(False) <= 4, "old messages should be pruned as new ones arrive"
