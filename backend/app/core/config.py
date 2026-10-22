"""Konfigurasi aplikasi dari environment / .env (pydantic-settings, gagal cepat — SRS 12.3).

Nilai yang dapat diubah saat berjalan (mode AI, ambang, scheduler) disimpan di tabel `settings`
lewat `services/settings_service.py`; nilai di sini adalah default-nya.
"""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_DEV_SECRET = "dev-only-secret-ganti-di-cloud"
_DEV_PASSWORD = "claimguard-demo"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["local", "cloud"] = "local"
    database_url: str = "sqlite:///./claimguard.db"
    # Boleh JSON (`["https://a", "https://b"]`) atau dipisah koma (`https://a,https://b`), karena nilai
    # env tanpa koma & tanpa kurung kotak dikira pydantic-settings sebagai JSON lalu gagal di-parse.
    # NoDecode: parsing JSON bawaan dimatikan, urusan pemisahan ditangani validator di bawah.
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    # Auth demo (FR-19): password tunggal, token HMAC
    auth_required: bool = False
    demo_password: str = _DEV_PASSWORD
    session_secret: str = _DEV_SECRET
    session_ttl_hours: int = 24

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

    # AI (Vertex AI)
    gcp_project: str | None = None
    gcp_location: str = "global"
    gemini_model: str = "gemini-2.5-flash"
    ai_mode: Literal["live", "auto", "cache"] = "auto"
    ai_cache_dir: str = "./data/cache"
    gemini_timeout_sec: float = 25.0
    min_confidence: float = 0.6
    medium_confidence: float = 0.4
    max_tool_calls: int = 8
    max_llm_calls: int = 20
    investigation_timeout_sec: float = 120.0

    # Privasi & retensi (tab Pengaturan > Privasi dan data)
    video_retention_days: int = 30
    mask_pii: bool = True
    deadline_reminder_hours: list[int] = [72, 24, 6]

    # Batas marketplace (tab Pengaturan > Koneksi dan sumber data)
    shopee_connected: bool = False
    tiktok_shop_connected: bool = False

    # Monitoring & data demo
    scan_interval_min: int = 5
    # 0 = aturan lama: bandingkan langsung dengan sla_deadline. Nilai > 0 menunda penandaan
    # sebesar N jam, melengkapi ambang tertahan per kurir (tabel courier_thresholds).
    sla_grace_hours: int = 3
    scheduler_enabled: bool = False
    seed_on_startup: bool = True
    mock_data_dir: str = "./data/mock"
    sample_media_dir: str = "./data/samples"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Terima "a,b" maupun ["a", "b"]. Trailing slash dibuang: browser mengirim origin
        tanpa slash, sehingga `https://x/` tidak akan pernah cocok."""
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                import json

                value = json.loads(text)
            else:
                value = text.split(",")
        if isinstance(value, list | tuple):
            return [str(v).strip().rstrip("/") for v in value if str(v).strip()]
        return value

    @model_validator(mode="after")
    def _cloud_requires_real_secrets(self) -> "Settings":
        if self.env == "cloud" and (
            self.session_secret == _DEV_SECRET or self.demo_password == _DEV_PASSWORD
        ):
            raise ValueError("ENV=cloud wajib mengisi SESSION_SECRET dan DEMO_PASSWORD")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
