"""Konfigurasi: parsing CORS_ORIGINS dari env (sumber error paling sering saat deploy)."""

import pytest

from app.core.config import Settings


def _origins(monkeypatch, value: str) -> list[str]:
    monkeypatch.setenv("CORS_ORIGINS", value)
    return Settings().cors_origins


def test_single_origin_without_brackets(monkeypatch):
    """Nilai tunggal tanpa kurung kotak dulu ditolak: pydantic-settings mengiranya JSON."""
    assert _origins(monkeypatch, "https://claimguard-web-123.run.app") == [
        "https://claimguard-web-123.run.app"
    ]


def test_comma_separated(monkeypatch):
    assert _origins(monkeypatch, "https://a.run.app, https://b.run.app") == [
        "https://a.run.app",
        "https://b.run.app",
    ]


def test_json_list_still_supported(monkeypatch):
    assert _origins(monkeypatch, '["https://a.run.app","http://localhost:3000"]') == [
        "https://a.run.app",
        "http://localhost:3000",
    ]


def test_trailing_slash_and_empty_entries_removed(monkeypatch):
    # Browser mengirim Origin tanpa slash; "https://a/" tidak akan pernah cocok.
    assert _origins(monkeypatch, "https://a.run.app/,,  ") == ["https://a.run.app"]


def test_invalid_json_reports_clearly(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", '["https://a.run.app"')
    with pytest.raises(ValueError):
        Settings()
