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
