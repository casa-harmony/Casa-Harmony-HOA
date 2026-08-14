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
