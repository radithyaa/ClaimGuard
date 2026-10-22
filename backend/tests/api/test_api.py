"""API Backend B end-to-end: FastAPI in-process, agen ADK dengan LLM skrip, FFmpeg & DB nyata."""

import asyncio
import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from google.adk.models.llm_response import LlmResponse

from app.agents.agent import build_root_agent
from app.core.config import get_settings
from app.main import create_app
from app.models import Investigation
from app.repositories import shipments as ship_repo
from app.services import demo_data, investigation_runner, monitoring
from tests.integration.test_pipeline import ScriptedLlm, clip_ids, live_models, txt

LOST = "JNE0012345678"
SELLER = "SCP8899770011"  # C2: penjual salah kirim


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


def use_scripted_agent(monkeypatch, db, tracking: str = LOST, decision: dict | None = None,
                       **kw) -> None:
    with db() as s:
        ship = ship_repo.get_by_tracking(s, tracking)
        case = {"shipment_id": ship.id, "tracking_number": ship.tracking_number,
                "item_value": ship.item_value}
    models = live_models(case, db, **kw)
    if decision:  # ganti keputusan Evaluator; Drafter dilewati bila bukan "claim"
        models["evaluator"] = ScriptedLlm(model="evaluator", steps=[
            lambda: txt({"verdict": "-", "reason": "-", "evidence_ids": clip_ids(db), **decision})])
    monkeypatch.setattr(investigation_runner, "agent_factory", lambda: build_root_agent(models))


async def wait_status(c: httpx.AsyncClient, inv_id: str, *statuses: str, timeout: float = 15) -> dict:
    for _ in range(int(timeout / 0.05)):
        body = (await c.get(f"/investigations/{inv_id}")).json()
        if body["status"] in statuses:
            return body
        await asyncio.sleep(0.05)
    raise AssertionError(f"status tetap {body['status']}")


async def test_cors_allows_web_origin_on_claims_endpoint(client, monkeypatch):
    """Browser memanggil API lintas origin (NFR-06). Tanpa header ini halaman klaim kosong
    dengan pesan "No 'Access-Control-Allow-Origin'" di konsol."""
    origin = "https://claimguard-web-259363364922.asia-southeast2.run.app"
    monkeypatch.setattr(get_settings(), "cors_origins", [origin])
    api = create_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test") as c:
        pre = await c.options("/api/v1/claims?status=submitted&limit=100", headers={
            "Origin": origin, "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type"})
        assert pre.status_code == 200
        assert pre.headers["access-control-allow-origin"] == origin
        assert pre.headers["access-control-allow-credentials"] == "true"

        res = await c.get("/api/v1/claims?status=submitted&limit=100", headers={"Origin": origin})
        assert res.status_code == 200
        assert res.headers["access-control-allow-origin"] == origin

        # Origin asing tetap tidak dilayani header CORS-nya.
        other = await c.get("/api/v1/claims", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in other.headers


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
    mock_rows = demo_data.load_mock()["shipments"]
    assert page["total"] == len(mock_rows) and all(s["is_simulated"] for s in page["items"])
    jne = (await client.get("/shipments", params={"courier": "jne"})).json()
    assert jne["total"] == sum(1 for r in mock_rows if r["courier"] == "jne")
    assert {s["courier"] for s in jne["items"]} == {"jne"}
    found = (await client.get("/shipments", params={"q": "surabaya"})).json()["items"]
    assert {s["tracking_number"] for s in found} == {LOST, SELLER}  # keduanya ke Surabaya
    lost = next(s for s in found if s["tracking_number"] == LOST)
    detail = (await client.get(f"/shipments/{lost['id']}")).json()
    assert len(detail["tracking_events"]) == 3 and detail["anomaly"] is None
    # Paket belum sampai: tenggat klaim = batas SLA + 14 hari kebijakan JNE
    sla = datetime.fromisoformat(detail["sla_deadline"])
    assert datetime.fromisoformat(detail["claim_deadline"]) == sla + timedelta(days=14)
    assert lost["claim_deadline"] == detail["claim_deadline"]


async def test_scan_flags_scenarios_and_is_idempotent(client, monkeypatch):
    # Waktu tetap: ambang tertahan per kurir dihitung dari tracking event terakhir, sehingga
    # hasil scan bergantung pada jam berjalan. Demo menganggap "sekarang" = 21 Okt 15.00 UTC.
    frozen = datetime(2026, 10, 21, 15, 0, tzinfo=UTC)
    monkeypatch.setattr(monitoring, "utcnow", lambda: frozen)

    r = (await client.post("/monitoring/scan")).json()
    flagged = {a["code"] for a in r["new_anomalies"]}
    assert r["scanned"] == len(demo_data.load_mock()["shipments"])
    # 2 SLA_EXCEEDED + 1 laporan rusak + 6 sengketa retur (lihat shipments.json)
    assert len(r["new_anomalies"]) == 9
    assert flagged == {"SLA_EXCEEDED", "BUYER_REPORTED_DAMAGE", "RETURN_DISPUTE"}
    # Dua resi 'lost': skenario utama (jam scan CCTV) dan satu resi SLA basi tanpa pergerakan.
    lost = sorted(a["reason_json"].get("days_stalled", a["reason_json"].get("days_late", 0))
                  for a in r["new_anomalies"] if a["case_type"] == "lost")
    assert len(lost) == 2
    assert (await client.post("/monitoring/scan")).json()["new_anomalies"] == []
    listed = (await client.get("/shipments", params={"limit": 100})).json()["items"]
    assert sum(1 for s in listed if s["active_anomaly"]) == len(r["new_anomalies"])


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


async def test_seller_error_closes_case_without_claim(client, db, monkeypatch):
    # Data mock menaruh scan resi ini di detik 300 cctv_packing_01 (menit ke-5). Fixture
    # `client` memakai rekaman sintetis 40 dtk untuk nama yang sama, jadi arahkan scan ke
    # detik 20 agar klip bisa dipotong dari rekaman uji itu.
    with db() as s:
        ship = ship_repo.get_by_tracking(s, SELLER)
        scan = ship_repo.get_pack_scan(s, ship.id)
        scan.scanned_at = scan.scanned_at.replace(minute=0, second=20)
        s.commit()
    use_scripted_agent(monkeypatch, db, tracking=SELLER, focus="consistency", decision={
        "decision": "seller_error", "confidence": 0.9,
        "verdict": "warna kaos yang dikemas berbeda dari pesanan",
        "reason": "CCTV menit ke-5 memperlihatkan kaos biru doubel dikemas, padahal pesanan biru tua (navy)."})
    inv_id = (await client.post("/demo/scenario/wrong_item_seller")).json()["investigation_id"]
    inv = await wait_status(client, inv_id, "completed", "failed")
    assert inv["outcome"] == "seller_error" and inv["claim_id"] is None
    assert (await client.get("/claims")).json()["total"] == 0
    detail = (await client.get(f"/shipments/{inv['shipment_id']}")).json()
    assert detail["anomaly"] is None  # kasus ditutup dengan keputusan, tidak ditagihkan ke kurir
    # Kesimpulan agen ikut menulis status resi: kesalahan ada di penjual, bukan kurir.
    assert detail["resolution"] == "seller" and "navy" in detail["resolution_reason"]
    logs = (await client.get("/audit-logs", params={"limit": 50})).json()
    assert "shipment_resolution_set" in {log["action"] for log in logs}
    assert (await client.get(f"/investigations/{inv_id}/buyer-request")).status_code == 409


async def test_claim_decision_sets_courier_cause_on_shipment(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db)
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    inv = await wait_status(client, inv_id, "completed")
    assert inv["outcome"] == "claim_drafted"
    detail = (await client.get(f"/shipments/{inv['shipment_id']}")).json()
    assert detail["resolution"] == "courier"
    assert detail["resolution_reason"]
    events = parse_sse((await client.get(f"/investigations/{inv_id}/stream")).text)
    decision = next(e for e in events if e["type"] == "decision")
    assert decision["payload"]["shipment_resolution"] == "courier"


async def test_needs_evidence_does_not_overrule_existing_resolution(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db, decision={
        "decision": "needs_evidence", "confidence": 0.5,
        "missing_evidence": ["video unboxing utuh"]})
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    inv = await wait_status(client, inv_id, "completed")
    detail = (await client.get(f"/shipments/{inv['shipment_id']}")).json()
    assert detail["resolution"] is None  # bukti kurang: tidak menuduh siapa pun


async def test_approve_blocked_while_resolution_points_at_seller(client, db, monkeypatch):
    with db() as s:
        ship = ship_repo.get_by_tracking(s, SELLER)
        scan = ship_repo.get_pack_scan(s, ship.id)
        scan.scanned_at = scan.scanned_at.replace(minute=0, second=20)
        s.commit()
    use_scripted_agent(monkeypatch, db, tracking=SELLER, focus="consistency", decision={
        "decision": "seller_error", "confidence": 0.9,
        "verdict": "warna kaos yang dikemas berbeda dari pesanan",
        "reason": "CCTV memperlihatkan kaos berbeda dari pesanan."})
    inv_id = (await client.post("/demo/scenario/wrong_item_seller")).json()["investigation_id"]
    inv = await wait_status(client, inv_id, "completed")
    with db() as s:  # draf dibuat manual: jalur ini hanya menguji pagar di approve
        from app.agents.outcome import InvestigationOutcome
        from app.models import Investigation as Inv
        from app.schemas.agent_outputs import ClaimDraft
        from app.services import claim_service as cs
        row = s.get(Inv, inv_id)
        draft = ClaimDraft(
            title="Klaim", tracking_number=SELLER, courier="sicepat", claim_type="lost",
            narrative="x" * 30, chronology=[{"at": row.started_at.isoformat(), "event": "scan"}],
            attachments=[], requested_compensation=95000)
        outcome = InvestigationOutcome(outcome="claim_drafted", draft=draft, evaluation={
            "decision": "claim", "confidence": 0.9, "verdict": "-", "reason": "-"})
        claim_id = cs.create_from_draft(s, row, outcome).id
        s.commit()
    blocked = await client.post(f"/claims/{claim_id}/approve")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "resolution_blocks_claim"

    rejected = await client.post(f"/claims/{claim_id}/reject", json={"reason": "Salah kirim dari gudang"})
    assert rejected.json()["status"] == "rejected"
    # Penolakan admin mencabut kesimpulan agen sehingga keputusan berikutnya milik manusia.
    detail = (await client.get(f"/shipments/{inv['shipment_id']}")).json()
    assert detail["resolution"] is None


async def test_buyer_request_drafted_for_needs_evidence(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db, decision={
        "decision": "needs_evidence", "confidence": 0.5,
        "missing_evidence": ["video unboxing utuh tanpa jeda", "foto kemasan luar"]})
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    assert (await wait_status(client, inv_id, "completed"))["outcome"] == "needs_evidence"
    draft = (await client.get(f"/investigations/{inv_id}/buyer-request")).json()
    assert draft["missing_evidence"] == ["video unboxing utuh tanpa jeda", "foto kemasan luar"]
    assert LOST in draft["message"] and "- foto kemasan luar" in draft["message"]
    assert draft["deadline"] and "paling lambat" in draft["message"]
    assert (await client.post(f"/investigations/{inv_id}/buyer-request",
                              json={"message": "x"})).status_code == 422
    sent = await client.post(f"/investigations/{inv_id}/buyer-request", json={"message": draft["message"]})
    assert sent.json() == {"status": "recorded"}
    actions = [a["action"] for a in (await client.get("/audit-logs", params={"limit": 50})).json()]
    assert "buyer_evidence_requested" in actions
    assert (await client.get("/claims")).json()["total"] == 0  # tidak ada yang dikirim ke kurir


async def test_review_time_and_case_audit_log(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db)
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    claim_id = (await wait_status(client, inv_id, "completed"))["claim_id"]
    assert (await client.get("/metrics/summary")).json()["avg_review_sec"] is None
    r = await client.post(f"/claims/{claim_id}/approve", json={"review_sec": 42.5})
    assert r.json()["status"] == "submitted"
    m = (await client.get("/metrics/summary")).json()
    assert m["avg_review_sec"] == 42.5 and m["reviewed_claims"] == 1
    logs = (await client.get("/audit-logs", params={"entity_id": [claim_id, inv_id], "limit": 50})).json()
    assert logs and {log["entity_id"] for log in logs} <= {claim_id, inv_id}
    assert {"claim_approved", "decision_made"} <= {log["action"] for log in logs}


async def test_reject_requires_reason_and_blocks_approve(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db)
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    claim_id = (await wait_status(client, inv_id, "completed"))["claim_id"]
    assert (await client.post(f"/claims/{claim_id}/reject", json={"reason": ""})).status_code == 422
    r = await client.post(f"/claims/{claim_id}/reject", json={"reason": "Bukti kurang jelas"})
    assert r.json()["status"] == "rejected" and r.json()["reject_reason"] == "Bukti kurang jelas"
    assert (await client.post(f"/claims/{claim_id}/approve")).status_code == 409


async def test_stream_requires_login(client, monkeypatch):
    """SSE memuat isi investigasi; tanpa sesi harus 401 (NFR-06)."""
    monkeypatch.setattr(get_settings(), "auth_required", True)
    anon = await client.get("/investigations/whatever/stream")
    assert anon.status_code == 401

    token = (await client.post("/auth/login", json={"password": get_settings().demo_password})).json()["token"]
    # Dengan sesi: lolos auth, lalu 404 karena investigasinya memang tidak ada
    ok = await client.get(
        "/investigations/whatever/stream", headers={"Authorization": f"Bearer {token}"}
    )
    assert ok.status_code == 404


async def test_auth_session_and_logout(client, monkeypatch):
    """Sesi dicek di server lewat cookie httpOnly; token tidak pernah dikirim ke penjaga rute."""
    # Tanpa AUTH_REQUIRED: semua dianggap sesi demo yang sah
    anon = (await client.get("/auth/session")).json()
    assert anon == {"authenticated": True, "user": "admin", "auth_required": False}

    monkeypatch.setattr(get_settings(), "auth_required", True)
    assert (await client.get("/auth/session")).json()["authenticated"] is False

    # Login menyetel cookie; klien test menyimpannya otomatis
    assert (await client.post("/auth/login", json={"password": get_settings().demo_password})).status_code == 200
    session = (await client.get("/auth/session")).json()
    assert session == {"authenticated": True, "user": "admin", "auth_required": True}
    assert "token" not in session  # jangan pernah membocorkan token ke halaman

    # Logout menghapus cookie dan idempoten
    assert (await client.post("/auth/logout")).status_code == 204
    assert (await client.get("/auth/session")).json()["authenticated"] is False
    assert (await client.post("/auth/logout")).status_code == 204


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


async def test_privacy_settings_persist(client):
    r = await client.patch("/settings", json={
        "video_retention_days": 14, "mask_pii": False, "deadline_reminder_hours": [24, 6],
        "medium_confidence": 0.5,
    })
    body = r.json()
    assert body["video_retention_days"] == 14 and body["mask_pii"] is False
    assert body["deadline_reminder_hours"] == [24, 6] and body["medium_confidence"] == 0.5
    reread = (await client.get("/settings")).json()
    assert reread["video_retention_days"] == 14 and reread["mask_pii"] is False
    # medium > tinggi ditolak
    assert (await client.patch("/settings", json={"medium_confidence": 0.95})).status_code == 422
    assert (await client.patch("/settings", json={"video_retention_days": 0})).status_code == 422


async def test_courier_thresholds_crud(client):
    initial = (await client.get("/settings/courier-thresholds")).json()
    assert {t["courier"] for t in initial} == {"jnt", "spx", "jne", "sicepat", "anteraja"}
    assert (await client.get("/settings")).json()["courier_thresholds"] == initial

    payload = [{"courier": "jne", "display_name": "JNE Express", "hold_days": 2,
                "sla_note": "Kargo & Reguler"},
               {"courier": "jnt", "display_name": "J&T Express", "hold_days": 5,
                "tag": "Longgar"}]
    updated = (await client.put("/settings/courier-thresholds", json=payload)).json()
    assert [(t["courier"], t["hold_days"]) for t in updated] == [("jne", 2), ("jnt", 5)]
    assert (await client.get("/settings/courier-thresholds")).json() == updated

    dup = payload + [payload[0]]
    assert (await client.put("/settings/courier-thresholds", json=dup)).status_code == 422
    bad = [{"courier": "JNE", "display_name": "x", "hold_days": 2}]
    assert (await client.put("/settings/courier-thresholds", json=bad)).status_code == 422


async def test_import_shipments_csv(client):
    csv_body = (
        b"tracking_number,courier,status,origin,destination,shipped_at,sla_deadline,"
        b"item_name,item_value\n"
        b"CSV0000000001,jne,in_transit,Bandung,Medan,2026-10-20T09:00:00Z,"
        b"2026-10-25T09:00:00Z,Kaos,150000\n"
        b"JNE0099887766,jne,delivered,Bandung,Medan,2026-10-16T05:00:00Z,"
        b"2026-10-20T05:00:00Z,Kaos,150000\n"
        b"CSV0000000002,kurir-asing,created,A,B,2026-10-20T09:00:00Z,"
        b"2026-10-21T09:00:00Z,X,1\n"
    )
    r = await client.post("/shipments/import",
                          files={"file": ("resi.csv", csv_body, "text/csv")})
    assert r.status_code == 200
    body = r.json()
    assert (body["imported"], body["updated"], body["skipped"]) == (1, 1, 1)
    assert body["errors"][0]["line"] == 4 and "kurir" in body["errors"][0]["message"]

    found = (await client.get("/shipments", params={"q": "CSV0000000001"})).json()
    assert found["total"] == 1 and found["items"][0]["courier"] == "jne"
    assert (await client.get("/shipments", params={"limit": 100})).json()["total"] \
        == len(demo_data.load_mock()["shipments"]) + 1

    missing = (await client.post("/shipments/import",
                                 files={"file": ("x.csv", b"a,b\n1,2\n", "text/csv")}))
    assert missing.status_code == 422 and missing.json()["error"]["code"] == "invalid_csv"
    template = await client.get("/shipments/import/template")
    assert template.status_code == 200 and template.text.startswith("tracking_number")


async def test_connections_status_and_toggle(client):
    body = (await client.get("/connections")).json()
    assert [m["id"] for m in body["marketplaces"]] == ["shopee", "tiktok_shop"]
    assert body["marketplaces"][0]["connected"] is False

    r = await client.patch("/connections/shopee", json={"connected": True})
    assert r.json()["connected"] is True
    assert (await client.get("/connections")).json()["marketplaces"][0]["connected"] is True
    assert (await client.patch("/connections/unknown", json={"connected": True})).status_code == 404
    r = await client.patch("/connections/tiktok_shop", json={"connected": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_available"


async def test_delete_and_purge_investigations(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db)
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    inv = await wait_status(client, inv_id, "completed")
    assert inv["evidence"]
    assert (await client.get("/claims")).json()["total"] == 1

    r = await client.delete(f"/investigations/{inv_id}")
    assert r.status_code == 200 and r.json()["deleted_evidence"] == 1
    assert (await client.get(f"/investigations/{inv_id}")).status_code == 404
    assert (await client.get("/claims")).json()["total"] == 0
    assert (await client.delete(f"/investigations/{inv_id}")).status_code == 404

    with db() as s:
        ship = ship_repo.get_by_tracking(s, LOST)
        assert s.get(Investigation, inv_id) is None
        assert ship is not None  # resi tidak ikut terhapus

    # purge: investigasi baru (dibuat 0 menit lalu) belum melewati retensi 1 hari.
    use_scripted_agent(monkeypatch, db)
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    await wait_status(client, inv_id, "completed")
    kept = (await client.post("/investigations/purge", params={"older_than_days": 1})).json()
    assert kept["deleted"] == 0

    # Investigasi dibuat baru saja, jadi retensi 1 hari tidak menyentuhnya.
    assert (await client.get(f"/investigations/{inv_id}")).status_code == 200
    actions = [a["action"] for a in (await client.get("/audit-logs", params={"limit": 50})).json()]
    assert "investigation_deleted" in actions


async def test_demo_reset_restores_data_and_keeps_policies(client, db, monkeypatch):
    use_scripted_agent(monkeypatch, db)
    inv_id = (await client.post("/demo/scenario/lost")).json()["investigation_id"]
    await wait_status(client, inv_id, "completed")
    report = (await client.post("/demo/reset")).json()
    assert report["shipments"] == len(demo_data.load_mock()["shipments"])
    assert report["missing_media"] == []
    assert (await client.get("/claims")).json()["total"] == 0
    assert (await client.get("/anomalies")).json() == []
    assert len((await client.get("/couriers/policies")).json()) == 3
