#!/usr/bin/env bash
# =============================================================================
# Unggah video sampel ke bucket media ClaimGuard (dibaca server deployment sebagai
# `gs://<BUCKET>/samples/<file>`; lihat app/services/demo_data.media_uri).
#
# Kenapa tidak lewat image: `backend/.dockerignore` membuang data/samples/, dan video
# biner besar tidak di-commit. Bucket adalah satu-satunya tempat berkas itu harus ada
# agar `clip_cctv_video` dan `analyze_media` berjalan di Cloud Run.
#
# Idempoten: berkas yang isinya sama dilewati (`gcloud storage rsync`).
#
# Pemakaian:
#   export PROJECT_ID=hackathon-primestep-18
#   ./infra/upload-samples.sh              # unggah semua rekaman di backend/data/samples
#   ./infra/upload-samples.sh --check      # pastikan semua berkas yang diminta shipments.json ada
#   ./infra/upload-samples.sh --dry-run    # cetak perintah saja
# =============================================================================
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID dulu: export PROJECT_ID=hackathon-primestep-18}"
BUCKET="${BUCKET:-${PROJECT_ID}-claimguard-media}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SAMPLES="$ROOT/backend/data/samples"
MANIFEST="$ROOT/backend/data/mock/shipments.json"

DRY_RUN=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --check)   CHECK_ONLY=1 ;;
    *) echo "Argumen tidak dikenal: $arg" >&2; exit 1 ;;
  esac
done

[[ -f "$MANIFEST" ]] || { echo "manifest tidak ada: $MANIFEST" >&2; exit 1; }
[[ -d "$SAMPLES" ]] || { echo "folder sampel tidak ada: $SAMPLES" >&2; exit 1; }

# Nama berkas yang diminta shipments.json (sama dengan key `samples/<file>` di storage).
wanted="$(python3 - "$MANIFEST" <<'PY'
import json, sys
for media in json.load(open(sys.argv[1], encoding="utf-8"))["media"]:
    print(media["file"])
PY
)"

missing=0
while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  if [[ -f "$SAMPLES/$file" ]]; then
    printf '    ok      %s\n' "$file"
  else
    printf '    HILANG  %s\n' "$file"
    missing=$((missing + 1))
  fi
done <<< "$wanted"
if [[ "$missing" -gt 0 ]]; then
  echo "PERINGATAN: $missing berkas belum ada di $SAMPLES." >&2
  echo "Investigasi yang memakai berkas itu akan gagal di clip_cctv_video / analyze_media." >&2
fi

if [[ "$CHECK_ONLY" == "1" ]]; then
  exit 0
fi

# Salinan yang sudah ada dan identik dilewati; hanya `samples/` yang disinkronkan.
CMD=(gcloud storage rsync "$SAMPLES" "gs://$BUCKET/samples"
  --project "$PROJECT_ID" --recursive --delete-unmatched-destination-objects)

printf '\n==> %s\n\n' "${CMD[*]}"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "(dry run: tidak dieksekusi)"
  exit 0
fi
"${CMD[@]}"

echo
gcloud storage ls "gs://$BUCKET/samples" --project "$PROJECT_ID"
cat <<EOF

Rekaman siap dipakai server deployment. Seed ulang DB agar media_assets menunjuk gs:// sambil mengukur
durasi asli (durasi di shipments.json hanya perkiraan):

  curl -X POST "\$API_URL/api/v1/demo/reseed" -H "Cookie: cg_session=\$TOKEN"

Checksum tidak disimpan, jadi berkas yang keganti isinya dengan nama sama tetap perlu
diunggah manual: gcloud storage cp backend/data/samples/<file> gs://$BUCKET/samples/
EOF
