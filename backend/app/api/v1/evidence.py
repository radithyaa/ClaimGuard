from fastapi import APIRouter

from app.api.deps import DB
from app.core.config import get_settings
from app.core.errors import AppError, not_found
from app.repositories import investigations as inv_repo
from app.schemas.claim import MediaUrlOut
from app.schemas.common import ERROR_RESPONSES
from app.services import storage_service

router = APIRouter(tags=["evidence"], responses=ERROR_RESPONSES)


@router.get("/evidence/{evidence_id}/media", response_model=MediaUrlOut)
def evidence_media(evidence_id: str, db: DB) -> MediaUrlOut:
    """URL pemutar: signed URL GCS (Range ditangani GCS) atau /media lokal."""
    ev = inv_repo.get_evidence(db, evidence_id)
    if ev is None:
        raise not_found("Bukti")
    try:
        url = storage_service.get_storage().public_url(ev.uri)
    except storage_service.StorageError as exc:
        raise AppError(404, "media_unavailable", str(exc)) from exc
    s = get_settings()
    return MediaUrlOut(evidence_id=ev.id, kind=ev.kind, url=url,
                       expires_in=s.signed_url_ttl_sec if s.storage_backend == "gcs" else None)
