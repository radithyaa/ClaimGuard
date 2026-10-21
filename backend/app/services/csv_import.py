"""Impor CSV resi (Pengaturan > Koneksi dan sumber data).

Format kolom (header wajib, urutan bebas):
`tracking_number,courier,status,origin,destination,shipped_at,sla_deadline,item_name,item_value`

- `courier`: jne | jnt | spc | sicepat | anteraja | spx (huruf kecil)
- `status`: created | picked_up | in_transit | out_for_delivery | delivered | returned
- `shipped_at`, `sla_deadline`: ISO-8601; waktu dianggap UTC bila tanpa zona
- Resi dengan `tracking_number` yang sudah ada diperbarui (status & SLA), bukan diduplikasi.

Berkas dibaca hingga 2 MB. Baris rusak dilewati dan dilaporkan, bukan menggagalkan seluruh unggahan.
"""

import csv
import io
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Shipment
from app.schemas.ops import CsvImportRowError
from app.services import audit

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 5000

REQUIRED = {"tracking_number", "courier", "shipped_at", "sla_deadline"}
VALID_COURIERS = {"jne", "jnt", "spc", "sicepat", "anteraja", "spx"}
VALID_STATUS = {"created", "picked_up", "in_transit", "out_for_delivery", "delivered", "returned"}


@dataclass
class ImportReport:
    imported: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[CsvImportRowError] = field(default_factory=list)


def _parse_dt(raw: str) -> datetime:
    value = datetime.fromisoformat(raw.strip())
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def import_csv(db: Session, content: bytes, *, filename: str, actor: str) -> ImportReport:
    if len(content) > MAX_BYTES:
        raise ValueError("Berkas melebihi 2 MB")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Berkas harus UTF-8 (simpan ulang sebagai CSV UTF-8)") from exc

    reader = csv.DictReader(io.StringIO(text))
    header = {h.strip().lower() for h in (reader.fieldnames or [])}
    missing = REQUIRED - header
    if missing:
        raise ValueError(f"Kolom wajib tidak ada: {', '.join(sorted(missing))}")

    report = ImportReport()
    for line, row in enumerate(reader, start=2):
        if line - 1 > MAX_ROWS:
            report.errors.append(CsvImportRowError(line=line, message="Batas 5000 baris tercapai"))
            break
        clean = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        tn = clean.get("tracking_number", "")
        courier = clean.get("courier", "").lower()
        try:
            if not tn:
                raise ValueError("tracking_number kosong")
            if courier not in VALID_COURIERS:
                raise ValueError(f"kurir tidak dikenal: {courier or '(kosong)'}")
            status = clean.get("status", "") or "in_transit"
            if status not in VALID_STATUS:
                raise ValueError(f"status tidak dikenal: {status}")
            shipped_at = _parse_dt(clean["shipped_at"])
            sla_deadline = _parse_dt(clean["sla_deadline"])
            if sla_deadline <= shipped_at:
                raise ValueError("sla_deadline harus setelah shipped_at")
            item_value = int(clean.get("item_value") or 0)
            if item_value < 0:
                raise ValueError("item_value tidak boleh negatif")
        except ValueError as exc:
            report.skipped += 1
            report.errors.append(CsvImportRowError(line=line, message=str(exc)))
            continue

        existing = db.scalar(select(Shipment).where(Shipment.tracking_number == tn))
        if existing is None:
            db.add(Shipment(
                tracking_number=tn, courier=courier, status=status,
                origin=clean.get("origin") or "-", destination=clean.get("destination") or "-",
                shipped_at=shipped_at, sla_deadline=sla_deadline,
                item_name=clean.get("item_name") or "-", item_value=item_value,
            ))
            report.imported += 1
        else:
            existing.status = status
            existing.sla_deadline = sla_deadline
            report.updated += 1

    db.flush()
    audit.record(db, actor=actor, action="shipments_imported", entity="shipment",
                 payload={"filename": filename, "imported": report.imported,
                          "updated": report.updated, "skipped": report.skipped})
    return report


TEMPLATE = (
    "tracking_number,courier,status,origin,destination,shipped_at,sla_deadline,item_name,item_value\n"
    "JNE0099999999,jne,in_transit,Bandung,Surabaya,2026-10-20T09:00:00Z,"
    "2026-10-23T09:00:00Z,Sepatu kulit,450000\n"
)
