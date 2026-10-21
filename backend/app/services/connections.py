"""Status koneksi marketplace & drif jam kamera (Pengaturan > Koneksi dan sumber data).

Koneksi marketplace default-nya dari config; nilai terbaru disimpan di `settings` runtime
(`shopee_connected`, `tiktok_shop_connected`). Drif kamera dihitung dari selisih
`pack_scan_logs.scanned_at` dengan `media_assets.recorded_start`.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MediaAsset, PackScanLog
from app.schemas.ops import CameraTimeDrift, MarketplaceOut
from app.services.settings_service import RuntimeSettings

WIB = UTC
DRIFT_WARN_SEC = 3.0


def _label(source: str) -> str:
    return {"local": "Berkas lokal"}.get(source, source.upper()) if source else "-"


def list_cameras(db: Session) -> list[CameraTimeDrift]:
    rows = db.execute(
        select(PackScanLog, MediaAsset)
        .join(MediaAsset, MediaAsset.id == PackScanLog.cctv_media_id)
        .order_by(PackScanLog.scanned_at.desc())
    ).all()
    seen: dict[str, CameraTimeDrift] = {}
    for scan, media in rows:
        if media.id in seen or media.recorded_start is None:
            continue
        # scanned_at - recorded_start = posisi barcode di dalam rekaman.
        drift = (scan.scanned_at - media.recorded_start).total_seconds()
        seen[media.id] = CameraTimeDrift(
            camera=media.id,
            label=media.description or "Kamera meja packing",
            source=_label(media.kind),
            drift_sec=round(drift, 2),
            calibrated_at=scan.scanned_at.isoformat(),
            status="perlu_kalibrasi" if abs(drift) > DRIFT_WARN_SEC else "ok",
        )
    return list(seen.values())


def marketplaces(settings: RuntimeSettings) -> list[MarketplaceOut]:
    return [
        MarketplaceOut(
            id="shopee", name="Shopee", kind="marketplace",
            connected=settings.shopee_connected, available=True,
            detail="Terhubung ke Shopee Open Platform" if settings.shopee_connected
            else "Akses Shopee Open Platform sedang diajukan",
        ),
        MarketplaceOut(
            id="tiktok_shop", name="TikTok Shop", kind="marketplace",
            connected=settings.tiktok_shop_connected, available=False,
            detail="Dalam pengembangan",
        ),
    ]


def now_iso() -> str:
    return datetime.now(UTC).isoformat()
