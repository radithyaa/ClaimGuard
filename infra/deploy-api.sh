#!/usr/bin/env bash
# =============================================================================
# Deploy ClaimGuard API ke Cloud Run — `gcloud run deploy --source` (SRS §10, §12.7).
#
# Tidak butuh Docker lokal: Cloud Build membangun dari backend/Dockerfile.
# Idempoten: aman dijalankan di setiap checkpoint (SRS §12.7 "deploy awal, deploy sering").
#
# Pemakaian:
#   export PROJECT_ID=hackathon-primestep-18
#   ./infra/deploy-api.sh                 # deploy dengan env default
#   ./infra/deploy-api.sh --dry-run       # cetak perintah saja
#   ./infra/deploy-api.sh --no-traffic    # deploy tanpa mengalihkan trafik (uji aman)
# =============================================================================
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID dulu: export PROJECT_ID=hackathon-primestep-18}"
REGION="${REGION:-asia-southeast2}"
SERVICE="${SERVICE:-claimguard-api}"
DB_INSTANCE="${DB_INSTANCE:-claimguard-pg}"
DB_NAME="${DB_NAME:-claimguard}"
DB_USER="${DB_USER:-claimguard}"
BUCKET="${BUCKET:-${PROJECT_ID}-claimguard-media}"
SA_RUN="${SA_RUN:-claimguard-run}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-flash-latest}"
GCP_LOCATION="${GCP_LOCATION:-global}"
AI_MODE="${AI_MODE:-auto}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"

DB_CONN="$PROJECT_ID:$REGION:$DB_INSTANCE"
SA_RUN_EMAIL="$SA_RUN@$PROJECT_ID.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DRY_RUN=0
TRAFFIC_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --no-traffic) TRAFFIC_ARGS+=(--no-traffic) ;;
    *) echo "Argumen tidak dikenal: $arg" >&2; exit 1 ;;
  esac
done

[[ -f "$ROOT/backend/Dockerfile" ]] || { echo "backend/Dockerfile tidak ada" >&2; exit 1; }
if [[ ! -f "$ROOT/backend/app/main.py" ]]; then
  echo "PERINGATAN: backend/app/main.py belum ada (milik Backend B)." >&2
  echo "Container akan gagal start karena Dockerfile menjalankan 'app.main:app'." >&2
  echo "Lanjutkan hanya untuk menguji build (Ctrl+C untuk batal)." >&2
  sleep 5
fi

# ENV_VARS non-rahasia. Password DB & URL lengkap TIDAK pernah masuk sini.
ENV_VARS="ENV=cloud"
ENV_VARS+=",STORAGE_BACKEND=gcs"
ENV_VARS+=",GCS_BUCKET=$BUCKET"
ENV_VARS+=",GCP_PROJECT=$PROJECT_ID"
ENV_VARS+=",GCP_LOCATION=$GCP_LOCATION"
ENV_VARS+=",GEMINI_MODEL=$GEMINI_MODEL"
ENV_VARS+=",AI_MODE=$AI_MODE"
# Dibaca ADK untuk memanggil model (NFR-04: tanpa API key, lewat service account).
ENV_VARS+=",GOOGLE_GENAI_USE_VERTEXAI=TRUE"
ENV_VARS+=",GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
ENV_VARS+=",GOOGLE_CLOUD_LOCATION=$GCP_LOCATION"
if [[ -n "$PUBLIC_BASE_URL" ]]; then
  ENV_VARS+=",PUBLIC_BASE_URL=$PUBLIC_BASE_URL"
fi

# DATABASE_URL dibangun di dalam container? Tidak: config.py membacanya sebagai satu nilai.
# Solusi paling aman: simpan URL lengkap sebagai secret dan pasang via --set-secrets.
# Buat sekali:
#   printf 'postgresql+psycopg://%s:%s@/%s?host=/cloudsql/%s' "$DB_USER" "$PW" "$DB_NAME" "$DB_CONN" \
#     | gcloud secrets create claimguard-database-url --data-file=-
SECRETS="DATABASE_URL=claimguard-database-url:latest"

# Cloud SQL Proxy sidecar disediakan oleh --add-cloudsql-instances (socket /cloudsql/<conn>).
CMD=(gcloud run deploy "$SERVICE"
  --project "$PROJECT_ID"
  --source "$ROOT/backend"
  --region "$REGION"
  --service-account "$SA_RUN_EMAIL"
  --add-cloudsql-instances "$DB_CONN"
  --set-env-vars "$ENV_VARS"
  --set-secrets "$SECRETS"
  --min-instances 1
  --max-instances 1
  --no-cpu-throttling
  --timeout 3600
  --memory 2Gi
  --cpu 1
  --port 8080
  --allow-unauthenticated
  --quiet
)
if [[ ${#TRAFFIC_ARGS[@]} -gt 0 ]]; then
  CMD+=("${TRAFFIC_ARGS[@]}")
fi

printf '\n==> %s\n\n' "${CMD[*]}"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "(dry run: tidak dieksekusi)"
  exit 0
fi

# --no-cpu-throttling + min-instances=1: investigasi berjalan sebagai asyncio.Task dan
# SSE memakai event bus di memori (SRS §12.3, NFR-13). Tanpa ini task mati setelah
# respons terkirim dan stream terputus.
"${CMD[@]}"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" \
  --region "$REGION" --format='value(status.url)')"

printf '\n==> Service: %s\n==> Health: %s/api/v1/health\n' "$URL" "$URL"
curl -fsS --max-time 30 "$URL/api/v1/health" && echo || {
  echo "Health belum hijau. Cek log:" >&2
  echo "  gcloud run services logs read $SERVICE --region $REGION --limit 50" >&2
}
