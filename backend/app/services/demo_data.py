"""Seed & reset data demo dari data/mock (FR-01, FR-17, FR-21). Idempoten dan deterministik.

Reset menghapus data transaksi (resi, investigasi, klaim, audit) tetapi mempertahankan
`courier_policies` dan `settings`, sehingga ekstraksi kebijakan tidak diulang setiap demo.
"""

import json
import logging
import subprocess
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    Anomaly,
    AuditLog,
    Claim,
    CourierPolicy,
    Evidence,
    Investigation,
    InvestigationEvent,
    MediaAsset,
    PackScanLog,
    Shipment,
    TrackingEvent,
)
from app.repositories import policies as policy_repo
from app.services import policy_extractor, storage_service, video_service
from app.services.settings_service import ensure_thresholds

log = logging.getLogger(__name__)
SCENARIOS = ("lost", "damaged", "return_fraud", "wrong_item_seller")
# urutan hapus mengikuti foreign key
_RESET_ORDER = (InvestigationEvent, Evidence, Claim, Investigation, Anomaly, PackScanLog,
                TrackingEvent, MediaAsset, Shipment, AuditLog)


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value)


@lru_cache
def load_mock() -> dict[str, Any]:
    path = Path(get_settings().mock_data_dir) / "shipments.json"
    return json.loads(path.read_text(encoding="utf-8"))


def scenario_tracking_number(name: str) -> str:
    for s in load_mock()["shipments"]:
        if s.get("scenario") == name:
            return s["tracking_number"]
    raise KeyError(name)


def _media_uri(file: str) -> str:
    s = get_settings()
    key = f"samples/{file}"
    if s.storage_backend == "gcs":  # sampel diunggah sekali: gcloud storage cp data/samples/* gs://BUCKET/samples/
        return f"gs://{s.gcs_bucket}/{key}"
    return f"local://{key}"


def _synthesize(path: Path, duration: float) -> None:
    """Video uji (pola warna + jam) untuk dev lokal bila rekaman asli belum ada."""
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [video_service.ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", f"testsrc=duration={duration}:size=640x360:rate=10", "-c:v", "libx264",
         "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)],
        check=True, timeout=120,
    )


def _prepare_local_media(media: list[dict], synthetic: bool) -> list[str]:
    """Menyalin data/samples/* ke storage lokal. Mengembalikan nama file yang tidak tersedia."""
    s = get_settings()
    if s.storage_backend != "local":
        return []
    storage = storage_service.get_storage()
    missing = []
    for m in media:
        src = Path(s.sample_media_dir) / m["file"]
        if not src.exists() and synthetic:
            _synthesize(src, m.get("duration_sec", 30))
        if src.exists():
            storage.put_file(src, f"samples/{m['file']}")
        elif not (Path(s.storage_local_root) / "samples" / m["file"]).exists():
            missing.append(m["file"])
    return missing


def reset_and_seed(db: Session, *, synthetic_media: bool = False) -> dict[str, Any]:
    data = load_mock()
    for model in _RESET_ORDER:
        db.execute(delete(model))
    missing = _prepare_local_media(data["media"], synthetic_media)

    by_tracking: dict[str, Shipment] = {}
    for row in data["shipments"]:
        ship = Shipment(
            tracking_number=row["tracking_number"], courier=row["courier"], status=row["status"],
            origin=row["origin"], destination=row["destination"],
            shipped_at=_ts(row["shipped_at"]), sla_deadline=_ts(row["sla_deadline"]),
            item_name=row["item_name"], item_value=row["item_value"],
            buyer_report=row.get("buyer_report"), is_simulated=True,
        )
        db.add(ship)
        db.flush()  # perlu id untuk tracking_events
        by_tracking[ship.tracking_number] = ship
        for e in row.get("tracking_events", []):
            db.add(TrackingEvent(shipment_id=ship.id, status=e["status"], location=e["location"],
                                 occurred_at=_ts(e["occurred_at"])))
    db.flush()

    media_ids: dict[str, str] = {}
    for m in data["media"]:
        owner = by_tracking.get(m.get("shipment", ""))
        asset = MediaAsset(
            kind=m["kind"], uri=_media_uri(m["file"]),
            recorded_start=_ts(m["recorded_start"]) if m.get("recorded_start") else None,
            duration_sec=m.get("duration_sec"), shipment_id=owner.id if owner else None,
            description=m.get("description", ""),
        )
        db.add(asset)
        db.flush()
        media_ids[m["key"]] = asset.id

    for row in data["shipments"]:
        ship = by_tracking[row["tracking_number"]]
        if scan := row.get("pack_scan"):
            db.add(PackScanLog(shipment_id=ship.id, scanned_at=_ts(scan["scanned_at"]),
                               cctv_media_id=media_ids.get(scan.get("cctv", ""))))
    db.flush()
    thresholds = ensure_thresholds(db)
    if missing:
        log.warning("media sampel belum ada: %s", ", ".join(missing))
    return {"shipments": len(by_tracking), "media": len(media_ids), "missing_media": missing,
            "courier_thresholds": thresholds}


async def ensure_policies(db: Session) -> dict[str, str]:
    """Ekstraksi kebijakan kurir bila tabel masih kosong (AI live -> cache -> manual)."""
    if db.scalar(select(CourierPolicy.id).limit(1)):
        return {}
    policy_dir = Path(get_settings().mock_data_dir) / "courier_policies"
    report = await policy_extractor.extract_all(db, policy_dir)
    fallback = json.loads((policy_dir / "fallback.json").read_text(encoding="utf-8"))
    for courier, source in report.items():
        if source == "skipped" and (p := fallback.get(courier)):
            policy_repo.upsert(
                db, courier, claim_window_days=p["claim_window_days"],
                required_docs_json=p["required_docs"], max_compensation=p["max_compensation"],
                extra_json={"insurance_note": p["insurance_note"], "exclusions": p["exclusions"]},
                source_text=(policy_dir / f"{courier}.md").read_text(encoding="utf-8"),
                extraction_source="manual",
            )
            report[courier] = "manual"
    return report
