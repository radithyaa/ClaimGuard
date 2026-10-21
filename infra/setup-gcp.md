# Setup GCP ClaimGuard

Panduan ini diturunkan dari kode backend yang sudah ada, bukan dari asumsi:

| Kebutuhan GCP | Sumber di kode |
| --- | --- |
| Vertex AI (Gemini, tanpa API key) | `backend/app/services/gemini_client.py` (`genai.Client(vertexai=True, ...)`), `GOOGLE_GENAI_USE_VERTEXAI` untuk ADK |
| Cloud Storage + signed URL v4 | `backend/app/services/storage_service.py` (`GCSStorage`, `IAM signBlob`) |
| Cloud SQL Postgres | `backend/app/db/session.py` (`postgresql+psycopg`), `DATABASE_URL` di `core/config.py` |
| Secret Manager | `security.py` (password demo, FR-19), password DB |
| Cloud Run | SRS §10 (dua service, satu instance backend) |

Acuan aturan: `docs/SRS.md` §10 dan §15.2. Kewajiban stack masih menunggu briefing panitia (TOR §5).

---

## 0. Prasyarat

```bash
gcloud auth login
gcloud auth application-default login     # dipakai SDK Gemini saat dev lokal
gcloud config set project hackathon-primestep-18
```

`.env`, `*.db`, `backend/storage/` sudah di `.gitignore`. **Jangan pernah** menaruh service account key JSON di repo, deck, atau rekaman (TOR §9, NFR-04).

---

## 1. Yang perlu diberikan PIC GCP ke developer

Jalankan dari akun Owner/PIC:

```bash
export PROJECT_ID=hackathon-primestep-18
./infra/setup-gcp.sh --deployer user:ahzathenation@gmail.com
```

Role yang diberikan (minimum untuk `gcloud run deploy --source`):

| Role | Dipakai untuk |
| --- | --- |
| `roles/run.admin` | deploy kedua service Cloud Run |
| `roles/cloudbuild.builds.editor` | build image saat `--source` |
| `roles/artifactregistry.admin` | simpan image hasil build |
| `roles/iam.serviceAccountUser` | melampirkan SA runtime ke service |
| `roles/serviceusage.serviceUsageAdmin` | cek/aktifkan API |
| `roles/cloudsql.client` | koneksi ke Cloud SQL |
| `roles/storage.objectAdmin` | unggah video sampel ke bucket |
| `roles/secretmanager.secretAccessor` | baca secret saat deploy |
| `roles/aiplatform.user` | uji panggilan Gemini |
| `roles/logging.viewer`, `roles/viewer` | debug |

Semua role **terikat ke project** dan ber-`--condition=None`. Jangan pakai `roles/owner` atau `roles/editor`: pada project bersama, role itu memungkinkan penghapusan Cloud SQL dan bucket milik tim lain.

---

## 2. Membuat infrastruktur (sekali, oleh PIC)

```bash
export PROJECT_ID=hackathon-primestep-18
./infra/setup-gcp.sh --create-infra
```

Yang dibuat:

| Resource | Nilai default | Catatan |
| --- | --- | --- |
| API | run, cloudbuild, artifactregistry, sqladmin, storage, secretmanager, aiplatform, logging, monitoring, iam | Dulunya `TBD` |
| Service account | `claimguard-api`, `claimguard-run`, `claimguard-web` | `claimguard-run` adalah SA runtime |
| Bucket | `gs://<project>-claimguard-media` | uniform access, public access prevention |
| Cloud SQL | `claimguard-pg` (Postgres 16, `db-f1-micro`, `asia-southeast2`) | provisioning 5–10 menit |
| Database/user | `claimguard` / `claimguard` | password acak → Secret Manager |
| Secret | `claimguard-db-password`, `claimguard-demo-password` | nilai demo wajib diganti di console |

**Catatan keamanan password:** script membuat password acak lalu menyalinnya ke Secret Manager sebagai teks. Script **tidak** mencetak password. Kalau butuh nilai aslinya untuk dijalankan lokal:

```bash
gcloud secrets versions access latest --secret=claimguard-db-password
```

**Region:** Cloud Run di `asia-southeast2` (Jakarta). Model Gemini di Vertex memakai `location=global` (default di `config.py`). Verifikasi nama model & region di jam pertama, karena tidak semua model tersedia di setiap region.

---

## 3. Role runtime service account

`setup-gcp.sh` sudah memasang ini. Kalau perlu manual:

| Role | Untuk |
| --- | --- |
| `roles/aiplatform.user` | panggilan Vertex AI |
| `roles/cloudsql.client` | koneksi socket `/cloudsql/<conn>` |
| `roles/secretmanager.secretAccessor` | baca password demo & DB |
| `roles/logging.logWriter` | log JSON ke Cloud Logging |
| `roles/iam.serviceAccountTokenCreator` **pada SA itu sendiri** | **wajib** untuk signed URL v4 |
| `roles/storage.objectAdmin` pada bucket | baca/tulis `samples/` dan `clips/` |

Role `serviceAccountTokenCreator` adalah jebakan yang paling mudah terlewat. Di Cloud Run kredensial tidak punya private key, sehingga `generate_signed_url()` memakai IAM signBlob. Tanpa role ini, endpoint `/evidence/{id}/media` akan gagal 403 — dan penyebabnya tidak kelihatan dari log aplikasi.

---

## 4. Environment Cloud Run

Pasang sebagai env var service (bukan di repo). Field kiri = nama di `config.py`.

| Env | Nilai | Wajib? |
| --- | --- | --- |
| `ENV` | `cloud` | ya |
| `DATABASE_URL` | `postgresql+psycopg://claimguard:PASSWORD@/claimguard?host=/cloudsql/hackathon-primestep-18:asia-southeast2:claimguard-pg` | ya |
| `STORAGE_BACKEND` | `gcs` | ya |
| `GCS_BUCKET` | `<project>-claimguard-media` | ya |
| `GCP_PROJECT` | `hackathon-primestep-18` | ya |
| `GCP_LOCATION` | `global` | ya |
| `GOOGLE_CLOUD_PROJECT` | `hackathon-primestep-18` | ya (dibaca ADK) |
| `GOOGLE_CLOUD_LOCATION` | `global` | ya (dibaca ADK) |
| `GOOGLE_GENAI_USE_VERTEXAI` | `TRUE` | ya |
| `GEMINI_MODEL` | `gemini-flash-latest` | verifikasi nama di Vertex |
| `AI_MODE` | `auto` | default demo |
| `MIN_CONFIDENCE` | `0.6` | penjaga FR-12 |
| `PUBLIC_BASE_URL` | URL Cloud Run frontend | untuk `/media` lokal saja |

`DATABASE_URL` berisi password. Jangan tulis literal di skrip yang di-commit. Pakai `--set-secrets` setelah password dipetakan, atau simpan URL lengkap sebagai secret `claimguard-database-url`.

---

## 5. Deploy API

`backend/Dockerfile` dan `infra/deploy-api.sh` sudah ada. Isi image diturunkan dari kode:

| Kebutuhan kode | Isi Dockerfile |
| --- | --- |
| `prompts/__init__.py` membaca `*.md` saat runtime | `COPY app ./app` (prompt ikut, bukan hanya paket Python) |
| `video_service.ffmpeg_exe()` | `apt-get install ffmpeg` |
| `storage_service` (GCS), `google-adk` | dependensi dari `pyproject.toml` |
| `ai_cache` menulis `./data/cache` | `/app/data/cache` dibuat & chown ke uid 10001 |
| `video_tools` memakai `tempfile` | TMPDIR default, dibersihkan `tini` |

### 5.1 Siapkan secret URL database (sekali)

`DATABASE_URL` berisi password, jadi tidak boleh masuk `--set-env-vars`.

```bash
PW="$(gcloud secrets versions access latest --secret=claimguard-db-password)"
printf 'postgresql+psycopg://claimguard:%s@/claimguard?host=/cloudsql/hackathon-primestep-18:asia-southeast2:claimguard-pg' "$PW" \
  | gcloud secrets create claimguard-database-url --data-file=-
unset PW
```

### 5.2 Deploy

```bash
export PROJECT_ID=hackathon-primestep-18
./infra/deploy-api.sh --dry-run     # lihat perintahnya dulu
./infra/deploy-api.sh               # deploy
```

Flag yang dipakai dan alasannya:

| Flag | Alasan |
| --- | --- |
| `--min-instances 1 --max-instances 1` | task registry, event bus SSE, dan scheduler ada di memori proses (NFR-13) |
| `--no-cpu-throttling` | investigasi berjalan sebagai `asyncio.Task` setelah respons terkirim (SRS §12.3) |
| `--timeout 3600` | SSE dan investigasi panjang |
| `--add-cloudsql-instances` | menyediakan socket `/cloudsql/<conn>` yang dipakai `DATABASE_URL` |
| `--memory 2Gi` | FFmpeg encode ulang + Gemini multimodal |
| `--allow-unauthenticated` | demo publik; API tetap punya login demo (FR-19) |

`--source` memakai Cloud Build, jadi tidak butuh Docker lokal.

### 5.3 Deploy frontend (claimguard-web)

```bash
export API_URL=https://claimguard-api-259363364922.asia-southeast2.run.app
./infra/deploy-web.sh --dry-run
./infra/deploy-web.sh
```

**`NEXT_PUBLIC_API_BASE_URL` wajib lewat `--build-arg`, bukan `--set-env-vars`.** Next.js meng-inline nilai `NEXT_PUBLIC_*` ke bundle saat `next build`. Memberikannya sebagai env runtime **tidak berpengaruh sama sekali** — hasilnya frontend akan memanggil `http://localhost:8000`. `deploy-web.sh` sudah menangani ini.

Setelah web punya URL, **backend harus diberi CORS origin web** (NFR-06):

```bash
CORS_ORIGINS='["https://claimguard-web-xxxx.a.run.app"]' ./infra/deploy-api.sh --image
```

### 5.4 Dua mode deploy: kapan pakai yang mana

| Perubahan | Perintah | Waktu |
| --- | --- | --- |
| Kode backend/frontend | `./infra/deploy-api.sh` / `deploy-web.sh` | 5–15 menit (build) |
| Env, secret, CORS, CPU/memory | tambahkan `--image` | **~2 menit** |

`--image` memakai tag `:latest` yang sudah ada di Artifact Registry, jadi tidak memicu Cloud Build. Ini yang dipakai saat rolling config di checkpoint.

### 5.5 Kegagalan umum dan artinya

| Pesan | Penyebab sebenarnya |
| --- | --- |
| `could not find source [backend]` | perintah dijalankan dari `frontend/`; path `--source` relatif ke CWD |
| `Aborted by user` walau tidak ada interaksi | `--quiet` menjawab "N" pada prompt aktivasi API |
| `failed to update builder last activity` / `no space left on device` | disk lokal penuh; `docker builder prune -af` |
| revisi `failed to start and listen on PORT` | container crash; baca `gcloud run services logs read` |
| `Connection refused` di `/cloudsql/...` | SA runtime belum punya `roles/cloudsql.client` |
| Gemini 403 saat investigasi | SA runtime belum punya `roles/aiplatform.user` |

### 5.6 Status prasyarat

`deploy-api.sh` akan memperingatkan bila `backend/app/main.py` belum ada (milik Backend B). Tanpa file itu, container gagal start karena entrypoint menjalankan `app.main:app`. Urutan yang benar: Backend B membuat `main.py` → deploy API → Frontend A deploy web.

---

## 6. Verifikasi

```bash
./infra/setup-gcp.sh --verify
gcloud run services list --region asia-southeast2
gcloud run services proxy claimguard-api --region asia-southeast2   # lalu buka /health
```

Uji Vertex tanpa deploy (memakai ADC lokal):

```bash
cd backend
python -c "from google import genai; c=genai.Client(vertexai=True, project='hackathon-primestep-18', location='global'); print(c.models.generate_content(model='gemini-flash-latest', contents='ping').text)"
```

Kalau perintah di atas 403, role `aiplatform.user` atau billing belum aktif.

---

## 7. Yang tetap jalan tanpa GCP

Dev lokal tidak butuh apa pun dari dokumen ini:

```bash
cd backend
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest -q
```

`STORAGE_BACKEND=local` + `DATABASE_URL=sqlite:///./claimguard.db` + cache rekam-putar (`AI_MODE=cache`) membuat seluruh alur agen berjalan tanpa billing. Ini jalur cadangan untuk skenario E (SRS §13).
