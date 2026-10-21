from fastapi import APIRouter, Request, Response

from app.api.deps import DB, User
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import COOKIE_NAME, DEMO_USER, check_password, create_token, verify_token
from app.schemas.common import ERROR_RESPONSES
from app.schemas.metrics import LoginIn, LoginOut, SessionOut
from app.services import audit, scheduler
from app.services.settings_service import (
    CourierThresholdIn,
    CourierThresholdOut,
    RuntimeSettings,
    RuntimeSettingsPatch,
    get_runtime,
    list_thresholds,
    replace_thresholds,
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


@router.get("/settings/courier-thresholds", response_model=list[CourierThresholdOut],
            tags=["settings"])
def read_courier_thresholds(db: DB) -> list[CourierThresholdOut]:
    return [CourierThresholdOut.of(row) for row in list_thresholds(db)]


@router.put("/settings/courier-thresholds", response_model=list[CourierThresholdOut],
            tags=["settings"])
def put_courier_thresholds(body: list[CourierThresholdIn], db: DB,
                           user: User) -> list[CourierThresholdOut]:
    """Mengganti seluruh pengecualian kurir (halaman Pengaturan > Pengecualian per kurir)."""
    couriers = [item.courier for item in body]
    if len(couriers) != len(set(couriers)):
        raise AppError(422, "duplicate_courier", "Kode kurir tidak boleh duplikat")
    replace_thresholds(db, body)
    audit.record(db, actor=user, action="courier_thresholds_updated", entity="settings",
                 payload={"couriers": couriers})
    db.commit()
    return [CourierThresholdOut.of(row) for row in list_thresholds(db)]


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


@router.get("/auth/session", response_model=SessionOut, tags=["auth"])
def read_session(request: Request) -> SessionOut:
    """Status sesi dari cookie httpOnly, dipakai penjaga rute di server (bukan di browser).

    Tidak memakai dependency `User` karena sesi yang tidak valid bukan error: endpoint ini
    sendiri yang melaporkan `authenticated: false` tanpa 401.
    """
    required = get_settings().auth_required
    if not required:
        return SessionOut(authenticated=True, user=DEMO_USER, auth_required=False)
    header = request.headers.get("authorization", "")
    bearer = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else None
    user = verify_token(bearer or request.cookies.get(COOKIE_NAME))
    return SessionOut(authenticated=user is not None, user=user, auth_required=True)


@router.post("/auth/logout", status_code=204, tags=["auth"])
def logout(response: Response) -> None:
    """Menghapus cookie sesi. Aman dipanggil tanpa sesi (idempoten)."""
    cloud = get_settings().env == "cloud"
    response.delete_cookie(COOKIE_NAME, secure=cloud, samesite="none" if cloud else "lax",
                           httponly=True)
