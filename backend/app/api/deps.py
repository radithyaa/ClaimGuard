from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import COOKIE_NAME, DEMO_USER, verify_token
from app.db.session import get_session

# Catatan: endpoint yang menulis memanggil db.commit() sendiri sebelum mengembalikan respons,
# agar request berikutnya dari frontend langsung melihat perubahan.
DB = Annotated[Session, Depends(get_session)]


def current_user(request: Request) -> str:
    if not get_settings().auth_required:
        return DEMO_USER
    header = request.headers.get("authorization", "")
    token = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else None
    user = verify_token(token or request.cookies.get(COOKIE_NAME))
    if user is None:
        raise AppError(401, "unauthorized", "Silakan login terlebih dahulu")
    return user


User = Annotated[str, Depends(current_user)]
