from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CourierPolicy, utcnow


def normalize_courier(name: str) -> str:
    """'J&T Express', 'jnt', 'JNT' -> 'jnt'."""
    key = name.strip().lower().replace("&", "n").replace(" ", "").replace("express", "")
    return {"jnt": "jnt", "jne": "jne", "sicepat": "sicepat"}.get(key, key)


def get_by_courier(session: Session, courier: str) -> CourierPolicy | None:
    return session.scalar(
        select(CourierPolicy).where(CourierPolicy.courier == normalize_courier(courier))
    )


def list_all(session: Session) -> Sequence[CourierPolicy]:
    return session.scalars(select(CourierPolicy).order_by(CourierPolicy.courier)).all()


def upsert(session: Session, courier: str, **fields: Any) -> CourierPolicy:
    """Idempoten: dipakai seed/policy_extractor."""
    key = normalize_courier(courier)
    policy = get_by_courier(session, key)
    if policy is None:
        policy = CourierPolicy(courier=key, **fields)
        session.add(policy)
    else:
        for k, v in fields.items():
            setattr(policy, k, v)
        policy.extracted_at = utcnow()
    session.flush()
    return policy
