#!/usr/bin/env bash
# =============================================================================
# Deploy ClaimGuard Web (Next.js) ke Cloud Run.
#
# Pelajaran yang sudah ditanam di sini (setiap satu pernah jadi kegagalan nyata):
#   1. --source memicu Cloud Build -> butuh repo Artifact Registry + izin bucket.
#   2. NEXT_PUBLIC_* di-inline saat BUILD, jadi wajib lewat --set-build-env-vars.
#      Memberikannya sebagai --set-env-vars TIDAK berpengaruh (sudah dibekukan di bundle).
#   3. `--quiet` menjawab "N" pada prompt aktivasi API -> gunakan
#      `gcloud services enable` lebih dulu, bukan mengandalkan prompt.
#   4. Path --source relatif ke CWD -> script ini memakai path absolut.
#   5. Build ulang penuh bisa >10 menit. Untuk perubahan env saja, pakai --image.
#
# Pemakaian:
#   export PROJECT_ID=hackathon-primestep-18
#   export API_URL=https://claimguard-api-xxx.run.app
#   ./infra/deploy-web.sh --dry-run
#   ./infra/deploy-web.sh
# =============================================================================
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID dulu: export PROJECT_ID=hackathon-primestep-18}"
REGION="${REGION:-asia-southeast2}"
SERVICE="${SERVICE:-claimguard-web}"
SA_WEB="${SA_WEB:-claimguard-web}"
REPO="${REPO:-cloud-run-source-deploy}"
API_URL="${API_URL:?Set API_URL dulu: export API_URL=https://claimguard-api-xxx.run.app}"
PORT="${PORT:-8080}"

SA_WEB_EMAIL="$SA_WEB@$PROJECT_ID.iam.gserviceaccount.com"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/frontend"

DRY_RUN=0
USE_IMAGE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --image)     USE_IMAGE=1 ;;   # lewati build, pakai tag :latest yang sudah ada
    *) echo "Argumen tidak dikenal: $arg" >&2; exit 1 ;;
  esac
done

[[ -d "$SRC" ]] || { echo "Folder frontend tidak ada di $SRC" >&2; exit 1; }
[[ -f "$SRC/Dockerfile" ]] || { echo "frontend/Dockerfile tidak ada" >&2; exit 1; }
for f in package.json package-lock.json; do
  [[ -f "$SRC/$f" ]] || { echo "frontend/$f tidak ada" >&2; exit 1; }
done

# API_URL harus absolut; nilai relatif akan gagal di browser.
if [[ ! "$API_URL" =~ ^https?:// ]]; then
  echo "API_URL harus diawali http(s):// (diterima: $API_URL)" >&2
  exit 1
fi
# Trailing slash menghasilkan //api/v1 di klien.
API_URL="${API_URL%/}"

log() { printf '\n==> %s\n' "$*"; }

log "Cek prasyarat"
# Beberapa API tidak auto-aktif dan prompt-nya dijawab "N" oleh --quiet.
if ! gcloud services list --enabled --project="$PROJECT_ID" \
      --filter='config.name:artifactregistry.googleapis.com' --format='value(config.name)' \
      | grep -q artifactregistry; then
  echo "artifactregistry.googleapis.com belum aktif. Jalankan:" >&2
  echo "  gcloud services enable artifactregistry.googleapis.com --project=$PROJECT_ID" >&2
  exit 1
fi
if ! gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
      >/dev/null 2>&1; then
  # Service web belum ada: pastikan SA-nya siap sebelum deploy pertama.
  if ! gcloud iam service-accounts describe "$SA_WEB_EMAIL" --project="$PROJECT_ID" \
        >/dev/null 2>&1; then
    echo "SA $SA_WEB_EMAIL belum ada. Buat dengan infra/setup-gcp.sh --create-infra" >&2
    exit 1
  fi
fi

deploy_args=(
  --project "$PROJECT_ID"
  --region "$REGION"
  --service-account "$SA_WEB_EMAIL"
  --port "$PORT"
  --min-instances 1
  --max-instances 4          # web stateless: boleh lebih dari 1 (beda dari API)
  --memory 512Mi
  --cpu 1
  --timeout 300
  --allow-unauthenticated
  --quiet
)

if [[ "$USE_IMAGE" == "1" ]]; then
  log "Deploy dari image yang sudah ada (tanpa build)"
  deploy_args+=(--image "$IMAGE:latest")
else
  log "Build & deploy dari sumber"
  # PENTING: pada `--source`, `--tag` berarti traffic tag revisi (maks. 46 karakter
  # gabungan dengan nama service), BUKAN nama image. Jangan dipakai untuk image.
  deploy_args+=(
    --source "$SRC"
    --set-build-env-vars "NEXT_PUBLIC_API_BASE_URL=$API_URL"
  )
fi

printf '\n  gcloud run deploy %s %s\n\n' "$SERVICE" "${deploy_args[*]}"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "(dry run: tidak dieksekusi)"
  exit 0
fi

# NEXT_PUBLIC_API_BASE_URL hanya efektif sebagai build arg. Jangan ditambahkan
# ke --set-env-vars: nilainya sudah dibekukan di bundle saat build.
gcloud run deploy "$SERVICE" "${deploy_args[@]}"

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" \
  --region="$REGION" --format='value(status.url)')"

log "Selesai"
printf '  Web : %s\n  API : %s\n\n' "$URL" "$API_URL"
printf '  Cek halaman: %s/settings\n\n' "$URL"
printf '  PENTING: set CORS_ORIGINS backend agar sama dengan origin web:\n'
printf '    ./infra/deploy-api.sh   (dengan CORS_ORIGINS=%s)\n' "$URL"

# Smoke test ringan; gagal di sini tidak membatalkan deploy, hanya memberi sinyal.
if curl -fsS -o /dev/null --max-time 30 "$URL/settings"; then
  echo "  Smoke test: /settings OK"
else
  echo "  Smoke test GAGAL. Cek: gcloud run services logs read $SERVICE --region $REGION --limit 50" >&2
fi
