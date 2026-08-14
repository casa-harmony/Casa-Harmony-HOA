import os

from slowapi import Limiter
from slowapi.util import get_remote_address

# The test suite runs hundreds of requests from the same TestClient address
# in seconds, tripping login/OTP limits meant for real traffic. Tests opt out
# via DISABLE_RATE_LIMIT; the flag is a no-op (limiter stays enabled) unless
# explicitly set, so production and dev behavior is unchanged.
limiter = Limiter(key_func=get_remote_address, enabled=os.getenv("DISABLE_RATE_LIMIT") != "1")
