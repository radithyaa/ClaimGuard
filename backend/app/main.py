"""Entrypoint FastAPI ClaimGuard: `uvicorn app.main:app` (dari folder backend/)."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text

from app.api.v1 import (
    claims,
    demo,
    evidence,
    investigations,
    metrics,
    monitoring,
    settings,
    shipments,
)
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import RequestIdMiddleware, setup_logging
from app.db.session import engine, init_db, session_scope
from app.models import Shipment
from app.schemas.metrics import HealthOut
from app.services import demo_data, investigation_runner, scheduler
from app.services.settings_service import get_runtime

log = logging.getLogger(__name__)
API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_logging()
    s = get_settings()
    init_db()
    if stale := investigation_runner.recover_stale():
        log.warning("%d investigasi tersisa dari proses lama ditandai gagal", stale)
    if s.seed_on_startup:
        with session_scope() as db:
            if db.scalar(select(Shipment.id).limit(1)) is None:
                log.info("database kosong: seed data demo %s", demo_data.reset_and_seed(db))
            log.info("kebijakan kurir: %s", await demo_data.ensure_policies(db) or "sudah ada")
    scheduler.start()
    yield
    scheduler.shutdown()
    await investigation_runner.cancel_all()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="ClaimGuard API", version="0.1.0", lifespan=lifespan,
                  openapi_url=f"{API_PREFIX}/openapi.json", docs_url=f"{API_PREFIX}/docs")
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True,
                       allow_methods=["GET", "POST", "PATCH"], allow_headers=["*"],
                       expose_headers=["X-Request-ID"])
    register_error_handlers(app)

    for module in (shipments, monitoring, investigations, claims, evidence, metrics, settings, demo):
        app.include_router(module.router, prefix=API_PREFIX)

    @app.get(f"{API_PREFIX}/health", response_model=HealthOut, tags=["health"])
    def health() -> HealthOut:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            db_status = "ok"
        except Exception:  # noqa: BLE001
            db_status = "error"
        return HealthOut(status="ok" if db_status == "ok" else "degraded", db=db_status,
                         ai_mode=get_runtime().ai_mode if db_status == "ok" else s.ai_mode,
                         storage=s.storage_backend)

    if s.storage_backend == "local":  # klip & sampel untuk pemutar saat dev (LocalStorage.public_url)
        Path(s.storage_local_root).mkdir(parents=True, exist_ok=True)
        app.mount("/media", StaticFiles(directory=s.storage_local_root), name="media")
    return app


app = create_app()
