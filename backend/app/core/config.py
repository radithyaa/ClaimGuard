"""Konfigurasi aplikasi dari environment / .env.

Bootstrap oleh Backend A agar layer data & tools bisa jalan; pemilik berkas ini Backend B (SRS bagian 9).
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["local", "cloud"] = "local"
    database_url: str = "sqlite:///./claimguard.db"

    # Penyimpanan media: "local" memakai folder, "gcs" memakai Cloud Storage
    storage_backend: Literal["local", "gcs"] = "local"
    storage_local_root: str = "./storage"
    gcs_bucket: str | None = None
    signed_url_ttl_sec: int = 3600
    public_base_url: str = "http://localhost:8000"

    # Video
    ffmpeg_path: str | None = None
    ffmpeg_timeout_sec: float = 30.0
    clip_min_sec: int = 5
    clip_max_sec: int = 30

    # AI (Vertex AI) — belum dipakai sampai billing aktif
    gcp_project: str | None = None
    gcp_location: str = "global"
    gemini_model: str = "gemini-flash-latest"
    ai_mode: Literal["live", "auto", "cache"] = "auto"
    ai_cache_dir: str = "./data/cache"
    gemini_timeout_sec: float = 25.0
    min_confidence: float = 0.6
    max_tool_calls: int = 8


@lru_cache
def get_settings() -> Settings:
    return Settings()
