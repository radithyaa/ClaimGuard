"""Menerima berkas rekaman (video unboxing pembeli) sebagai bukti satu resi.

Alurnya sengaja ketat: berkas harus benar-benar bisa didekode FFmpeg, resi harus ada, dan
`kind`/`shipment_id` dicatat supaya `analyze_media` bisa merujuknya. CCTV gudang tidak lewat
sini karena CCTV dipotong relatif terhadap `pack_scan_logs`, bukan diunggah per resi.
"""

from __future__ import annotations

import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Evidence, MediaAsset, Shipment
from app.services import audit, storage_service, video_service

MAX_BYTES = 100 * 1024 * 1024
KINDS = {"unboxing": "video/mp4", "photo": "image/jpeg"}


def _parse_dt(raw: str) -> datetime:
    # Python 3.11+ menerima akhiran "Z"
    value = datetime.fromisoformat(raw)
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


async def ingest(
    db: Session,
    actor: str,
    file,
    *,
    shipment_tracking: str | None,
    recorded_start: str | None = None,
    origin_sec: float = 0.0,
    replace: bool = True,
) -> dict[str, Any]:
    filename = Path(file.filename or "rekaman.mp4").name
    content_type = (file.content_type or "").lower()
    kind = "photo" if content_type.startswith("image/") else "unboxing"
    if kind == "photo":
        raise ValueError("unggahan foto belum didukung; gunakan video unboxing (.mp4/.mov)")
    if not shipment_tracking:
        raise ValueError("parameter `shipment` (nomor resi) wajib diisi")

    shipment = db.scalar(select(Shipment).where(Shipment.tracking_number == shipment_tracking))
    if shipment is None:
        raise ValueError(f"resi {shipment_tracking} tidak ditemukan")

    data = await file.read()
    if not data:
        raise ValueError("berkas kosong")
    if len(data) > MAX_BYTES:
        raise ValueError("berkas melebihi 100 MB; kompres video sebelum diunggah")

    storage = storage_service.get_storage()
    with tempfile.TemporaryDirectory(prefix="upload_") as tmp:
        src = Path(tmp) / filename
        src.write_bytes(data)
        try:
            duration = round(video_service.probe_duration_sync(src), 3)
        except (video_service.VideoError, OSError) as exc:
            raise ValueError(
                f"berkas tidak dapat dibaca sebagai video: {exc}"
            ) from exc
        key = f"samples/{shipment.id}_{filename}"
        uri = storage.put_file(src, key)

    # `replace`: rekaman lama untuk resi + jenis yang sama diganti. Saat unggah ulang, URI-nya
    # identik (kunci berkas sama) — tetap hapus barisnya, cukup lindungi berkasnya dari delete.
    for old in db.scalars(select(MediaAsset).where(MediaAsset.shipment_id == shipment.id,
                                                    MediaAsset.kind == kind)).all():
        if replace and old.uri != uri:
            try:
                storage.delete(old.uri)
            except (OSError, storage_service.StorageError):
                pass  # berkas boleh sudah hilang; barisnya tetap diganti
        # Bukti yang merujuk media lama (investigasi sebelumnya) ikut dibuang: URI-nya
        # sudah tidak ada, dan media_assets dirujuk oleh evidence.source_media_id.
        db.execute(delete(Evidence).where(Evidence.source_media_id == old.id))
        # delete() eksplisit, bukan db.delete(): autflush (dipicu atribut/Mapper) bisa
        # mengembalikan entity ORM yang sudah ditandai hapus, sehingga barisnya tidak hilang.
        db.execute(delete(MediaAsset).where(MediaAsset.id == old.id))

    asset = MediaAsset(
        kind=kind, uri=uri, duration_sec=duration,
        recorded_start=_parse_dt(recorded_start) if recorded_start else None,
        shipment_id=shipment.id,
        description=f"Video unboxing pembeli (unggahan, asal detik {origin_sec:g})",
    )
    db.add(asset)
    db.flush()
    audit.record(db, actor=actor, action="media_uploaded", entity="media", entity_id=asset.id,
                 payload={"tracking_number": shipment_tracking, "kind": kind, "file": filename,
                          "duration_sec": duration, "origin_sec": origin_sec})
    db.commit()
    return {"media_id": asset.id, "kind": kind, "duration_sec": duration,
            "tracking_number": shipment_tracking, "uri": uri, "origin_sec": origin_sec}
