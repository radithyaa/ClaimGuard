"""Menjalankan agen ADK per investigasi sebagai asyncio.Task (SRS 3.5, 3.6).

- Event ADK dipetakan ke `investigation_events` (sumber replay SSE) dan antrean pelanggan live.
- Pembatalan (FR-20): abort_signal ADK + task.cancel() (subprocess FFmpeg ikut dimatikan).
- Registry ada di memori proses, sehingga backend wajib satu instance (NFR-13).
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

from app.agents.agent import APP_NAME, START_MESSAGE, build_root_agent, initial_state
from app.agents.outcome import OutcomeError, persist_outcome
from app.core.config import get_settings
from app.core.errors import conflict, not_found
from app.core.logging import investigation_id_var
from app.db.session import session_scope
from app.models import Anomaly, Investigation, Shipment
from app.repositories import investigations as inv_repo
from app.repositories import shipments as ship_repo
from app.services import audit, claim_service

# Kesimpulan agen -> pihak yang bersalah. `claim` memberi dua kemungkinan: bukti packing kuat
# berarti kurir yang menanggung (klaim diajukan), sedangkan bukti belum ada berarti belum bisa
# menyalahkan siapa pun (null). `needs_evidence` tidak pernah mengubah kesimpulan resi.
RESOLUTION_BY_DECISION: dict[str, str | None] = {
    "claim": "courier",
    "fraud_suspect": "buyer",
    "seller_error": "seller",
}

log = logging.getLogger(__name__)

TERMINAL_EVENTS = frozenset({"done", "error", "cancelled"})
ACTIVE_STATUSES = ("queued", "running")
agent_factory = build_root_agent  # diganti di test dengan agen ber-LLM skrip


@dataclass
class _Run:
    abort: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    subscribers: set[asyncio.Queue] = field(default_factory=set)


_runs: dict[str, _Run] = {}


# ---------- event ----------

def _jsonable(value: Any, limit: int = 300) -> Any:
    """Ringkas payload agar SSE ringan: string dipotong, list dibatasi."""
    if isinstance(value, str):
        return value if len(value) <= limit else value[:limit] + "…"
    if isinstance(value, dict):
        return {str(k): _jsonable(v, limit) for k, v in value.items()}
    if isinstance(value, list | tuple):
        items = [_jsonable(v, limit) for v in value[:10]]
        return items + ([f"(+{len(value) - 10} lagi)"] if len(value) > 10 else [])
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def serialize_event(ev) -> dict[str, Any]:
    return {
        "seq": ev.seq, "investigation_id": ev.investigation_id, "type": ev.type, "agent": ev.agent,
        "ts": ev.created_at.isoformat(), "payload": ev.payload_json, "source": ev.source,
    }


def emit(inv_id: str, type_: str, payload: dict[str, Any], *, agent: str | None = None,
         source: str | None = None) -> dict[str, Any]:
    with session_scope() as db:
        data = serialize_event(inv_repo.add_event(db, inv_id, type_, _jsonable(payload),
                                                  agent=agent, source=source))
    run = _runs.get(inv_id)
    for q in list(run.subscribers) if run else []:
        q.put_nowait(data)
    return data


def subscribe(inv_id: str) -> asyncio.Queue | None:
    run = _runs.get(inv_id)
    if run is None:
        return None
    q: asyncio.Queue = asyncio.Queue()
    run.subscribers.add(q)
    return q


def unsubscribe(inv_id: str, q: asyncio.Queue | None) -> None:
    if q is not None and (run := _runs.get(inv_id)):
        run.subscribers.discard(q)


def is_active(inv_id: str) -> bool:
    return inv_id in _runs


# ---------- start ----------

def start(shipment_id: str, *, actor: str = "user") -> str:
    """Membuat investigasi (status queued) lalu menjalankan agen di background."""
    with session_scope() as db:
        shipment = ship_repo.get(db, shipment_id)
        if shipment is None:
            raise not_found("Resi")
        anomaly = ship_repo.get_open_anomaly(db, shipment_id)
        if anomaly is None:
            raise conflict("no_anomaly", "Resi ini tidak memiliki anomali aktif; jalankan scan dulu")
        if any(i.status in ACTIVE_STATUSES for i in inv_repo.list_for(db, shipment_id=shipment_id)):
            raise conflict("already_running", "Investigasi untuk resi ini sedang berjalan")
        inv = inv_repo.create(db, shipment_id=shipment_id, case_type=anomaly.case_type,
                              anomaly_id=anomaly.id)
        anomaly.status = "investigating"
        audit.record(db, actor=actor, action="investigation_started", entity="investigation",
                     entity_id=inv.id, payload={"shipment_id": shipment_id,
                                                "case_type": anomaly.case_type})
        state = initial_state(
            investigation_id=inv.id, shipment_id=shipment.id,
            tracking_number=shipment.tracking_number, courier=shipment.courier,
            case_type=anomaly.case_type, item_value=shipment.item_value,
        )
        inv_id = inv.id
    run = _Run()
    _runs[inv_id] = run
    run.task = asyncio.create_task(_execute(inv_id, state), name=f"investigation-{inv_id}")
    return inv_id


# ---------- eksekusi ----------

async def _execute(inv_id: str, state: dict[str, Any]) -> None:
    token = investigation_id_var.set(inv_id)
    run = _runs[inv_id]
    try:
        with session_scope() as db:
            inv_repo.mark_running(db, inv_repo.get(db, inv_id))
        emit(inv_id, "status", {"status": "running"})
        final_state = await asyncio.wait_for(
            _drive(inv_id, state, run.abort), timeout=get_settings().investigation_timeout_sec
        )
        if run.abort.is_set():
            _cancelled(inv_id)
        else:
            _complete(inv_id, final_state)
    except asyncio.CancelledError:
        _cancelled(inv_id)
    except TimeoutError:
        _fail(inv_id, "timeout", "Investigasi melebihi batas waktu dan dihentikan")
    except Exception as exc:
        log.exception("investigasi %s gagal", inv_id)
        if not get_settings().gcp_project:
            _fail(inv_id, "ai_not_configured", "Gemini belum dikonfigurasi (GCP_PROJECT kosong) "
                  "dan rekaman cache untuk kasus ini belum ada")
        else:
            _fail(inv_id, "agent_error", f"Agen gagal: {exc}"[:300])
    finally:
        _runs.pop(inv_id, None)
        investigation_id_var.reset(token)


async def _drive(inv_id: str, state: dict[str, Any], abort: asyncio.Event) -> dict[str, Any]:
    sessions = InMemorySessionService()
    runner = Runner(app_name=APP_NAME, agent=agent_factory(), session_service=sessions)
    session = await sessions.create_session(app_name=APP_NAME, user_id="system", state=state)
    started: dict[str, float] = {}
    async for event in runner.run_async(
        user_id="system", session_id=session.id, new_message=START_MESSAGE,
        run_config=RunConfig(max_llm_calls=get_settings().max_llm_calls), abort_signal=abort,
    ):
        _forward(inv_id, event, started)
    final = await sessions.get_session(app_name=APP_NAME, user_id="system", session_id=session.id)
    return dict(final.state) if final else state


def _forward(inv_id: str, event, started: dict[str, float]) -> None:
    agent = event.author if event.author != "user" else None
    model_source = (event.custom_metadata or {}).get("source")
    for call in event.get_function_calls():
        started[call.id or call.name] = time.monotonic()
        emit(inv_id, "tool_start", {"tool": call.name, "args": dict(call.args or {})},
             agent=agent, source=model_source)
    for resp in event.get_function_responses():
        body = resp.response or {}
        t0 = started.pop(resp.id or resp.name, None)
        emit(inv_id, "tool_end", {
            "tool": resp.name, "status": body.get("status", "ok"), "result": body,
            "duration_ms": int((time.monotonic() - t0) * 1000) if t0 else None,
        }, agent=agent, source=body.get("source"))
    if event.partial or not event.content or event.get_function_calls() or event.get_function_responses():
        return
    text = "".join(p.text or "" for p in event.content.parts or [] if not getattr(p, "thought", False))
    if not text.strip():
        return
    if agent == "investigator":
        emit(inv_id, "thought", {"text": text}, agent=agent, source=model_source)
    elif agent == "drafter":
        emit(inv_id, "thought", {"text": "Draf klaim selesai disusun."}, agent=agent,
             source=model_source)
    # Evaluator: teksnya JSON keputusan, dikirim sebagai event `decision` setelah run selesai


def _set_anomaly(db, inv: Investigation, status: str) -> None:
    if inv.anomaly_id and (a := db.get(Anomaly, inv.anomaly_id)):
        a.status = status


def _apply_resolution(db, inv: Investigation, outcome) -> str | None:
    """Resi mencatat kesimpulan Evaluator (siapa yang bersalah menurut bukti).

    `needs_evidence` dan `claim` dengan confidence rendah sengaja tidak mengubah kesimpulan:
    menuduh pihak lain butuh bukti. Klaim tetap harus disetujui manusia, jadi baris `claims`
    tidak dibuat di sini.
    """
    ev = outcome.evaluation
    party = RESOLUTION_BY_DECISION.get(ev.decision)
    if party is None or (party == "courier" and outcome.outcome != "claim_drafted"):
        return None
    shipment = db.get(Shipment, inv.shipment_id)
    if shipment is None:
        return None
    ship_repo.set_resolution(db, shipment, party=party, reason=ev.reason,
                             evidence_ids=ev.evidence_ids)
    return party


def _complete(inv_id: str, final_state: dict[str, Any]) -> None:
    try:
        outcome = persist_outcome(final_state)
    except OutcomeError as exc:
        _fail(inv_id, "no_decision", str(exc))
        return
    ev = outcome.evaluation
    with session_scope() as db:
        inv = inv_repo.get(db, inv_id)
        inv_repo.finish(db, inv, status="completed", outcome=outcome.outcome, verdict=ev.verdict,
                        confidence=ev.confidence, decision_reason=ev.reason)
        claim_id = None
        if outcome.outcome == "claim_drafted":
            claim_id = claim_service.create_from_draft(db, inv, outcome).id
        else:  # needs_evidence: anomali dibuka lagi; fraud_suspect/seller_error: ditutup dengan keputusan
            _set_anomaly(db, inv, "open" if outcome.outcome == "needs_evidence" else "resolved")
        resolution = _apply_resolution(db, inv, outcome)
        audit.record(db, actor="agent:evaluator", action="decision_made", entity="investigation",
                     entity_id=inv_id, payload={"decision": ev.decision,
                                                "confidence": ev.confidence,
                                                "guard_applied": outcome.guard_applied,
                                                "shipment_id": inv.shipment_id})
        duration_ms = inv.duration_ms
    emit(inv_id, "decision", {
        "decision": ev.decision, "outcome": outcome.outcome, "confidence": ev.confidence,
        "verdict": ev.verdict, "reason": ev.reason, "evidence_ids": ev.evidence_ids,
        "missing_evidence": ev.missing_evidence, "guard_applied": outcome.guard_applied,
        "shipment_resolution": resolution,
    }, agent="evaluator")
    emit(inv_id, "done", {"outcome": outcome.outcome, "claim_id": claim_id,
                          "duration_ms": duration_ms})


def _fail(inv_id: str, code: str, message: str) -> None:
    with session_scope() as db:
        inv = inv_repo.get(db, inv_id)
        inv_repo.finish(db, inv, status="failed", error=message)
        _set_anomaly(db, inv, "open")
        audit.record(db, actor="system", action="investigation_failed", entity="investigation",
                     entity_id=inv_id, payload={"code": code, "message": message})
    emit(inv_id, "error", {"code": code, "message": message})


def _cancelled(inv_id: str) -> None:
    with session_scope() as db:
        inv = inv_repo.get(db, inv_id)
        if inv.status in inv_repo.TERMINAL_STATUSES:
            return
        inv_repo.finish(db, inv, status="cancelled")
        _set_anomaly(db, inv, "open")
    emit(inv_id, "cancelled", {"message": "Investigasi dihentikan oleh pengguna"})


# ---------- cancel ----------

def cancel(inv_id: str, *, actor: str = "user") -> None:
    run = _runs.get(inv_id)
    with session_scope() as db:
        inv = inv_repo.get(db, inv_id)
        if inv is None:
            raise not_found("Investigasi")
        if inv.status in inv_repo.TERMINAL_STATUSES:
            raise conflict("invalid_status", f"Investigasi sudah berstatus '{inv.status}'")
        audit.record(db, actor=actor, action="investigation_cancelled", entity="investigation",
                     entity_id=inv_id)
    if run is None:  # mis. tersisa dari proses sebelum restart
        _cancelled(inv_id)
        return
    run.abort.set()
    if run.task:
        run.task.cancel()


async def cancel_all() -> None:
    tasks = [r.task for r in _runs.values() if r.task]
    for r in list(_runs.values()):
        r.abort.set()
        if r.task:
            r.task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


def recover_stale() -> int:
    """Saat startup: investigasi queued/running dari proses lama ditandai gagal."""
    with session_scope() as db:
        stale = [i for s in ACTIVE_STATUSES for i in inv_repo.list_for(db, status=s)]
        for inv in stale:
            inv_repo.finish(db, inv, status="failed", error="Server dimulai ulang saat investigasi berjalan")
            _set_anomaly(db, inv, "open")
    return len(stale)

