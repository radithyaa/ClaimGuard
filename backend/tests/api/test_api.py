"""API Backend B end-to-end: FastAPI in-process, agen ADK dengan LLM skrip, FFmpeg & DB nyata."""

import asyncio
import json
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta
from pathlib import Path

import httpx
import pytest
from google.adk.models.llm_response import LlmResponse

from app.agents.agent import build_root_agent
from app.core.config import get_settings
from app.main import create_app
from app.repositories import shipments as ship_repo
from app.services import demo_data, investigation_runner
from tests.integration.test_pipeline import ScriptedLlm, live_models

LOST = "JNE0012345678"


@pytest.fixture(scope="session")
def samples_dir(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("samples")
    for m in demo_data.load_mock()["media"]:
        demo_data._synthesize(d / m["file"], m["duration_sec"])
    return d


@pytest.fixture
async def client(db, storage, samples_dir, ai, monkeypatch) -> AsyncGenerator[httpx.AsyncClient]:
    s = get_settings()
    monkeypatch.setattr(s, "sample_media_dir", str(samples_dir))
    monkeypatch.setattr(s, "storage_local_root", str(storage.root))
    with db() as session:
        demo_data.reset_and_seed(session)
        ai["value"] = "cache"  # kebijakan kurir dari fallback manual (tanpa AI)
        await demo_data.ensure_policies(session)
        ai["value"] = "live"
        session.commit()
    app = create_app()  # tanpa lifespan: DB sudah disiapkan fixture
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://test/api/v1") as c:
        yield c
    await investigation_runner.cancel_all()


def use_scripted_agent(monkeypatch, db, tracking: str = LOST, **kw) -> None:
    with db() as s:
        ship = ship_repo.get_by_tracking(s, tracking)
        case = {"shipment_id": ship.id, "tracking_number": ship.tracking_number,
                "item_value": ship.item_value}
    models = live_models(case, db, **kw)
    monkeypatch.setattr(investigation_runner, "agent_factory", lambda: build_root_agent(models))


async def wait_status(c: httpx.AsyncClient, inv_id: str, *statuses: str, timeout: float = 15) -> dict:
    for _ in range(int(timeout / 0.05)):
        body = (await c.get(f"/investigations/{inv_id}")).json()
        if body["status"] in statuses:
            return body
        await asyncio.sleep(0.05)
    raise AssertionError(f"status tetap {body['status']}")


def parse_sse(text: str) -> list[dict]:
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


async def test_health_and_uniform_errors(client):
    assert (await client.get("/health")).json()["db"] == "ok"
    r = await client.get("/shipments/tidak-ada")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = await client.get("/shipments", params={"limit": 0})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


async def test_shipments_list_filter_and_detail(client):
    page = (await client.get("/shipments", params={"limit": 100})).json()
    assert page["total"] == 15 and all(s["is_simulated"] for s in page["items"])
    jne = (await client.get("/shipments", params={"courier": "jne"})).json()
    assert jne["total"] == 5 and {s["courier"] for s in jne["items"]} == {"jne"}
    found = (await client.get("/shipments", params={"q": "surabaya"})).json()["items"]
    assert [s["tracking_number"] for s in found] == [LOST]
    detail = (await client.get(f"/shipments/{found[0]['id']}")).json()
    assert len(detail["tracking_events"]) == 3 and detail["anomaly"] is None
    # Paket belum sampai: tenggat klaim = batas SLA + 14 hari kebijakan JNE
    sla = datetime.fromisoformat(detail["sla_deadline"])
    assert datetime.fromisoformat(detail["claim_deadline"]) == sla + timedelta(days=14)
    assert found[0]["claim_deadline"] == detail["claim_deadline"]


async def test_scan_flags_scenarios_and_is_idempotent(client):
    r = (await client.post("/monitoring/scan")).json()
    flagged = {a["code"] for a in r["new_anomalies"]}
    assert r["scanned"] == 15 and len(r["new_anomalies"]) == 4
    assert flagged == {"SLA_EXCEEDED", "BUYER_REPORTED_DAMAGE", "RETURN_DISPUTE"}
    assert (await client.post("/monitoring/scan")).json()["new_anomalies"] == []
    listed = (await client.get("/shipments", params={"limit": 100})).json()["items"]
    assert sum(1 for s in listed if s["active_anomaly"]) == 4


async def test_lost_scenario_end_to_end_with_hitl(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db)
    r = await client.post("/demo/scenario/lost")
    assert r.status_code == 202
    inv_id = r.json()["investigation_id"]

    events = parse_sse((await client.get(f"/investigations/{inv_id}/stream")).text)
    types = [e["type"] for e in events]
    assert types[0] == "status" and types[-1] == "done"
    assert {"tool_start", "tool_end", "thought", "decision"} <= set(types)
    tools = [e["payload"]["tool"] for e in events if e["type"] == "tool_end"]
    assert tools == ["get_case_context", "clip_cctv_video", "analyze_media", "get_courier_policy"]
    assert [e["seq"] for e in events] == sorted(e["seq"] for e in events)

    replay = parse_sse((await client.get(f"/investigations/{inv_id}/stream",
                                         headers={"Last-Event-ID": str(events[2]["seq"])})).text)
    assert [e["seq"] for e in replay] == [e["seq"] for e in events[3:]]

    inv = await wait_status(client, inv_id, "completed")
    assert inv["outcome"] == "claim_drafted" and inv["courier_policy"]["courier"] == "jne"
    clip = inv["evidence"][0]
    assert clip["analysis_source"] == "live"
    media = (await client.get(f"/evidence/{clip['id']}/media")).json()
    assert media["url"].startswith("http://test/media/clips/")

    claim_id = events[-1]["payload"]["claim_id"]
    claim = (await client.get(f"/claims/{claim_id}")).json()
    assert claim["status"] == "pending_approval" and claim["tracking_number"] == LOST
    assert claim["claim_value"] == 450000 and claim["is_simulated"]
    shipment = (await client.get(f"/shipments/{claim['shipment_id']}")).json()
    assert claim["case_type"] == "lost" and claim["claim_deadline"] == shipment["claim_deadline"]
    assert (await client.get("/claims")).json()["items"][0]["id"] == claim_id

    edited = await client.patch(f"/claims/{claim_id}", json={"narrative": "Narasi diedit pemilik toko."})
    assert edited.json()["narrative"] == "Narasi diedit pemilik toko."

    approved = await client.post(f"/claims/{claim_id}/approve")
    assert approved.json()["status"] == "submitted"
    assert approved.json()["submission_ref"].startswith("SIM-JNE-")
    again = await client.post(f"/claims/{claim_id}/approve")
    assert again.status_code == 409 and again.json()["error"]["code"] == "invalid_status"
    assert (await client.patch(f"/claims/{claim_id}", json={"narrative": "x" * 30})).status_code == 409

    metrics = (await client.get("/metrics/summary")).json()
    assert metrics["submitted_claims"] == 1 and metrics["estimated_value_saved"] == 450000
    actions = [a["action"] for a in (await client.get("/audit-logs", params={"limit": 50})).json()]
    for expected in ("anomaly_flagged", "investigation_started", "claim_drafted",
                     "decision_made", "claim_edited", "claim_approved"):
        assert expected in actions


async def test_second_start_while_running_conflicts_and_cancel_works(client, db, monkeypatch):
    class SlowLlm(ScriptedLlm):
        async def generate_content_async(self, llm_request, stream: bool = False):
            await asyncio.sleep(30)
            yield LlmResponse()

    monkeypatch.setattr(investigation_runner, "agent_factory",
                        lambda: build_root_agent({"investigator": SlowLlm(model="slow")}))
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    await wait_status(client, inv_id, "running")
    with db() as s:
        ship_id = ship_repo.get_by_tracking(s, LOST).id
    dup = await client.post("/investigations", json={"shipment_id": ship_id})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "already_running"

    assert (await client.post(f"/investigations/{inv_id}/cancel")).status_code == 202
    inv = await wait_status(client, inv_id, "cancelled", timeout=2)
    assert inv["is_active"] is False
    events = parse_sse((await client.get(f"/investigations/{inv_id}/stream")).text)
    assert events[-1]["type"] == "cancelled"
    assert (await client.post(f"/investigations/{inv_id}/cancel")).status_code == 409
    detail = (await client.get(f"/shipments/{ship_id}")).json()
    assert detail["anomaly"]["status"] == "open"  # bisa diinvestigasi ulang


async def test_low_confidence_needs_evidence_creates_no_claim(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db, confidence=0.3)
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    inv = await wait_status(client, inv_id, "completed", "failed")
    assert inv["status"] == "completed" and inv["outcome"] == "needs_evidence"
    assert inv["claim_id"] is None
    assert (await client.get("/claims")).json()["total"] == 0


async def test_reject_requires_reason_and_blocks_approve(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db)
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    claim_id = (await wait_status(client, inv_id, "completed"))["claim_id"]
    assert (await client.post(f"/claims/{claim_id}/reject", json={"reason": ""})).status_code == 422
    r = await client.post(f"/claims/{claim_id}/reject", json={"reason": "Bukti kurang jelas"})
    assert r.json()["status"] == "rejected" and r.json()["reject_reason"] == "Bukti kurang jelas"
    assert (await client.post(f"/claims/{claim_id}/approve")).status_code == 409


async def test_auth_required_protects_mutations(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "auth_required", True)
    assert (await client.post("/monitoring/scan")).status_code == 401
    assert (await client.get("/shipments")).status_code == 200  # baca tetap terbuka
    bad = await client.post("/auth/login", json={"password": "salah"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "invalid_credentials"
    token = (await client.post("/auth/login", json={"password": get_settings().demo_password})).json()["token"]
    ok = await client.post("/monitoring/scan", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200
    forged = token[:-4] + "AAAA"
    assert (await client.post("/monitoring/scan", headers={"Authorization": f"Bearer {forged}"})).status_code == 401


async def test_settings_patch_and_validation(client):
    assert (await client.get("/settings")).json()["ai_mode"] == get_settings().ai_mode
    r = await client.patch("/settings", json={"min_confidence": 0.75, "scheduler_enabled": False})
    assert r.json()["min_confidence"] == 0.75
    assert (await client.get("/settings")).json()["min_confidence"] == 0.75
    assert (await client.patch("/settings", json={"min_confidence": 2})).status_code == 422


async def test_demo_reset_restores_data_and_keeps_policies(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db)
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    await wait_status(client, inv_id, "completed")
    report = (await client.post("/demo/reset")).json()
    assert report["shipments"] == 15 and report["missing_media"] == []
    assert (await client.get("/claims")).json()["total"] == 0
    assert (await client.get("/anomalies")).json() == []
    assert len((await client.get("/couriers/policies")).json()) == 3
