from fastapi import APIRouter

from app.api.deps import DB, User
from app.schemas.common import ERROR_RESPONSES
from app.schemas.shipment import AnomalyOut, ScanResultOut
from app.services import monitoring
from app.services.settings_service import get_runtime, hold_map

router = APIRouter(tags=["monitoring"], responses=ERROR_RESPONSES)


@router.post("/monitoring/scan", response_model=ScanResultOut)
def scan(db: DB, user: User) -> ScanResultOut:
    scanned, created = monitoring.scan(db, grace_hours=get_runtime(db).sla_grace_hours,
                                       hold_days_by_courier=hold_map(db))
    result = ScanResultOut(scanned=scanned,
                           new_anomalies=[AnomalyOut.model_validate(a) for a in created])
    db.commit()
    return result
