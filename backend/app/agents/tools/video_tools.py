"""Tool clip_cctv_video (FR-03). Agen hanya memberi shipment_id; video sumber dicari dari DB."""

import tempfile
from datetime import timedelta
from pathlib import Path
from typing import Any

from app.agents.tools._common import ToolContext, state_value, tool_error
from app.core.config import get_settings
from app.db.session import session_scope
from app.repositories import investigations as inv_repo
from app.repositories import shipments as ship_repo
from app.services import storage_service, video_service
from app.services.storage_service import StorageError


async def clip_cctv_for_shipment(
    shipment_id: str, investigation_id: str, pre_sec: float, post_sec: float
) -> dict[str, Any]:
    s = get_settings()
    pre = min(max(pre_sec, 0), s.clip_max_sec)
    post = min(max(post_sec, 0), s.clip_max_sec)
    if pre + post < s.clip_min_sec:
        post = s.clip_min_sec - pre
    if pre + post > s.clip_max_sec:
        return tool_error("clip_too_long", f"pre_sec + post_sec maksimal {s.clip_max_sec} detik")

    # Baca semua yang dibutuhkan lalu tutup sesi: jangan tahan koneksi DB selama ffmpeg
    with session_scope() as db:
        shipment = ship_repo.get(db, shipment_id)
        if shipment is None:
            return tool_error("shipment_not_found", f"resi {shipment_id} tidak ditemukan")
        scan = ship_repo.get_pack_scan(db, shipment_id)
        if scan is None or scan.cctv_media_id is None:
            return tool_error("no_pack_scan", "tidak ada log scan packing dengan rekaman CCTV")
        media = ship_repo.get_media(db, scan.cctv_media_id)
        if media is None or media.recorded_start is None or media.duration_sec is None:
            return tool_error("cctv_unavailable", "metadata rekaman CCTV tidak lengkap")
        scan_at, rec_start, rec_dur = scan.scanned_at, media.recorded_start, media.duration_sec
        media_id, media_uri = media.id, media.uri

    offset = (scan_at - rec_start).total_seconds()
    if not 0 <= offset <= rec_dur:
        return tool_error(
            "scan_outside_recording", "waktu scan packing berada di luar rentang rekaman CCTV"
        )
    start = max(0.0, offset - pre)
    end = min(rec_dur, offset + post)

    storage = storage_service.get_storage()
    with tempfile.TemporaryDirectory(prefix="clip_") as tmp:
        out = Path(tmp) / "clip.mp4"
        try:
            result = await video_service.clip(storage.ffmpeg_input(media_uri), start, end - start,
                                              out)
            key = f"clips/{investigation_id}/cctv_{int(start)}_{int(end)}.mp4"
            uri = storage.put_file(result.path, key)
        except (video_service.VideoError, StorageError) as exc:
            return tool_error("clip_failed", str(exc))

    with session_scope() as db:
        evidence = inv_repo.add_evidence(
            db, investigation_id=investigation_id, kind="cctv_clip", uri=uri,
            source_media_id=media_id, clip_start_sec=start, clip_duration_sec=end - start,
        )
        evidence_id = evidence.id

    return {
        "status": "ok",
        "evidence_id": evidence_id,
        "clip_start_utc": (rec_start + timedelta(seconds=start)).isoformat(),
        "clip_end_utc": (rec_start + timedelta(seconds=end)).isoformat(),
        "duration_sec": round(end - start, 2),
        "pack_scan_utc": scan_at.isoformat(),
        "pack_scan_at_clip_sec": round(offset - start, 2),
    }


async def clip_cctv_video(
    shipment_id: str, pre_sec: int = 10, post_sec: int = 15, tool_context: ToolContext = None
) -> dict[str, Any]:
    """Memotong rekaman CCTV meja packing di sekitar waktu scan resi.

    Args:
        shipment_id: ID resi yang sedang diinvestigasi.
        pre_sec: Detik sebelum waktu scan yang ikut dipotong (0-30).
        post_sec: Detik setelah waktu scan yang ikut dipotong (0-30).

    Returns:
        evidence_id klip beserta rentang waktunya, atau error yang menjelaskan masalahnya.
    """
    investigation_id = state_value(tool_context, "investigation_id")
    if not investigation_id:
        return tool_error("no_investigation", "investigation_id tidak ada di state sesi")
    return await clip_cctv_for_shipment(shipment_id, investigation_id, pre_sec, post_sec)
