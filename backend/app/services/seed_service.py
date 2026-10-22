"""Penyiapan data demo sekali jalan (dipakai seed CLI dan endpoint ops)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import utcnow
from app.services import audit, demo_data


async def seed_report(
    db: Session, *, synthetic_media: bool = False, actor: str = "system",
    action: str = "demo_seeded",
) -> dict[str, Any]:
    """Reset + seed resi/media, lengkapi kebijakan kurir, lalu catat audit.

    `shipments.json` memakai waktu tetap (Oktober 2026), sedangkan aturan SLA membandingkan
    dengan jam sekarang. Bila hari ini sudah lewat 30 hari setelah tanggal demo, seluruh resi
    akan tampak tertahan dan skenario demo tidak lagi bisa diperagakan — beri peringatan
    eksplisit alih-alih gagal diam-diam.
    """
    report = demo_data.reset_and_seed(db, synthetic_media=synthetic_media)
    report["policies"] = await demo_data.ensure_policies(db)
    audit.record(db, actor=actor, action=action, entity="demo", payload=report)
    db.commit()

    latest = max((datetime.fromisoformat(r["sla_deadline"]) for r in demo_data.load_mock()["shipments"]),
                 default=None)
    if latest is not None and (utcnow() - latest).days > 30:
        report["freshness_warning"] = (
            f"Data demo bertanggal {latest.date():%d %b %Y}, sudah lewat {(utcnow() - latest).days} hari. "
            "Semua resi akan tampak melewati SLA; perbarui tanggal di data/mock/shipments.json."
        )
    return report
