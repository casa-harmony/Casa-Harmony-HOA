"""Shared pytest setup.

Must run before any test module imports app.main, since Settings is read
once at import time and cached.
"""
import os

# Tests log in as the same seeded resident (e.g. "owner1") across many test
# functions within seconds of each other. The production OTP resend cooldown
# would otherwise make later logins in the same run fail with "a code was
# just sent" — a false failure, not a real one.
os.environ.setdefault("OTP_RESEND_SECONDS", "0")

# Nearly every test file logs in as superadmin independently; across the full
# suite that's far more than 10 logins/minute, which the login rate limiter
# (correctly) rejects in real traffic. See app/core/rate_limit.py.
os.environ.setdefault("DISABLE_RATE_LIMIT", "1")

import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _clear_seed_must_change_password():
    """Make the suite reproducible against a freshly seeded database.

    ``scripts.seed`` creates the SUPERADMIN with ``must_change_password=True``
    (a real security control: factory-created accounts change on first login).
    But ``get_current_user`` then 403s every endpoint except change-password/
    me/tenants, so a suite that logs in as superadmin and exercises protected
    routes fails 127 of 150 tests against a fresh DB — yet passes against a
    long-lived dev DB whose superadmin already changed the password once.

    The password-change requirement is a first-login UX flow, not something
    the automated suite should exercise. Clear the flag once per session so
    CI on a clean database gets the same result as local dev.
    """
    from sqlalchemy import update

    from app.core.database import session_for
    from app.models.identity import User

    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        db.execute(
            update(User).where(User.is_superadmin.is_(True)).values(must_change_password=False)
        )
        db.commit()
    finally:
        db.close()
