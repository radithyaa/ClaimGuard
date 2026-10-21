"""Tenggat pengajuan klaim per resi: tanggal acuan + `claim_window_days` kebijakan kurir (FR-05).

Acuan: paket sudah sampai/diretur -> event pelacakan terakhir (klaim rusak/retur dihitung dari
serah terima). Selain itu (tertahan/hilang) -> batas SLA, saat paket seharusnya sudah tiba.
"""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import Shipment
from app.repositories import policies as policy_repo

ARRIVED_STATUSES = ("delivered", "returned")


def window_days_by_courier(db: Session) -> dict[str, int]:
    return {p.courier: p.claim_window_days for p in policy_repo.list_all(db)}


def claim_deadline(shipment: Shipment, windows: dict[str, int]) -> datetime | None:
    days = windows.get(policy_repo.normalize_courier(shipment.courier))
    if days is None:
        return None
    reference = shipment.sla_deadline
    if shipment.status in ARRIVED_STATUSES and shipment.tracking_events:
        reference = shipment.tracking_events[-1].occurred_at
    return reference + timedelta(days=days)
