from datetime import timedelta, timezone

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import DB
from app.models import Anomaly, Claim, Investigation, utcnow
from app.repositories import policies as policy_repo
from app.schemas.metrics import AuditLogOut, MetricsSummaryOut, TrendPoint
from app.schemas.shipment import CourierPolicyOut
from app.services import audit

router = APIRouter(tags=["metrics"])
WIB = timezone(timedelta(hours=7))


@router.get("/metrics/summary", response_model=MetricsSummaryOut)
def summary(db: DB) -> MetricsSummaryOut:
    def count(model, *where) -> int:
        return db.scalar(select(func.count()).select_from(model).where(*where)) or 0

    submitted = db.scalars(select(Claim).where(Claim.status == "submitted")).all()
    avg_ms = db.scalar(select(func.avg(Investigation.duration_ms))
                       .where(Investigation.status == "completed"))

    today = utcnow().astimezone(WIB).date()
    days = [today - timedelta(days=i) for i in range(6, -1, -1)]
    since = utcnow() - timedelta(days=8)
    anomaly_days = [a.astimezone(WIB).date() for a in
                    db.scalars(select(Anomaly.detected_at).where(Anomaly.detected_at >= since))]
    claim_days = [c.astimezone(WIB).date() for c in
                  db.scalars(select(Claim.created_at).where(Claim.created_at >= since))]
    return MetricsSummaryOut(
        active_anomalies=count(Anomaly, Anomaly.status != "resolved"),
        pending_claims=count(Claim, Claim.status == "pending_approval"),
        submitted_claims=len(submitted),
        estimated_value_saved=sum(int(c.draft_json.get("requested_compensation") or 0)
                                  for c in submitted),
        avg_processing_sec=round(avg_ms / 1000, 1) if avg_ms else None,
        trend=[TrendPoint(date=d.isoformat(), anomalies=anomaly_days.count(d),
                          claims=claim_days.count(d)) for d in days],
    )


@router.get("/audit-logs", response_model=list[AuditLogOut])
def audit_logs(db: DB, limit: int = Query(default=20, ge=1, le=100), entity: str | None = None):
    return audit.recent(db, limit=limit, entity=entity)


@router.get("/couriers/policies", response_model=list[CourierPolicyOut], tags=["couriers"])
def courier_policies(db: DB) -> list[CourierPolicyOut]:
    return [CourierPolicyOut.of(p) for p in policy_repo.list_all(db)]
