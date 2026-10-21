"""Klien Gemini via Vertex AI (service account, tanpa API key — NFR-04).

Dipakai langsung oleh tool vision dan policy_extractor. Agen ADK memanggil model lewat ADK sendiri
(env GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION).
"""

import asyncio
import logging
import os
from functools import lru_cache
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.core.config import get_settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class AIUnavailable(Exception):
    """Gemini tidak dapat dipakai (belum dikonfigurasi, timeout, kuota, atau error layanan)."""


def configure_vertex_env() -> bool:
    """Arahkan model agen ADK ke Vertex AI dari config, agar cukup mengisi GCP_PROJECT.
    Mengembalikan False bila Vertex belum dikonfigurasi."""
    s = get_settings()
    if not s.gcp_project:
        return False
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", s.gcp_project)
    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", s.gcp_location)
    return True


@lru_cache
def _client():
    from google import genai

    s = get_settings()
    if not s.gcp_project:
        raise AIUnavailable("GCP_PROJECT belum diisi; Vertex AI belum dikonfigurasi")
    return genai.Client(vertexai=True, project=s.gcp_project, location=s.gcp_location)


async def generate_structured(  # noqa: UP047
    contents: list, schema: type[T], *, temperature: float = 0.0, retries: int = 1
) -> T:
    """Satu panggilan structured output dengan timeout dan retry eksponensial.

    Mode `auto` sebaiknya memakai retries=0 agar fallback ke cache cepat (NFR-01).
    """
    from google.genai import types

    s = get_settings()
    config = types.GenerateContentConfig(
        temperature=temperature, response_mime_type="application/json", response_schema=schema
    )
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = await asyncio.wait_for(
                _client().aio.models.generate_content(
                    model=s.gemini_model, contents=contents, config=config
                ),
                timeout=s.gemini_timeout_sec,
            )
            if isinstance(resp.parsed, schema):
                return resp.parsed
            return schema.model_validate_json(resp.text or "")
        except AIUnavailable:
            raise
        except ValidationError as exc:  # model menjawab di luar skema: jangan diulang terus
            raise AIUnavailable(f"output Gemini tidak sesuai skema: {exc.errors()[:2]}") from exc
        except Exception as exc:  # noqa: BLE001  (timeout, 429, 5xx)
            last = exc
            log.warning("gemini attempt %d gagal: %s", attempt + 1, exc)
            if attempt < retries:
                await asyncio.sleep(0.5 * 2**attempt)
    raise AIUnavailable(f"Gemini gagal setelah {retries + 1} percobaan: {last}")
