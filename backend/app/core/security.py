"""Cryptographic primitives: password hashing, JWTs, and field encryption.

* Passwords    – bcrypt via passlib.
* Access tokens – signed JWT (HS256) with jti for revocation support.
* Field crypto  – Fernet (AES-128-CBC + HMAC) for column-level encryption of
                  sensitive PII (e.g. bank/ACH detail), demonstrating the
                  "encryption at rest" control required for SOC 2 / ISO 27001.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# --- Passwords -------------------------------------------------------------
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# --- Password-reset tokens (staff) -----------------------------------------
def password_version(password_hash: str) -> str:
    """Short fingerprint of the current password hash.

    Embedded in reset tokens and re-checked on use so a token becomes invalid the
    moment the password changes — making the reset link effectively single-use
    without server-side storage.
    """
    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


def create_password_reset_token(user_id: uuid.UUID, password_hash: str, minutes: int = 30) -> str:
    return create_access_token(
        subject=str(user_id),
        extra_claims={"scope": "pwreset", "pv": password_version(password_hash)},
        expires_minutes=minutes,
    )


# --- JWT -------------------------------------------------------------------
def create_refresh_token(subject: str, extra_claims: dict[str, Any] | None = None) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(days=7)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": now,
        "exp": exp,
        "jti": str(uuid.uuid4()),
        "scope": "refresh",
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(
    subject: str,
    extra_claims: dict[str, Any] | None = None,
    expires_minutes: int | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": str(uuid.uuid4()),
        "type": "access",
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:  # pragma: no cover - re-raised as auth error upstream
        raise ValueError("Invalid or expired token") from exc


# --- Field-level encryption ------------------------------------------------
def _fernet():
    from cryptography.fernet import Fernet

    key = settings.FIELD_ENCRYPTION_KEY
    if not key or key.startswith("CHANGE_ME"):
        # Dev fallback: derive a stable key so the app still boots. Production
        # MUST supply a real FIELD_ENCRYPTION_KEY (validated on startup).
        import base64
        import hashlib

        key = base64.urlsafe_b64encode(
            hashlib.sha256(settings.SECRET_KEY.encode()).digest()
        ).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_field(plaintext: str | None) -> str | None:
    if plaintext is None:
        return None
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_field(ciphertext: str | None) -> str | None:
    if ciphertext is None:
        return None
    return _fernet().decrypt(ciphertext.encode()).decode()
