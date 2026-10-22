"""Endpoint operasional untuk tab "Sistem > Pengaturan".

- `POST /shipments/import` + `GET /shipments/import/template` (Koneksi dan sumber data)
- `POST /media` (unggah rekaman unboxing untuk satu resi)
- `POST /demo/reseed` (seed ulang setelah rekaman baru ditaruh di data/samples)
- `GET /connections`, `PATCH /connections/{id}` (status marketplace & drif kamera)
- `DELETE /investigations/{id}`, `POST /investigations/purge` (Privasi dan data)

Semua endpoint tulis memerlukan sesi login (`User`) dan menulis audit log.
"""

import logging
from datetime import timedelta

from fastapi import APIRouter, Query, Response, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import DB, User
from app.core.errors import AppError, conflict, not_found
from app.db.session import session_scope
from app.models import (
    Anomaly,
    Claim,
    Evidence,
    Investigation,
    InvestigationEvent,
    MediaAsset,
    PackScanLog,
    utcnow,
)
from app.repositories import investigations as inv_repo
from app.schemas.common import ERROR_RESPONSES
from app.schemas.ops import (
    ConnectIn,
    ConnectionResultOut,
    ConnectionsOut,
    CsvImportOut,
    DeleteInvestigationOut,
    PurgeResultOut,
)
from app.services import (
    audit,
    connections,
    csv_import,
    investigation_runner,
    seed_service,
    storage_service,
)
from app.services.settings_service import RuntimeSettingsPatch, get_runtime, update_runtime

log = logging.getLogger(__name__)

router = APIRouter(tags=["ops"], responses=ERROR_RESPONSES)

_CONNECTION_FIELDS = {"shopee": "shopee_connected", "tiktok_shop": "tiktok_shop_connected"}


# ---------- impor CSV resi ----------

@router.post("/shipments/import", response_model=CsvImportOut)
async def import_shipments(db: DB, user: User, file: UploadFile) -> CsvImportOut:
    filename = file.filename or "upload.csv"
    try:
        report = csv_import.import_csv(db, await file.read(), filename=filename, actor=user)
    except ValueError as exc:
        raise AppError(422, "invalid_csv", str(exc)) from exc
    db.commit()
    return CsvImportOut(imported=report.imported, updated=report.updated,
                        skipped=report.skipped, errors=report.errors, filename=filename)


@router.get("/shipments/import/template")
def import_template() -> Response:
    return Response(
        content=csv_import.TEMPLATE,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="templat-resi-claimguard.csv"'},
    )


# ---------- media rekaman demo ----------

@router.post("/media")
async def upload_media(db: DB, user: User, file: UploadFile,
                       shipment: str | None = Query(default=None),
                       recorded_start: str | None = Query(default=None),
                       origin_sec: float = Query(default=0, ge=0),
                       replace: bool = Query(default=True),
                       ) -> dict:
    """Unggah rekaman ke storage sebagai bukti untuk satu resi.

    - `shipment`: nomor resi pemilik rekaman (wajib untuk `kind=unboxing`).
    - `origin_sec`: detik pertama yang benar-benar terekam di berkas. Bila rekaman memotong
      bagian awal, isi detik asal adegan agar stempel waktu AI tetap cocok.

    Rekaman CCTV gudang tidak diunggah lewat sini: CCTV dipotong lewat `pack_scan_logs`,
    jadi cukup taruh berkasnya di `data/samples/` lalu jalankan seed.
    """
    from app.services import media_ingest

    try:
        return await media_ingest.ingest(
            db, user, file, shipment_tracking=shipment, recorded_start=recorded_start,
            origin_sec=origin_sec, replace=replace,
        )
    except ValueError as exc:
        raise AppError(422, "invalid_media", str(exc)) from exc
    except storage_service.StorageError as exc:
        raise AppError(503, "storage_unavailable", str(exc)) from exc


@router.post("/demo/reseed")
async def reseed_demo(user: User) -> dict:
    """Seed ulang resi & media tanpa menghapus kebijakan kurir (setara `python data/seed.py`).

    Dipakai setelah rekaman baru ditaruh di `data/samples/`, agar durasi dan cache analisis
    diperbarui tanpa menekan tombol reset di UI.
    """
    await investigation_runner.cancel_all()
    with session_scope() as db:
        return await seed_service.seed_report(db, actor=user, action="demo_seeded")


# ---------- koneksi & kamera ----------

@router.get("/connections", response_model=ConnectionsOut)
def read_connections(db: DB) -> ConnectionsOut:
    return ConnectionsOut(marketplaces=connections.marketplaces(get_runtime(db)),
                          cameras=connections.list_cameras(db))


@router.patch("/connections/{connection_id}", response_model=ConnectionResultOut)
def patch_connection(connection_id: str, body: ConnectIn, db: DB,
                     user: User) -> ConnectionResultOut:
    field = _CONNECTION_FIELDS.get(connection_id)
    if field is None:
        raise not_found("Koneksi")
    item = next(m for m in connections.marketplaces(get_runtime(db)) if m.id == connection_id)
    if body.connected and not item.available:
        raise conflict("not_available", f"{item.name} belum tersedia pada demo ini")
    update_runtime(db, RuntimeSettingsPatch(**{field: body.connected}))
    audit.record(db, actor=user, action="connection_updated", entity="connection",
                 entity_id=connection_id, payload={"connected": body.connected})
    db.commit()
    return ConnectionResultOut(
        id=connection_id, connected=body.connected,
        detail=f"{item.name} {'terhubung' if body.connected else 'diputuskan'}",
    )


# ---------- hapus data investigasi ----------

def _remove_media(db: Session, uri: str) -> None:
    """Hapus berkas media lalu baris yang merujuknya (evidence -> media_assets)."""
    try:
        storage_service.get_storage().delete(uri)
    except (OSError, storage_service.StorageError):  # berkas boleh sudah hilang
        log.warning("media %s tidak dapat dihapus dari storage", uri)
    db.execute(delete(Evidence).where(Evidence.uri == uri))
    for media in db.scalars(select(MediaAsset).where(MediaAsset.uri == uri)):
        db.execute(delete(PackScanLog).where(PackScanLog.cctv_media_id == media.id))
        db.delete(media)


def _delete_investigations(db: Session, investigations: list[Investigation]) -> dict[str, int]:
    """Menghapus investigasi beserta event, klaim, bukti, dan anomali terkait."""
    ids = [i.id for i in investigations]
    if not ids:
        return {"evidence": 0, "events": 0, "claims": 0}
    evidence = db.scalars(select(Evidence).where(Evidence.investigation_id.in_(ids))).all()
    for ev in evidence:
        _remove_media(db, ev.uri)
    events = db.execute(delete(InvestigationEvent)
                        .where(InvestigationEvent.investigation_id.in_(ids))).rowcount or 0
    claims = db.execute(delete(Claim).where(Claim.investigation_id.in_(ids))).rowcount or 0
    anomaly_ids = [i.anomaly_id for i in investigations if i.anomaly_id]
    db.execute(delete(Investigation).where(Investigation.id.in_(ids)))
    db.flush()  # anomali masih direferensikan investigasi yang dihapus di sesi ini
    if anomaly_ids:
        db.execute(delete(Anomaly).where(Anomaly.id.in_(anomaly_ids)))
    db.flush()
    return {"evidence": len(evidence), "events": events, "claims": claims}


@router.delete("/investigations/{investigation_id}", response_model=DeleteInvestigationOut)
def delete_investigation(investigation_id: str, db: DB, user: User) -> DeleteInvestigationOut:
    inv = inv_repo.get(db, investigation_id)
    if inv is None:
        raise not_found("Investigasi")
    if investigation_runner.is_active(inv.id):
        raise conflict("investigation_running", "Hentikan investigasi sebelum menghapus datanya")
    deleted = _delete_investigations(db, [inv])
    audit.record(db, actor=user, action="investigation_deleted", entity="investigation",
                 entity_id=investigation_id, payload=deleted)
    db.commit()
    return DeleteInvestigationOut(id=investigation_id, deleted_evidence=deleted["evidence"],
                                  deleted_events=deleted["events"])


@router.post("/investigations/purge", response_model=PurgeResultOut)
def purge_investigations(db: DB, user: User,
                         older_than_days: int = Query(default=30, ge=1, le=365)
                         ) -> PurgeResultOut:
    """Menghapus investigasi terminal yang lebih tua dari `older_than_days`."""
    cutoff = utcnow() - timedelta(days=older_than_days)
    stale = list(db.scalars(
        select(Investigation).where(Investigation.status.in_(inv_repo.TERMINAL_STATUSES),
                                    Investigation.started_at < cutoff)
    ))
    ids = [i.id for i in stale]
    skipped = [i for i in ids if investigation_runner.is_active(i)]
    targets = [i for i in stale if i.id not in skipped]
    deleted = _delete_investigations(db, targets)
    audit.record(db, actor=user, action="investigation_purged", entity="investigation",
                 payload={"older_than_days": older_than_days, "deleted": len(targets), **deleted})
    db.commit()
    return PurgeResultOut(deleted=len(targets), media_deleted=deleted["evidence"],
                          skipped_active=skipped)
