"""OpenAPI generation must stay healthy, and rate-limited endpoints must keep
their request bodies.

Regression guard: slowapi's rate-limit decorator combined with
``from __future__ import annotations`` makes FastAPI read body models as
unresolved ``Query`` forward-refs — OpenAPI generation crashes and every
rate-limited POST 422s with "field required" in *query*. auth.py and portal.py
deliberately avoid the future import for this reason (see the note atop
portal.py); this test pins the observable behaviour so it cannot silently
recur.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# Every endpoint decorated with @limiter.limit(...) must still take its payload
# as a request body, not as query parameters.
RATE_LIMITED_POSTS = [
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
    "/api/v1/portal/login",
    "/api/v1/portal/login/verify",
    "/api/v1/portal/forgot-password",
]


def test_openapi_generates():
    res = client.get("/api/v1/openapi.json")
    assert res.status_code == 200, res.text
    assert "PortalLogin" in res.json()["components"]["schemas"]


def test_rate_limited_endpoints_keep_request_bodies():
    spec = client.get("/api/v1/openapi.json").json()
    for path in RATE_LIMITED_POSTS:
        op = spec["paths"][path]["post"]
        assert op.get("requestBody"), (
            f"{path} lost its request body — the body model degraded into a "
            "query parameter (rate-limiter + future-annotations regression)"
        )
        assert not op.get("parameters"), f"{path} unexpectedly has query params"


def test_rate_limited_handlers_classify_payload_as_body():
    """Mechanism-level check (no DB): FastAPI must see a body param, not query."""
    from fastapi.dependencies.utils import get_dependant

    from app.api.v1.auth import forgot_password, login, refresh_session
    from app.api.v1.portal import portal_forgot_password, portal_login, portal_login_verify

    handlers = [
        login, refresh_session, forgot_password,
        portal_login, portal_login_verify, portal_forgot_password,
    ]
    for handler in handlers:
        dep = get_dependant(path="/x", call=handler)
        assert [p.name for p in dep.body_params] == ["payload"], handler.__name__
        assert not dep.query_params, f"{handler.__name__} has query params"
