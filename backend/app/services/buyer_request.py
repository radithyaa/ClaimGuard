"""Draf permintaan bukti ke pembeli (F6) untuk investigasi berakhir `needs_evidence`.

Draf disusun deterministik dari keputusan Evaluator (`missing_evidence`), syarat bukti kurir,
dan tenggat klaim. Sistem TIDAK mengirim apa pun: admin menyalin/mengedit pesan, lalu
menandainya terkirim, dan tindakan itu tercatat di audit log.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import conflict, not_found
from app.models import Investigation, InvestigationEvent, Shipment
from app.repositories import investigations as inv_repo
from app.repositories import policies as policy_repo
from app.services import audit
from app.services.deadlines import claim_deadline, window_days_by_courier

WIB = ZoneInfo("Asia/Jakarta")
COURIER_LABEL = {"jne": "JNE", "jnt": "J&T", "sicepat": "SiCepat"}
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")


def _fmt_date(ts: datetime) -> str:
    local = ts.astimezone(WIB)
    return f"{local.day} {_MONTHS[local.month - 1]} {local.year}"


def _missing_evidence(db: Session, inv: Investigation) -> list[str]:
    event = db.scalar(
        select(InvestigationEvent)
        .where(InvestigationEvent.investigation_id == inv.id, InvestigationEvent.type == "decision")
        .order_by(InvestigationEvent.seq.desc())
    )
    items = (event.payload_json.get("missing_evidence") if event else None) or []
    return [str(i).strip() for i in items if str(i).strip()]


def build(db: Session, investigation_id: str) -> dict:
    inv = inv_repo.get(db, investigation_id)
    if inv is None:
        raise not_found("Investigasi")
    if inv.outcome != "needs_evidence":
        raise conflict("invalid_status", "Permintaan bukti hanya untuk investigasi yang butuh bukti tambahan")
    shipment = db.get(Shipment, inv.shipment_id)
    policy = policy_repo.get_by_courier(db, shipment.courier)
    courier = COURIER_LABEL.get(shipment.courier, shipment.courier)

    missing = _missing_evidence(db, inv)
    if not missing and policy:
        missing = list(policy.required_docs_json)  # cadangan: minta seluruh bukti wajib kurir
    if not missing:
        missing = ["video unboxing utuh tanpa jeda", "foto kemasan luar"]

    deadline = claim_deadline(shipment, window_days_by_courier(db))
    lines = [
        "Halo Kak, terima kasih sudah menghubungi kami.",
        "",
        (f"Agar kami dapat menindaklanjuti pesanan dengan nomor resi {shipment.tracking_number} "
        f"({shipment.item_name}) ke {courier}, mohon bantuan Kakak mengirimkan:"),
        *[f"- {item}" for item in missing],
        "",
    ]
    if deadline:
        lines.append(f"Mohon dikirim paling lambat {_fmt_date(deadline)}, karena batas pengajuan "
                     f"klaim ke {courier} berakhir pada tanggal tersebut.")
    lines += [
        ("Bila merekam video, mulai dari sebelum segel dibuka sampai isi paket terlihat jelas, "
        "tanpa dipotong."),
        "",
        "Terima kasih atas bantuannya.",
    ]
    return {
        "investigation_id": inv.id, "tracking_number": shipment.tracking_number,
        "courier": shipment.courier, "missing_evidence": missing,
        "deadline": deadline, "message": "\n".join(lines),
    }


def mark_sent(db: Session, investigation_id: str, message: str, actor: str) -> dict:
    data = build(db, investigation_id)  # validasi status sama dengan saat membuat draf
    audit.record(db, actor=actor, action="buyer_evidence_requested", entity="investigation",
                 entity_id=investigation_id,
                 payload={"tracking_number": data["tracking_number"],
                          "missing_evidence": data["missing_evidence"], "length": len(message)})
    return {"status": "recorded"}
