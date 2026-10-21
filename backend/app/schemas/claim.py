from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.evidence import EvidenceOut
from app.schemas.investigation import InvestigationDetailOut
from app.schemas.shipment import CaseType, CourierPolicyOut

ClaimStatus = Literal["pending_approval", "submitted", "rejected"]


class ClaimSummaryOut(BaseModel):
    id: str
    shipment_id: str
    tracking_number: str
    courier: str
    status: ClaimStatus
    confidence: float | None
    claim_value: int
    created_at: datetime
    is_simulated: bool
    case_type: CaseType | None
    claim_deadline: datetime | None


class ClaimDetailOut(ClaimSummaryOut):
    investigation_id: str
    narrative: str
    draft: dict[str, Any]
    draft_issues: list[str]
    decision_reason: str | None
    item_name: str
    item_value: int
    updated_at: datetime
    submitted_at: datetime | None
    submitted_by: str | None
    submission_ref: str | None
    reject_reason: str | None
    evidence: list[EvidenceOut]
    courier_policy: CourierPolicyOut | None


class ClaimPatchIn(BaseModel):
    narrative: str = Field(min_length=20, max_length=8000)


class ApproveIn(BaseModel):
    # H5: lama admin meninjau (detik), diukur di layar Review klaim
    review_sec: float | None = Field(default=None, ge=0, le=86400)


class RejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)
    review_sec: float | None = Field(default=None, ge=0, le=86400)


class BuyerRequestOut(BaseModel):
    """F6: draf pesan ke pembeli; tidak dikirim otomatis."""

    investigation_id: str
    tracking_number: str
    courier: str
    missing_evidence: list[str]
    deadline: datetime | None
    message: str


class BuyerRequestIn(BaseModel):
    message: str = Field(min_length=10, max_length=4000)


class StartInvestigationIn(BaseModel):
    shipment_id: str = Field(min_length=1, max_length=36)


class StartInvestigationOut(BaseModel):
    investigation_id: str


class InvestigationViewOut(InvestigationDetailOut):
    """Detail untuk halaman investigasi live: plus konteks resi & kebijakan kurir (FR-05)."""

    tracking_number: str
    courier: str
    anomaly_reason: dict[str, Any] | None
    courier_policy: CourierPolicyOut | None
    is_active: bool


class MediaUrlOut(BaseModel):
    evidence_id: str
    kind: str
    url: str
    expires_in: int | None
