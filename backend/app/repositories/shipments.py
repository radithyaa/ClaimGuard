from collections.abc import Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import Anomaly, MediaAsset, PackScanLog, Shipment

ACTIVE_STATUSES = ("created", "picked_up", "in_transit", "out_for_delivery", "returned")


def get(session: Session, shipment_id: str) -> Shipment | None:
    return session.scalar(
        select(Shipment)
        .where(Shipment.id == shipment_id)
        .options(selectinload(Shipment.tracking_events))
    )


def get_by_tracking(session: Session, tracking_number: str) -> Shipment | None:
    return session.scalar(select(Shipment).where(Shipment.tracking_number == tracking_number))


def list_active(session: Session) -> Sequence[Shipment]:
    """Resi yang masih perlu dipantau oleh Monitoring (FR-01, FR-02)."""
    return session.scalars(
        select(Shipment)
        .where(Shipment.status.in_(ACTIVE_STATUSES))
        .options(selectinload(Shipment.tracking_events))
    ).all()


def search(
    session: Session,
    *,
    status: str | None = None,
    courier: str | None = None,
    q: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[Sequence[Shipment], int]:
    stmt = select(Shipment)
    if status:
        stmt = stmt.where(Shipment.status == status)
    if courier:
        stmt = stmt.where(Shipment.courier == courier)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(Shipment.tracking_number.ilike(like), Shipment.destination.ilike(like))
        )
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = session.scalars(
        stmt.order_by(Shipment.shipped_at.desc()).limit(limit).offset(offset)
    ).all()
    return rows, total


def get_pack_scan(session: Session, shipment_id: str) -> PackScanLog | None:
    """Scan packing terakhir untuk resi (get_scan_timestamp, FR-03)."""
    return session.scalar(
        select(PackScanLog)
        .where(PackScanLog.shipment_id == shipment_id)
        .order_by(PackScanLog.scanned_at.desc())
    )


def get_media(session: Session, media_id: str) -> MediaAsset | None:
    return session.get(MediaAsset, media_id)


def list_media_for_shipment(session: Session, shipment_id: str) -> Sequence[MediaAsset]:
    """Media milik resi (unboxing/foto) + rekaman CCTV yang menjadi sumber scan packing."""
    scan = get_pack_scan(session, shipment_id)
    cond = MediaAsset.shipment_id == shipment_id
    if scan and scan.cctv_media_id:
        cond = or_(cond, MediaAsset.id == scan.cctv_media_id)
    return session.scalars(select(MediaAsset).where(cond)).all()


def get_open_anomaly(session: Session, shipment_id: str) -> Anomaly | None:
    return session.scalar(
        select(Anomaly)
        .where(Anomaly.shipment_id == shipment_id, Anomaly.status != "resolved")
        .order_by(Anomaly.detected_at.desc())
    )
