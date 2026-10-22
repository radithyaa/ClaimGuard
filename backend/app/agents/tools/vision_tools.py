"""Tool analyze_media (FR-04, FR-10, FR-21): Gemini multimodal dengan cache dan label sumber."""

from typing import Any

from app.agents.prompts import prompt_version, render
from app.agents.tools._common import ToolContext, state_value, tool_error
from app.db.session import session_scope
from app.models import Evidence
from app.repositories import investigations as inv_repo
from app.repositories import shipments as ship_repo
from app.schemas.agent_outputs import MediaFocus, VisionAnalysis
from app.services import ai_cache, gemini_client, storage_service
from app.services.storage_service import StorageError

MIME = {"cctv_clip": "video/mp4", "unboxing": "video/mp4", "cctv": "video/mp4", "photo": "image/jpeg"}
FOCUSES = ("packing", "damage", "consistency")


def _resolve_evidence(db, ref_id: str, investigation_id: str, shipment_id: str) -> Evidence | None:
    """ref_id boleh evidence_id (klip) atau media_id dari get_case_context (unboxing/foto).

    Media milik resi lain hanya bisa dirujuk bila media itu ikut muncul di `get_case_context`
    kasus ini (mis. rekaman CCTV sumber scan packing), supaya kasus A tidak bisa menganalisis
    bukti kasus B hanya dengan menebak id.
    """
    ev = inv_repo.get_evidence(db, ref_id)
    if ev is not None:
        return ev if ev.investigation_id == investigation_id else None
    media = ship_repo.get_media(db, ref_id)
    if media is None or media.kind == "cctv":
        return None  # rekaman CCTV mentah harus dipotong dulu lewat clip_cctv_video
    visible = {m.id for m in ship_repo.list_media_for_shipment(db, shipment_id)}
    if media.id not in visible:
        return None
    return inv_repo.add_evidence(
        db, investigation_id=investigation_id, kind=media.kind, uri=media.uri,
        source_media_id=media.id,
    )


def _media_part(uri: str, mime: str):
    from google.genai import types

    if uri.startswith("gs://"):
        return types.Part.from_uri(file_uri=uri, mime_type=mime)  # Vertex membaca GCS langsung
    return types.Part.from_bytes(data=storage_service.get_storage().read_bytes(uri), mime_type=mime)


async def analyze_media_for(
    ref_id: str, focus: str, investigation_id: str, shipment_id: str
) -> dict[str, Any]:
    if focus not in FOCUSES:
        return tool_error("invalid_focus", f"focus harus salah satu dari {', '.join(FOCUSES)}")

    with session_scope() as db:
        ev = _resolve_evidence(db, ref_id, investigation_id, shipment_id)
        if ev is None:
            return tool_error("evidence_not_found", f"bukti {ref_id} tidak ditemukan untuk kasus ini")
        shipment = ship_repo.get(db, shipment_id)
        source = ship_repo.get_media(db, ev.source_media_id) if ev.source_media_id else None
        ev_id, ev_kind, ev_uri = ev.id, ev.kind, ev.uri
        # Kunci cache stabil lintas seed/reset: URI media sumber + rentang klip, bukan UUID
        key = ai_cache.cache_key(
            source.uri if source else ev_uri, ev.clip_start_sec, ev.clip_duration_sec, focus,
            prompt_version("vision"),
        )
        item_name = shipment.item_name if shipment else ""
        # File rekaman hilang/korup: beri pesan yang bisa ditindaklanjuti, bukan "AI tidak tersedia".
        # Klip CCTV sudah diperiksa saat dipotong; unboxing/foto menjalankan FFmpeg di sini.
        if ev_kind in ("unboxing", "photo"):
            try:
                storage_service.get_storage().ffmpeg_input(ev_uri)
            except StorageError as exc:
                return tool_error("media_missing", f"berkas rekaman {ev_kind} tidak tersedia: {exc}")

    mode = ai_cache.current_mode()
    analysis: VisionAnalysis | None = None
    origin = "live"
    if mode != "cache":
        try:
            prompt = render("vision", focus=focus, item_name=item_name)
            analysis = await gemini_client.generate_structured(
                [_media_part(ev_uri, MIME.get(ev_kind, "video/mp4")), prompt], VisionAnalysis,
                retries=1 if mode == "live" else 0,
            )
            ai_cache.save("vision", key, analysis.model_dump(), meta={"focus": focus})
        except (gemini_client.AIUnavailable, StorageError) as exc:
            if mode == "live":
                return tool_error("ai_unavailable", str(exc))
    if analysis is None:
        cached = ai_cache.load("vision", key)
        if cached is None:
            return tool_error("ai_unavailable", "Gemini tidak tersedia dan hasil cache belum ada")
        analysis, origin = VisionAnalysis.model_validate(cached["value"]), "cache"

    with session_scope() as db:
        ev = inv_repo.get_evidence(db, ev_id)
        ev.analysis_json = {"focus": focus, **analysis.model_dump()}
        ev.analysis_source = origin

    return {"status": "ok", "evidence_id": ev_id, "focus": focus, "source": origin,
            **analysis.model_dump()}


async def analyze_media(
    ref_id: str, focus: MediaFocus, tool_context: ToolContext = None
) -> dict[str, Any]:
    """Menganalisis klip CCTV, video unboxing, atau foto dengan Vision AI.

    Args:
        ref_id: evidence_id dari clip_cctv_video, atau media_id unboxing/foto dari get_case_context.
        focus: "packing" (CCTV packing), "damage" (kerusakan barang), atau "consistency"
            (kesesuaian video unboxing pembeli dengan klaimnya).

    Returns:
        verdict, confidence, findings, timestamp_evidence (detik dalam rekaman), dan source
        ("live" atau "cache").
    """
    investigation_id = state_value(tool_context, "investigation_id")
    shipment_id = state_value(tool_context, "shipment_id")
    if not investigation_id or not shipment_id:
        return tool_error("no_investigation", "investigation_id/shipment_id tidak ada di state")
    return await analyze_media_for(ref_id, focus, investigation_id, shipment_id)
