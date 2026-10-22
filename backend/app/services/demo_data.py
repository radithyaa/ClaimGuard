"""Seed & reset data demo dari data/mock (FR-01, FR-17, FR-21). Idempoten dan deterministik.

Reset menghapus data transaksi (resi, investigasi, klaim, audit) tetapi mempertahankan
`courier_policies` dan `settings`, sehingga ekstraksi kebijakan tidak diulang setiap demo.

Media: rekaman ditaruh manual di `sample_media_dir` (default `data/samples/<file>`). Saat seed,
berkas yang ada disalin ke storage, durasinya diukur ulang dengan FFmpeg, dan `duration_sec` di
JSON hanya dipakai bila video belum tersedia (mode `--synthetic`) sehingga waktu scan packing
tidak pernah jatuh di luar rentang rekaman.
"""

import json
import logging
import re
import subprocess
from dataclasses import dataclass
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
SCENARIOS = ("lost", "damaged", "needs_evidence", "wrong_item_seller")
# urutan hapus mengikuti foreign key
_RESET_ORDER = (InvestigationEvent, Evidence, Claim, Investigation, Anomaly, PackScanLog,
                TrackingEvent, MediaAsset, Shipment, AuditLog)

# Ekstensi berkas video dasar yang dibuang saat mencocokkan nama file.
_VIDEO_EXT = re.compile(r"\.(mp4|mov|m4v|webm|mkv)$", re.IGNORECASE)


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value)


def mock_manifest_path() -> Path:
    return Path(get_settings().mock_data_dir) / "shipments.json"


def mock_revision() -> str:
    """Sidik jari berkas manifest (mtime+ukuran): berubah saat `shipments.json` diganti."""
    st = mock_manifest_path().stat()
    return f"{st.st_mtime_ns}:{st.st_size}"


@lru_cache
def _load_mock_cached(key: tuple[str, str]) -> dict[str, Any]:
    return json.loads(Path(key[0]).read_text(encoding="utf-8"))


def load_mock() -> dict[str, Any]:
    """Manifest demo, dibaca ulang bila berkasnya berubah.

    Cache dikunci pada path + mtime/ukuran, bukan sekali per proses: container Cloud Run dengan
    `min-instances=1` tidak restart saat `POST /demo/reseed`, sehingga cache permanen membuat seed
    ulang tetap memakai data lama sampai instance didaur ulang.
    """
    path = mock_manifest_path()
    return _load_mock_cached((str(path.resolve()), mock_revision()))


def scenario_tracking_number(name: str) -> str:
    for s in load_mock()["shipments"]:
        if s.get("scenario") == name:
            return s["tracking_number"]
    raise KeyError(name)


def media_uri(file: str) -> str:
    """URI media sampel: `local://samples/<file>` atau `gs://<bucket>/samples/<file>`."""
    s = get_settings()
    key = f"samples/{Path(file).name}"  # hanya nama berkas: tolak path absolut / ".." dari JSON
    if s.storage_backend == "gcs":  # sampel diunggah sekali: gcloud storage cp data/samples/* gs://BUCKET/samples/
        return f"gs://{s.gcs_bucket}/{key}"
    return f"local://{key}"


def _synthesize(path: Path, duration: float) -> None:
    """Video uji (pola warna) untuk dev lokal bila rekaman asli belum ada."""
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [video_service.ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", f"testsrc=duration={duration}:size=640x360:rate=10", "-c:v", "libx264",
         "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)],
        check=True, timeout=120,
    )


def _duration(path: Path) -> float | None:
    """Durasi sebenarnya dari berkas video; None bila FFmpeg tidak bisa membacanya."""
    try:
        return round(video_service.probe_duration_sync(path), 3)
    except (OSError, subprocess.SubprocessError, video_service.VideoError) as exc:
        log.warning("durasi %s tidak terbaca: %s", path.name, exc)
        return None

def find_sample(directory: Path, file: str) -> Path | None:
    """Cari berkas rekaman di `directory`, toleran terhadap nama case/ekstensi.

    `cctv_packing_01.mp4` juga cocok dengan `CCTV_Packing_01.MOV`, `cctv_packing_01.mkv`, dst.
    Mengembalikan None bila tidak ada (atau bila ada lebih dari satu kandidat — ambigu).
    """
    if not directory.is_dir():
        return None
    wanted = _VIDEO_EXT.sub("", Path(file).name).lower()
    matches = [
        p for p in directory.iterdir()
        if p.is_file() and not p.name.startswith(".") and _VIDEO_EXT.search(p.name)
        and _VIDEO_EXT.sub("", p.stem).lower() == wanted
    ]
    if len(matches) > 1:
        log.warning("nama rekaman ambigu untuk %s: %s", file,
                    ", ".join(sorted(p.name for p in matches)))
        return None
    return matches[0] if matches else None


@dataclass(frozen=True)
class MediaPlan:
    """Rencana satu aset media: berkas sumber (bila ada) dan durasi yang akan disimpan."""

    file: str
    source: Path | None
    duration_sec: float | None


def plan_media(media: list[dict], *, synthetic: bool, samples_dir: Path | None = None) -> list[MediaPlan]:
    """Tentukan berkas sumber & durasi tiap media tanpa menyentuh storage atau DB."""
    s = get_settings()
    directory = samples_dir or Path(s.sample_media_dir)
    plans = []
    for m in media:
        src = find_sample(directory, m["file"])
        if src is None and synthetic:
            src = directory / m["file"]
            if not src.exists():
                _synthesize(src, m.get("duration_sec", 30))
        plans.append(MediaPlan(m["file"], src, m.get("duration_sec")))
    return plans


def _prepare_local_media(
    media: list[dict], synthetic: bool
) -> tuple[list[MediaPlan], list[str]]:
    """Salin rekaman ke storage lokal dan ukur durasinya.

    Mengembalikan (rencana per media, nama file yang belum tersedia). Bila storage lokal
    sudah punya berkas dari seed sebelumnya, berkas itu dipakai sebagai sumber walau
    `data/samples` kosong.
    """
    s = get_settings()
    if s.storage_backend != "local":
        return [MediaPlan(m["file"], None, m.get("duration_sec")) for m in media], []
    storage = storage_service.get_storage()
    stored_dir = Path(s.storage_local_root) / "samples"
    plans: list[MediaPlan] = []
    missing: list[str] = []
    for plan in plan_media(media, synthetic=synthetic):
        src = plan.source
        if src is None:
            existing = stored_dir / Path(plan.file).name
            src = existing if existing.exists() else None
        if src is None:
            missing.append(plan.file)
            plans.append(plan)
            continue
        stored = Path(storage.ffmpeg_input(storage.put_file(src, f"samples/{Path(plan.file).name}")))
        measured = _duration(stored)
        plans.append(MediaPlan(plan.file, src, measured or plan.duration_sec))
    return plans, missing


def reset_and_seed(db: Session, *, synthetic_media: bool = False) -> dict[str, Any]:
    data = load_mock()
    for model in _RESET_ORDER:
        db.execute(delete(model))
    plans, missing = _prepare_local_media(data["media"], synthetic_media)
    duration_by_file = {p.file: p.duration_sec for p in plans}

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
            kind=m["kind"], uri=media_uri(m["file"]),
            recorded_start=_ts(m["recorded_start"]) if m.get("recorded_start") else None,
            duration_sec=duration_by_file.get(m["file"], m.get("duration_sec")),
            shipment_id=owner.id if owner else None,
            description=m.get("description", ""),
        )
        db.add(asset)
        db.flush()
        media_ids[m["key"]] = asset.id

    for row in data["shipments"]:
        ship = by_tracking[row["tracking_number"]]
        if scan := row.get("pack_scan"):
            db.add(PackScanLog(shipment_id=ship.id, scanned_at=_ts(scan["scanned_at"]),
                               cctv_media_id=media_ids.get(scan.get("cctv", "")),
                               packed_items_json=list(scan.get("packed_items") or [])))
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
