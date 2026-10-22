from fastapi import APIRouter, Query
from sqlalchemy import case, func, select

from app.api.deps import DB, User
from app.core.errors import not_found
from app.models import Claim, Investigation, Shipment
from app.repositories import investigations as inv_repo
from app.repositories import policies as policy_repo
from app.schemas.claim import (
    ApproveIn,
    ClaimDetailOut,
    ClaimPatchIn,
    ClaimStatus,
    ClaimSummaryOut,
    RejectIn,
)
from app.schemas.common import ERROR_RESPONSES, Page
from app.schemas.evidence import EvidenceOut
from app.schemas.shipment import CourierPolicyOut
from app.services import claim_service
from app.services.deadlines import claim_deadline, window_days_by_courier

router = APIRouter(tags=["claims"], responses=ERROR_RESPONSES)


def _summary(claim: Claim, shipment: Shipment, inv: Investigation | None,
             windows: dict[str, int]) -> dict:
    return {
        "id": claim.id, "shipment_id": claim.shipment_id,
        "tracking_number": shipment.tracking_number, "courier": shipment.courier,
        "status": claim.status, "confidence": inv.confidence if inv else None,
        "claim_value": int(claim.draft_json.get("requested_compensation") or shipment.item_value),
        "created_at": claim.created_at, "is_simulated": claim.is_simulated,
        "case_type": inv.case_type if inv else None,
        "claim_deadline": claim_deadline(shipment, windows),
    }


@router.get("/claims", response_model=Page[ClaimSummaryOut])
def list_claims(
    db: DB,
    status: ClaimStatus | None = None,
    shipment_id: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Page[ClaimSummaryOut]:
    stmt = (select(Claim, Shipment, Investigation)
            .join(Shipment, Shipment.id == Claim.shipment_id)
            .outerjoin(Investigation, Investigation.id == Claim.investigation_id))
    if status:
        stmt = stmt.where(Claim.status == status)
    if shipment_id:
        stmt = stmt.where(Claim.shipment_id == shipment_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    pending_first = case((Claim.status == "pending_approval", 0), else_=1)
    rows = db.execute(stmt.order_by(pending_first, Claim.created_at.desc())
                      .limit(limit).offset(offset)).all()
    windows = window_days_by_courier(db)
    return Page(items=[ClaimSummaryOut(**_summary(*r, windows)) for r in rows], total=total,
                limit=limit, offset=offset)


def _detail(db, claim: Claim) -> ClaimDetailOut:
    shipment = db.get(Shipment, claim.shipment_id)
    inv = db.get(Investigation, claim.investigation_id)
    policy = policy_repo.get_by_courier(db, shipment.courier)
    draft = dict(claim.draft_json)
    issues = draft.pop("draft_issues", [])
    return ClaimDetailOut(
        **_summary(claim, shipment, inv, window_days_by_courier(db)), investigation_id=claim.investigation_id,
        narrative=claim.narrative, draft=draft, draft_issues=issues,
        decision_reason=inv.decision_reason if inv else None, item_name=shipment.item_name,
        shipment_resolution=shipment.resolution,
        item_value=shipment.item_value, updated_at=claim.updated_at,
        submitted_at=claim.submitted_at, submitted_by=claim.submitted_by,
        submission_ref=claim.submission_ref, reject_reason=claim.reject_reason,
        evidence=[EvidenceOut.model_validate(e) for e in inv_repo.list_evidence(db, claim.investigation_id)],
        courier_policy=CourierPolicyOut.of(policy) if policy else None,
    )


@router.get("/claims/{claim_id}", response_model=ClaimDetailOut)
def get_claim(claim_id: str, db: DB) -> ClaimDetailOut:
    claim = db.get(Claim, claim_id)
    if claim is None:
        raise not_found("Klaim")
    return _detail(db, claim)


@router.patch("/claims/{claim_id}", response_model=ClaimDetailOut)
def edit_claim(claim_id: str, body: ClaimPatchIn, db: DB, user: User) -> ClaimDetailOut:
    claim = claim_service.update_narrative(db, claim_id, body.narrative, actor=user)
    db.commit()
    return _detail(db, claim)


@router.post("/claims/{claim_id}/approve", response_model=ClaimDetailOut)
def approve_claim(claim_id: str, db: DB, user: User, body: ApproveIn | None = None) -> ClaimDetailOut:
    claim = claim_service.approve(db, claim_id, actor=user, review_sec=body.review_sec if body else None)
    db.commit()
    return _detail(db, claim)


@router.post("/claims/{claim_id}/reject", response_model=ClaimDetailOut)
def reject_claim(claim_id: str, body: RejectIn, db: DB, user: User) -> ClaimDetailOut:
    claim = claim_service.reject(db, claim_id, body.reason, actor=user, review_sec=body.review_sec)
    db.commit()
    return _detail(db, claim)
