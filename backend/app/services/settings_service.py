"""Pengaturan runtime (GET/PATCH /settings) di tabel `settings`, default dari config.

Semua nilai yang dapat diubah operator backend lewat tab "Sistem > Pengaturan" disimpan di satu
baris JSON (`key='runtime'`). Urutan prioritas: baris DB -> default `config.py`.

Catatan: `medium_confidence` (< `min_confidence`) hanya dipakai untuk pratinjau meter keyakinan di
UI; penjaga FR-12 tetap memakai `min_confidence` tunggal.
"""

from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.session import session_scope
from app.models import CourierThreshold, Setting

_KEY = "runtime"

AiMode = Literal["live", "auto", "cache"]


def _first_message(exc: ValidationError) -> str:
    err = exc.errors()[0]
    return str(err.get("msg", "pengaturan tidak valid")).removeprefix("Value error, ")


class CourierThresholdIn(BaseModel):
    courier: str = Field(min_length=1, max_length=32, pattern=r"^[a-z0-9_]+$")
    display_name: str = Field(min_length=1, max_length=64)
    hold_days: int = Field(ge=1, le=30)
    sla_note: str = Field(default="Standar SLA", max_length=64)
    tag: str | None = Field(default=None, max_length=32)


class CourierThresholdOut(CourierThresholdIn):
    @classmethod
    def of(cls, row: CourierThreshold) -> "CourierThresholdOut":
        return cls(courier=row.courier, display_name=row.display_name, hold_days=row.hold_days,
                   sla_note=row.sla_note, tag=row.tag)


class RuntimeSettings(BaseModel):
    scan_interval_min: int = Field(ge=1, le=1440)
    sla_grace_hours: int = Field(ge=0, le=240)
    min_confidence: float = Field(ge=0, le=1)
    medium_confidence: float = Field(ge=0, le=1)
    ai_mode: AiMode
    scheduler_enabled: bool
    video_retention_days: int = Field(ge=1, le=365)
    mask_pii: bool
    deadline_reminder_hours: list[int]
    shopee_connected: bool
    tiktok_shop_connected: bool
    courier_thresholds: list[CourierThresholdOut] = []

    @model_validator(mode="after")
    def _medium_below_high(self) -> "RuntimeSettings":
        if self.medium_confidence > self.min_confidence:
            raise ValueError("medium_confidence tidak boleh lebih besar dari min_confidence")
        return self


class RuntimeSettingsPatch(BaseModel):
    scan_interval_min: int | None = Field(default=None, ge=1, le=1440)
    sla_grace_hours: int | None = Field(default=None, ge=0, le=240)
    min_confidence: float | None = Field(default=None, ge=0, le=1)
    medium_confidence: float | None = Field(default=None, ge=0, le=1)
    ai_mode: AiMode | None = None
    scheduler_enabled: bool | None = None
    video_retention_days: int | None = Field(default=None, ge=1, le=365)
    mask_pii: bool | None = None
    deadline_reminder_hours: list[int] | None = Field(default=None, max_length=5)
    shopee_connected: bool | None = None
    tiktok_shop_connected: bool | None = None


DEFAULT_COURIER_THRESHOLDS = [
    CourierThresholdIn(courier="jnt", display_name="J&T Express", hold_days=3),
    CourierThresholdIn(courier="spx", display_name="Shopee Xpress (SPX)", hold_days=2, tag="Ketat"),
    CourierThresholdIn(courier="jne", display_name="JNE Express", hold_days=4, sla_note="Kargo & Reguler"),
    CourierThresholdIn(courier="sicepat", display_name="SiCepat", hold_days=3),
    CourierThresholdIn(courier="anteraja", display_name="Anteraja", hold_days=3),
]


def _defaults() -> RuntimeSettings:
    s = get_settings()
    return RuntimeSettings(
        scan_interval_min=s.scan_interval_min, sla_grace_hours=s.sla_grace_hours,
        min_confidence=s.min_confidence, medium_confidence=s.medium_confidence,
        ai_mode=s.ai_mode, scheduler_enabled=s.scheduler_enabled,
        video_retention_days=s.video_retention_days, mask_pii=s.mask_pii,
        deadline_reminder_hours=s.deadline_reminder_hours,
        shopee_connected=s.shopee_connected, tiktok_shop_connected=s.tiktok_shop_connected,
    )


def _read(session: Session) -> RuntimeSettings:
    row = session.get(Setting, _KEY)
    stored = dict(row.value_json) if row else {}
    stored.pop("courier_thresholds", None)  # tabel sendiri, bukan JSON
    thresholds = session.scalars(select(CourierThreshold).order_by(CourierThreshold.courier)).all()
    return RuntimeSettings.model_validate({
        **_defaults().model_dump(), **stored,
        "courier_thresholds": [CourierThresholdOut.of(t) for t in thresholds],
    })


def get_runtime(db: Session | None = None) -> RuntimeSettings:
    if db is not None:
        return _read(db)
    with session_scope() as session:
        return _read(session)


def hold_map(db: Session | None = None) -> dict[str, int]:
    """Batas tertahan per kurir untuk dipakai `monitoring.scan` (kosong = aturan SLA lama)."""
    return {t.courier: t.hold_days for t in get_runtime(db).courier_thresholds}


def list_thresholds(db: Session) -> list[CourierThreshold]:
    return list(db.scalars(select(CourierThreshold).order_by(CourierThreshold.courier)))


def replace_thresholds(db: Session, items: list[CourierThresholdIn]) -> None:
    """Mengganti seluruh daftar pengecualian kurir. ID yang sama diperbarui, bukan diduplikasi."""
    existing = {t.courier: t for t in list_thresholds(db)}
    keep = {item.courier for item in items}
    for courier, row in existing.items():
        if courier not in keep:
            db.delete(row)
    for item in items:
        row = existing.get(item.courier)
        if row is None:
            db.add(CourierThreshold(**item.model_dump()))
        else:
            row.display_name = item.display_name
            row.hold_days = item.hold_days
            row.sla_note = item.sla_note
            row.tag = item.tag
    db.flush()


def update_runtime(db: Session, patch: RuntimeSettingsPatch) -> RuntimeSettings:
    current = _read(db)
    try:
        merged = RuntimeSettings.model_validate(
            {**current.model_dump(), **patch.model_dump(exclude_none=True)}
        )
    except ValidationError as exc:
        raise AppError(422, "invalid_settings", _first_message(exc)) from exc
    row = db.get(Setting, _KEY)
    data = merged.model_dump(exclude={"courier_thresholds"})
    if row is None:
        db.add(Setting(key=_KEY, value_json=data))
    else:
        row.value_json = data
    db.flush()
    return merged


def ensure_thresholds(db: Session) -> int:
    """Seed pengecualian kurir bawaan bila tabel masih kosong (idempoten)."""
    if list_thresholds(db):
        return 0
    for item in DEFAULT_COURIER_THRESHOLDS:
        db.add(CourierThreshold(**item.model_dump()))
    db.flush()
    return len(DEFAULT_COURIER_THRESHOLDS)
