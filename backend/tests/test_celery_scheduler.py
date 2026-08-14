"""P31: Celery Beat app — task registration, beat schedule, eager execution,
and the /scheduler/info mode endpoint."""
from __future__ import annotations

import os

from fastapi.testclient import TestClient

from app.main import app
from app.core.celery_app import celery_app

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")

EXPECTED_TASKS = {"casa.nightly_gl_posting", "casa.po_budget_checks", "casa.nightly_backup",
                  "casa.monthly_jobs", "casa.dunning_sweep"}


def test_all_jobs_registered_as_tasks_and_in_beat():
    registered = {t for t in celery_app.tasks if t.startswith("casa.")}
    assert EXPECTED_TASKS <= registered
    beat = {v["task"] for v in celery_app.conf.beat_schedule.values()}
    assert beat == EXPECTED_TASKS  # every periodic job has a beat entry


def test_task_runs_eagerly_against_db():
    # Eager mode runs the task in-process (no broker needed) — exercises the wrapper
    # and the underlying per-tenant posting function.
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    try:
        res = celery_app.tasks["casa.nightly_gl_posting"].apply().get()
        assert isinstance(res, int)  # number of batches posted across tenants
    finally:
        celery_app.conf.task_always_eager = False


def test_scheduler_info_reports_mode():
    token = client.post("/api/v1/auth/login",
                        json={"email": SUPERADMIN, "password": SUPERADMIN_PW}).json()["access_token"]
    tid = next(t for t in client.get("/api/v1/tenants?include_demo=true",
               headers={"Authorization": f"Bearer {token}"}).json() if t["slug"] == "casa-harmony")["id"]
    info = client.get("/api/v1/scheduler/info",
                      headers={"Authorization": f"Bearer {token}", "X-Tenant-Id": tid}).json()
    assert info["mode"] in ("apscheduler", "celery")
    assert {j["id"] for j in info["jobs"]} >= {"nightly_gl_posting", "dunning_sweep", "monthly_jobs"}
