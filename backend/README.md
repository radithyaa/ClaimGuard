# ClaimGuard — Backend

API untuk ClaimGuard: pemantauan resi, investigasi oleh agen AI, dan alur persetujuan klaim.
Dibangun dengan FastAPI, Google Agent Development Kit (ADK), Gemini di Vertex AI, dan FFmpeg.

Gambaran produk dan arsitektur ada di [README utama](../README.md). Kontrak API ada di
[`openapi.json`](openapi.json), dan versi interaktifnya di `/api/v1/docs` saat server berjalan.

## Menjalankan

Kebutuhan: Python 3.12+. FFmpeg ikut terpasang lewat paket `imageio-ffmpeg`.

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -e ".[dev]"            # Windows: .venv\Scripts\pip
cp .env.example .env
.venv/bin/python data/seed.py --synthetic    # isi data demo
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

| Alamat | Isi |
| --- | --- |
| http://localhost:8000/api/v1/health | status server, database, mode AI, penyimpanan |
| http://localhost:8000/api/v1/docs | dokumentasi API interaktif |

Opsi `--synthetic` membuat video uji sederhana bila video asli belum ada di `data/samples/`.

## Fitur AI

Tanpa `GCP_PROJECT` di `.env`, semua fitur selain analisis AI tetap berjalan. Investigasi akan
berhenti dengan pesan `ai_not_configured`, kecuali hasil analisis kasus itu sudah tersimpan di
`data/cache/`.

Untuk menyalakan Gemini:

1. Isi `GCP_PROJECT` di `.env`.
2. Jalankan `gcloud auth application-default login`. Tidak ada API key yang dipakai.
3. Taruh video sampel di `data/samples/`. Panduannya ada di [`../docs/media-setup.md`](../docs/media-setup.md).

Mode AI diatur lewat `AI_MODE` atau menu Pengaturan:

| Mode | Perilaku |
| --- | --- |
| `live` | selalu memanggil Gemini; gagal berarti investigasi berakhir dengan error |
| `auto` | memanggil Gemini; bila gagal, memakai rekaman cache dan menandainya `cache` |
| `cache` | hanya memakai rekaman; tanpa biaya kuota |

## Alur lewat API

| Langkah | Endpoint | Hasil |
| --- | --- | --- |
| 1 | `POST /api/v1/demo/reset` | data demo kembali ke awal |
| 2 | `POST /api/v1/monitoring/scan` | resi bermasalah ditandai sebagai anomali |
| 3 | `POST /api/v1/demo/scenario/lost` | investigasi dimulai, mengembalikan `investigation_id` |
| 4 | `GET /api/v1/investigations/{id}/stream` | progres agen secara langsung (Server-Sent Events) |
| 5 | `POST /api/v1/claims/{id}/approve` | klaim berstatus `submitted` (simulasi); persetujuan kedua menghasilkan 409 |

Skenario yang tersedia: `lost`, `damaged`, `needs_evidence`, `wrong_item_seller`. Penjelasan
tiap skenario ada di [`../docs/data-demo.md`](../docs/data-demo.md).

Bila `AUTH_REQUIRED=true`, aksi yang mengubah data butuh login:
`POST /api/v1/auth/login` dengan `{"password": "..."}`, lalu kirim token sebagai header
`Authorization: Bearer <token>` atau cookie `cg_session`.

## Pengujian

```bash
.venv/bin/python -m pytest -q                       # test unit, API, dan integrasi
.venv/bin/ruff check app data scripts tests         # lint
.venv/bin/python scripts/export_openapi.py          # perbarui openapi.json setelah mengubah endpoint
```

Test tidak memanggil Gemini. Jawaban model diganti rekaman sehingga hasilnya selalu sama.

## Struktur

| Folder | Isi |
| --- | --- |
| `app/agents/` | pipeline agen (Investigator → Evaluator → Drafter), prompt, alat, dan penjaga keputusan |
| `app/api/v1/` | endpoint REST dan SSE |
| `app/services/` | monitoring, investigasi, klaim, audit, penyimpanan, video, cache AI |
| `app/models/`, `app/schemas/` | model database dan skema data |
| `data/mock/` | resi simulasi dan dokumen aturan klaim kurir |
| `data/samples/` | video sampel (tidak disimpan di repositori) |
| `tests/` | test unit, API, dan integrasi |

## Deploy

Backend di-deploy ke Cloud Run dengan [`../infra/deploy-api.sh`](../infra/deploy-api.sh).
Langkah lengkap ada di [`../infra/setup-gcp.md`](../infra/setup-gcp.md).

Cloud Run wajib memakai `--min-instances 1 --max-instances 1 --no-cpu-throttling`.
Investigasi berjalan di latar belakang dan progresnya disiarkan dari memori proses, sehingga
lebih dari satu instance atau CPU yang dibatasi akan memutus investigasi.

## Batasan

- Belum ada pembatasan laju permintaan (rate limit) untuk endpoint yang memicu AI.
- Endpoint baca (GET) tidak butuh login. Datanya simulasi, jadi ini disengaja agar demo mudah.
