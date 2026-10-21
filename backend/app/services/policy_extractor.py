"""Ekstraksi dokumen kebijakan kurir (Markdown) menjadi JSON terstruktur (FR-05).

Dijalankan sekali oleh seed.py, bukan per investigasi. Urutan sumber: Gemini (live) -> cache.
Bila keduanya tidak ada, kurir dilewati dan dilaporkan; agen akan menerima error policy_not_found.
"""

import logging
from pathlib import Path

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.repositories import policies as policy_repo
from app.services import ai_cache, gemini_client

log = logging.getLogger(__name__)
PROMPT_VERSION = "policy-v1"
PROMPT = (
    "Ekstrak ketentuan klaim ganti rugi dari dokumen kebijakan kurir berikut. Gunakan hanya isi "
    "dokumen; bila suatu ketentuan tidak disebut, kosongkan atau tulis 'tidak disebutkan'.\n\n"
)


class PolicyExtract(BaseModel):
    claim_window_days: int = Field(ge=0, description="Batas hari pengajuan klaim sejak kejadian")
    required_docs: list[str] = Field(description="Dokumen/bukti wajib")
    max_compensation: str = Field(description="Batas ganti rugi, ringkas")
    insurance_note: str = ""
    exclusions: list[str] = Field(default_factory=list, description="Kondisi yang tidak ditanggung")


async def extract_one(courier: str, text: str) -> tuple[PolicyExtract, str] | None:
    key = ai_cache.cache_key(courier, text, PROMPT_VERSION)
    if ai_cache.current_mode() != "cache":
        try:
            result = await gemini_client.generate_structured([PROMPT + text], PolicyExtract)
            ai_cache.save("policy", key, result.model_dump(), meta={"courier": courier})
            return result, "live"
        except gemini_client.AIUnavailable as exc:
            log.warning("ekstraksi live %s gagal: %s", courier, exc)
    cached = ai_cache.load("policy", key)
    if cached:
        return PolicyExtract.model_validate(cached["value"]), "cache"
    return None


async def extract_all(db: Session, policy_dir: Path) -> dict[str, str]:
    """Mengembalikan {courier: 'live'|'cache'|'skipped'}. Nama berkas = kode kurir (jne.md)."""
    report: dict[str, str] = {}
    for path in sorted(policy_dir.glob("*.md")):
        courier = policy_repo.normalize_courier(path.stem)
        text = path.read_text(encoding="utf-8")
        got = await extract_one(courier, text)
        if got is None:
            report[courier] = "skipped"
            continue
        p, source = got
        policy_repo.upsert(
            db, courier, claim_window_days=p.claim_window_days, required_docs_json=p.required_docs,
            max_compensation=p.max_compensation,
            extra_json={"insurance_note": p.insurance_note, "exclusions": p.exclusions},
            source_text=text, extraction_source=source,
        )
        report[courier] = source
    return report
