import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Header, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.api.deps import DB, User
from app.core.errors import not_found
from app.db.session import session_scope
from app.models import Anomaly, Claim
from app.repositories import investigations as inv_repo
from app.repositories import policies as policy_repo
from app.repositories import shipments as ship_repo
from app.schemas.claim import InvestigationViewOut, StartInvestigationIn, StartInvestigationOut
from app.schemas.common import ERROR_RESPONSES
from app.schemas.evidence import EvidenceOut
from app.schemas.investigation import InvestigationOut
from app.schemas.shipment import CourierPolicyOut
from app.services import investigation_runner as runner

router = APIRouter(tags=["investigations"], responses=ERROR_RESPONSES)
KEEPALIVE_SEC = 15.0


@router.post("/investigations", response_model=StartInvestigationOut, status_code=202)
async def start_investigation(body: StartInvestigationIn, user: User) -> StartInvestigationOut:
    return StartInvestigationOut(investigation_id=runner.start(body.shipment_id, actor=user))


@router.get("/investigations", response_model=list[InvestigationOut])
def list_investigations(db: DB, shipment_id: str | None = None, status: str | None = None):
    return inv_repo.list_for(db, shipment_id=shipment_id, status=status)


@router.get("/investigations/{investigation_id}", response_model=InvestigationViewOut)
def get_investigation(investigation_id: str, db: DB) -> InvestigationViewOut:
    inv = inv_repo.get(db, investigation_id)
    if inv is None:
        raise not_found("Investigasi")
    shipment = ship_repo.get(db, inv.shipment_id)
    anomaly = db.get(Anomaly, inv.anomaly_id) if inv.anomaly_id else None
    policy = policy_repo.get_by_courier(db, shipment.courier)
    claim_id = db.scalar(select(Claim.id).where(Claim.investigation_id == inv.id))
    return InvestigationViewOut(
        **InvestigationOut.model_validate(inv).model_dump(),
        evidence=[EvidenceOut.model_validate(e) for e in inv_repo.list_evidence(db, inv.id)],
        claim_id=claim_id, tracking_number=shipment.tracking_number, courier=shipment.courier,
        anomaly_reason=anomaly.reason_json if anomaly else None,
        courier_policy=CourierPolicyOut.of(policy) if policy else None,
        is_active=runner.is_active(inv.id),
    )


@router.post("/investigations/{investigation_id}/cancel", status_code=202)
def cancel_investigation(investigation_id: str, user: User) -> dict:
    runner.cancel(investigation_id, actor=user)
    return {"status": "cancelling"}


def _sse(data: dict) -> str:
    return f"id: {data['seq']}\nevent: {data['type']}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _event_stream(inv_id: str, after_seq: int) -> AsyncIterator[str]:
    # Berlangganan dulu, baru baca backlog: event yang muncul di antaranya tidak terlewat
    queue = runner.subscribe(inv_id)
    last = after_seq
    try:
        with session_scope() as db:
            backlog = [runner.serialize_event(e) for e in inv_repo.events_after(db, inv_id, after_seq)]
        for data in backlog:
            yield _sse(data)
            last = data["seq"]
            if data["type"] in runner.TERMINAL_EVENTS:
                return
        if queue is None:  # run tidak aktif di proses ini dan belum ada event akhir
            return
        while True:
            try:
                data = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_SEC)
            except TimeoutError:
                yield ": keepalive\n\n"
                continue
            if data["seq"] <= last:
                continue
            yield _sse(data)
            last = data["seq"]
            if data["type"] in runner.TERMINAL_EVENTS:
                return
    finally:
        runner.unsubscribe(inv_id, queue)


@router.get("/investigations/{investigation_id}/stream")
def stream_investigation(
    investigation_id: str,
    db: DB,
    last_event_id: str | None = Header(default=None),
    after: int = Query(default=0, ge=0, description="Alternatif Last-Event-ID"),
) -> StreamingResponse:
    if inv_repo.get(db, investigation_id) is None:
        raise not_found("Investigasi")
    after_seq = int(last_event_id) if last_event_id and last_event_id.isdigit() else after
    return StreamingResponse(
        _event_stream(investigation_id, after_seq), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
