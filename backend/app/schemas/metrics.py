from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class TrendPoint(BaseModel):
    date: str  # YYYY-MM-DD (WIB)
    anomalies: int
    claims: int


class MetricsSummaryOut(BaseModel):
    active_anomalies: int
    pending_claims: int
    submitted_claims: int
    estimated_value_saved: int
    avg_processing_sec: float | None
    trend: list[TrendPoint]
    is_simulated: bool = True


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    actor: str
    action: str
    entity: str
    entity_id: str | None
    payload_json: dict[str, Any]
    created_at: datetime


class LoginIn(BaseModel):
    password: str


class LoginOut(BaseModel):
    token: str
    expires_in: int


class SessionOut(BaseModel):
    """Status sesi untuk dicek di server (route handler Next.js). Token tidak pernah dikirim."""

    authenticated: bool
    user: str | None = None
    auth_required: bool


class HealthOut(BaseModel):
    status: str
    db: str
    ai_mode: str
    storage: str
