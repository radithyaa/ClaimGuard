# Status Backend vs SRS — verifikasi 21 Okt 2026

Pembaca: seluruh tim. Acuan: [SRS.md](SRS.md) v2.4. Hasil verifikasi kode, test, run, build,
dan kesiapan deploy. Semua angka di bawah berasal dari eksekusi nyata, bukan estimasi.

## Ringkasan

| Aspek | Hasil | Catatan |
| --- | --- | --- |
| Test | **49/49 lulus** (±9 s) | Tanpa Gemini; LLM diganti rekaman (ADK pipeline + API end-to-end) |
| Lint | `ruff check` bersih | `app data scripts tests` |
| Run lokal | **Bisa** | Boot, auto-seed 15 resi, `POST /monitoring/scan` menandai 4 anomali, 200 OK |
| SSE & cancel | **Bisa** | Replay `Last-Event-ID`, cancel saat run → 202, cancel saat selesai → 409 |
| Build Docker | **Bisa** | `python:3.12-slim` + ffmpeg, image ±1 menit |
| Run container | **Bisa** | `ENV=cloud` dengan secret diset → `/health` hijau; tanpa secret → gagal cepat (sesuai desain) |
| Deploy Cloud Run | **Belum diverifikasi** | Aset ada (`infra/deploy-api.sh`), butuh GCP + billing; secret `DEMO_PASSWORD`/`SESSION_SECRET` belum dipasang skrip |
| Kontrak API | **Lengkap** | **32 operasi / 27 path** sesuai SRS §6 (endpoint baru: impor CSV, `/connections`, ambang per kurir, hapus & purge investigasi) |
| Skema Postgres | **Valid** | 13 tabel; DDL `create_all` dikompilasi dengan dialect `psycopg` tanpa error |
| Auth demo (FR-19) | **Bisa** | `AUTH_REQUIRED=true`: endpoint tulis → 401 tanpa token; login mengembalikan token HMAC |
| Frontend | **Ada** | `frontend/` (Next.js App Router) sudah terisi: dashboard, resi, investigasi live, klaim, laporan, kebijakan kurir, demo, pengaturan. Lihat SRS §5 dan §19 untuk celah yang tersisa |

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
49 passed, 15 warnings in 8.78s

$ .venv/bin/ruff check app data scripts tests
All checks passed!

$ curl /api/v1/health            -> {"status":"ok","db":"ok","ai_mode":"auto","storage":"local"}
$ curl -X POST /api/v1/monitoring/scan -> scanned: 15, 4 anomali baru
$ curl /api/v1/openapi.json      -> 27 path, 32 operasi

# Dijalankan 21 Okt 2026 (sebelum sinkronisasi dokumen):
$ docker build -t claimguard-api:test .   -> sukses
$ docker run (ENV=cloud, secret diset) ... /health -> 200
$ AUTH_REQUIRED=true; POST /investigations (tanpa login) -> 401; GET /shipments -> 200
$ ENV=cloud + DATABASE_URL postgresql+psycopg://... -> engine postgresql/psycopg, DDL compiles
```

## Rekomendasi urutan kerja

> **Diperbarui 22 Okt 2026.** Daftar risiko dan celah yang berlaku sekarang ada di
> [SRS.md §19](SRS.md#19-celah-yang-diketahui-known-gaps). Ringkasnya:
>
> 1. Rekam `data/samples/*.mp4` lalu ketiga skenario di `AI_MODE=live` → commit `data/cache/`.
> 2. Verifikasi deploy Cloud Run (`infra/deploy-api.sh`) beserta `DEMO_PASSWORD`/`SESSION_SECRET`.
> 3. Tambahkan rate limit pada endpoint pemicu AI (NFR-06, Should).
> 4. Lengkapi halaman `/settings/account` yang tertaut tetapi belum ada.
>
> Langkah "mulai frontend" sudah selesai: `frontend/` terisi. Catatan bahwa folder itu ada di
> `.gitignore` sudah **tidak berlaku** — frontend ikut di-commit.
