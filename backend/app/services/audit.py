"""Audit log untuk setiap aksi agen, keputusan manusia, dan pembatalan (NFR-07)."""

from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog


def record(
    db: Session, *, actor: str, action: str, entity: str, entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> AuditLog:
    log = AuditLog(actor=actor, action=action, entity=entity, entity_id=entity_id,
                   payload_json=payload or {})
    db.add(log)
    db.flush()
    return log


def recent(db: Session, *, limit: int = 20, entity: str | None = None) -> Sequence[AuditLog]:
    stmt = select(AuditLog)
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    return db.scalars(stmt.order_by(AuditLog.created_at.desc()).limit(limit)).all()
