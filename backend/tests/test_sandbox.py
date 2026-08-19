"""The sandbox partition: a developer superadmin isolated from live data.

These tests are the evidence for the claim the feature makes — that a developer
can drive the real application without touching, or being touched by, live
communities. Isolation is asserted in *both* directions, because a one-way check
would pass even if the live side could still see the developer's mess.
"""
from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.core.config import settings
from app.core.database import session_for
from app.core.security import hash_password
from app.main import app
from app.models.identity import Tenant, User

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")
DEV_PW = "ChangeMe!Devadmin1"


@pytest.fixture(scope="module")
def dev_admin():
    """A sandbox SUPERADMIN plus a sandbox community, torn down afterwards."""
    suffix = uuid.uuid4().hex[:8]
    email = f"dev-{suffix}@sandbox.example.com"
    slug = f"sandbox-{suffix}"

    db = session_for(tenant_id=None, is_superadmin=True, sandbox=True)
    try:
        user = User(
            email=email,
            hashed_password=hash_password(DEV_PW),
            full_name="Sandbox Developer",
            is_superadmin=True,
            is_sandbox=True,
            is_active=True,
        )
        db.add(user)
        tenant = Tenant(name=f"Sandbox {suffix}", slug=slug, status="active", is_sandbox=True)
        db.add(tenant)
        db.flush()
        # Read the ids before commit: commit expires the instances, and the
        # refresh SELECT would run outside the sandbox GUC that made them visible.
        ids = (str(user.id), str(tenant.id), email, slug)
        db.commit()
    finally:
        db.close()

    yield ids

    db = session_for(tenant_id=None, is_superadmin=True, sandbox="any")
    try:
        db.execute(text("DELETE FROM tenants WHERE slug = :s"), {"s": slug})
        db.execute(text("DELETE FROM users WHERE email = :e"), {"e": email})
        db.commit()
    finally:
        db.close()


def _token(email, password):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def test_stamp_defaults_to_live_side():
    """A tenant created without a sandbox context lands on the live side.

    The partition is opt-in: every pre-existing caller — seed, scripts, the live
    API — must keep producing live rows, or the migration would silently strand
    real communities in the sandbox.
    """
    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        casa = db.execute(select(Tenant).where(Tenant.slug == "casa-harmony")).scalar_one()
        assert casa.is_sandbox is False
    finally:
        db.close()


def test_login_reports_which_side_it_is_on(dev_admin):
    _uid, _tid, email, _slug = dev_admin
    assert _token(email, DEV_PW)["is_sandbox"] is True
    assert _token(SUPERADMIN, SUPERADMIN_PW)["is_sandbox"] is False


def test_developer_cannot_see_live_communities(dev_admin):
    _uid, _tid, email, _slug = dev_admin
    body = _token(email, DEV_PW)
    headers = {"Authorization": f"Bearer {body['access_token']}"}

    slugs = {t["slug"] for t in client.get("/api/v1/tenants?include_demo=true",
                                           headers=headers).json()}
    assert "casa-harmony" not in slugs
    assert slugs, "the developer should still see its own sandbox communities"
    assert all(s.startswith("sandbox-") for s in slugs)


def test_live_superadmin_cannot_see_sandbox_communities(dev_admin):
    _uid, _tid, _email, slug = dev_admin
    token = _token(SUPERADMIN, SUPERADMIN_PW)["access_token"]
    slugs = {t["slug"] for t in client.get("/api/v1/tenants?include_demo=true",
                                           headers={"Authorization": f"Bearer {token}"}).json()}
    assert slug not in slugs
    assert "casa-harmony" in slugs


def test_developer_cannot_select_a_live_tenant_by_id(dev_admin):
    """Knowing a live tenant's UUID is not enough — the row is invisible to it."""
    _uid, _tid, email, _slug = dev_admin
    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        live_id = str(db.execute(select(Tenant.id).where(Tenant.slug == "casa-harmony")).scalar_one())
    finally:
        db.close()

    token = _token(email, DEV_PW)["access_token"]
    r = client.get("/api/v1/tenants", headers={
        "Authorization": f"Bearer {token}", "X-Tenant-Id": live_id,
    })
    assert r.status_code == 404, r.text


def test_tenant_scoped_rows_are_invisible_across_the_partition(dev_admin):
    """The restrictive policy, not just the tenant list.

    A superadmin session normally bypasses tenant scoping entirely. This asserts
    the sandbox backstop still hides the rows, so the bypass cannot be used to
    read across the partition even with a known tenant_id.
    """
    _uid, tid, _email, _slug = dev_admin

    # Write an audit row into the sandbox tenant from a sandbox session.
    db = session_for(tenant_id=uuid.UUID(tid), is_superadmin=True, sandbox=True)
    try:
        db.execute(text(
            "INSERT INTO audit_logs (id, tenant_id, action, entity_type, created_at) "
            "VALUES (:id, :tid, 'SANDBOX_PROBE', 'Test', now())"
        ), {"id": str(uuid.uuid4()), "tid": tid})
        db.commit()
    finally:
        db.close()

    # Read back from a *fresh* session: the RLS GUCs are transaction-local
    # (set_config(..., true)), so the committing session no longer carries them.
    db = session_for(tenant_id=uuid.UUID(tid), is_superadmin=True, sandbox=True)
    try:
        seen_by_sandbox = db.execute(text(
            "SELECT count(*) FROM audit_logs WHERE action = 'SANDBOX_PROBE'"
        )).scalar_one()
    finally:
        db.close()
    assert seen_by_sandbox == 1

    # A live superadmin session — RLS-bypassing on tenant scope — sees nothing.
    db = session_for(tenant_id=uuid.UUID(tid), is_superadmin=True, sandbox=False)
    try:
        seen_by_live = db.execute(text(
            "SELECT count(*) FROM audit_logs WHERE action = 'SANDBOX_PROBE'"
        )).scalar_one()
    finally:
        db.close()
    assert seen_by_live == 0


def test_sandbox_users_are_invisible_to_the_live_side(dev_admin):
    _uid, _tid, email, _slug = dev_admin
    db = session_for(tenant_id=None, is_superadmin=True, sandbox=False)
    try:
        assert db.execute(select(User).where(User.email == email)).scalar_one_or_none() is None
    finally:
        db.close()

    db = session_for(tenant_id=None, is_superadmin=True, sandbox=True)
    try:
        assert db.execute(select(User).where(User.email == email)).scalar_one_or_none() is not None
        # ...and the live logins are equally hidden from the developer.
        assert db.execute(select(User).where(User.email == SUPERADMIN)).scalar_one_or_none() is None
    finally:
        db.close()


def test_sandbox_suppresses_outbound_email(caplog):
    """Resident invites and OTPs must not reach a real inbox from the sandbox."""
    from app.core.context import RequestContext, reset_context, set_context
    from app.services import notifications

    sent: list[tuple] = []
    original = notifications.settings.SENDGRID_API_KEY
    notifications.settings.SENDGRID_API_KEY = ""
    try:
        set_context(RequestContext(is_sandbox=True))
        with caplog.at_level("INFO", logger="casa-harmony.notify"):
            notifications._send_email("resident@example.com", "Subject", "Body")
        assert any("[SANDBOX] suppressed email" in r.getMessage() for r in caplog.records)

        # The live side still goes through the normal (here, logging) path.
        reset_context()
        caplog.clear()
        with caplog.at_level("INFO", logger="casa-harmony.notify"):
            notifications._send_email("resident@example.com", "Subject", "Body")
        assert not any("[SANDBOX]" in r.getMessage() for r in caplog.records)
    finally:
        notifications.settings.SENDGRID_API_KEY = original
        reset_context()
        assert sent == []


def test_portal_dropdown_lists_sandbox_communities(dev_admin):
    """A sandbox HOA must be selectable in the resident portal.

    Regression: the portal's community list is a *public* endpoint, so an
    anonymous request has no side of the partition. On an RLS-scoped session
    that silently resolved to "live", which hid every sandbox community and left
    a developer unable to pick theirs from the dropdown at all — the resident
    flow became untestable in the sandbox.
    """
    _uid, _tid, _email, slug = dev_admin
    rows = client.get("/api/v1/portal/communities").json()
    slugs = {r["slug"] for r in rows}
    assert slug in slugs, "the sandbox HOA should be selectable"
    assert "casa-harmony" in slugs, "live HOAs must still be listed"
    assert next(r for r in rows if r["slug"] == slug)["is_sandbox"] is True


def test_portal_dropdown_hides_sandbox_in_production(dev_admin):
    """A real resident must never be offered somebody's test HOA."""
    _uid, _tid, _email, slug = dev_admin
    original = settings.ENVIRONMENT
    settings.ENVIRONMENT = "production"
    try:
        slugs = {r["slug"] for r in client.get("/api/v1/portal/communities").json()}
    finally:
        settings.ENVIRONMENT = original
    assert slug not in slugs
    assert "casa-harmony" in slugs


def test_portal_dropdown_sandbox_override(dev_admin):
    """A production-labelled deployment used for testing can opt back in.

    Regression: gating on ENVIRONMENT alone left the dropdown permanently empty
    on a staging box whose every HOA is a sandbox one — nothing to list, and no
    way to ask for the sandbox ones.
    """
    _uid, _tid, _email, slug = dev_admin
    original_env = settings.ENVIRONMENT
    original_override = settings.PORTAL_SHOW_SANDBOX_COMMUNITIES
    settings.ENVIRONMENT = "production"
    settings.PORTAL_SHOW_SANDBOX_COMMUNITIES = True
    try:
        slugs = {r["slug"] for r in client.get("/api/v1/portal/communities").json()}
    finally:
        settings.ENVIRONMENT = original_env
        settings.PORTAL_SHOW_SANDBOX_COMMUNITIES = original_override
    assert slug in slugs, "the override should bring sandbox HOAs back"
