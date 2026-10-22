# Setup Google Cloud untuk ClaimGuard

Panduan ini untuk siapa pun yang ingin menjalankan ClaimGuard di Google Cloud sendiri: membuat
project, izin, database, bucket, secret, lalu men-deploy backend dan frontend ke Cloud Run.
Untuk sekadar mencoba aplikasi, cukup buka [Panduan Pengujian](../docs/PANDUAN-PENGUJIAN.md).

Layanan yang dipakai dan bagian kode yang membutuhkannya:

| Layanan | Dipakai oleh |
| --- | --- |
| Vertex AI (Gemini, tanpa API key) | `backend/app/services/gemini_client.py` dan agen ADK |
| Cloud Storage + signed URL | `backend/app/services/storage_service.py` (video dan klip bukti) |
| Cloud SQL PostgreSQL | `backend/app/db/session.py` (`DATABASE_URL`) |
| Secret Manager | kata sandi demo, kunci sesi, URL database |
| Cloud Run | dua service: `claimguard-api` (satu instance) dan `claimguard-web` |

---

## 0. Prasyarat

```bash
gcloud auth login
gcloud auth application-default login     # dipakai SDK Gemini saat dev lokal
gcloud config set project hackathon-primestep-18
```

`.env`, `*.db`, `backend/storage/` sudah di `.gitignore`. **Jangan pernah** menaruh service account key JSON di repo, deck, atau rekaman.

---

## 1. Izin untuk anggota tim yang men-deploy

Jalankan dari akun pemilik project (Owner):

```bash
export PROJECT_ID=hackathon-primestep-18
./infra/setup-gcp.sh --deployer user:<email-developer>
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

## 2. Membuat infrastruktur (sekali)

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
| `MIN_CONFIDENCE` | `0.6` | ambang keyakinan minimum keputusan agen |
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
| `--min-instances 1 --max-instances 1` | task registry, event bus SSE, dan scheduler ada di memori proses |
| `--no-cpu-throttling` | investigasi berjalan sebagai `asyncio.Task` setelah respons terkirim |
| `--timeout 3600` | SSE dan investigasi panjang |
| `--add-cloudsql-instances` | menyediakan socket `/cloudsql/<conn>` yang dipakai `DATABASE_URL` |
| `--memory 2Gi` | FFmpeg encode ulang + Gemini multimodal |
| `--allow-unauthenticated` | demo publik; aksi tulis di API tetap butuh login demo |

`--source` memakai Cloud Build, jadi tidak butuh Docker lokal. Waktu build ±5–8 menit.

### 5.3 Deploy frontend (claimguard-web)

```bash
export API_URL=https://claimguard-api-5rzsoa7j3a-et.a.run.app
export DEMO_PASSWORD="$(gcloud secrets versions access latest --secret=claimguard-demo-password --project="$PROJECT_ID")"

./infra/deploy-web.sh --dry-run
./infra/deploy-web.sh
```

`DEMO_PASSWORD` dipakai tombol **Masuk sebagai juri** di halaman login. Bila kosong, tombol tetap tampil tetapi memakai kata sandi bawaan lokal (`claimguard-demo`), yang ditolak backend cloud. Jadi variabel ini wajib diisi saat deploy ke cloud.

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
| **Juri berhasil login tetapi terlempar kembali ke `/login`** | layout `(dashboard)` memakai hasil render/RSC lama (“belum login”) karena `router.replace()` berjalan sebelum `router.refresh()`; halaman juga belum `force-dynamic` | sudah diperbaiki di kode |

### 5.6 Urutan deploy

API → web → pastikan `CORS_ORIGINS` API berisi alamat web → uji login.

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

Satu akun untuk admin dan juri:

| Email | Kata sandi |
| --- | --- |
| `admin@claimguard.demo` | `juri2026` (isi secret `claimguard-demo-password` saat ini) |

Email hanya label tampilan; backend memverifikasi kata sandi saja. Juri cukup menekan tombol
**Masuk sebagai juri**, yang mengisi kedua kolom lalu langsung masuk.

Mengganti kata sandi:

```bash
printf 'kata-sandi-baru' | gcloud secrets versions add claimguard-demo-password --data-file=-

# API memakai versi secret terbaru (revisi baru, image dan env lain tidak berubah)
gcloud run services update claimguard-api --region asia-southeast2 \
  --update-secrets DEMO_PASSWORD=claimguard-demo-password:latest

# Tombol juri ikut berubah (butuh build ulang frontend)
DEMO_PASSWORD=kata-sandi-baru ./infra/deploy-web.sh
```

Kata sandi ini ikut terbaca di kode browser, jadi hanya untuk akun demo dengan data simulasi.

---

## 6. Verifikasi infrastruktur

```bash
./infra/setup-gcp.sh --verify
gcloud run services list --region asia-southeast2
gcloud run services proxy claimguard-api --region asia-southeast2   # lalu buka /health
```

Uji Vertex tanpa deploy (memakai ADC lokal):

```bash
cd backend
python -c "from google import genai; c=genai.Client(vertexai=True, project='hackathon-primestep-18', location='global'); print(c.models.generate_content(model='gemini-2.5-flash', contents='ping').text)"
```

Kalau perintah di atas 403, role `aiplatform.user` atau billing belum aktif.

---

## 7. Menjalankan tanpa Google Cloud

Menjalankan di komputer sendiri tidak membutuhkan apa pun dari dokumen ini:

```bash
cd backend
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest -q
```

`STORAGE_BACKEND=local` + `DATABASE_URL=sqlite:///./claimguard.db` + cache rekam-putar (`AI_MODE=cache`) membuat seluruh alur agen berjalan tanpa billing. Ini juga jalur cadangan bila Gemini tidak tersedia.
