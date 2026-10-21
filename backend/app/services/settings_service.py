"""Pengaturan runtime (PATCH /settings) di tabel `settings`, default dari config."""

from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import session_scope
from app.models import Setting

_KEY = "runtime"


class RuntimeSettings(BaseModel):
    scan_interval_min: int = Field(ge=1, le=1440)
    sla_grace_hours: int = Field(ge=0, le=240)
    min_confidence: float = Field(ge=0, le=1)
    ai_mode: Literal["live", "auto", "cache"]
    scheduler_enabled: bool


class RuntimeSettingsPatch(BaseModel):
    scan_interval_min: int | None = Field(default=None, ge=1, le=1440)
    sla_grace_hours: int | None = Field(default=None, ge=0, le=240)
    min_confidence: float | None = Field(default=None, ge=0, le=1)
    ai_mode: Literal["live", "auto", "cache"] | None = None
    scheduler_enabled: bool | None = None


def _defaults() -> RuntimeSettings:
    s = get_settings()
    return RuntimeSettings(
        scan_interval_min=s.scan_interval_min, sla_grace_hours=s.sla_grace_hours,
        min_confidence=s.min_confidence, ai_mode=s.ai_mode, scheduler_enabled=s.scheduler_enabled,
    )


def get_runtime(db: Session | None = None) -> RuntimeSettings:
    def read(session: Session) -> RuntimeSettings:
        row = session.get(Setting, _KEY)
        base = _defaults().model_dump()
        return RuntimeSettings.model_validate({**base, **(row.value_json if row else {})})

    if db is not None:
        return read(db)
    with session_scope() as session:
        return read(session)


def update_runtime(db: Session, patch: RuntimeSettingsPatch) -> RuntimeSettings:
    current = get_runtime(db)
    merged = RuntimeSettings.model_validate(
        {**current.model_dump(), **patch.model_dump(exclude_none=True)}
    )
    row = db.get(Setting, _KEY)
    if row is None:
        db.add(Setting(key=_KEY, value_json=merged.model_dump()))
    else:
        row.value_json = merged.model_dump()
    db.flush()
    return merged
