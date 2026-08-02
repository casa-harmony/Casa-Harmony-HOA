"""PCI DSS payment tokenization service.

Implements the tokenization control: a Primary Account Number (PAN) is exchanged
for an opaque vault token and is NEVER persisted by the application. Only the
token, card brand, and last four digits are stored (see PaymentToken).

This reference "vault" is deterministic-but-opaque (HMAC of the PAN under the
app secret) to keep the demo self-contained. In production this call is replaced
by a real PCI-compliant gateway/vault (Stripe, Braintree, etc.) — the interface
and what we store stay identical, so the app stays out of PCI scope.
"""
from __future__ import annotations

import hashlib
import hmac
import re

from app.core.config import settings


class CardValidationError(ValueError):
    pass


def _luhn_ok(pan: str) -> bool:
    digits = [int(d) for d in pan]
    checksum = 0
    parity = len(digits) % 2
    for i, d in enumerate(digits):
        if i % 2 == parity:
            d *= 2
            if d > 9:
                d -= 9
        checksum += d
    return checksum % 10 == 0


def _brand(pan: str) -> str:
    if pan.startswith("4"):
        return "Visa"
    if pan[:2] in {"51", "52", "53", "54", "55"} or pan[:2] == "22":
        return "Mastercard"
    if pan[:2] in {"34", "37"}:
        return "Amex"
    if pan[:2] == "60" or pan[:4] == "6011":
        return "Discover"
    return "Unknown"


def tokenize_card(pan: str, exp_month: int, exp_year: int) -> dict:
    """Validate a card and return token metadata. The PAN is discarded."""
    pan = re.sub(r"[\s-]", "", pan or "")
    if not pan.isdigit() or not (12 <= len(pan) <= 19):
        raise CardValidationError("Invalid card number format")
    if not _luhn_ok(pan):
        raise CardValidationError("Card number failed Luhn checksum")
    if not (1 <= exp_month <= 12):
        raise CardValidationError("Invalid expiry month")

    token = hmac.new(
        settings.SECRET_KEY.encode(), pan.encode(), hashlib.sha256
    ).hexdigest()
    return {
        "vault_token": f"tok_{token[:32]}",
        "card_brand": _brand(pan),
        "last_four": pan[-4:],
        "exp_month": exp_month,
        "exp_year": exp_year,
    }
    # NOTE: `pan` goes out of scope here and is never stored or logged.
