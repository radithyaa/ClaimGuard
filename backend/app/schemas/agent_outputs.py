"""Structured output agen (output_schema ADK) dan hasil tool vision. FR-10, FR-22, FR-06."""

from typing import Literal

from pydantic import BaseModel, Field

CaseType = Literal["lost", "damaged", "return_fraud"]
MediaFocus = Literal["packing", "damage", "consistency"]
Decision = Literal["claim", "needs_evidence", "fraud_suspect"]


class TimestampEvidence(BaseModel):
    t_sec: float = Field(ge=0, description="Detik dalam klip/video tempat temuan terlihat")
    label: str = Field(description="Deskripsi singkat apa yang terlihat pada detik ini")


class Finding(BaseModel):
    description: str
    severity: Literal["info", "warning", "critical"] = "info"


class VisionAnalysis(BaseModel):
    """Hasil analyze_media. Verdict bergantung focus:
    packing -> item_packed | item_not_packed | unclear
    damage -> damaged | not_damaged | unclear
    consistency -> consistent | inconsistent | unclear
    """

    verdict: Literal[
        "item_packed",
        "item_not_packed",
        "damaged",
        "not_damaged",
        "consistent",
        "inconsistent",
        "unclear",
    ]
    confidence: float = Field(ge=0, le=1)
    findings: list[Finding] = Field(default_factory=list)
    timestamp_evidence: list[TimestampEvidence] = Field(default_factory=list)


class Evaluation(BaseModel):
    """Output Evaluator: titik keputusan agentic (FR-22)."""

    decision: Decision
    confidence: float = Field(ge=0, le=1)
    verdict: str = Field(description="Ringkasan satu frasa, mis. 'paket hilang setelah serah ke kurir'")
    reason: str = Field(description="Alasan keputusan dalam bahasa Indonesia sederhana, merujuk bukti")
    evidence_ids: list[str] = Field(default_factory=list, description="Evidence yang mendukung")
    missing_evidence: list[str] = Field(
        default_factory=list, description="Bukti yang kurang bila decision=needs_evidence"
    )


class ChronologyItem(BaseModel):
    at: str = Field(description="Waktu ISO 8601 UTC, harus berasal dari data kasus")
    event: str


class ClaimDraft(BaseModel):
    """Output Drafter (FR-06). Narasi hanya boleh memakai fakta dari state."""

    title: str
    tracking_number: str
    courier: str
    claim_type: Literal["lost", "damaged"]
    narrative: str
    chronology: list[ChronologyItem]
    attachments: list[str] = Field(description="evidence_id yang dilampirkan")
    requested_compensation: int = Field(ge=0, description="Rupiah, tidak melebihi batas kebijakan")
    policy_notes: list[str] = Field(default_factory=list, description="Syarat kurir yang dipenuhi")
