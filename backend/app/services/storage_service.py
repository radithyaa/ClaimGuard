"""Penyimpanan media: lokal (dev) atau Cloud Storage (Cloud Run).

URI disimpan di DB sebagai `local://<key>` atau `gs://<bucket>/<key>`. Kode lain tidak pernah
membangun path sendiri dari input pengguna/agen (NFR-05).
"""

import shutil
from datetime import timedelta
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Protocol

from app.core.config import get_settings


class StorageError(Exception):
    pass


def _safe_key(key: str) -> str:
    p = PurePosixPath(key)
    if p.is_absolute() or ".." in p.parts or not key or "\\" in key:
        raise StorageError(f"key penyimpanan tidak valid: {key!r}")
    return str(p)


class Storage(Protocol):
    def put_file(self, src: Path, key: str, content_type: str = "video/mp4") -> str: ...
    def ffmpeg_input(self, uri: str) -> str: ...
    def public_url(self, uri: str) -> str: ...
    def delete(self, uri: str) -> None: ...


class LocalStorage:
    scheme = "local://"

    def __init__(self, root: str, public_base_url: str) -> None:
        self.root = Path(root).resolve()
        self.public_base_url = public_base_url.rstrip("/")

    def _path(self, uri: str) -> Path:
        if not uri.startswith(self.scheme):
            raise StorageError(f"URI bukan lokal: {uri}")
        path = (self.root / _safe_key(uri.removeprefix(self.scheme))).resolve()
        if not path.is_relative_to(self.root):
            raise StorageError("path di luar folder storage")
        return path

    def put_file(self, src: Path, key: str, content_type: str = "video/mp4") -> str:
        uri = self.scheme + _safe_key(key)
        dest = self._path(uri)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
        return uri

    def ffmpeg_input(self, uri: str) -> str:
        path = self._path(uri)
        if not path.exists():
            raise StorageError(f"file media tidak ditemukan: {uri}")
        return str(path)

    def read_bytes(self, uri: str) -> bytes:
        return Path(self.ffmpeg_input(uri)).read_bytes()

    def public_url(self, uri: str) -> str:
        # Mode lokal: main.py me-mount StaticFiles di /media (milik Backend B)
        return f"{self.public_base_url}/media/{uri.removeprefix(self.scheme)}"

    def delete(self, uri: str) -> None:
        self._path(uri).unlink(missing_ok=True)


class GCSStorage:
    def __init__(self, bucket: str, ttl_sec: int) -> None:
        from google.cloud import storage  # impor lambat: tidak wajib saat dev lokal

        self.bucket_name = bucket
        self.client = storage.Client()
        self.bucket = self.client.bucket(bucket)
        self.ttl = timedelta(seconds=ttl_sec)

    def _blob(self, uri: str):
        prefix = f"gs://{self.bucket_name}/"
        if not uri.startswith(prefix):
            raise StorageError(f"URI bukan milik bucket {self.bucket_name}: {uri}")
        return self.bucket.blob(_safe_key(uri.removeprefix(prefix)))

    def put_file(self, src: Path, key: str, content_type: str = "video/mp4") -> str:
        key = _safe_key(key)
        self.bucket.blob(key).upload_from_filename(str(src), content_type=content_type)
        return f"gs://{self.bucket_name}/{key}"

    def ffmpeg_input(self, uri: str) -> str:
        # FFmpeg membaca HTTPS dengan Range, jadi -ss tidak mengunduh seluruh video
        return self.public_url(uri)

    def public_url(self, uri: str) -> str:
        """Signed URL v4. Di Cloud Run kredensial tidak punya private key, jadi penandatanganan
        memakai IAM signBlob: service account butuh roles/iam.serviceAccountTokenCreator
        pada dirinya sendiri (lihat infra/setup-gcp.md)."""
        import google.auth
        from google.auth.transport.requests import Request

        creds, _ = google.auth.default()
        if not creds.valid:
            creds.refresh(Request())
        email = getattr(creds, "service_account_email", None)
        kwargs = {"service_account_email": email, "access_token": creds.token} if email else {}
        return self._blob(uri).generate_signed_url(
            version="v4", expiration=self.ttl, method="GET", **kwargs
        )

    def delete(self, uri: str) -> None:
        self._blob(uri).delete()


@lru_cache
def get_storage() -> Storage:
    s = get_settings()
    if s.storage_backend == "gcs":
        if not s.gcs_bucket:
            raise StorageError("GCS_BUCKET wajib diisi bila STORAGE_BACKEND=gcs")
        return GCSStorage(s.gcs_bucket, s.signed_url_ttl_sec)
    return LocalStorage(s.storage_local_root, s.public_base_url)
