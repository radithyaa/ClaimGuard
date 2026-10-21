"""Cache respons AI berbasis file untuk fallback dan demo rekam-putar (SRS 13, FR-21).

Berkas JSON di `data/cache/<namespace>/<key>.json` di-commit sebelum pembekuan versi, sehingga
mode `cache` dan fallback `auto` bekerja walau Gemini mati (skenario E).
"""

import hashlib
import json
from pathlib import Path
from typing import Any, Literal

from app.core.config import get_settings

AIMode = Literal["live", "auto", "cache"]


def current_mode() -> AIMode:
    """Mode dari tabel settings (PATCH /settings); default dari config."""
    from app.services.settings_service import get_runtime  # impor lambat: hindari siklus

    return get_runtime().ai_mode


def cache_key(*parts: Any) -> str:
    raw = json.dumps(parts, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _path(namespace: str, key: str) -> Path:
    if not namespace.replace("_", "").replace("-", "").isalnum() or not key.isalnum():
        raise ValueError("namespace/key cache tidak valid")
    return Path(get_settings().ai_cache_dir) / namespace / f"{key}.json"


def load(namespace: str, key: str) -> dict[str, Any] | None:
    p = _path(namespace, key)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def save(namespace: str, key: str, value: dict[str, Any], *, meta: dict[str, Any] | None = None) -> None:
    p = _path(namespace, key)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {"meta": meta or {}, "value": value}
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
