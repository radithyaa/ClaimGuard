"""Penyiapan media rekaman: pencocokan berkas, durasi hasil probe, unggahan, dan pesan error."""

import asyncio
import shutil

import pytest
from sqlalchemy import delete, select

from app.agents.tools import vision_tools
from app.models import CourierPolicy, Investigation, MediaAsset, Shipment
from app.services import demo_data, media_ingest
from tests.conftest import seed_case


def _write_video(path, cctv_video):
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(cctv_video, path)
    return path


class TestFindSample:
    def test_tolerates_case_and_extension(self, tmp_path, cctv_video):
        _write_video(tmp_path / "CCTV_Packing_01.MOV", cctv_video)
        assert demo_data.find_sample(tmp_path, "cctv_packing_01.mp4") == tmp_path / "CCTV_Packing_01.MOV"

    def test_ignores_partial_and_hidden_names(self, tmp_path, cctv_video):
        _write_video(tmp_path / "cctv_packing_01_extended.mp4", cctv_video)
        _write_video(tmp_path / ".cctv_packing_01.mp4", cctv_video)
        _write_video(tmp_path / "cctv_packing_01.mp4.bak", cctv_video)
        assert demo_data.find_sample(tmp_path, "cctv_packing_01.mp4") is None

    def test_ambiguous_names_are_rejected(self, tmp_path, cctv_video):
        _write_video(tmp_path / "cctv_packing_01.mp4", cctv_video)
        _write_video(tmp_path / "cctv_packing_01.mkv", cctv_video)
        assert demo_data.find_sample(tmp_path, "cctv_packing_01.mp4") is None


class TestSeedUsesRealDuration:
    def test_duration_is_measured_not_trusted(self, db, storage, tmp_path, monkeypatch, cctv_video):
        # Video hanya 40 detik walau shipments.json menyebut 180 detik.
        _write_video(tmp_path / "cctv_packing_01.mp4", cctv_video)
        monkeypatch.setattr(demo_data.get_settings(), "sample_media_dir", str(tmp_path))
        monkeypatch.setattr(demo_data.get_settings(), "storage_local_root", str(storage.root))
        with db() as s:
            report = demo_data.reset_and_seed(s)
            cctv = s.scalar(select(MediaAsset).where(
                MediaAsset.uri == "local://samples/cctv_packing_01.mp4"))
            duration = cctv.duration_sec
            s.commit()
        assert duration == pytest.approx(40, abs=0.5)
        # Berkas yang belum ditaruh dilaporkan, bukan diajukan dengan metadata palsu.
        assert "unboxing_vas.mp4" in report["missing_media"]

    def test_scan_outside_recording_is_reported(self, tmp_path, cctv_video, monkeypatch):
        from app.tools import check_media

        # Folder ini sengaja hanya berisi CCTV: pastikan pengecekan tidak ikut membaca
        # storage lokal hasil seed/tes lain (yang bisa berisi semua sampel).
        monkeypatch.setattr(check_media.get_settings(), "storage_local_root",
                            str(tmp_path / "storage-kosong"))
        _write_video(tmp_path / "cctv_packing_01.mp4", cctv_video)
        checks = {c.key: c for c in check_media.check_media(samples_dir=tmp_path)}
        assert checks["cctv_packing_01"].status == check_media.STATUS_OK
        assert "scan_outside_recording" in checks["cctv_packing_01"].note
        assert checks["unboxing_vas"].status == check_media.STATUS_MISSING

    def test_scan_offsets_follow_recorded_start(self):
        from app.tools import check_media

        rows = dict(check_media.scan_offsets(demo_data.load_mock(), "cctv_packing_01", 40))
        assert rows["JNE0012345678"] == "2026-10-17T01:00:40Z"
        assert rows["SCP5566778899"] == "2026-10-17T01:00:40Z"


class TestAnalyzeMediaErrors:
    def test_missing_unboxing_has_actionable_error(self, db, storage, cctv_video):
        case = seed_case(db, storage, cctv_video)
        with db() as s:
            ship = s.get(Shipment, case["shipment_id"])
            s.add(MediaAsset(kind="unboxing", uri="local://samples/tidak_ada.mp4",
                             shipment_id=ship.id))
            inv = Investigation(shipment_id=ship.id, case_type="lost")
            s.add(inv)
            s.commit()
            media_id = s.scalar(select(MediaAsset.id).where(MediaAsset.kind == "unboxing"))
            inv_id = inv.id
        result = asyncio.run(vision_tools.analyze_media_for(
            media_id, "damage", inv_id, case["shipment_id"]))
        assert result["error_code"] == "media_missing"
        assert "tidak tersedia" in result["message"]

    def test_media_of_other_shipment_is_rejected(self, db, storage, cctv_video):
        case_a = seed_case(db, storage, cctv_video, tracking_number="AAA0000000001")
        with db() as s:  # seed_case kedua tidak boleh bentrok kebijakan kurir
            s.execute(delete(CourierPolicy))
            s.commit()
        case_b = seed_case(db, storage, cctv_video, tracking_number="BBB0000000002")
        with db() as s:
            other = MediaAsset(kind="unboxing", uri="local://samples/x.mp4",
                               shipment_id=case_b["shipment_id"])
            s.add(other)
            inv = s.get(Investigation, case_a["investigation_id"])
            s.commit()
            media_id, inv_id = other.id, inv.id
        result = asyncio.run(vision_tools.analyze_media_for(
            media_id, "damage", inv_id, case_a["shipment_id"]))
        assert result["error_code"] == "evidence_not_found"


class FakeUpload:
    filename = "unboxing.mp4"
    content_type = "video/mp4"

    def __init__(self, content: bytes):
        self._content = content

    async def read(self) -> bytes:
        return self._content


class TestIngestUpload:
    def test_ingest_is_idempotent_and_can_replace(self, db, storage, cctv_video):
        """Unggah ulang berkas yang sama memperbarui rekaman, bukan menumpuk aset ganda."""
        case = seed_case(db, storage, cctv_video)
        with db() as s:
            tracking = s.get(Shipment, case["shipment_id"]).tracking_number
            first = asyncio.run(media_ingest.ingest(
                s, "tester", FakeUpload(cctv_video.read_bytes()),
                shipment_tracking=tracking))
        with db() as s:
            second = asyncio.run(media_ingest.ingest(
                s, "tester", FakeUpload(cctv_video.read_bytes()),
                shipment_tracking=tracking))
            assets = s.scalars(select(MediaAsset).where(
                MediaAsset.shipment_id == case["shipment_id"],
                MediaAsset.kind == "unboxing")).all()
        assert first["duration_sec"] == pytest.approx(40, abs=0.5)
        # Kunci berkas sama -> berkas tidak hilang, tetapi asetnya diganti (bukan dobel).
        assert [a.id for a in assets] == [second["media_id"]]

    def test_rejects_unknown_shipment_and_non_video(self, db, storage, cctv_video):
        with db() as s, pytest.raises(ValueError, match="tidak ditemukan"):
            asyncio.run(media_ingest.ingest(
                s, "tester", FakeUpload(cctv_video.read_bytes()),
                shipment_tracking="TIDAK-ADA"))
        case = seed_case(db, storage, cctv_video)
        with db() as s:
            tracking = s.get(Shipment, case["shipment_id"]).tracking_number
            with pytest.raises(ValueError, match="tidak dapat dibaca"):
                asyncio.run(media_ingest.ingest(
                    s, "tester", FakeUpload(b"bukan video"), shipment_tracking=tracking))
