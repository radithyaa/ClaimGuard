# ClaimGuard Backend

FastAPI + Google ADK + FFmpeg. Kontrak API: `openapi.json` (juga di `/api/v1/docs` saat server jalan). Arsitektur: [../docs/SRS.md](../docs/SRS.md).

## Jalan lokal (Windows, kurang dari 5 menit)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
.venv\Scripts\python data/seed.py --synthetic     # 15 resi demo + video uji bila data/samples kosong
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

- Health: http://localhost:8000/api/v1/health
- Docs: http://localhost:8000/api/v1/docs
- Test: `.venv\Scripts\python -m pytest -q` (tanpa Gemini; LLM diganti skrip)
- Lint: `.venv\Scripts\ruff check app data scripts tests`
- Perbarui kontrak setelah mengubah endpoint: `.venv\Scripts\python scripts/export_openapi.py`

Tanpa `GCP_PROJECT`, semua fitur non-AI berjalan normal. Investigasi akan gagal dengan pesan `ai_not_configured`, kecuali rekaman cache kasus itu sudah ada di `data/cache/`.

## Video sampel

Taruh rekaman asli di `data/samples/` dengan nama sesuai `data/mock/shipments.json` (`cctv_packing_01.mp4`, `unboxing_vas.mp4`, `unboxing_earphone.mp4`). Folder ini tidak di-commit.

- **Jam overlay CCTV harus sama dengan `recorded_start` + detik video.** Scan packing skenario jatuh di detik 40, 95, dan 150 rekaman. Bila rekaman berbeda, ubah `recorded_start`/`scanned_at` di JSON, bukan videonya.
- Cloud: unggah sekali dengan `gcloud storage cp data/samples/* gs://BUCKET/samples/`.

## Alur demo (API)

1. `POST /demo/reset`: data kembali ke awal (kebijakan kurir dan settings dipertahankan).
2. `POST /monitoring/scan`: menandai 4 anomali (2 tertahan, 1 rusak, 1 retur mencurigakan).
3. `POST /demo/scenario/lost`: memulai investigasi, lalu `GET /investigations/{id}/stream` (SSE).
4. `POST /claims/{id}/approve`: status menjadi `submitted` (simulasi). Klik kedua menghasilkan 409.

Rekam cache AI: jalankan tiap skenario sekali dengan `AI_MODE=live`, lalu commit `data/cache/`. Saat demo pakai `auto`. Nomor resi skenario jangan diubah.

## Deploy Cloud Run (Dev B)

Prasyarat: resource dari [../infra/setup-gcp.md](../infra/setup-gcp.md): Cloud SQL, bucket, service account `claimguard-api`, dan tiga secret di Secret Manager:
- `database-url`: `postgresql+psycopg://claimguard:PASSWORD@/claimguard?host=/cloudsql/PROJECT:asia-southeast2:claimguard-db`
- `demo-password`
- `session-secret`: string acak panjang

```powershell
Copy-Item env.cloud.yaml.example env.cloud.yaml   # isi nilainya; file ini tidak di-commit
gcloud run deploy claimguard-api --source . --region asia-southeast2 `
  --service-account claimguard-api@PROJECT.iam.gserviceaccount.com `
  --min-instances 1 --max-instances 1 --no-cpu-throttling --timeout 3600 --memory 2Gi `
  --add-cloudsql-instances PROJECT:asia-southeast2:claimguard-db `
  --env-vars-file env.cloud.yaml `
  --set-secrets "DATABASE_URL=database-url:latest,DEMO_PASSWORD=demo-password:latest,SESSION_SECRET=session-secret:latest" `
  --allow-unauthenticated
```

Wajib: `--min-instances 1 --max-instances 1 --no-cpu-throttling`. Investigasi berjalan sebagai background task dan SSE ada di memori proses (SRS 3.6, NFR-13).

## Belum dikerjakan (Should/Could)

- Rate limiting endpoint pemicu AI (NFR-06, Should). Saat ini endpoint tulis sudah dilindungi login bila `AUTH_REQUIRED=true`.
- Endpoint baca (GET) tidak dilindungi login. Datanya simulasi, jadi ini disengaja untuk kemudahan demo.
