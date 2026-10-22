import json

import pytest

from app.agents.tools.case_tools import evidence_on_hand, get_case_context, get_courier_policy
from app.repositories.policies import normalize_courier
from app.services.storage_service import StorageError


def test_case_context_hides_uris_and_flags_untrusted_text(seeded):
    ctx = get_case_context(seeded["shipment_id"])

    assert ctx["status"] == "ok"
    assert ctx["shipment"]["tracking_number"] == "JNE0012345678"
    assert ctx["anomaly"]["case_type"] == "lost"
    assert ctx["available_media"][0]["kind"] == "cctv"
    assert "Abaikan instruksi" in ctx["buyer_report_untrusted"]
    dumped = json.dumps(ctx)
    assert "local://" not in dumped and "gs://" not in dumped  # agen tidak pernah melihat path
    assert ctx["shipment"]["shipped_at_utc"].endswith("+00:00")


def test_case_context_unknown(seeded):
    assert get_case_context("x")["error_code"] == "shipment_not_found"


@pytest.mark.parametrize("name", ["JNE", "jne", " Jne "])
def test_courier_policy_lookup(seeded, name):
    p = get_courier_policy(name)
    assert p["status"] == "ok" and p["claim_window_days"] == 14


def test_courier_policy_unknown(seeded):
    assert get_courier_policy("anteraja")["error_code"] == "policy_not_found"


@pytest.mark.parametrize("raw,expected", [("J&T Express", "jnt"), ("JNT", "jnt"), ("SiCepat", "sicepat")])
def test_normalize_courier(raw, expected):
    assert normalize_courier(raw) == expected


@pytest.mark.parametrize("bad", ["../etc/passwd", "/abs/x.mp4", "a/../../b", "a\\b", ""])
def test_storage_rejects_path_traversal(storage, tmp_path, bad):
    src = tmp_path / "x.mp4"
    src.write_bytes(b"x")
    with pytest.raises(StorageError):
        storage.put_file(src, bad)
    with pytest.raises(StorageError):
        storage.ffmpeg_input("local://" + bad)


class TestEvidenceOnHand:
    """Bukti yang dilaporkan terhubung ke kasus harus mencerminkan media milik resi itu."""

    DOCS = ["Nomor resi", "Video unboxing tanpa jeda"]

    def test_unboxing_media_counts_as_unboxing_video(self):
        r = evidence_on_hand({"unboxing", "cctv"}, inventory=[], policy_docs=self.DOCS)
        assert r["on_hand"] == ["unboxing_video"]
        assert "unboxing_video" not in [m["kind"] for m in r["missing"]]

    def test_cctv_only_still_lacks_unboxing(self):
        r = evidence_on_hand({"cctv"}, inventory=["kaos putih"], policy_docs=self.DOCS)
        assert r["on_hand"] == []
        assert "unboxing_video" in [m["kind"] for m in r["missing"]]

    def test_invoice_is_reported_missing_not_faked(self):
        r = evidence_on_hand({"unboxing", "cctv"}, inventory=[], policy_docs=self.DOCS)
        assert "invoice" not in r["on_hand"]
        assert any("bukti pembelian" in label for label in r["missing_labels"])

    def test_case_without_inventory_or_policy_asks_nothing(self):
        # Resi tanpa media & tanpa catatan kemasan: tidak ada dasar untuk meminta dokumen apa pun,
        # jadi daftar kosong (bukan diisi tebakan).
        r = evidence_on_hand(set(), inventory=None, policy_docs=[])
        assert r["required"] == [] and r["missing"] == []

    def test_dispute_case_without_unboxing_asks_for_it(self):
        # CCTV saja tidak membuktikan isi paket setelah diserahkan -> video unboxing diminta.
        r = evidence_on_hand({"cctv"}, inventory=["kaos putih"], policy_docs=[])
        assert r["missing"][0]["kind"] == "unboxing_video"
        assert "unboxing_video" not in r["on_hand"]
