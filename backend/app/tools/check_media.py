"""Pemeriksa & panduan media demo: rekaman mana harus ditaruh, dan di detik berapa scan resi.

Tiga hal yang paling mudah salah saat menyiapkan rekaman:

1. Berkas tidak ada di `data/samples/` -> investigasi gagal di `clip_cctv_video`
   (`clip_failed` / `file media tidak ditemukan`).
2. `pack_scan.scanned_at` di `shipments.json` tidak sesuai detik scan pada video ->
   klip CCTV menampilkan bagian yang salah, atau investigasi gagal dengan
   `scan_outside_recording` bila selisihnya melebihi durasi rekaman.
3. Nama resi di `docs/data-demo.md` hanya label urutan; yang benar-benar dipakai
   API adalah `shipments.id` (UUID).

Pemakaian (dari folder backend/):

    .venv/bin/python -m app.tools.check_media            # status semua rekaman
    .venv/bin/python -m app.tools.check_media --plan     # panduan syuting per skenario
    .venv/bin/python -m app.tools.check_media --guide    # status + daftar resi asli (butuh DB)
    .venv/bin/python -m app.tools.check_media --scan cctv_packing_01=00:00:40
    .venv/bin/python -m app.tools.check_media --json

`--scan` menampilkan `scanned_at` yang harus ditulis ke `data/mock/shipments.json` untuk
setiap resi yang memakai CCTV tersebut (recorded_start + detik scan).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from app.core.config import get_settings
from app.services import demo_data, video_service

STATUS_OK = "ok"
STATUS_MISSING = "belum ada"
STATUS_UNREADABLE = "tidak terbaca"

# Detik di video tempat kejadian penting untuk tiap skenario (lihat docs/data-demo.md).
# Dipakai `--plan` dan `--scan` bila detik tidak diberikan manual.
SCENARIO_SECONDS = {"cctv_packing_01": 40, "cctv_packing_02": 30}


@dataclass
class MediaCheck:
    key: str
    file: str
    kind: str
    used_by: list[str]
    source: str | None
    duration_sec: float | None
    status: str
    note: str = ""


def _parse_seconds(value: str) -> float:
    """Terima `40`, `40.5`, `00:00:40`, atau `0:40`."""
    if ":" not in value:
        return float(value)
    total = 0.0
    for part in value.split(":"):
        total = total * 60 + float(part)
    return total


def _usage(data: dict) -> dict[str, list[str]]:
    """Pemakaian per key media: resi pemilik (unboxing) dan resi yang memindai CCTV-nya."""
    used: dict[str, list[str]] = {m["key"]: [] for m in data["media"]}
    for media in data["media"]:
        if owner := media.get("shipment"):
            used[media["key"]].append(owner)
    for row in data["shipments"]:
        cctv = (row.get("pack_scan") or {}).get("cctv")
        if cctv in used:
            used[cctv].append(row["tracking_number"])
    for tracking in used.values():
        tracking.sort()
    return used


def _stored_path(file: str) -> Path | None:
    """Berkas di storage lokal siap pakai (dari seed sebelumnya), bila ada."""
    s = get_settings()
    if s.storage_backend != "local":
        return None
    p = Path(s.storage_local_root) / "samples" / Path(file).name
    return p if p.exists() else None


def check_media(data: dict | None = None, samples_dir: Path | None = None) -> list[MediaCheck]:
    s = get_settings()
    data = data or demo_data.load_mock()
    directory = samples_dir or Path(s.sample_media_dir)
    used = _usage(data)
    checks: list[MediaCheck] = []
    for m in data["media"]:
        src = demo_data.find_sample(directory, m["file"]) or _stored_path(m["file"])
        check = MediaCheck(key=m["key"], file=m["file"], kind=m["kind"],
                           used_by=used.get(m["key"], []), source=str(src) if src else None,
                           duration_sec=None, status=STATUS_MISSING)
        if src is not None:
            try:
                check.duration_sec = round(video_service.probe_duration_sync(src), 3)
                check.status = STATUS_OK
                declared = m.get("duration_sec")
                if declared and check.duration_sec + 0.5 < declared:
                    check.note = (f"lebih pendek dari duration_sec={declared} di shipments.json; "
                                  f"seed memakai durasi sebenarnya")
            except (video_service.VideoError, OSError) as exc:
                check.status = STATUS_UNREADABLE
                check.note = str(exc)
        if check.status == STATUS_OK:
            problem = _scan_problem(data, m, check.duration_sec or 0)
            if problem:
                check.note = f"{check.note} {problem}".strip()
        checks.append(check)
    return checks


def _scan_problem(data: dict, media: dict, duration: float) -> str:
    """Peringatan bila waktu scan packing di JSON berada di luar rekaman."""
    recorded = media.get("recorded_start")
    if not recorded:
        return ""
    start = datetime.fromisoformat(recorded)
    for row in data["shipments"]:
        scan = row.get("pack_scan") or {}
        if scan.get("cctv") != media["key"]:
            continue
        offset = (datetime.fromisoformat(scan["scanned_at"]) - start).total_seconds()
        if not 0 <= offset <= duration:
            return (f"scan {row['tracking_number']} di detik {offset:.0f}, di luar rekaman "
                    f"(0-{duration:.0f}); investigasi akan gagal scan_outside_recording")
    return ""


def scan_offsets(data: dict, cctv_key: str, at_sec: float) -> list[tuple[str, str]]:
    """`scanned_at` baru untuk semua resi yang memakai CCTV tersebut."""
    media = next((m for m in data["media"] if m["key"] == cctv_key), None)
    if media is None or not media.get("recorded_start"):
        raise KeyError(f"{cctv_key} tidak punya recorded_start")
    at = datetime.fromisoformat(media["recorded_start"]) + timedelta(seconds=at_sec)
    stamped = at.strftime("%Y-%m-%dT%H:%M:%SZ") if at.microsecond == 0 else at.isoformat()
    return [(row["tracking_number"], stamped) for row in data["shipments"]
            if (row.get("pack_scan") or {}).get("cctv") == cctv_key]


def _fmt_duration(sec: float | None) -> str:
    if sec is None:
        return "-"
    if sec >= 60:
        return f"{int(sec) // 60}m{int(sec) % 60:02d}s ({sec:.0f} dtk)"
    return f"{sec:.0f} dtk"


def _fmt_seconds(sec: float) -> str:
    """`00:40` untuk durasi panjang, `20` untuk durasi pendek (angka detik saja)."""
    return f"{int(sec) // 60:02d}:{int(sec) % 60:02d}" if sec >= 60 else f"{sec:g}"


def _scenario_of(data: dict) -> dict[str, str]:
    """tracking_number -> nama skenario dari shipments.json."""
    return {row["tracking_number"]: row.get("scenario", "") for row in data["shipments"]}


def _plan_lines(data: dict, checks: list[MediaCheck]) -> list[str]:
    """Panduan syuting: berkas apa, untuk resi siapa, adegan penting di detik berapa."""
    scenario = _scenario_of(data)
    by_key = {m["key"]: m for m in data["media"]}
    lines = ["Panduan rekaman (nama berkas = `file` di data/mock/shipments.json):"]
    for c in checks:
        media = by_key[c.key]
        users = ", ".join(f"{t} ({scenario.get(t) or 'negatif'})" for t in c.used_by) or "-"
        lines.append(f"\n  {c.file}  [{c.kind}]")
        if c.kind == "cctv":
            at = SCENARIO_SECONDS.get(c.key)
            lines.append(f"    dipakai          : {users}")
            lines.append("    jenis            : rekaman CCTV meja packing, satu take tanpa potongan")
            if at is not None:
                lines.append(f"    adegan penting    : detik {_fmt_seconds(at)} (scan resi / barang masuk kardus)")
            lines.append("    catatan          : scan packing semua resi harus terlihat sekali pada take ini")
        else:
            owner = media.get("shipment", "-")
            lines.append(f"    dipakai          : {owner} ({scenario.get(owner) or 'negatif'})")
            lines.append("    jenis            : video unboxing pembeli, direkam dari kardus masih tersegel")
            lines.append(f"    durasi           : sekitar {media.get('duration_sec', '-')} detik")
        lines.append(f"    status           : {c.status}")
    return lines


def _db_rows(data: dict) -> list[str]:
    """Resi asli (UUID) dari DB: yang dilihat agen & dipakai API, bukan label dokumen."""
    from sqlalchemy import select

    from app.db.session import session_scope
    from app.models import MediaAsset, Shipment
    from app.services.deadlines import claim_deadline, window_days_by_courier

    rows = []
    try:
        with session_scope() as db:
            windows = window_days_by_courier(db)
            for row in data["shipments"]:
                s = db.scalar(select(Shipment).where(
                    Shipment.tracking_number == row["tracking_number"]))
                if s is None:
                    rows.append(f"  {row['tracking_number']:14} (belum ada di DB — jalankan seed)")
                    continue
                allowed = claim_deadline(s, windows)
                assets = db.scalars(select(MediaAsset).where(MediaAsset.shipment_id == s.id)).all()
                kinds = ",".join(sorted({a.kind for a in assets})) or "-"
                deadline = allowed.strftime("%d %b %Y") if allowed else "-"
                rows.append(f"  {s.tracking_number:14} id={s.id}  media={kinds:16} "
                            f"tenggat klaim={deadline}")
    except Exception as exc:  # noqa: BLE001 - DB opsional untuk pemeriksaan berkas
        return [f"  (tidak bisa membaca DB: {exc})"]
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scan", action="append", default=[], metavar="CCTV=DETIK",
                        help="hitung scanned_at untuk detik scan, mis. cctv_packing_01=00:00:40")
    parser.add_argument("--plan", action="store_true",
                        help="panduan rekaman: berkas apa, untuk resi siapa, adegan di detik berapa")
    parser.add_argument("--guide", action="store_true",
                        help="status berkas + daftar resi asli (UUID) dari DB")
    parser.add_argument("--json", action="store_true", help="cetak JSON, bukan tabel")
    parser.add_argument("--samples-dir", type=Path, default=None,
                        help="folder rekaman (default data/samples)")
    args = parser.parse_args(argv)

    s = get_settings()
    data = demo_data.load_mock()
    try:
        checks = check_media(data, args.samples_dir)
    except OSError as exc:
        print(f"gagal memeriksa media: {exc}", file=sys.stderr)
        return 2

    scans: dict[str, list[tuple[str, str]]] = {}
    for spec in args.scan:
        try:
            key, value = spec.split("=", 1)
            scans[key] = scan_offsets(data, key, _parse_seconds(value))
        except (ValueError, KeyError) as exc:
            print(f"--scan tidak valid ({spec}): {exc}", file=sys.stderr)
            return 2

    directory = str(args.samples_dir or s.sample_media_dir)
    if args.json:
        print(json.dumps({
            "samples_dir": directory,
            "storage_backend": s.storage_backend,
            "media": [c.__dict__ for c in checks],
            "scans": scans,
            "plan": _plan_lines(data, checks),
        }, indent=2, ensure_ascii=False))
    elif args.plan:
        print("\n".join(_plan_lines(data, checks)))
        print("\nAngka di atas adalah detik dalam rekaman, bukan jam dinding. Bila take Anda bergeser, "
              "perbarui dengan `--scan <cctv>=<detik>` lalu salin scanned_at ke shipments.json.")
    else:
        _print_table(checks, scans, directory, s.storage_backend)
        if args.guide:
            print("\nResi asli di DB (pakai `id` ini saat memulai investigasi / unggah media):")
            print("\n".join(_db_rows(data)))

    ready = sum(1 for c in checks if c.status == STATUS_OK)
    print(f"\n{ready}/{len(checks)} rekaman siap. ", end="")
    if ready < len(checks):
        print(f"Taruh berkas yang belum ada di {directory} (nama boleh beda huruf/ekstensi), "
              "lalu jalankan seed.")
        return 1
    print("Semua rekaman siap.")
    return 0


def _print_table(checks: list[MediaCheck], scans: dict[str, list[tuple[str, str]]],
                 samples_dir: str, backend: str) -> None:
    print(f"Folder rekaman : {samples_dir}")
    print(f"Storage        : {backend}")
    width = max((len(c.file) for c in checks), default=10) + 2
    used_width = max((len(", ".join(c.used_by)) for c in checks), default=12) + 2
    print(f"\n{'berkas'.ljust(width)}{'jenis'.ljust(10)}{'durasi'.ljust(16)}"
          f"{'dipakai resi'.ljust(used_width)}status")
    print("-" * (width + 10 + 16 + used_width + 12))
    for c in checks:
        used = ", ".join(c.used_by) or "-"
        print(f"{c.file.ljust(width)}{c.kind.ljust(10)}{_fmt_duration(c.duration_sec).ljust(16)}"
              f"{used.ljust(used_width)}{c.status}")
        if c.note:
            print(f"{' '.ljust(width)}  ! {c.note}")
    for key, rows in scans.items():
        print(f"\nscanned_at untuk {key} (tulis ke data/mock/shipments.json):")
        for tracking, stamped in rows:
            print(f'  {tracking:14} -> "{stamped}"')


if __name__ == "__main__":
    raise SystemExit(main())
