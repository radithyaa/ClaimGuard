"""Prompt agen sebagai aset berversi (SRS 12.1).

Placeholder memakai `$nama` (string.Template), bukan `{nama}` ala ADK, sehingga contoh JSON atau
kurung kurawal di prompt tidak pernah diinterpretasikan sebagai variabel state.
"""

import re
from functools import lru_cache
from pathlib import Path
from string import Template

_DIR = Path(__file__).parent
_VERSION_RE = re.compile(r"<!--\s*version:\s*([\w.-]+)\s*-->")


@lru_cache
def _load(name: str) -> tuple[str, str]:
    text = (_DIR / f"{name}.md").read_text(encoding="utf-8")
    m = _VERSION_RE.search(text)
    if not m:
        raise ValueError(f"prompt {name}.md tidak memiliki header versi")
    return m.group(1), _VERSION_RE.sub("", text).strip()


def prompt_version(name: str) -> str:
    return _load(name)[0]


def render(name: str, **values: object) -> str:
    """Isi placeholder. Nilai hilang dibiarkan sebagai `$nama` agar mudah terlihat saat debug."""
    return Template(_load(name)[1]).safe_substitute({k: str(v) for k, v in values.items()})
