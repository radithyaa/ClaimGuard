"""Klaim & HITL (SRS 3.4, FR-07, FR-13, FR-14).

Agen tidak pernah memanggil modul ini untuk mengirim. `submit_claim` hanya dicapai lewat
`approve`, dengan update atomik bersyarat status sehingga klik ganda menghasilkan 409.
"""

import uuid

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.agents.outcome import InvestigationOutcome
from app.core.errors import conflict, not_found
from app.models import Anomaly, Claim, Investigation, Shipment, utcnow
from app.services import audit

PENDING = "pending_approval"


def create_from_draft(db: Session, inv: Investigation, outcome: InvestigationOutcome) -> Claim:
    if outcome.outcome != "claim_drafted" or outcome.draft is None:
        raise ValueError("klaim hanya dibuat dari outcome claim_drafted dengan draf")
    claim = Claim(
        shipment_id=inv.shipment_id, investigation_id=inv.id, narrative=outcome.draft.narrative,
        draft_json={**outcome.draft.model_dump(), "draft_issues": outcome.draft_issues},
        status=PENDING, is_simulated=True,
    )
    db.add(claim)
    db.flush()
    audit.record(db, actor="agent:drafter", action="claim_drafted", entity="claim",
                 entity_id=claim.id, payload={"investigation_id": inv.id,
                                              "issues": outcome.draft_issues})
    return claim


def _get(db: Session, claim_id: str) -> Claim:
    claim = db.get(Claim, claim_id)
    if claim is None:
        raise not_found("Klaim")
    return claim


def _transition(db: Session, claim_id: str, **values) -> Claim:
    """UPDATE ... WHERE status='pending_approval'; 0 baris berarti status sudah berubah."""
    result = db.execute(
        update(Claim).where(Claim.id == claim_id, Claim.status == PENDING)
        .values(updated_at=utcnow(), **values)
        .execution_options(synchronize_session=False)
    )
    claim = _get(db, claim_id)
    if result.rowcount == 0:
        raise conflict("invalid_status", f"Klaim sudah berstatus '{claim.status}'")
    db.refresh(claim)
    return claim


def _resolve_anomaly(db: Session, claim: Claim) -> None:
    inv = db.get(Investigation, claim.investigation_id)
    if inv and inv.anomaly_id and (a := db.get(Anomaly, inv.anomaly_id)):
        a.status = "resolved"


def update_narrative(db: Session, claim_id: str, narrative: str, actor: str) -> Claim:
    claim = _transition(db, claim_id, narrative=narrative)
    audit.record(db, actor=actor, action="claim_edited", entity="claim", entity_id=claim.id,
                 payload={"length": len(narrative)})
    return claim


def submit_claim(claim: Claim, courier: str) -> str:
    """Simulasi pengiriman ke kurir (di luar lingkup: API kurir sungguhan)."""
    return f"SIM-{courier.upper()}-{uuid.uuid4().hex[:8].upper()}"


def approve(db: Session, claim_id: str, actor: str) -> Claim:
    claim = _get(db, claim_id)
    shipment = db.get(Shipment, claim.shipment_id)
    ref = submit_claim(claim, shipment.courier if shipment else "kurir")
    claim = _transition(db, claim_id, status="submitted", submitted_at=utcnow(),
                        submitted_by=actor, submission_ref=ref)
    _resolve_anomaly(db, claim)
    audit.record(db, actor=actor, action="claim_approved", entity="claim", entity_id=claim.id,
                 payload={"submission_ref": ref, "simulated": True})
    return claim


def reject(db: Session, claim_id: str, reason: str, actor: str) -> Claim:
    claim = _transition(db, claim_id, status="rejected", reject_reason=reason)
    _resolve_anomaly(db, claim)
    audit.record(db, actor=actor, action="claim_rejected", entity="claim", entity_id=claim.id,
                 payload={"reason": reason})
    return claim
