"""SQLAlchemy column types for encryption at rest.

``EncryptedString`` transparently encrypts/decrypts a text column using the
application's Fernet key (AES-128-CBC + HMAC). Ciphertext is what lands on disk
and in backups, satisfying the "encryption at rest" control for SOC 2 / ISO
27001 / PCI DSS for sensitive PII columns (bank/ACH detail, MFA secrets).
"""
from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

from app.core.security import decrypt_field, encrypt_field


class EncryptedString(TypeDecorator):
    """Application-layer encrypted VARCHAR. Stores ciphertext, returns plaintext."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt_field(value) if value is not None else None

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        try:
            return decrypt_field(value)
        except Exception:
            # Tolerate legacy/plaintext rows rather than crashing reads.
            return value
