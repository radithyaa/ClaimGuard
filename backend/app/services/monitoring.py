"""Monitoring deterministik (FR-02, FR-09): aturan biasa tanpa LLM, idempoten.

Aturan:
- SLA_EXCEEDED (lost): belum terkirim dan sudah melewati sla_deadline + toleransi.
- BUYER_REPORTED_DAMAGE (damaged): terkirim dan laporan pembeli menyebut kerusakan.
- RETURN_DISPUTE (return_fraud): diretur dan pembeli mengklaim isi kosong/tidak sesuai.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Anomaly, Shipment, utcnow
from app.services import audit

IN_TRANSIT = ("created", "picked_up", "in_transit", "out_for_delivery")
_DAMAGE = re.compile(r"\b(rusak|pecah|retak|penyok|patah|basah|sobek|robek|hancur)\b", re.IGNORECASE)
_DISPUTE = re.compile(r"\b(kosong|tidak sesuai|beda|berbeda|kurang|hilang isi|bukan barang)\b", re.IGNORECASE)


@dataclass(frozen=True)
class Flag:
    code: str
    case_type: str
    severity: str
    reason: dict


def evaluate(shipment: Shipment, now: datetime, grace_hours: int = 0) -> Flag | None:
    """Aturan murni; mudah diuji tanpa DB."""
    report = shipment.buyer_report or ""
    if shipment.status in IN_TRANSIT:
        deadline = shipment.sla_deadline + timedelta(hours=grace_hours)
        if now > deadline:
            late_h = (now - shipment.sla_deadline).total_seconds() / 3600
            days_late = round(late_h / 24, 1)
            last = shipment.tracking_events[-1] if shipment.tracking_events else None
            severity = "high" if days_late >= 3 else "medium" if days_late >= 1 else "low"
            summary = f"Melewati batas SLA {days_late:g} hari"
            if last:
                summary += f"; status terakhir '{last.status}' di {last.location}"
            return Flag("SLA_EXCEEDED", "lost", severity, {
                "summary": summary, "days_late": days_late,
                "sla_deadline": shipment.sla_deadline.isoformat(),
                "last_event_at": last.occurred_at.isoformat() if last else None,
            })
    if shipment.status == "delivered" and _DAMAGE.search(report):
        return Flag("BUYER_REPORTED_DAMAGE", "damaged", "medium", {
            "summary": "Pembeli melaporkan barang rusak", "matched": _DAMAGE.search(report).group(0),
        })
    if shipment.status == "returned" and _DISPUTE.search(report):
        return Flag("RETURN_DISPUTE", "return_fraud", "high", {
            "summary": "Pembeli mengklaim isi paket kosong/tidak sesuai; perlu dicocokkan dengan bukti packing",
            "matched": _DISPUTE.search(report).group(0),
        })
    return None


def scan(db: Session, *, now: datetime | None = None, grace_hours: int = 0,
         shipment_ids: list[str] | None = None) -> tuple[int, list[Anomaly]]:
    """Mengembalikan (jumlah resi dipindai, anomali baru)."""
    now = now or utcnow()
    stmt = select(Shipment).options(selectinload(Shipment.tracking_events))
    if shipment_ids:
        stmt = stmt.where(Shipment.id.in_(shipment_ids))
    shipments = db.scalars(stmt).all()
    existing = {
        (a.shipment_id, a.code)
        for a in db.scalars(select(Anomaly).where(Anomaly.status != "resolved"))
    }
    created: list[Anomaly] = []
    for s in shipments:
        flag = evaluate(s, now, grace_hours)
        if flag is None or (s.id, flag.code) in existing:
            continue
        a = Anomaly(shipment_id=s.id, code=flag.code, case_type=flag.case_type,
                    severity=flag.severity, reason_json=flag.reason, detected_at=now)
        db.add(a)
        created.append(a)
    db.flush()
    for a in created:
        audit.record(db, actor="agent:monitoring", action="anomaly_flagged", entity="anomaly",
                     entity_id=a.id, payload={"code": a.code, "shipment_id": a.shipment_id})
    return len(shipments), created
