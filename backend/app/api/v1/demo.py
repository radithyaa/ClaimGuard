from typing import Literal

from fastapi import APIRouter

from app.api.deps import User
from app.core.errors import AppError
from app.db.session import session_scope
from app.repositories import shipments as ship_repo
from app.schemas.claim import StartInvestigationOut
from app.schemas.common import ERROR_RESPONSES
from app.services import audit, demo_data, investigation_runner, monitoring

router = APIRouter(tags=["demo"], responses=ERROR_RESPONSES)


@router.post("/demo/reset")
async def reset(user: User) -> dict:
    await investigation_runner.cancel_all()
    with session_scope() as db:
        report = demo_data.reset_and_seed(db)
        audit.record(db, actor=user, action="demo_reset", entity="demo", payload=report)
    return report


@router.post("/demo/scenario/{name}", response_model=StartInvestigationOut, status_code=202)
async def scenario(
    name: Literal["lost", "damaged", "needs_evidence", "wrong_item_seller"],
    user: User,
) -> StartInvestigationOut:
    """Menandai anomali resi skenario (aturan monitoring yang sama) lalu memulai investigasi."""
    with session_scope() as db:
        shipment = ship_repo.get_by_tracking(db, demo_data.scenario_tracking_number(name))
        if shipment is None:
            raise AppError(409, "demo_not_seeded", "Data demo belum ada; jalankan reset dulu")
        monitoring.scan(db, shipment_ids=[shipment.id])
        if ship_repo.get_open_anomaly(db, shipment.id) is None:
            raise AppError(409, "scenario_not_flagged",
                           "Aturan monitoring tidak menandai resi skenario ini; periksa data mock")
        shipment_id = shipment.id
    return StartInvestigationOut(
        investigation_id=investigation_runner.start(shipment_id, actor=user)
    )
