"""Pemotongan video dengan FFmpeg (FR-03).

Encode ulang H.264 (bukan stream copy): potongan akurat ke detik dan dapat diputar browser.
Proses async agar dapat dibatalkan (FR-20): CancelledError mematikan subprocess.
"""

import asyncio
import re
import shutil
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings


class VideoError(Exception):
    pass


@dataclass(frozen=True)
class ClipResult:
    path: Path
    start_sec: float
    duration_sec: float


@lru_cache
def ffmpeg_exe() -> str:
    configured = get_settings().ffmpeg_path
    if configured:
        return configured
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # dev lokal tanpa ffmpeg terpasang

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:
        raise VideoError("ffmpeg tidak ditemukan; pasang ffmpeg atau imageio-ffmpeg") from exc


def build_clip_cmd(src: str, start_sec: float, duration_sec: float, out: Path) -> list[str]:
    return [
        ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{start_sec:.3f}",  # sebelum -i: seek cepat, tetap akurat karena encode ulang
        "-i", src,
        "-t", f"{duration_sec:.3f}",
        "-vf", "scale=-2:'min(720,ih)'",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        str(out),
    ]


async def _run(cmd: list[str], timeout: float) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except (asyncio.CancelledError, TimeoutError):
        proc.kill()
        await proc.wait()
        raise
    if proc.returncode != 0:
        raise VideoError(f"ffmpeg gagal (kode {proc.returncode}): {stderr.decode()[-300:]}")
    return stderr


async def clip(src: str, start_sec: float, duration_sec: float, out: Path) -> ClipResult:
    if duration_sec <= 0:
        raise VideoError("durasi klip harus > 0")
    out.parent.mkdir(parents=True, exist_ok=True)
    timeout = get_settings().ffmpeg_timeout_sec
    try:
        await _run(build_clip_cmd(src, max(0.0, start_sec), duration_sec, out), timeout)
    except TimeoutError as exc:
        raise VideoError(f"ffmpeg melebihi batas waktu {timeout:.0f} detik") from exc
    if not out.exists() or out.stat().st_size == 0:
        raise VideoError("ffmpeg tidak menghasilkan file klip")
    return ClipResult(path=out, start_sec=max(0.0, start_sec), duration_sec=duration_sec)


_DURATION_RE = re.compile(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)")


async def probe_duration(src: str) -> float:
    """Durasi video (detik) dari output `ffmpeg -i` (imageio-ffmpeg tidak menyertakan ffprobe)."""
    proc = await asyncio.create_subprocess_exec(
        ffmpeg_exe(), "-hide_banner", "-i", src,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    m = _DURATION_RE.search(stderr.decode(errors="ignore"))
    if not m:
        raise VideoError("durasi video tidak terbaca")
    h, mnt, s = m.groups()
    return int(h) * 3600 + int(mnt) * 60 + float(s)
