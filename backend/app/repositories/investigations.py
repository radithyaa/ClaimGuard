from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Evidence, Investigation, InvestigationEvent, utcnow

TERMINAL_STATUSES = ("completed", "failed", "cancelled")


def create(
    session: Session, *, shipment_id: str, case_type: str, anomaly_id: str | None = None
) -> Investigation:
    inv = Investigation(shipment_id=shipment_id, case_type=case_type, anomaly_id=anomaly_id)
    session.add(inv)
    session.flush()
    return inv


def get(session: Session, investigation_id: str) -> Investigation | None:
    return session.get(Investigation, investigation_id)


def list_for(
    session: Session, *, shipment_id: str | None = None, status: str | None = None
) -> Sequence[Investigation]:
    stmt = select(Investigation)
    if shipment_id:
        stmt = stmt.where(Investigation.shipment_id == shipment_id)
    if status:
        stmt = stmt.where(Investigation.status == status)
    return session.scalars(stmt.order_by(Investigation.started_at.desc())).all()


def mark_running(session: Session, inv: Investigation) -> None:
    inv.status = "running"
    inv.started_at = utcnow()


def finish(
    session: Session,
    inv: Investigation,
    *,
    status: str,
    outcome: str | None = None,
    verdict: str | None = None,
    confidence: float | None = None,
    decision_reason: str | None = None,
    error: str | None = None,
) -> None:
    """Menutup investigasi. Tidak menimpa status terminal (mis. cancelled lalu error susulan)."""
    if inv.status in TERMINAL_STATUSES:
        return
    finished: datetime = utcnow()
    inv.status = status
    inv.outcome = outcome
    inv.verdict = verdict
    inv.confidence = confidence
    inv.decision_reason = decision_reason
    inv.error = error
    inv.finished_at = finished
    inv.duration_ms = int((finished - inv.started_at).total_seconds() * 1000)


def add_event(
    session: Session,
    investigation_id: str,
    type_: str,
    payload: dict[str, Any],
    *,
    agent: str | None = None,
    source: str | None = None,
) -> InvestigationEvent:
    ev = InvestigationEvent(
        investigation_id=investigation_id, type=type_, agent=agent, payload_json=payload,
        source=source,
    )
    session.add(ev)
    session.flush()
    return ev


def events_after(
    session: Session, investigation_id: str, after_seq: int = 0
) -> Sequence[InvestigationEvent]:
    """Untuk SSE replay dengan Last-Event-ID."""
    return session.scalars(
        select(InvestigationEvent)
        .where(
            InvestigationEvent.investigation_id == investigation_id,
            InvestigationEvent.seq > after_seq,
        )
        .order_by(InvestigationEvent.seq)
    ).all()


def add_evidence(session: Session, **fields: Any) -> Evidence:
    ev = Evidence(**fields)
    session.add(ev)
    session.flush()
    return ev


def get_evidence(session: Session, evidence_id: str) -> Evidence | None:
    return session.get(Evidence, evidence_id)


def list_evidence(session: Session, investigation_id: str) -> Sequence[Evidence]:
    return session.scalars(
        select(Evidence)
        .where(Evidence.investigation_id == investigation_id)
        .order_by(Evidence.created_at)
    ).all()
