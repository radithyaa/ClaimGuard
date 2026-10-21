# =============================================================================
# ClaimGuard API — FastAPI + Google ADK + FFmpeg
#
# Dasar: SRS §9 (python:3.12-slim + ffmpeg) dan §10 (Cloud Run, satu instance).
# Keperluan kode yang menentukan isi image:
#   - app/agents/prompts/*.md  dibaca runtime via pathlib -> wajib ikut COPY
#   - app/services/video_service.py -> butuh binary ffmpeg (cpython:3.12-slim)
#   - app/services/storage_service.py -> google-cloud-storage
#   - app/agents/tools/video_tools.py -> tempfile (TMPDIR) untuk klip sementara
# =============================================================================

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ENV=cloud \
    PORT=8080

# ffmpeg: dipakai video_service.py. ca-certificates: panggilan HTTPS ke Vertex/GCS.
# tini: reaper proses supaya subprocess ffmpeg tidak jadi zombie saat cancel (FR-20).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependensi lebih dulu agar layer cache tidak invalid setiap kali source berubah.
# Catatan: proyek ini tidak dipasang sebagai paket (tidak ada [tool.setuptools]), jadi
# dependensi dibaca dari pyproject.toml lalu di-install sebagai wheel secara eksplisit.
COPY pyproject.toml ./
RUN pip install --upgrade pip \
    && python -c "import tomllib,sys; print('\\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requirements.txt \
    && pip install -r /tmp/requirements.txt \
    && rm -f /tmp/requirements.txt \
    && rm -rf /root/.cache

# Prompt .md adalah aset berversi yang dibaca saat runtime, bukan bagian install.
COPY app ./app

# Folder kerja runtime. Tidak di-commit; dibuat di image agar writable oleh user non-root.
RUN useradd --create-home --uid 10001 claimguard \
    && mkdir -p /app/data/cache /app/storage \
    && chown -R claimguard:claimguard /app

USER claimguard

EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]

# Cloud Run mengirim SIGTERM; uvicorn menutup koneksi SSE yang masih terbuka.
# --proxy-headers agar request_id/skema benar di belakang proxy Cloud Run.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --timeout-keep-alive 75"]
