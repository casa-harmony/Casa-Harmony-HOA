"""Resident one-time-code MFA (email/SMS).

Security properties:
* Codes are random 6-digit secrets generated with ``secrets`` (CSPRNG).
* Only an HMAC-SHA256 hash (keyed by SECRET_KEY, bound to the resident id) is
  stored — never the plaintext code.
* Challenges expire (OTP_TTL_MINUTES), are single-use, and attempt-capped.
* Verification uses a constant-time compare.
* Resend is rate-limited (OTP_RESEND_SECONDS).
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.otp import ResidentOtpChallenge
from app.models.resident import Resident
from app.services import notifications


class OtpError(ValueError):
    pass


def _hash(resident_id: uuid.UUID, code: str) -> str:
    msg = f"{resident_id}:{code}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()


def _mask(channel: str, dest: str) -> str:
    if channel == "SMS":
        return f"***-***-{dest[-4:]}" if len(dest) >= 4 else "***"
    name, _, domain = dest.partition("@")
    shown = (name[0] + "***") if name else "***"
    return f"{shown}@{domain}" if domain else "***"


def _destination(resident: Resident) -> str:
    dest = resident.phone if resident.mfa_channel == "SMS" else resident.email
    if not dest:
        raise OtpError(
            f"No {resident.mfa_channel.lower()} on file for verification; contact your HOA."
        )
    return dest


def create_challenge(db: Session, resident: Resident) -> tuple[ResidentOtpChallenge, str]:
    now = datetime.now(timezone.utc)
    recent = db.execute(
        select(ResidentOtpChallenge).where(
            ResidentOtpChallenge.resident_id == resident.id,
        ).order_by(ResidentOtpChallenge.created_at.desc())
    ).scalars().first()
    if recent and recent.consumed_at is None:
        age = (now - recent.created_at).total_seconds()
        if age < settings.OTP_RESEND_SECONDS:
            raise OtpError("A code was just sent; please wait a moment before retrying.")

    dest = _destination(resident)
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = ResidentOtpChallenge(
        tenant_id=resident.tenant_id, resident_id=resident.id,
        code_hash=_hash(resident.id, code), channel=resident.mfa_channel,
        destination_masked=_mask(resident.mfa_channel, dest),
        expires_at=now + timedelta(minutes=settings.OTP_TTL_MINUTES),
        attempts=0, max_attempts=settings.OTP_MAX_ATTEMPTS,
    )
    db.add(challenge)
    db.flush()
    notifications.send_otp(resident.mfa_channel, dest, code)
    return challenge, code


def verify_challenge(db: Session, challenge_id: uuid.UUID, code: str) -> Resident:
    challenge = db.get(ResidentOtpChallenge, challenge_id)
    if challenge is None:
        raise OtpError("Invalid or expired code")
    now = datetime.now(timezone.utc)
    expires = challenge.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if challenge.consumed_at is not None or now > expires:
        raise OtpError("Invalid or expired code")
    if challenge.attempts >= challenge.max_attempts:
        raise OtpError("Too many attempts; request a new code")

    challenge.attempts += 1
    expected = challenge.code_hash
    actual = _hash(challenge.resident_id, (code or "").strip())
    if not hmac.compare_digest(expected, actual):
        db.flush()
        raise OtpError("Invalid or expired code")

    challenge.consumed_at = now
    db.flush()
    resident = db.get(Resident, challenge.resident_id)
    if resident is None or not resident.is_active:
        raise OtpError("Resident not found or inactive")
    return resident
