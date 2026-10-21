from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class EvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    investigation_id: str
    kind: Literal["cctv_clip", "unboxing", "photo"]
    clip_start_sec: float | None
    clip_duration_sec: float | None
    analysis_json: dict[str, Any] | None
    analysis_source: Literal["live", "cache"] | None
    created_at: datetime
