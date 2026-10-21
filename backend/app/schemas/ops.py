from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CsvImportRowError(BaseModel):
    line: int
    message: str


class CsvImportOut(BaseModel):
    imported: int
    updated: int
    skipped: int
    errors: list[CsvImportRowError] = []
    filename: str


class MarketplaceOut(BaseModel):
    id: Literal["shopee", "tiktok_shop"]
    name: str
    kind: Literal["marketplace"]
    connected: bool
    available: bool
    detail: str


class CameraTimeDrift(BaseModel):
    camera: str
    label: str
    source: str
    drift_sec: float
    calibrated_at: str
    status: Literal["ok", "perlu_kalibrasi"]


class ConnectionsOut(BaseModel):
    marketplaces: list[MarketplaceOut]
    cameras: list[CameraTimeDrift]


class ConnectIn(BaseModel):
    connected: bool


class ConnectionResultOut(BaseModel):
    id: str
    connected: bool
    detail: str


class DeleteInvestigationOut(BaseModel):
    id: str
    deleted_evidence: int = 0
    deleted_events: int = 0


class PurgeResultOut(BaseModel):
    deleted: int = Field(description="Jumlah investigasi yang dihapus")
    media_deleted: int = Field(default=0, description="Berkas media yang ikut dihapus")
    skipped_active: list[str] = Field(default_factory=list)


class EvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    kind: str
    uri: str
    created_at: datetime
