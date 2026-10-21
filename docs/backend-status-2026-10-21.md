# Status Backend vs SRS — verifikasi 21 Okt 2026

Pembaca: seluruh tim. Acuan: [SRS.md](SRS.md) v2.3. Hasil verifikasi kode, test, run, build,
dan kesiapan deploy. Semua angka di bawah berasal dari eksekusi nyata, bukan estimasi.

## Ringkasan

| Aspek | Hasil | Catatan |
| --- | --- | --- |
| Test | **42/42 lulus** (8.4 s) | Tanpa Gemini; LLM diganti rekaman (ADK pipeline + API end-to-end) |
| Lint | `ruff check` bersih | `app data scripts tests` |
| Run lokal | **Bisa** | Boot, auto-seed 15 resi, `POST /monitoring/scan` menandai 4 anomali, 200 OK |
| SSE & cancel | **Bisa** | Replay `Last-Event-ID`, cancel saat run → 202, cancel saat selesai → 409 |
| Build Docker | **Bisa** | `python:3.12-slim` + ffmpeg, image ±1 menit |
| Run container | **Bisa** | `ENV=cloud` dengan secret diset → `/health` hijau; tanpa secret → gagal cepat (sesuai desain) |
| Deploy Cloud Run | **Belum diverifikasi** | Aset ada (`infra/deploy-api.sh`), butuh GCP + billing; secret `DEMO_PASSWORD`/`SESSION_SECRET` belum dipasang skrip |
| Kontrak API | **Lengkap** | 23 endpoint SRS hadir di `openapi.json` (25 operasi) |
| Skema Postgres | **Valid** | 12 tabel; DDL `create_all` dikompilasi dengan dialect `psycopg` tanpa error |
| Auth demo (FR-19) | **Bisa** | `AUTH_REQUIRED=true`: endpoint tulis → 401 tanpa token; login mengembalikan token HMAC |
| Frontend | **Tidak ada** | Folder `frontend/` belum dibuat |

## Kesesuaian dengan SRS

### Sudah sesuai

- **Kontrak API (§6)**: seluruh endpoint SRS tersedia, termasuk yang "mudah terlewat":
  `GET /anomalies`, `GET /couriers/policies`, `GET /audit-logs`.
- **HITL struktural (§3.4)**: `submit_claim` hanya dipanggil `approve`; transisi klaim memakai
  `UPDATE ... WHERE status='pending_approval'`, klik ganda → 409.
- **Hentikan agen (§3.5)**: `task.cancel()` + `abort_signal`, subprocess FFmpeg ikut dimatikan,
  audit log tertulis.
- **Monitoring deterministik (§3.2, FR-02/09)**: idempoten, tidak bergantung LLM.
- **Penjaga confidence (§3.3, FR-12)**: ambang ditegakkan kode (`enforce_min_confidence`),
  bukan prompt.
- **Tool tidak menerima path (§7.1, NFR-05)**: hanya ID; `_safe_key` menolak path traversal.
- **Error seragam (§6)**: `{"error": {"code", "message"}}` untuk 400/404/409/422/500.
- **NFR-13**: satu instance dinyatakan di Dockerfile, skrip deploy, dan README.

### Temuan yang perlu ditindaklanjuti (urut risiko)

1. **`data/cache/` kosong — risiko demо tertinggi.** Fallback `auto` dan mode `cache` adalah
   strategi keandalan utama (§13). Tanpa rekaman, investigasi gagal dengan
   `ai_not_configured` (sudah diverifikasi). Harus direkam dengan `AI_MODE=live` + Gemini
   aktif, lalu di-commit.
2. **Sample video tidak ada di repo** (`data/samples/`). Seed berjalan, tetapi
   investigasi akan gagal di `clip_cctv_video` (`media tidak ditemukan`) sampai rekaman
   asli diunggah ke `data/samples/` atau `gs://BUCKET/samples/`.
3. **Kebijakan kurir jatuh ke fallback "manual"** tanpa Gemini. Terverifikasi di log:
   `ekstraksi live jne gagal: GCP_PROJECT belum diisi`. Data tetap tersedia (fallback JSON),
   tetapi provenance-nya `manual`, bukan `live`/`cache` (FR-05/FR-21).
4. **Endpoint tulis terlindungi login, baca tidak** (sesuai keputusan desain di README).
   Diverifikasi dengan `AUTH_REQUIRED=true`: `POST /investigations`, `/demo/scenario/*`,
   `/monitoring/scan`, `/demo/reset` → **401**; `GET /shipments` → 200. Ini sesuai NFR-06 bagian
   "endpoint pemicu AI membutuhkan login". Yang belum ada: **rate limiting** (Should).
5. **`infra/deploy-api.sh` hanya memasang satu secret** (`DATABASE_URL=claimguard-database-url`),
   padahal `ENV=cloud` mewajibkan `DEMO_PASSWORD` dan `SESSION_SECRET` non-default. Bila
   keduanya tidak diset, container **gagal start** (`ValueError` dari `config.py` — sudah
   diverifikasi). Pastikan tambahkan dua secret itu, mis. `DEMO_PASSWORD=claimguard-demo-password:latest`
   dan `SESSION_SECRET=...:latest` (secret `claimguard-demo-password` sudah dibuat oleh `setup-gcp.sh`).
6. **Mode cloud memaksa `STORAGE_BACKEND=gcs`** (Dockerfile). Bila `GCS_BUCKET` kosong, tool video
   mengembalikan error `GCS_BUCKET wajib diisi`, sehingga investigasi gagal di tahap klip.
   Bucket harus ada sebelum deploy.
7. **Risiko arkeologi SQLite**: `session_scope` dipakai dari thread `asyncio.to_thread`
   (ADK tool sinkron). Diuji dengan 40 pemanggilan paralel → tanpa `database is locked`
   (WAL aktif). Batas ini tidak berlaku di Postgres.

## Bukti yang dijalankan

```text
$ .venv/bin/python -m pytest -q
42 passed, 12 warnings in 8.36s

$ .venv/bin/ruff check app data scripts tests
All checks passed!

$ curl /api/v1/health            -> {"status":"ok","db":"ok","ai_mode":"auto","storage":"local"}
$ curl -X POST /api/v1/monitoring/scan -> scanned: 15, 4 anomali baru
$ curl /api/v1/openapi.json      -> 21 path, 25 operasi
$ docker build -t claimguard-api:test .   -> sukses
$ docker run (ENV=cloud, secret diset) ... /health -> 200
$ AUTH_REQUIRED=true; POST /investigations (tanpa login) -> 401; GET /shipments -> 200
$ ENV=cloud + DATABASE_URL postgresql+psycopg://... -> engine postgresql/psycopg, DDL compiles
```

## Rekomendasi urutan kerja

1. Aktifkan billing → isi `GCP_PROJECT`, `GEMINI_MODEL` → jalankan ketiga skenario dalam `AI_MODE=live`
   → commit `data/cache/`.
2. Rekam/unggah `data/samples/*.mp4` dan verifikasi scan packing jatuh di detik 40/95/150.
3. Tambahkan `DEMO_PASSWORD` dan `SESSION_SECRET` ke `--set-secrets` di `infra/deploy-api.sh`, lalu
   `./infra/deploy-api.sh --dry-run`.
4. Siapkan bucket GCS (`GCS_BUCKET`) dan unggah `data/samples/*` sebelum deploy.
5. Tambahkan rate limit sederhana pada endpoint pemicu AI (NFR-06, Should).
6. Mulai frontend (tidak ada di repo ini; folder `frontend/` juga ada di `.gitignore`).
