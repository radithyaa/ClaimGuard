"""Model SQLAlchemy untuk semua tabel SRS bagian 8.

Waktu selalu UTC (timezone-aware). PK berupa UUID string agar portabel SQLite <-> Postgres.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    TypeDecorator,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator):
    """DateTime yang selalu disimpan & dikembalikan sebagai UTC timezone-aware (SQLite membuang tzinfo)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("datetime harus timezone-aware (UTC)")
        return value.astimezone(UTC)

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value


Json = JSON().with_variant(JSONB(), "postgresql")


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tracking_number: Mapped[str] = mapped_column(String(64), unique=True)
    courier: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    origin: Mapped[str] = mapped_column(String(128))
    destination: Mapped[str] = mapped_column(String(128))
    shipped_at: Mapped[datetime] = mapped_column(UTCDateTime())
    sla_deadline: Mapped[datetime] = mapped_column(UTCDateTime())
    item_name: Mapped[str] = mapped_column(String(256), default="")
    item_value: Mapped[int] = mapped_column(Integer, default=0)  # rupiah
    buyer_report: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Kesimpulan pihak yang bersalah: courier | seller | buyer (null = belum diputuskan)
    resolution: Mapped[str | None] = mapped_column(String(16), nullable=True)
    resolution_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=True)

    tracking_events: Mapped[list["TrackingEvent"]] = relationship(
        back_populates="shipment", order_by="TrackingEvent.occurred_at"
    )


class TrackingEvent(Base):
    __tablename__ = "tracking_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"), index=True)
    status: Mapped[str] = mapped_column(String(64))
    location: Mapped[str] = mapped_column(String(128))
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime())

    shipment: Mapped[Shipment] = relationship(back_populates="tracking_events")


class MediaAsset(Base):
    """Video/foto sumber: rekaman CCTV gudang, video unboxing pembeli, foto barang."""

    __tablename__ = "media_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(16))  # cctv | unboxing | photo
    uri: Mapped[str] = mapped_column(String(512))  # gs://... atau local://...
    recorded_start: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    shipment_id: Mapped[str | None] = mapped_column(
        ForeignKey("shipments.id"), nullable=True, index=True
    )
    description: Mapped[str] = mapped_column(String(256), default="")


class PackScanLog(Base):
    __tablename__ = "pack_scan_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"), index=True)
    scanned_at: Mapped[datetime] = mapped_column(UTCDateTime())
    cctv_media_id: Mapped[str | None] = mapped_column(ForeignKey("media_assets.id"), nullable=True)
    # Barang yang dikemas penjual sesuai urutan waktu (rekaman CCTV). Menjadi pembanding klaim
    # isi paket; kosong bila operator tidak mencatatnya.
    packed_items_json: Mapped[list[str]] = mapped_column(Json, default=list)


class Anomaly(Base):
    __tablename__ = "anomalies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"), index=True)
    code: Mapped[str] = mapped_column(String(32))
    case_type: Mapped[str] = mapped_column(String(16))  # lost | damaged | return_fraud
    severity: Mapped[str] = mapped_column(String(8))  # low | medium | high
    reason_json: Mapped[dict[str, Any]] = mapped_column(Json, default=dict)
    detected_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open|investigating|resolved


class Investigation(Base):
    __tablename__ = "investigations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"), index=True)
    anomaly_id: Mapped[str | None] = mapped_column(ForeignKey("anomalies.id"), nullable=True)
    case_type: Mapped[str] = mapped_column(String(16))
    # queued | running | completed | failed | cancelled
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    # claim_drafted | needs_evidence | fraud_suspect | seller_error
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Ringkasan satu frasa dari Evaluator (bisa lebih panjang dari kode status).
    verdict: Mapped[str | None] = mapped_column(String(256), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)


class InvestigationEvent(Base):
    """Event agen berurutan; sumber SSE dan replay Last-Event-ID."""

    __tablename__ = "investigation_events"

    seq: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id"), index=True)
    type: Mapped[str] = mapped_column(String(16))
    agent: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(Json, default=dict)
    source: Mapped[str | None] = mapped_column(String(8), nullable=True)  # live | cache
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # cctv_clip | unboxing | photo
    uri: Mapped[str] = mapped_column(String(512))
    source_media_id: Mapped[str | None] = mapped_column(
        ForeignKey("media_assets.id"), nullable=True
    )
    clip_start_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    clip_duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    analysis_json: Mapped[dict[str, Any] | None] = mapped_column(Json, nullable=True)
    analysis_source: Mapped[str | None] = mapped_column(String(8), nullable=True)  # live | cache
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class CourierPolicy(Base):
    __tablename__ = "courier_policies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    courier: Mapped[str] = mapped_column(String(32), unique=True)
    claim_window_days: Mapped[int] = mapped_column(Integer)
    required_docs_json: Mapped[list[str]] = mapped_column(Json, default=list)
    max_compensation: Mapped[str] = mapped_column(String(256))
    extra_json: Mapped[dict[str, Any]] = mapped_column(Json, default=dict)
    source_text: Mapped[str] = mapped_column(Text, default="")
    extraction_source: Mapped[str] = mapped_column(String(8), default="manual")  # live|cache|manual
    extracted_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Claim(Base):
    __tablename__ = "claims"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"), index=True)
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id"))
    narrative: Mapped[str] = mapped_column(Text)
    draft_json: Mapped[dict[str, Any]] = mapped_column(Json, default=dict)
    # pending_approval | submitted | rejected
    status: Mapped[str] = mapped_column(String(16), default="pending_approval", index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    submitted_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    submission_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor: Mapped[str] = mapped_column(String(64))  # agent:<nama> | user | system
    action: Mapped[str] = mapped_column(String(64))
    entity: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(Json, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class CourierThreshold(Base):
    """Batas tertahan per kurir (tab Pengaturan > Pemantauan dan ambang).

    Menimpa `settings.sla_grace_hours` bila ada. `hold_days` = jumlah hari resi tanpa
    pergerakan sebelum ditandai anomali 'Tertahan'; `sla_note` hanya label tampilan.
    """

    __tablename__ = "courier_thresholds"

    courier: Mapped[str] = mapped_column(String(32), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(64))
    hold_days: Mapped[int] = mapped_column(Integer, default=3)
    sla_note: Mapped[str] = mapped_column(String(64), default="Standar SLA")
    tag: Mapped[str | None] = mapped_column(String(32), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_json: Mapped[Any] = mapped_column(Json)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)
