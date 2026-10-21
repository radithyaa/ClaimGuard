import json

import pytest

from app.agents.tools.case_tools import get_case_context, get_courier_policy
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
