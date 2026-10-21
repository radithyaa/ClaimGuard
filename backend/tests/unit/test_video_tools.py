from datetime import timedelta
from types import SimpleNamespace

import pytest

from app.agents.tools.video_tools import clip_cctv_for_shipment, clip_cctv_video
from app.models import Evidence, PackScanLog
from app.services import video_service
from tests.conftest import REC_START


async def test_clip_around_pack_scan(seeded, storage, db):
    res = await clip_cctv_for_shipment(seeded["shipment_id"], seeded["investigation_id"], 10, 15)

    assert res["status"] == "ok", res
    assert res["duration_sec"] == 25
    assert res["pack_scan_at_clip_sec"] == 10
    assert res["clip_start_utc"] == (REC_START + timedelta(seconds=10)).isoformat()
    with db() as s:
        ev = s.get(Evidence, res["evidence_id"])
        assert ev.kind == "cctv_clip" and ev.source_media_id == seeded["cctv_id"]
        path = storage.ffmpeg_input(ev.uri)
    duration = await video_service.probe_duration(path)
    assert duration == pytest.approx(25, abs=0.5)


async def test_clip_is_bounded_by_recording(seeded):
    # scan di detik 20, rekaman 40 detik: post 30 dipotong menjadi akhir rekaman
    res = await clip_cctv_for_shipment(seeded["shipment_id"], seeded["investigation_id"], 0, 30)
    assert res["status"] == "ok"
    assert res["duration_sec"] == 20


async def test_clip_rejects_too_long(seeded):
    res = await clip_cctv_for_shipment(seeded["shipment_id"], seeded["investigation_id"], 20, 20)
    assert res == {"status": "error", "error_code": "clip_too_long", "message": res["message"]}


async def test_scan_outside_recording(seeded, db):
    with db() as s:
        scan = s.query(PackScanLog).one()
        scan.scanned_at = REC_START + timedelta(minutes=5)
        s.commit()
    res = await clip_cctv_for_shipment(seeded["shipment_id"], seeded["investigation_id"], 10, 10)
    assert res["error_code"] == "scan_outside_recording"


async def test_unknown_shipment(seeded):
    res = await clip_cctv_for_shipment("tidak-ada", seeded["investigation_id"], 10, 10)
    assert res["error_code"] == "shipment_not_found"


async def test_adk_wrapper_reads_investigation_from_state(seeded):
    ctx = SimpleNamespace(state={"investigation_id": seeded["investigation_id"]})
    res = await clip_cctv_video(seeded["shipment_id"], 5, 5, tool_context=ctx)
    assert res["status"] == "ok"
    missing = await clip_cctv_video(seeded["shipment_id"], 5, 5, tool_context=None)
    assert missing["error_code"] == "no_investigation"
