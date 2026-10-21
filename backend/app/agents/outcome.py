"""Hasil akhir run agen untuk disimpan Backend B (investigations + claims)."""

from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.agent_outputs import ClaimDraft, Evaluation

OUTCOME_BY_DECISION = {
    "claim": "claim_drafted",
    "needs_evidence": "needs_evidence",
    "fraud_suspect": "fraud_suspect",
}


class InvestigationOutcome(BaseModel):
    outcome: Literal["claim_drafted", "needs_evidence", "fraud_suspect"]
    evaluation: Evaluation
    guard_applied: bool = False
    draft: ClaimDraft | None = None
    draft_issues: list[str] = []
    notes: str | None = None


class OutcomeError(Exception):
    pass


def persist_outcome(state: dict[str, Any]) -> InvestigationOutcome:
    """Validasi state akhir. `claim_drafted` tanpa draf valid diturunkan ke needs_evidence."""
    if not state.get("evaluation"):
        raise OutcomeError("Evaluator tidak menghasilkan keputusan")
    evaluation = Evaluation.model_validate(state["evaluation"])
    draft = ClaimDraft.model_validate(state["claim_draft"]) if state.get("claim_draft") else None
    outcome = OUTCOME_BY_DECISION[evaluation.decision]
    issues = list(state.get("draft_issues") or [])
    if outcome == "claim_drafted" and draft is None:
        outcome, issues = "needs_evidence", [*issues, "draf klaim tidak dihasilkan"]
    return InvestigationOutcome(
        outcome=outcome, evaluation=evaluation, guard_applied=bool(state.get("guard_applied")),
        draft=draft if outcome == "claim_drafted" else None, draft_issues=issues,
        notes=state.get("investigation_notes"),
    )
