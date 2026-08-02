"""Schema serialization regressions."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.schemas.rbac import UserOut


def test_userout_serializes_anonymized_email():
    """CCPA erasure sets emails to ...@anonymized.invalid (a reserved domain).

    UserOut.email must be a plain str so the user list still serializes after an
    erasure — EmailStr would reject '.invalid' and 500 the whole /users response.
    """
    u = UserOut(
        id=uuid.uuid4(),
        email="erased+abc123@anonymized.invalid",
        full_name="REDACTED",
        is_superadmin=False,
        is_active=False,
        created_at=datetime.now(timezone.utc),
    )
    assert u.email.endswith("@anonymized.invalid")
