"""Scan monitoring berkala (FR-08). Nonaktif secara default agar tidak menyela demo."""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.db.session import session_scope
from app.services import monitoring
from app.services.settings_service import RuntimeSettings, get_runtime

log = logging.getLogger(__name__)
_JOB_ID = "monitoring_scan"
_scheduler: AsyncIOScheduler | None = None


def _scan_job() -> None:
    try:
        with session_scope() as db:
            grace = get_runtime(db).sla_grace_hours
            scanned, created = monitoring.scan(db, grace_hours=grace)
        log.info("scan terjadwal: %d resi, %d anomali baru", scanned, len(created))
    except Exception:
        log.exception("scan terjadwal gagal")


def start() -> None:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
        _scheduler.start()
    apply(get_runtime())


def apply(settings: RuntimeSettings) -> None:
    """Dipanggil saat startup dan setelah PATCH /settings."""
    if _scheduler is None:
        return
    if _scheduler.get_job(_JOB_ID):
        _scheduler.remove_job(_JOB_ID)
    if settings.scheduler_enabled:
        _scheduler.add_job(_scan_job, "interval", minutes=settings.scan_interval_min, id=_JOB_ID,
                           max_instances=1, coalesce=True)


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
