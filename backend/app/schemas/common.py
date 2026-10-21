from pydantic import BaseModel


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorBody(BaseModel):
    error: ErrorDetail


ERROR_RESPONSES = {
    s: {"model": ErrorBody} for s in (401, 404, 409, 422)
}
