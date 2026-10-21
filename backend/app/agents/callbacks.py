"""Callback ADK: anggaran tool, rekam-putar respons model (fallback cache), dan penjaga deterministik.

Rekam-putar: setiap respons model live disimpan per (agen, nomor resi, giliran). ID dinamis (UUID
evidence/media/resi) diganti alias stabil (@EVIDENCE_1, @MEDIA_1, @SHIPMENT) agar rekaman tetap
berlaku setelah demo reset membuat UUID baru. Saat diputar ulang alias dikembalikan ke ID run ini.
"""

import json
import logging
from typing import Any

from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.agents.prompts import prompt_version
from app.agents.tools._common import tool_error
from app.core.config import get_settings
from app.schemas.agent_outputs import Evaluation
from app.services import ai_cache

log = logging.getLogger(__name__)

ALIASES = "_id_aliases"  # real_id -> alias
TOOL_CALLS = "_tool_calls"


# ---------- alias ID ----------

def register_alias(state: Any, real_id: str | None, prefix: str) -> None:
    if not real_id:
        return
    aliases = dict(state.get(ALIASES) or {})
    if real_id in aliases:
        return
    if prefix in ("SHIPMENT", "INVESTIGATION"):
        aliases[real_id] = f"@{prefix}"
    else:
        n = sum(1 for a in aliases.values() if a.startswith(f"@{prefix}_")) + 1
        aliases[real_id] = f"@{prefix}_{n}"
    state[ALIASES] = aliases


def _to_aliases(text: str, aliases: dict[str, str]) -> str:
    for real, alias in aliases.items():
        text = text.replace(real, alias)
    return text


def _from_aliases(text: str, aliases: dict[str, str]) -> str:
    # alias terpanjang dulu: @EVIDENCE_10 tidak boleh tertimpa @EVIDENCE_1
    for real, alias in sorted(aliases.items(), key=lambda kv: -len(kv[1])):
        text = text.replace(alias, real)
    return text


# ---------- tool ----------

def before_tool(tool, args: dict[str, Any], tool_context) -> dict[str, Any] | None:
    calls = int(tool_context.state.get(TOOL_CALLS, 0)) + 1
    tool_context.state[TOOL_CALLS] = calls
    if calls > get_settings().max_tool_calls:
        return tool_error("tool_budget_exceeded", "batas jumlah pemanggilan tool tercapai; simpulkan")
    return None


def after_tool(tool, args: dict[str, Any], tool_context, tool_response: dict[str, Any]) -> None:
    if not isinstance(tool_response, dict):
        return
    register_alias(tool_context.state, tool_response.get("evidence_id"), "EVIDENCE")
    for m in tool_response.get("available_media") or []:
        register_alias(tool_context.state, m.get("media_id"), "MEDIA")
    return


# ---------- model: rekam & putar ulang ----------

def _turn_key(ctx) -> str:
    agent = ctx.agent_name
    turn = ctx.state.get(f"_turn:{agent}", 0)
    return ai_cache.cache_key(agent, ctx.state.get("tracking_number"), turn, prompt_version(agent))


def _replay(ctx) -> LlmResponse | None:
    cached = ai_cache.load("agent", _turn_key(ctx))
    if cached is None:
        return None
    raw = _from_aliases(json.dumps(cached["value"]), dict(ctx.state.get(ALIASES) or {}))
    return LlmResponse(content=types.Content.model_validate_json(raw),
                       custom_metadata={"source": "cache"})


def before_model(ctx, llm_request) -> LlmResponse | None:
    agent = ctx.agent_name
    ctx.state[f"_turn:{agent}"] = ctx.state.get(f"_turn:{agent}", 0) + 1
    if ai_cache.current_mode() != "cache":
        return None
    replay = _replay(ctx)
    if replay is None:
        raise RuntimeError(f"mode cache: rekaman respons {agent} untuk kasus ini belum ada")
    return replay


def after_model(ctx, llm_response: LlmResponse) -> LlmResponse | None:
    meta = llm_response.custom_metadata or {}
    if meta.get("source") == "cache" or llm_response.partial or llm_response.content is None:
        return None
    raw = llm_response.content.model_dump_json(exclude_none=True)
    value = json.loads(_to_aliases(raw, dict(ctx.state.get(ALIASES) or {})))
    ai_cache.save("agent", _turn_key(ctx), value,
                  meta={"agent": ctx.agent_name, "tracking_number": ctx.state.get("tracking_number")})
    llm_response.custom_metadata = {**meta, "source": "live"}
    return llm_response


def on_model_error(ctx, llm_request, error: Exception) -> LlmResponse | None:
    if ai_cache.current_mode() != "auto":
        return None
    log.warning("model %s gagal (%s); mencoba cache", ctx.agent_name, error)
    return _replay(ctx)


MODEL_CALLBACKS = {
    "before_model_callback": before_model,
    "after_model_callback": after_model,
    "on_model_error_callback": on_model_error,
}


# ---------- penjaga deterministik ----------

def enforce_min_confidence(callback_context) -> None:
    """FR-12: ambang confidence ditegakkan kode, bukan prompt."""
    raw = callback_context.state.get("evaluation")
    if not raw:
        return
    ev = Evaluation.model_validate(raw)
    from app.services.settings_service import get_runtime  # impor lambat: hindari siklus

    threshold = get_runtime().min_confidence
    if ev.decision != "needs_evidence" and ev.confidence < threshold:
        data = ev.model_dump()
        data.update(
            decision="needs_evidence",
            reason=f"{ev.reason} (Keyakinan {ev.confidence:.0%} di bawah ambang "
                   f"{threshold:.0%}; perlu ditinjau atau bukti tambahan.)",
        )
        callback_context.state["evaluation"] = data
        callback_context.state["guard_applied"] = True
    return


def skip_drafter_unless_claim(callback_context) -> types.Content | None:
    ev = callback_context.state.get("evaluation") or {}
    if ev.get("decision") == "claim":
        return None
    # Content tanpa teks: Drafter dilewati tanpa memicu validasi output_schema ClaimDraft
    callback_context.state["draft_skipped_reason"] = f"keputusan Evaluator: {ev.get('decision', '-')}"
    return types.Content(role="model", parts=[])


def validate_draft(callback_context) -> None:
    """Cek fakta draf terhadap state (SRS 12.1); masalah ditandai, bukan diperbaiki diam-diam."""
    st = callback_context.state
    draft = st.get("claim_draft")
    if not draft:
        return
    issues: list[str] = []
    if draft.get("tracking_number") != st.get("tracking_number"):
        issues.append("nomor resi di draf tidak sama dengan resi kasus")
    known = {real for real, alias in (st.get(ALIASES) or {}).items() if alias.startswith("@EVIDENCE_")}
    unknown = [a for a in draft.get("attachments", []) if a not in known]
    if unknown:
        issues.append(f"lampiran tidak dikenal: {', '.join(unknown)}")
    item_value = st.get("item_value")
    if item_value is not None and draft.get("requested_compensation", 0) > item_value:
        issues.append("nilai ganti rugi melebihi nilai barang")
    st["draft_issues"] = issues
    return
