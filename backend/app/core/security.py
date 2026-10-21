"""Token sesi demo (FR-19): HMAC-SHA256 atas `user|expiry`, tanpa dependensi JWT."""

import base64
import hashlib
import hmac
import time

from app.core.config import get_settings

COOKIE_NAME = "cg_session"
DEMO_USER = "admin"


def _sign(payload: str) -> str:
    key = get_settings().session_secret.encode()
    return hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()


def create_token(user: str = DEMO_USER) -> tuple[str, int]:
    ttl = get_settings().session_ttl_hours * 3600
    expires = int(time.time()) + ttl
    payload = f"{user}|{expires}"
    raw = f"{payload}|{_sign(payload)}"
    return base64.urlsafe_b64encode(raw.encode()).decode(), ttl


def verify_token(token: str | None) -> str | None:
    """Mengembalikan nama user bila token valid dan belum kedaluwarsa."""
    if not token:
        return None
    try:
        user, expires, sig = base64.urlsafe_b64decode(token.encode()).decode().split("|")
        expires_at = int(expires)
    except (ValueError, UnicodeDecodeError):
        return None
    if not hmac.compare_digest(sig, _sign(f"{user}|{expires}")) or expires_at < time.time():
        return None
    return user


def check_password(password: str) -> bool:
    return hmac.compare_digest(password.encode(), get_settings().demo_password.encode())
