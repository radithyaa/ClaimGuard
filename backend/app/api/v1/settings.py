from fastapi import APIRouter, Response

from app.api.deps import DB, User
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import COOKIE_NAME, check_password, create_token
from app.schemas.common import ERROR_RESPONSES
from app.schemas.metrics import LoginIn, LoginOut
from app.services import audit, scheduler
from app.services.settings_service import (
    RuntimeSettings,
    RuntimeSettingsPatch,
    get_runtime,
    update_runtime,
)

router = APIRouter(responses=ERROR_RESPONSES)


@router.get("/settings", response_model=RuntimeSettings, tags=["settings"])
def read_settings(db: DB) -> RuntimeSettings:
    return get_runtime(db)


@router.patch("/settings", response_model=RuntimeSettings, tags=["settings"])
def patch_settings(body: RuntimeSettingsPatch, db: DB, user: User) -> RuntimeSettings:
    updated = update_runtime(db, body)
    audit.record(db, actor=user, action="settings_updated", entity="settings",
                 payload=body.model_dump(exclude_none=True))
    db.commit()
    scheduler.apply(updated)
    return updated


@router.post("/auth/login", response_model=LoginOut, tags=["auth"])
def login(body: LoginIn, response: Response) -> LoginOut:
    if not check_password(body.password):
        raise AppError(401, "invalid_credentials", "Password salah")
    token, ttl = create_token()
    cloud = get_settings().env == "cloud"
    # Frontend & backend beda domain di Cloud Run: cookie lintas situs butuh SameSite=None+Secure.
    # Frontend juga boleh memakai token sebagai header Authorization: Bearer.
    response.set_cookie(COOKIE_NAME, token, max_age=ttl, httponly=True, secure=cloud,
                        samesite="none" if cloud else "lax")
    return LoginOut(token=token, expires_in=ttl)
