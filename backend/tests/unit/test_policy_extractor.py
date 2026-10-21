import pytest

from app.core.config import get_settings
from app.repositories import policies as policy_repo
from app.services import ai_cache, gemini_client, policy_extractor
from app.services.policy_extractor import PolicyExtract

DOC = "# Kebijakan Klaim JNE\nKlaim maksimal 14 hari. Wajib foto resi dan video packing."


@pytest.fixture
def policy_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_cache_dir", str(tmp_path / "cache"))
    d = tmp_path / "policies"
    d.mkdir()
    (d / "jne.md").write_text(DOC, encoding="utf-8")
    return d


async def test_live_then_cache_fallback(db, policy_dir, monkeypatch):
    async def ok(contents, schema, **kw):
        return PolicyExtract(claim_window_days=14, required_docs=["foto resi", "video packing"],
                             max_compensation="10x ongkir")

    monkeypatch.setattr(gemini_client, "generate_structured", ok)
    with db() as s:
        assert await policy_extractor.extract_all(s, policy_dir) == {"jne": "live"}
        s.commit()

    async def dead(contents, schema, **kw):
        raise gemini_client.AIUnavailable("mati")

    monkeypatch.setattr(gemini_client, "generate_structured", dead)
    with db() as s:
        assert await policy_extractor.extract_all(s, policy_dir) == {"jne": "cache"}
        s.commit()
        p = policy_repo.get_by_courier(s, "JNE")
        assert p.claim_window_days == 14 and p.extraction_source == "cache"


async def test_skipped_without_ai_or_cache(db, policy_dir, monkeypatch):
    monkeypatch.setattr(ai_cache, "current_mode", lambda: "cache")
    with db() as s:
        assert await policy_extractor.extract_all(s, policy_dir) == {"jne": "skipped"}
