"""Casa Harmony AI — FastAPI application entrypoint."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.middleware import TenantContextMiddleware
from app.core.rate_limit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("casa-harmony")

app = FastAPI(
    title=settings.APP_NAME,
    version="2.0.0",
    description=(
        "Secure multi-tenant Service Desk + ERP for Homeowner Associations. "
        "Oracle EBS-modeled Key Flexfield Chart of Accounts."
    ),
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    docs_url="/docs",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# --- Security: CORS (tighten origins in production) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS if settings.ENVIRONMENT == "production" else (settings.BACKEND_CORS_ORIGINS or ["http://localhost:3000"]),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Tenant resolution (must run per request, before route handlers) ---
app.add_middleware(TenantContextMiddleware)


@app.on_event("startup")
def _check_link_base_url() -> None:
    """Refuse to boot a production API that mints localhost links.

    FRONTEND_BASE_URL is what goes into resident invites, password resets and
    statement links. Left at its development default, every one of those emails
    points the recipient at their *own* machine — and the failure is invisible
    from the server side: the mail sends fine, the token is valid, and the
    resident just sees ERR_CONNECTION_REFUSED. Better to fail loudly here.
    """
    import logging

    base = settings.FRONTEND_BASE_URL
    local = any(h in base for h in ("localhost", "127.0.0.1", "0.0.0.0"))
    if not local:
        return
    message = (
        f"FRONTEND_BASE_URL is {base!r}. Emailed invite, password-reset and "
        "statement links will point at the recipient's own machine. Set it to "
        "the public URL of the frontend."
    )
    if settings.is_production:
        raise RuntimeError(message)
    logging.getLogger("casa-harmony").warning("%s (fine for local development)", message)


@app.on_event("startup")
def _maybe_start_scheduler() -> None:
    """Optional in-process nightly GL posting (ENABLE_SCHEDULER=true).

    Skipped when SCHEDULER_MODE=celery — Celery Beat + workers handle scheduling
    out-of-process for high availability.
    """
    if settings.ENABLE_SCHEDULER and settings.SCHEDULER_MODE != "celery":
        from app.core.scheduler import start_scheduler

        start_scheduler()


@app.on_event("shutdown")
def _stop_scheduler() -> None:
    if settings.ENABLE_SCHEDULER:
        from app.core.scheduler import shutdown_scheduler

        shutdown_scheduler()


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok", "app": settings.APP_NAME, "environment": settings.ENVIRONMENT}


app.include_router(api_router, prefix=settings.API_V1_PREFIX)
