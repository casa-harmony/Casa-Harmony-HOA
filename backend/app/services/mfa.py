"""TOTP multi-factor authentication (RFC 6238) via pyotp."""
from __future__ import annotations

import pyotp

from app.core.config import settings

ISSUER = "Casa Harmony AI"


def generate_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, account_email: str) -> str:
    """otpauth:// URI to render as a QR code in an authenticator app."""
    return pyotp.TOTP(secret).provisioning_uri(name=account_email, issuer_name=ISSUER)


def verify_code(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    # Allow ±1 time-step for clock drift.
    return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)
