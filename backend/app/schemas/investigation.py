from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.evidence import EvidenceOut

InvestigationStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
Outcome = Literal["claim_drafted", "needs_evidence", "fraud_suspect"]
EventType = Literal[
    "status", "tool_start", "tool_end", "thought", "decision", "done", "error", "cancelled"
]


class InvestigationEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seq: int
    investigation_id: str
    type: EventType
    agent: str | None
    payload_json: dict[str, Any]
    source: Literal["live", "cache"] | None
    created_at: datetime


class InvestigationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    shipment_id: str
    anomaly_id: str | None
    case_type: Literal["lost", "damaged", "return_fraud"]
    status: InvestigationStatus
    outcome: Outcome | None
    verdict: str | None
    confidence: float | None
    decision_reason: str | None
    error: str | None
    started_at: datetime
    finished_at: datetime | None
    duration_ms: int | None


class InvestigationDetailOut(InvestigationOut):
    evidence: list[EvidenceOut] = []
    claim_id: str | None = None
