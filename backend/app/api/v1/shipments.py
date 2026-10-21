from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import DB
from app.core.errors import not_found
from app.models import Anomaly, Claim, Investigation
from app.repositories import shipments as ship_repo
from app.schemas.common import ERROR_RESPONSES, Page
from app.schemas.shipment import AnomalyBrief, AnomalyOut, ShipmentDetailOut, ShipmentOut
from app.services.deadlines import claim_deadline, window_days_by_courier

router = APIRouter(tags=["shipments"], responses=ERROR_RESPONSES)


def active_anomalies(db, shipment_ids: list[str]) -> dict[str, Anomaly]:
    rows = db.scalars(
        select(Anomaly)
        .where(Anomaly.shipment_id.in_(shipment_ids), Anomaly.status != "resolved")
        .order_by(Anomaly.detected_at)
    ).all()
    return {a.shipment_id: a for a in rows}  # terbaru menimpa yang lama


@router.get("/shipments", response_model=Page[ShipmentOut])
def list_shipments(
    db: DB,
    status: str | None = None,
    courier: str | None = None,
    q: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Page[ShipmentOut]:
    rows, total = ship_repo.search(db, status=status, courier=courier, q=q, limit=limit,
                                   offset=offset)
    anomalies = active_anomalies(db, [s.id for s in rows])
    windows = window_days_by_courier(db)
    items = [
        ShipmentOut.model_validate(s).model_copy(update={
            "active_anomaly": AnomalyBrief.model_validate(anomalies[s.id]) if s.id in anomalies else None,
            "claim_deadline": claim_deadline(s, windows),
        })
        for s in rows
    ]
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/shipments/{shipment_id}", response_model=ShipmentDetailOut)
def get_shipment(shipment_id: str, db: DB) -> ShipmentDetailOut:
    s = ship_repo.get(db, shipment_id)
    if s is None:
        raise not_found("Resi")
    anomaly = active_anomalies(db, [s.id]).get(s.id)
    inv = db.scalar(select(Investigation).where(Investigation.shipment_id == s.id)
                    .order_by(Investigation.started_at.desc()))
    claim = db.scalar(select(Claim).where(Claim.shipment_id == s.id)
                      .order_by(Claim.created_at.desc()))
    base = ShipmentOut.model_validate(s).model_dump()
    base["claim_deadline"] = claim_deadline(s, window_days_by_courier(db))
    return ShipmentDetailOut(
        **{**base, "active_anomaly": AnomalyBrief.model_validate(anomaly) if anomaly else None},
        buyer_report=s.buyer_report, tracking_events=s.tracking_events,
        anomaly=AnomalyOut.model_validate(anomaly) if anomaly else None,
        latest_investigation=inv, latest_claim=claim,
    )


@router.get("/anomalies", response_model=list[AnomalyOut])
def list_anomalies(db: DB, status: str | None = None, case_type: str | None = None) -> list[Anomaly]:
    stmt = select(Anomaly)
    if status:
        stmt = stmt.where(Anomaly.status == status)
    if case_type:
        stmt = stmt.where(Anomaly.case_type == case_type)
    return list(db.scalars(stmt.order_by(Anomaly.detected_at.desc())))
