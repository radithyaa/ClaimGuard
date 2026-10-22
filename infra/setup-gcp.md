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
| Secret | `claimguard-session-secret`, `claimguard-database-url` | dipasang `deploy-api.sh`; dibuat di §5.1/§8.2 bila belum ada |
| WIF | pool `github`, provider `github` | hanya bila auto-deploy dihidupkan lagi (§8) |

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

`deploy-api.sh` memasang tiga secret (lihat `SECRETS` di script): `claimguard-database-url`,
`claimguard-session-secret`, dan `claimguard-demo-password`. Selain db-password/demo-password
yang dibuat `--create-infra`, dua secret berikut harus ada **sebelum** deploy pertama:

```bash
# SESSION_SECRET: string acak; config.py menolak start bila memakai default dev.
head -c 48 /dev/urandom | base64 | tr -d '/+=' \
  | gcloud secrets create claimguard-session-secret --replication-policy=automatic --data-file=-
```

`DATABASE_URL` berisi password, jadi tidak boleh masuk `--set-env-vars`.

```bash
PW="$(gcloud secrets versions access latest --secret=claimguard-db-password)"
printf 'postgresql+psycopg://claimguard:%s@/claimguard?host=/cloudsql/hackathon-primestep-18:asia-southeast2:claimguard-pg' "$PW" \
  | gcloud secrets create claimguard-database-url --data-file=-
unset PW
```

### 5.2 Deploy API

```bash
cd <root repo>
export PROJECT_ID=hackathon-primestep-18
# Origin frontend WAJIB disertakan, formatnya daftar dipisah koma (script mengubahnya ke JSON).
export CORS_ORIGINS=https://claimguard-web-5rzsoa7j3a-et.a.run.app

./infra/deploy-api.sh --dry-run     # cetak perintah + env vars tanpa eksekusi
./infra/deploy-api.sh               # build via Cloud Build, deploy, lalu cek /health
```

Keluaran yang benar diakhiri:

```
Service [claimguard-api] revision [claimguard-api-00007-4rt] has been deployed and is serving 100 percent of traffic.
==> Health: https://claimguard-api-5rzsoa7j3a-et.a.run.app/api/v1/health
{"status":"ok","db":"ok","ai_mode":"auto","storage":"gcs"}
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

`--source` memakai Cloud Build, jadi tidak butuh Docker lokal. Waktu build ±5–8 menit.

### 5.3 Deploy frontend (claimguard-web)

```bash
export API_URL=https://claimguard-api-5rzsoa7j3a-et.a.run.app
export DEMO_PASSWORD="$(gcloud secrets versions access latest --secret=claimguard-demo-password --project="$PROJECT_ID")"

./infra/deploy-web.sh --dry-run
./infra/deploy-web.sh
```

`DEMO_PASSWORD` mengaktifkan tombol **"Coba sebagai juri"** di halaman login. Bila variabel ini kosong, tombol disembunyikan dan juri harus mengetik kata sandi.

**`NEXT_PUBLIC_*` wajib lewat `--build-arg`, bukan `--set-env-vars`.** Next.js meng-inline nilai `NEXT_PUBLIC_*` ke bundle saat `next build`. Memberikannya sebagai env runtime **tidak berpengaruh sama sekali** — hasilnya frontend akan memanggil `http://localhost:8000`. `deploy-web.sh` sudah menangani ini.

Bila `CORS_ORIGINS` belum diisi saat deploy API, jalankan ulang tanpa build (±2 menit):

```bash
CORS_ORIGINS=https://claimguard-web-5rzsoa7j3a-et.a.run.app ./infra/deploy-api.sh --image
```

### 5.4 Dua mode deploy: kapan pakai yang mana

| Perubahan | Perintah | Waktu |
| --- | --- | --- |
| Kode backend/frontend | `./infra/deploy-api.sh` / `deploy-web.sh` | 5–15 menit (build) |
| Env, secret, CORS, CPU/memory | tambahkan `--image` | **~2 menit** |

`--image` memakai tag `:latest` yang sudah ada di Artifact Registry, jadi tidak memicu Cloud Build. Ini yang dipakai saat rolling config di checkpoint.

### 5.5 Kegagalan umum dan artinya

Semua baris di bawah adalah **kegagalan nyata yang pernah terjadi** saat mengerjakan repo ini, bukan tebakan.

| Pesan / gejala | Penyebab sebenarnya | Perbaikan |
| --- | --- | --- |
| `could not find source [backend]` | perintah dijalankan dari `frontend/`; path `--source` relatif ke CWD | jalankan dari root repo |
| `Aborted by user` walau tidak ada interaksi | `--quiet` menjawab "N" pada prompt aktivasi API | `gcloud services enable <api>` lebih dulu |
| `failed to update builder last activity` / `no space left on device` | disk lokal penuh | `docker builder prune -af` |
| revisi **`failed to start and listen on PORT=8080`** | container crash sebelum listen | baca log: `gcloud run services logs read claimguard-api --region asia-southeast2 --limit 50` |
| Log: `SettingsError: error parsing value for field "cors_origins"` + `JSONDecodeError` | `cors_origins` bertipe `list[str]`; pydantic-settings mem-parsing env sebagai **JSON**, sedangkan nilai dikirim sebagai URL mentah | gunakan `deploy-api.sh` versi terbaru (mengubah daftar koma → JSON array), atau kirim `CORS_ORIGINS='["https://..."]'` |
| `Connection refused` di `/cloudsql/...` | SA runtime belum punya `roles/cloudsql.client` | §3 |
| Gemini 403 saat investigasi | SA runtime belum punya `roles/aiplatform.user` | §3 |
| `deploy-web.sh` mencetak `GAGAL: API URL tidak ditemukan di bundle` tetapi situs **berjalan normal** | skrip lama memindai `/settings`, yang sekarang 307 → `/login` dan tidak memuat chunk aplikasi | gunakan skrip terbaru (memindai `/login`); verifikasi manual ada di §5.7 |
| **Juri berhasil login tetapi terlempar kembali ke `/login`** | layout `(dashboard)` memakai hasil render/RSC lama (“belum login”) karena `router.replace()` berjalan sebelum `router.refresh()`; halaman juga belum `force-dynamic` | sudah diperbaiki di kode; lihat SRS §18 v2.5 |

### 5.6 Status prasyarat

`deploy-api.sh` akan memperingatkan bila `backend/app/main.py` belum ada. Tanpa file itu, container gagal start karena entrypoint menjalankan `app.main:app`. Urutan yang benar: API → web → **set CORS API ke origin web** → uji login.

### 5.7 Verifikasi setelah deploy (wajib)

Jangan menilai keberhasilan deploy dari pesan `Done.` saja. Jalankan pemeriksaan ini:

```bash
API=https://claimguard-api-5rzsoa7j3a-et.a.run.app
WEB=https://claimguard-web-5rzsoa7j3a-et.a.run.app

# 1. Kesehatan API
curl -s "$API/api/v1/health"
#    harap: {"status":"ok","db":"ok","ai_mode":"auto","storage":"gcs"}

# 2. CORS untuk origin web (harus memantulkan origin, bukan "*")
curl -s -o /dev/null -D - -X OPTIONS "$API/api/v1/investigations" \
  -H "Origin: $WEB" -H 'Access-Control-Request-Method: POST' \
  | grep -i access-control-allow-origin

# 3. Sesi: anonim ditolak, dengan cookie diterima
curl -s "$API/api/v1/auth/session"          # authenticated:false
TOKEN=$(curl -s -X POST "$API/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"password\":\"$(gcloud secrets versions access latest --secret=claimguard-demo-password --project="$PROJECT_ID")\"}" \
  | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s -H "Cookie: cg_session=$TOKEN" "$API/api/v1/auth/session"   # authenticated:true

# 4. Penjaga rute di server (ini yang paling penting)
curl -s -o /dev/null -w 'tanpa sesi : %{http_code}\n' "$WEB/dashboard"                          # 307
curl -s -o /dev/null -w 'dengan sesi: %{http_code}\n' -H "Cookie: cg_session=$TOKEN" "$WEB/dashboard"   # 200

# 5. Aksi tulis tanpa login harus 401
curl -s -o /dev/null -w 'scan tanpa login: %{http_code}\n' -X POST "$API/api/v1/monitoring/scan"   # 401
```

**Verifikasi bundle tanpa skrip** (bila ingin memastikan `NEXT_PUBLIC_API_BASE_URL` benar-benar ter-inline):

```bash
curl -s "$WEB/login" | grep -oE '/_next/static/[^"\\]+\.js' | sort -u \
  | while read -r c; do curl -s "$WEB$c" 2>/dev/null; done \
  | grep -c "claimguard-api"        # harus > 0
```

Pindai **`/login`**, bukan `/settings`: halaman dashboard mengembalikan 307 dan HTML-nya tidak memuat chunk aplikasi.

### 5.8 Kredensial demo

Satu akun untuk admin dan juri (FR-19):

| Untuk | Email (label) | Kata sandi |
| --- | --- | --- |
| Admin / juri | `admin@claimguard.demo` | secret `claimguard-demo-password` |

Email hanya label tampilan; backend memverifikasi kata sandi saja. Untuk demo, arahkan juri ke tombol **"Coba sebagai juri"** agar tidak perlu mengetik. Mengganti kata sandi:

```bash
printf 'kata-sandi-baru' | gcloud secrets versions add claimguard-demo-password --data-file=-
./infra/deploy-api.sh --image                       # API memakai secret terbaru
DEMO_PASSWORD=kata-sandi-baru ./infra/deploy-web.sh # tombol juri ikut berubah (perlu build ulang)
```

---

## 8. ~~Auto-deploy dari GitHub~~ (tidak dipakai)

Auto-deploy lewat GitHub Actions **sudah dihapus** (`.github/workflows/deploy.yml`). Ia
menuntut service account deployer terpisah, Workload Identity Federation, dan satu set role
tambahan — beban administrasi yang tidak sepadan untuk demo ini. Deploy kini **manual**:

```bash
./infra/deploy-api.sh     # API dulu (CORS_ORIGINS = URL web)
./infra/deploy-web.sh     # lalu web (API_URL = URL API)
```

Jalankan dari mesin PIC yang punya role di §1. Bagian 8.1–8.4 di bawah hanya dipertahankan
sebagai catatan bila auto-deploy ingin dihidupkan lagi.

### 8.1 Siapkan IAM (sekali, oleh PIC, hanya bila auto-deploy dihidupkan lagi)

```bash
# Butuh GitHub CLI + `gh auth login` (dipakai untuk membaca repository_id).
export PROJECT_ID=hackathon-primestep-18
./infra/setup-gcp.sh --github radithyaa/ClaimGuard

# Tanpa gh: ambil angka `id` dari https://api.github.com/repos/radithyaa/ClaimGuard
REPO_ID=<angka> ./infra/setup-gcp.sh --github radithyaa/ClaimGuard
```

Yang dibuat:

| Resource | Isi |
| --- | --- |
| Service account | `claimguard-github-deployer` |
| WIF pool/provider | `projects/<proj>/locations/global/workloadIdentityPools/github/providers/github` |
| Attribute condition | `assertion.repository_id == <id repo> && assertion.ref == 'refs/heads/main'` |
| Role deployer | `run.admin`, `cloudbuild.builds.editor`, `artifactregistry.admin`, `serviceusage.serviceUsageAdmin`, `cloudsql.client`, `storage.objectAdmin`, `secretmanager.secretAccessor`, `aiplatform.user`, `logging.viewer`, `viewer` |
| Role tambahan | `iam.serviceAccountUser` **pada** `claimguard-run` dan `claimguard-web` (wajib untuk `--service-account`), `iam.workloadIdentityUser` pada SA deploy |

Repositori lain (fork) tidak bisa memakai provider ini: `repository_id` ikut dicek, bukan
hanya nama `owner/repo`. Jangan menambahkan `roles/editor` atau `roles/owner`.

### 8.2 Variable di GitHub

Settings > Secrets and variables > Actions > **Variables** (bukan Secrets — tidak ada nilai rahasia):

| Variable | Nilai |
| --- | --- |
| `GCP_PROJECT_ID` | `hackathon-primestep-18` |
| `GCP_REGION` | `asia-southeast2` (opsional; default script) |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | dicetak `setup-gcp.sh --github` |
| `GCP_SERVICE_ACCOUNT` | `claimguard-github-deployer@<project>.iam.gserviceaccount.com` |
| `CORS_ORIGINS` | `["https://claimguard-web-xxx.a.run.app"]` untuk API (`deploy-api.sh`); kosongkan bila belum ada |

### 8.3 Urutan deploy pertama

`deploy-web.sh` membutuhkan `API_URL`, dan workflow mengambilnya dari service `claimguard-api`.
Jadi sekali sebelum mengandalkan CI:

```bash
./infra/setup-gcp.sh --create-infra          # bila belum
# buat claimguard-session-secret dan claimguard-database-url (§5.1)
./infra/deploy-api.sh
```

Setelah API punya URL, isi `CORS_ORIGINS` = URL web di variable GitHub. Untuk deploy pertama,
URL web bisa diambil dari log job `web` setelah selesai.

### 8.4 Batasan

| Hal | Artinya |
| --- | --- |
| Build 5–15 menit per job | Dua build paralel (API + web) memakai kuota Cloud Build bersamaan |
| Kode rusak tetap ter-deploy | Workflow ini deploy, bukan gate. Tambahkan test/lint sebagai job terpisah bila ingin memblokir |
| Server web bisa 500 di halaman yang memanggil API saat prerender | `NEXT_PUBLIC_API_BASE_URL` kosong saat `next build` -> `localhost:8000`; workflow selalu mengisinya lewat `API_URL` |

---

## 8. Verifikasi

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

## 9. Yang tetap jalan tanpa GCP

Dev lokal tidak butuh apa pun dari dokumen ini:

```bash
cd backend
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest -q
```

`STORAGE_BACKEND=local` + `DATABASE_URL=sqlite:///./claimguard.db` + cache rekam-putar (`AI_MODE=cache`) membuat seluruh alur agen berjalan tanpa billing. Ini jalur cadangan untuk skenario E (SRS §13).
