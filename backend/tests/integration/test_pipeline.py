"""Pipeline ADK end-to-end tanpa Gemini: LLM skrip + tool nyata (DB, FFmpeg, storage lokal)."""

import json
from collections.abc import AsyncGenerator, Callable
from pathlib import Path
from typing import Any

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from sqlalchemy import select

from app.agents.agent import APP_NAME, START_MESSAGE, build_root_agent, initial_state
from app.agents.outcome import persist_outcome
from app.models import Evidence
from tests.conftest import make_db, seed_case

Step = Callable[[], list[types.Part]] | Exception


class ScriptedLlm(BaseLlm):
    model: str = "scripted"
    steps: list[Any] = []  # noqa: RUF012  (field pydantic, aman)
    calls: int = 0

    async def generate_content_async(self, llm_request, stream: bool = False) -> AsyncGenerator[LlmResponse, None]:
        if self.calls >= len(self.steps):
            raise AssertionError(f"{self.model}: dipanggil melebihi skrip")
        step = self.steps[self.calls]
        self.calls += 1
        if isinstance(step, Exception):
            raise step
        yield LlmResponse(content=types.Content(role="model", parts=step()))


def failing(name: str) -> ScriptedLlm:
    return ScriptedLlm(model=name, steps=[ConnectionError("Gemini mati")] * 10)


def fc(name: str, **args: Any) -> types.Part:
    return types.Part(function_call=types.FunctionCall(name=name, args=args))


def txt(value: Any) -> list[types.Part]:
    return [types.Part(text=value if isinstance(value, str) else json.dumps(value))]


def clip_ids(db) -> list[str]:
    with db() as s:
        return list(s.scalars(select(Evidence.id).where(Evidence.kind == "cctv_clip")))


def live_models(case: dict, db, confidence: float = 0.86) -> dict[str, ScriptedLlm]:
    ship = case["shipment_id"]
    evaluation = lambda: txt({
        "decision": "claim", "confidence": confidence, "verdict": "paket tertahan setelah serah kurir",
        "reason": "CCTV detik ke-10 menunjukkan barang dikemas dan dipindai.", "evidence_ids": clip_ids(db),
    })
    draft = lambda: txt({
        "title": "Klaim paket tertahan", "tracking_number": case["tracking_number"], "courier": "jne",
        "claim_type": "lost", "narrative": "Dengan hormat, ...",
        "chronology": [{"at": "2026-10-18T02:00:20+00:00", "event": "Resi dipindai di meja packing"}],
        "attachments": clip_ids(db), "requested_compensation": case["item_value"],
        "policy_notes": ["Diajukan dalam 14 hari"],
    })
    return {
        "investigator": ScriptedLlm(model="investigator", steps=[
            lambda: [fc("get_case_context", shipment_id=ship)],
            lambda: [fc("clip_cctv_video", shipment_id=ship, pre_sec=10, post_sec=15)],
            lambda: [fc("analyze_media", ref_id=clip_ids(db)[0], focus="packing")],
            lambda: [fc("get_courier_policy", courier="jne")],
            lambda: txt("Barang terlihat dikemas pada detik 10 klip."),
        ]),
        "evaluator": ScriptedLlm(model="evaluator", steps=[evaluation]),
        "drafter": ScriptedLlm(model="drafter", steps=[draft]),
    }


async def run_pipeline(case: dict, models: dict) -> tuple[list, dict]:
    ss = InMemorySessionService()
    runner = Runner(app_name=APP_NAME, agent=build_root_agent(models), session_service=ss)
    state = initial_state(investigation_id=case["investigation_id"], shipment_id=case["shipment_id"],
                          tracking_number=case["tracking_number"], courier="jne", case_type="lost",
                          item_value=case["item_value"])
    session = await ss.create_session(app_name=APP_NAME, user_id="system", state=state)
    events = [e async for e in runner.run_async(user_id="system", session_id=session.id,
                                                new_message=START_MESSAGE)]
    final = await ss.get_session(app_name=APP_NAME, user_id="system", session_id=session.id)
    return events, final.state


def model_sources(events: list) -> set[str]:
    return {(e.custom_metadata or {}).get("source") for e in events
            if e.author in ("investigator", "evaluator", "drafter") and e.content and e.custom_metadata}



async def test_live_run_drafts_claim_and_records_cache(ai, seeded, db, tmp_path):
    events, state = await run_pipeline(seeded, live_models(seeded, db))

    out = persist_outcome(state)
    assert out.outcome == "claim_drafted"
    assert out.draft and out.draft.tracking_number == seeded["tracking_number"]
    assert out.draft_issues == []
    assert model_sources(events) == {"live"}
    with db() as s:
        ev = s.scalars(select(Evidence)).one()
        assert ev.analysis_source == "live" and ev.analysis_json["verdict"] == "item_packed"

    recorded = "".join(p.read_text(encoding="utf-8") for p in Path(tmp_path / "cache").rglob("*.json"))
    assert seeded["shipment_id"] not in recorded and ev.id not in recorded  # hanya alias
    assert "@SHIPMENT" in recorded and "@EVIDENCE_1" in recorded


@pytest.mark.parametrize("mode", ["cache", "auto"])
async def test_replay_after_reset_without_gemini(ai, mode, seeded, db, storage, cctv_video, tmp_path, monkeypatch):
    await run_pipeline(seeded, live_models(seeded, db))  # rekam

    # Demo reset: DB baru, UUID baru; Gemini mati
    db2 = make_db(tmp_path / "reset.db", monkeypatch)
    case2 = seed_case(db2, storage, cctv_video)
    assert case2["shipment_id"] != seeded["shipment_id"]
    ai["value"] = mode
    dead = {name: failing(name) for name in ("investigator", "evaluator", "drafter")}

    events, state = await run_pipeline(case2, dead)

    out = persist_outcome(state)
    assert out.outcome == "claim_drafted"
    assert out.draft.attachments == clip_ids(db2)  # alias dipetakan ke evidence run baru
    assert out.draft_issues == []
    assert model_sources(events) == {"cache"}
    with db2() as s:
        assert s.scalars(select(Evidence)).one().analysis_source == "cache"
    if mode == "cache":
        assert all(m.calls == 0 for m in dead.values())  # cache tidak menyentuh model


async def test_low_confidence_forces_needs_evidence_and_skips_drafter(ai, seeded, db):
    models = live_models(seeded, db, confidence=0.3)
    models["drafter"] = failing("drafter")

    _, state = await run_pipeline(seeded, models)

    out = persist_outcome(state)
    assert out.outcome == "needs_evidence"
    assert out.guard_applied and out.draft is None
    assert models["drafter"].calls == 0
