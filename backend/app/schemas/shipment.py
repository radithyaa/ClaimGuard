from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

CaseType = Literal["lost", "damaged", "return_fraud"]
Severity = Literal["low", "medium", "high"]


class AnomalyBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    code: str
    case_type: CaseType
    severity: Severity


class AnomalyOut(AnomalyBrief):
    shipment_id: str
    reason_json: dict[str, Any]
    detected_at: datetime
    status: Literal["open", "investigating", "resolved"]


class ShipmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    tracking_number: str
    courier: str
    status: str
    origin: str
    destination: str
    shipped_at: datetime
    sla_deadline: datetime
    item_name: str
    item_value: int
    is_simulated: bool
    active_anomaly: AnomalyBrief | None = None
    claim_deadline: datetime | None = None  # None bila kebijakan kurir belum ada


class TrackingEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    status: str
    location: str
    occurred_at: datetime


class InvestigationBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    status: str
    outcome: str | None
    started_at: datetime


class ClaimBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    status: str


class ShipmentDetailOut(ShipmentOut):
    buyer_report: str | None
    tracking_events: list[TrackingEventOut]
    anomaly: AnomalyOut | None
    latest_investigation: InvestigationBrief | None
    latest_claim: ClaimBrief | None


class ScanResultOut(BaseModel):
    scanned: int
    new_anomalies: list[AnomalyOut]


class CourierPolicyOut(BaseModel):
    courier: str
    claim_window_days: int
    required_docs: list[str]
    max_compensation: str
    extra: dict[str, Any]
    source: Literal["live", "cache", "manual"]
    extracted_at: datetime

    @classmethod
    def of(cls, p) -> "CourierPolicyOut":
        return cls(courier=p.courier, claim_window_days=p.claim_window_days,
                   required_docs=p.required_docs_json, max_compensation=p.max_compensation,
                   extra=p.extra_json, source=p.extraction_source, extracted_at=p.extracted_at)
