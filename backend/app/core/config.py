"""Application configuration loaded from environment / .env.

All settings are validated by pydantic-settings at startup so the process fails
fast on misconfiguration rather than at first request.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Annotated, List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- Application ---
    APP_NAME: str = "Casa Harmony AI"
    ENVIRONMENT: str = "development"
    API_V1_PREFIX: str = "/api/v1"
    # NoDecode: don't let the env source JSON-decode this; the validator below
    # accepts a plain URL or a comma-separated list (e.g. "https://a,https://b").
    BACKEND_CORS_ORIGINS: Annotated[List[str], NoDecode] = Field(default_factory=list)

    # --- Database ---
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "casa_harmony"
    POSTGRES_USER: str = "casa_app"
    POSTGRES_PASSWORD: str = "casa_app_pwd"
    DATABASE_URL: str | None = None

    # --- Security ---
    SECRET_KEY: str = "CHANGE_ME"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    ALGORITHM: str = "HS256"
    FIELD_ENCRYPTION_KEY: str = ""

    # --- Bootstrap ---
    SUPERADMIN_EMAIL: str = "superadmin@casaharmony.ai"
    SUPERADMIN_PASSWORD: str = "ChangeMe!Superadmin1"

    # --- Nightly GL posting scheduler (in-process; off by default) ---
    ENABLE_SCHEDULER: bool = False
    POSTING_HOUR: int = 2
    POSTING_MINUTE: int = 0
    # Nightly encrypted DB backup (runs inside the scheduler when both are on).
    BACKUP_ENABLED: bool = False
    # Scheduling mode: "apscheduler" (in-process, dev/single-instance) or "celery"
    # (Celery Beat + workers for HA). Celery uses the broker/backend below.
    SCHEDULER_MODE: str = "apscheduler"
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"

    # Base URL of the frontend (used in password-reset links).
    FRONTEND_BASE_URL: str = "http://localhost:3000"

    # Demo-only shortcut: POST /portal/pay books a receipt directly from the
    # client's asserted amount, with no payment processor involved. That is fine
    # for showing the app without a real gateway, but in production a resident
    # payment must settle through /portal/pay/checkout + the gateway webhook, or
    # anyone could clear their own balance for free. Off in production unless a
    # deployment explicitly opts in.
    ALLOW_DIRECT_PORTAL_PAYMENT: bool = True

    # --- Resident MFA (email/SMS one-time codes) ---
    OTP_TTL_MINUTES: int = 10
    OTP_MAX_ATTEMPTS: int = 5
    OTP_RESEND_SECONDS: int = 30        # min seconds between code sends
    # Optional providers; if unset, codes are logged (dev) instead of sent.
    SENDGRID_API_KEY: str = ""
    MAIL_FROM: str = "no-reply@casaharmony.ai"
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def _split_cors(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def sqlalchemy_database_uri(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return (
            f"postgresql+psycopg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
