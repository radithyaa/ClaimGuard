#!/usr/bin/env bash
# =============================================================================
# Setup GCP untuk ClaimGuard — idempoten, aman dijalankan berulang.
#
# Diturunkan langsung dari kode backend:
#   app/core/config.py          -> env GCP_PROJECT, GCS_BUCKET, DATABASE_URL, ...
#   app/services/gemini_client.py -> Vertex AI, tanpa API key
#   app/services/storage_service.py -> GCSStorage + signed URL v4 via IAM signBlob
#   app/db/session.py           -> postgresql+psycopg via Cloud SQL socket
#
# Acuan: docs/SRS.md §10 dan §15.2.
#
# Pemakaian:
#   export PROJECT_ID=hackathon-primestep-18
#   ./infra/setup-gcp.sh --create-infra        # sekali saja (butuh sqladmin/storage admin)
#   ./infra/setup-gcp.sh --deployer you@x.com  # beri IAM ke anggota tim yang deploy
#   ./infra/setup-gcp.sh --github owner/repo   # (opsional, tidak dipakai) izin GitHub Actions deploy
#
# JANGAN menjalankan --create-infra bila project dipakai bersama tim lain
# tanpa persetujuan PIC. Lihat infra/setup-gcp.md.
# =============================================================================
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID dulu: export PROJECT_ID=hackathon-primestep-18}"
REGION="${REGION:-asia-southeast2}"          # Jakarta; dekat ke pengguna & mendukung Cloud Run
DB_INSTANCE="${DB_INSTANCE:-claimguard-pg}"
DB_NAME="${DB_NAME:-claimguard}"
DB_USER="${DB_USER:-claimguard}"
BUCKET="${BUCKET:-${PROJECT_ID}-claimguard-media}"
SA_API="${SA_API:-claimguard-api}"
SA_RUN="${SA_RUN:-claimguard-run}"           # runtime service (yang dipakai Cloud Run)
SA_WEB="${SA_WEB:-claimguard-web}"
SA_DEPLOY="${SA_DEPLOY:-claimguard-github-deployer}"  # untuk auto-deploy GitHub (opsional, tidak dipakai)
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"
# WIF pool/provider: keduanya tidak punya biaya dan aman dipertahankan.
WIF_POOL="${WIF_POOL:-github}"
WIF_PROVIDER="${WIF_PROVIDER:-github}"

GCP="$PROJECT_ID"
DB_CONN="$PROJECT_ID:$REGION:$DB_INSTANCE"
SA_API_EMAIL="$SA_API@$PROJECT_ID.iam.gserviceaccount.com"
SA_RUN_EMAIL="$SA_RUN@$PROJECT_ID.iam.gserviceaccount.com"
SA_WEB_EMAIL="$SA_WEB@$PROJECT_ID.iam.gserviceaccount.com"
SA_DEPLOY_EMAIL="$SA_DEPLOY@$PROJECT_ID.iam.gserviceaccount.com"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
skip() { printf '    (sudah ada) %s\n' "$*"; }

require_project() {
  local state
  state="$(gcloud projects describe "$PROJECT_ID" --format='value(lifecycleState)')" || {
    echo "Tidak bisa membaca project $PROJECT_ID. Sudah dapat akses IAM?" >&2
    exit 1
  }
  [[ "$state" == "ACTIVE" ]] || { echo "Project bukan ACTIVE: $state" >&2; exit 1; }
  gcloud config set project "$PROJECT_ID" >/dev/null
  log "Project: $PROJECT_ID (region $REGION)"
}

check_billing() {
  local enabled
  enabled="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')"
  if [[ "$enabled" != "True" ]]; then
    echo "PERINGATAN: billing belum aktif. API Cloud Run/Vertex/SQL tidak bisa dipakai." >&2
    echo "Minta PIC mengaktifkan billing atau link billing account:" >&2
    echo "  gcloud billing projects link $PROJECT_ID --billing-account=XXXXXX-XXXXXX-XXXXXX" >&2
    return 1
  fi
  log "Billing aktif"
}

enable_apis() {
  log "Mengaktifkan API"
  # Daftar ini cocok dengan yang dipakai kode (Vertex, GCS, Cloud SQL) + pipa deploy.
  gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    sqladmin.googleapis.com \
    storage.googleapis.com \
    secretmanager.googleapis.com \
    aiplatform.googleapis.com \
    logging.googleapis.com \
    monitoring.googleapis.com \
    iam.googleapis.com \
    iamcredentials.googleapis.com \
    sts.googleapis.com \
    --project="$PROJECT_ID"
}

ensure_service_account() {
  local id="$1" display="$2"
  if gcloud iam service-accounts describe "$id@$PROJECT_ID.iam.gserviceaccount.com" \
      --project="$PROJECT_ID" >/dev/null 2>&1; then
    skip "SA $id"
  else
    gcloud iam service-accounts create "$id" \
      --display-name="$display" --project="$PROJECT_ID"
  fi
}

bind_sa_role() {
  local sa_email="$1" role="$2"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$sa_email" \
    --role="$role" \
    --condition=None >/dev/null
  printf '    %-45s <- %s\n' "$sa_email" "$role"
}

create_bucket() {
  log "Bucket GCS: gs://$BUCKET"
  if gcloud storage buckets describe "gs://$BUCKET" --project="$PROJECT_ID" >/dev/null 2>&1; then
    skip "gs://$BUCKET"
  else
    gcloud storage buckets create "gs://$BUCKET" \
      --project="$PROJECT_ID" --location="$REGION" \
      --uniform-bucket-level-access --public-access-prevention
  fi
  # Struktur key dipakai kode: samples/... dan clips/<investigation_id>/...
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
    --member="serviceAccount:$SA_RUN_EMAIL" \
    --role="roles/storage.objectAdmin" >/dev/null
  printf '    %s <- roles/storage.objectAdmin\n' "$SA_RUN_EMAIL"
}

create_cloud_sql() {
  log "Cloud SQL Postgres: $DB_INSTANCE ($DB_CONN)"
  if gcloud sql instances describe "$DB_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1; then
    skip "instance $DB_INSTANCE"
  else
    # db-f1-micro: tier terkecil, sesuai SRS §15.2. Provisioning 5-10 menit.
    gcloud sql instances create "$DB_INSTANCE" \
      --project="$PROJECT_ID" \
      --database-version=POSTGRES_16 \
      --edition=enterprise \
      --tier=db-f1-micro \
      --region="$REGION" \
      --storage-size=10GB \
      --storage-auto-increase \
      --availability-type=zonal \
      --no-backup
  fi

  if gcloud sql databases describe "$DB_NAME" --instance="$DB_INSTANCE" \
      --project="$PROJECT_ID" >/dev/null 2>&1; then
    skip "database $DB_NAME"
  else
    gcloud sql databases create "$DB_NAME" --instance="$DB_INSTANCE" --project="$PROJECT_ID"
  fi

  # Password DB tidak pernah ditulis ke repo/deck (NFR-04). Simpan di Secret Manager.
  if gcloud secrets describe claimguard-db-password --project="$PROJECT_ID" >/dev/null 2>&1; then
    skip "password $DB_USER (secret sudah ada; password tidak diubah)"
  else
    local pw
    pw="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"
    gcloud sql users create "$DB_USER" \
      --instance="$DB_INSTANCE" --project="$PROJECT_ID" --password="$pw" >/dev/null
    printf '%s' "$pw" | gcloud secrets create claimguard-db-password \
      --project="$PROJECT_ID" --replication-policy=automatic --data-file=-
    echo "    password dibuat dan disimpan di Secret Manager: claimguard-db-password"
  fi
}

create_demo_password_secret() {
  if gcloud secrets describe claimguard-demo-password --project="$PROJECT_ID" >/dev/null 2>&1; then
    skip "secret claimguard-demo-password"
  else
    # FR-19: password tunggal mode demo. Ganti nilainya di console setelah dibuat.
    printf '%s' "ganti-password-ini" | gcloud secrets create claimguard-demo-password \
      --project="$PROJECT_ID" --replication-policy=automatic --data-file=-
  fi
}

grant_runtime_iam() {
  log "Role untuk service account runtime ($SA_RUN)"
  # Vertex AI: dipakai gemini_client.py dan model ADK.
  bind_sa_role "$SA_RUN_EMAIL" roles/aiplatform.user
  # Baca secret: GCS_BUCKET tidak rahasia, tapi password DB & demo ada di Secret Manager.
  bind_sa_role "$SA_RUN_EMAIL" roles/secretmanager.secretAccessor
  # Cloud SQL Client: koneksi via socket /cloudsql/<conn>.
  bind_sa_role "$SA_RUN_EMAIL" roles/cloudsql.client
  # Log terstruktur ke stdout dibaca Cloud Logging (NFR-08).
  bind_sa_role "$SA_RUN_EMAIL" roles/logging.logWriter

  # PENTING: signed URL v4. Di Cloud Run kredensial tidak punya private key, jadi
  # storage_service.py menandatangani lewat IAM signBlob. SA butuh role ini PADA
  # DIRINYA SENDIRI, bukan hanya di bucket.
  gcloud iam service-accounts add-iam-policy-binding "$SA_RUN_EMAIL" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:$SA_RUN_EMAIL" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --condition=None >/dev/null
  printf '    %s <- roles/iam.serviceAccountTokenCreator (self, untuk signed URL)\n' "$SA_RUN_EMAIL"
}

grant_deployer() {
  local member="$1"
  log "Role untuk pengguna yang men-deploy: $member"
  # Role minimum agar `gcloud run deploy --source` + setup berjalan.
  # Sengaja BUKAN roles/owner atau roles/editor.
  for role in \
    roles/run.admin \
    roles/cloudbuild.builds.editor \
    roles/artifactregistry.admin \
    roles/iam.serviceAccountUser \
    roles/serviceusage.serviceUsageAdmin \
    roles/cloudsql.client \
    roles/storage.objectAdmin \
    roles/secretmanager.secretAccessor \
    roles/aiplatform.user \
    roles/logging.viewer \
    roles/viewer ; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="$member" --role="$role" --condition=None >/dev/null
    printf '    %-45s <- %s\n' "$member" "$role"
  done
}

grant_deploy_sa() {
  log "Role untuk service account deploy CI ($SA_DEPLOY)"
  # Harus bisa meniru SA runtime: melampirkan --service-account ke Cloud Run
  # butuh iam.serviceAccounts.actAs pada SA tersebut.
  for sa_email in "$SA_RUN_EMAIL" "$SA_WEB_EMAIL"; do
    gcloud iam service-accounts add-iam-policy-binding "$sa_email" \
      --project="$PROJECT_ID" \
      --member="serviceAccount:$SA_DEPLOY_EMAIL" \
      --role="roles/iam.serviceAccountUser" \
      --condition=None >/dev/null
    printf '    %-45s <- %s\n' "$SA_DEPLOY_EMAIL" "roles/iam.serviceAccountUser on $sa_email"
  done

  # Cakupan sama dengan --deployer; sengaja tanpa roles/editor atau roles/owner.
  for role in \
    roles/run.admin \
    roles/cloudbuild.builds.editor \
    roles/artifactregistry.admin \
    roles/serviceusage.serviceUsageAdmin \
    roles/cloudsql.client \
    roles/storage.objectAdmin \
    roles/secretmanager.secretAccessor \
    roles/aiplatform.user \
    roles/logging.viewer \
    roles/viewer ; do
    bind_sa_role "$SA_DEPLOY_EMAIL" "$role"
  done
}

grant_github_wif() {
  local repo="${1:-}"
  local repo_id="" pool_full provider_full issuer

  [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
    echo "Pakai: $0 --github owner/repo (contoh: radithyaa/ClaimGuard)" >&2
    exit 1
  }
  # Repo berbeda bisa memakai nama yang sama (fork/rename), jadi atribut yang
  # dipercaya adalah `repository_id`, bukan `repository` saja.
  if [[ -n "${REPO_ID:-}" ]]; then
    repo_id="$REPO_ID"
  else
    repo_id="$(gh api "repos/$repo" --jq .id 2>/dev/null)" || {
      echo "Tidak bisa membaca repo $repo lewat 'gh'. Butuh GitHub CLI + login (gh auth login)." >&2
      echo "Tanpa gh: lihat angka pada https://api.github.com/repos/$repo lalu jalankan" >&2
      echo "  REPO_ID=<angka> ./infra/setup-gcp.sh --github $repo" >&2
      exit 1
    }
  fi
  [[ -n "$repo_id" ]] || { echo "repository_id kosong untuk $repo" >&2; exit 1; }

  pool_full="projects/$PROJECT_ID/locations/global/workloadIdentityPools/$WIF_POOL"
  provider_full="$pool_full/providers/$WIF_PROVIDER"
  issuer="https://token.actions.githubusercontent.com"

  log "Workload Identity Federation untuk GitHub Actions"
  if gcloud iam workload-identity-pools describe "$WIF_POOL" \
      --project="$PROJECT_ID" --location=global >/dev/null 2>&1; then
    skip "pool $WIF_POOL"
  else
    gcloud iam workload-identity-pools create "$WIF_POOL" \
      --project="$PROJECT_ID" --location=global \
      --display-name="GitHub Actions"
  fi

  if gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
      --project="$PROJECT_ID" --location=global \
      --workload-identity-pool="$WIF_POOL" >/dev/null 2>&1; then
    skip "provider $WIF_PROVIDER"
  else
    gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
      --project="$PROJECT_ID" --location=global \
      --workload-identity-pool="$WIF_POOL" \
      --display-name="GitHub OIDC" \
      --issuer-uri="$issuer" \
      --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref" \
      --attribute-condition="assertion.repository_id == '$repo_id' && assertion.ref == 'refs/heads/main'"
  fi

  # Hanya workflow di main repo ini (dan hanya dari main) yang boleh memakai SA.
  gcloud iam service-accounts add-iam-policy-binding "$SA_DEPLOY_EMAIL" \
    --project="$PROJECT_ID" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/$pool_full/attribute.repository_id/$repo_id" \
    --condition=None >/dev/null
  printf '    %s <- roles/iam.workloadIdentityUser (repo_id %s)\n' "$SA_DEPLOY_EMAIL" "$repo_id"

  cat <<EOF

  Isi GitHub Settings > Secrets and variables > Actions > Variables:
    GCP_PROJECT_ID                 = $PROJECT_ID
    GCP_REGION                     = $REGION
    GCP_WORKLOAD_IDENTITY_PROVIDER = $provider_full
    GCP_SERVICE_ACCOUNT            = $SA_DEPLOY_EMAIL
    CORS_ORIGINS                   = ["https://claimguard-web-xxx.<region>.run.app"]
                                     (URL web setelah deploy pertama; lihat §8.4)

  Tidak ada service account key JSON yang dibuat atau diunduh (NFR-04).

EOF
}

print_summary() {
  cat <<EOF

  Ringkasan (catat di infra/setup-gcp.md, tanpa secret):

    PROJECT_ID          = $PROJECT_ID
    REGION              = $REGION
    DB_CONNECTION_NAME  = $DB_CONN
    DB_NAME / DB_USER   = $DB_NAME / $DB_USER
    BUCKET              = $BUCKET
    SA runtime API      = $SA_RUN_EMAIL
    SA build API        = $SA_API_EMAIL   (opsional: dipakai Cloud Build untuk deploy)
    Secrets             = claimguard-db-password, claimguard-demo-password

  Env Cloud Run untuk claimguard-api (lihat infra/setup-gcp.md):
    ENV=cloud
    STORAGE_BACKEND=gcs
    GCS_BUCKET=$BUCKET
    GCP_PROJECT=$GCP
    GOOGLE_CLOUD_PROJECT=$GCP
    GOOGLE_GENAI_USE_VERTEXAI=TRUE
    DATABASE_URL=postgresql+psycopg://$DB_USER:PASSWORD@/$DB_NAME?host=/cloudsql/$DB_CONN
      PASSWORD  <- referensikan secret, JANGAN tulis literal

EOF
}

main() {
  require_project
  case "${1:-}" in
    --create-infra)
      check_billing || exit 1
      enable_apis
      ensure_service_account "$SA_API" "ClaimGuard API build"
      ensure_service_account "$SA_RUN" "ClaimGuard API runtime (Cloud Run)"
      ensure_service_account "$SA_WEB" "ClaimGuard Web runtime (Cloud Run)"
      create_bucket
      create_cloud_sql
      create_demo_password_secret
      grant_runtime_iam
      print_summary
      ;;
    --deployer)
      [[ -n "${2:-}" ]] || { echo "Pakai: $0 --deployer user:email@domain" >&2; exit 1; }
      grant_deployer "$2"
      ;;
    --github)
      [[ -n "${2:-}" ]] || { echo "Pakai: $0 --github owner/repo" >&2; exit 1; }
      require_project
      check_billing || exit 1
      enable_apis
      ensure_service_account "$SA_DEPLOY" "ClaimGuard CI deployer (GitHub Actions)"
      grant_deploy_sa
      grant_github_wif "$2"
      ;;
    --verify)
      log "Verifikasi"
      gcloud services list --enabled --project="$PROJECT_ID" \
        --filter='config.name:(run|aiplatform|sqladmin|storage|secretmanager).googleapis.com' \
        --format='table(config.name)' || true
      gcloud storage buckets describe "gs://$BUCKET" --format='value(name,location)' 2>/dev/null || echo "    bucket belum ada"
      gcloud sql instances describe "$DB_INSTANCE" \
        --format='value(name,state,region)' 2>/dev/null || echo "    instance belum ada"
      ;;
    *)
      sed -n '2,23p' "$0"
      ;;
  esac
}

main "$@"
