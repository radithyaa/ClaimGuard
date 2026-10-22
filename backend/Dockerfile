# Image Cloud Run backend ClaimGuard (SRS 10): Python 3.12 + FFmpeg.
# Build & deploy: gcloud run deploy claimguard-api --source . (lihat README)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
# Dependensi di lapisan sendiri: selama requirements.lock tidak berubah, Cloud Build memakai
# cache lapisan ini, sehingga deploy yang hanya mengubah kode ~1 menit (bukan 4 menit pip install).
COPY requirements.lock .
RUN pip install -r requirements.lock

COPY app ./app
COPY data/mock ./data/mock
COPY data/cache ./data/cache

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /srv
USER appuser

ENV ENV=cloud STORAGE_BACKEND=gcs SEED_ON_STARTUP=true
# Satu worker: registry investigasi & SSE ada di memori proses (NFR-13)
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 \
    --proxy-headers --forwarded-allow-ips="*"
