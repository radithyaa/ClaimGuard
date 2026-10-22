# ClaimGuard

**Agentic AI untuk klaim logistik UMKM.** Menemukan paket bermasalah, mengumpulkan bukti sendiri (potong CCTV gudang, analisis video dengan Gemini), memutuskan tindak lanjut, lalu menyiapkan draf klaim untuk kurir — dan **selalu menunggu persetujuan manusia sebelum mengirim apa pun**.

> Agentic AI Hackathon 2026 — ITB Hackathon Series · 21–23 Oktober 2026 Dibangun dengan **Google ADK** + **Gemini (Vertex AI)** di **Google Cloud Run / Cloud SQL / Cloud Storage**.

---

## Daftar Isi

 1. [Masalah dan Pengguna](#1-masalah-dan-pengguna)
 2. [Cara Kerja (Arsitektur Agent)](#2-cara-kerja-arsitektur-agent)
 3. [Coba Cepat](#3-coba-cepat)
 4. [Instalasi](#4-instalasi)
 5. [Konfigurasi](#5-konfigurasi)
 6. [Menjalankan dan Men-deploy](#6-menjalankan-dan-men-deploy)
 7. [Skenario Demo dan Bukti Pengujian](#7-skenario-demo-dan-bukti-pengujian)
 8. [Batasan dan Kondisi Gagal](#8-batasan-dan-kondisi-gagal)
 9. [Struktur Repositori](#9-struktur-repositori)
10. [Catatan Sumber, Lisensi, dan Penggunaan AI](#10-catatan-sumber-lisensi-dan-penggunaan-ai)
11. [Pembagian Kontribusi Tim](#11-pembagian-kontribusi-tim)
12. [Mentor: Cara Menilai Tautan Ini](#12-mentor-cara-menilai-tautan-ini)

---

## 1. Masalah dan Pengguna

**Pengguna sasaran:** penjual online dan UMKM (admin gudang/pemilik toko) yang mengirim ratusan paket per hari lewat 3PL (JNE, J&T, SiCepat).

**Masalah nyata.** Saat paket hilang, rusak, atau diretur dengan tuduhan kosong:

- Penjual baru menyadarinya **setelah** pembeli komplain — lewat tenggat klaim kurir.
- Bukti tercecer: CCTV gudang 24 jam, video unboxing dari pembeli, catatan resi, kebijakan tiap kurir yang berbeda-beda dan berbahasa hukum.
- Menyusun klaim berarti menonton video manual, memotong klip, dan menulis kronologi — pekerjaan 20–40 menit per kasus untuk ganti rugi puluhan hingga ratusan ribu rupiah. Akibatnya banyak klaim yang sebenarnya sah tidak pernah diajukan.

**Yang dilakukan ClaimGuard.** Tiga hal, dalam bahasa yang sama dengan cara kerja admin:

| Fitur | Akibat bagi pengguna |
| --- | --- |
| Monitoring aturan deterministik | Paket yang melewati SLA, dilaporkan rusak, atau diretur mencurigakan langsung ditandai — tanpa biaya LLM |
| Investigation Agent (ADK) | Memotong klip CCTV di detik barcode discan, menganalisis klip/unboxing, membaca kebijakan kurir, lalu memutuskan `claim` / `needs_evidence` / `fraud_suspect` **beserta alasannya** |
| Action Agent + Approval Dashboard | Draf klaim siap review; admin mengedit, menyetujui, atau menolak. Pengiriman hanya terjadi lewat tombol manusia |

**Di luar lingkup (jujur sejak awal):** tidak ada pengiriman klaim sungguhan ke API kurir (disimulasikan), tidak ada integrasi CCTV RTSP (memakai berkas video sampel), tidak ada multi-tenant/billing, dan backend berjalan satu instance (lihat [§8](#8-batasan-dan-kondisi-gagal)).

---

## 2. Cara Kerja (Arsitektur Agent)

```
                    Google Cloud
┌──────────────────────────────────────────────────────────────────────┐
│  Cloud Run claimguard-web   (Next.js, App Router)                    │
│        │ REST + SSE                                                  │
│  Cloud Run claimguard-api   (FastAPI · 1 instance · no CPU throttle) │
│   ├─ Monitoring service ─── aturan SLA deterministik ──► anomalies   │
│   ├─ Investigation runner ─ ADK Runner (satu run per resi)           │
│   │     SequentialAgent: Investigator → Evaluator → Drafter          │
│   │     tools: get_case_context · clip_cctv_video (FFmpeg)           │
│   │            analyze_media (Gemini multimodal) · get_courier_policy│
│   ├─ Claim service ──────── approve / reject / submit (simulasi)     │
│   └─ Event bus ──────────── investigation_events ──► SSE ke browser  │
│        │                    │                     │                  │
│  Cloud SQL Postgres     Cloud Storage        Vertex AI Gemini        │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Pemilihan agent (dan mengapa tiga, bukan satu)

`build_root_agent()` di `backend/app/agents/agent.py` membuat `SequentialAgent`(`investigation_pipeline`) dengan tiga `LlmAgent`:

| \# | Agent | Tugas | Output (`output_key`) |
| --- | --- | --- | --- |
| 1 | **Investigator** | Memilih dan memanggil tools sesuai `case_type`: ambil konteks kasus, potong CCTV, analisis klip/unboxing, ambil kebijakan kurir | `investigation_notes` |
| 2 | **Evaluator** | Menilai kekuatan bukti dan mengambil keputusan terstruktur: `claim`, `needs_evidence`, atau `fraud_suspect` + alasan | `evaluation` |
| 3 | **Drafter** | Menyusun narasi klaim dari fakta di state. **Dilewati** bila keputusan bukan `claim` | `claim_draft` |

Pemisahan ini bukan gaya-gayaan: di ADK, agent dengan `output_schema` tidak dapat memanggil tool. Karena itu pengumpulan bukti dan keputusan terstruktur dipisah. Suhu model juga dibedakan (Investigator 0.2, Evaluator 0.0, Drafter 0.3).

**Bagian yang benar-benar agentic** (yang ditunjukkan di demo). Agent menentukan sendiri tool mana yang dipanggil dan urutannya; keputusan akhir bukan `if` di kode, melainkan hasil penalaran Evaluator — yang ditampilkan ke admin beserta alasannya.

**Penjaga deterministik di atas LLM.** `confidence` di bawah ambang (`min_confidence`) memaksa keputusan menjadi `needs_evidence` lewat callback `enforce_min_confidence`, apa pun jawaban model. Draf yang tidak konsisten (`tracking_number` salah, narasi kosong) diturunkan menjadi `needs_evidence` oleh `persist_outcome`.

### 2.2 Tools dan data

| Tool | Menerima | Tidak pernah menerima |
| --- | --- | --- |
| `get_case_context` | `shipment_id` | path berkas |
| `clip_cctv_video` | `shipment_id`, `pre_sec`, `post_sec` (5–30 dtk) | path berkas — video sumber dicari dari DB |
| `analyze_media` | `evidence_id`, `focus` | path/URI dari LLM |
| `get_courier_policy` | `courier` | teks bebas |

Tools hanya menerima **ID**, sehingga prompt injection lewat teks pembeli tidak dapat menunjuk berkas sembarang. Setiap pemanggilan dicatat ke `investigation_events` dan `audit_logs`.

### 2.3 Human-in-the-Loop yang dijamin secara struktural

Aturan kunci: **agent tidak punya kemampuan mengirim klaim.** Bukan karena dilarang di prompt, tapi karena `submit_claim` **tidak terdaftar sebagai tool ADK** di agent mana pun — fungsinya hanya ada di `services/claim_service.py` dan hanya dipanggil endpoint `POST /claims/{id}/approve`:

1. Run agent selesai dengan draf berstatus `pending_approval`. Tidak ada run yang menunggu.
2. Approve memakai update atomik `UPDATE claims SET status='submitted' WHERE id=:id AND status='pending_approval'`. Klik ganda ⇒ 0 baris berubah ⇒ HTTP **409**, tanpa duplikat.
3. Setiap approve/reject/edit tercatat di `audit_logs`.

Fitur *tool confirmation* ADK sengaja tidak dipakai: statusnya eksperimental dan tidak mendukung session service persisten, sehingga persetujuan tertunda akan hilang saat container restart. Dengan desain di atas, restart tidak menghilangkan klaim yang menunggu.

### 2.4 Transparansi ke UI (SSE)

`investigation_runner` memetakan event ADK ke SSE: `status`, `tool_start`, `tool_end`, `thought`, `decision`, `done`, `error`, `cancelled`. Event juga disimpan ke tabel `investigation_events` dengan nomor urut, sehingga `Last-Event-ID` memungkinkan replay setelah refresh. Tombol **Hentikan Agen** (`POST /investigations/{id}/cancel`) membatalkan `asyncio.Task` dan menghentikan subprocess FFmpeg yang berjalan.

### 2.5 Keandalan demo

- **Mode AI** (`settings.ai_mode`): `live` (selalu Gemini) · `auto` (Gemini → fallback cache, default demo) · `cache` (hanya rekaman).
- **Label sumber** (FR-21): setiap hasil analisis bertanda `live` atau `cache`; klaim bertanda `is_simulated`. Hasil cache **tidak pernah** ditampilkan sebagai eksekusi langsung.
- `min-instances=1` menghapus cold start; `SLA_GRACE_HOURS` dan pengecualian per kurir menghindari penandaan yang salah waktu.

Spesifikasi lengkap: `docs/SRS.md` (v2.3, dokumen acuan implementasi).

---

## 3. Coba Cepat

Butuh: Python 3.12+ dan FFmpeg. **Tanpa akun Google Cloud pun aplikasi berjalan** (semua fitur non-AI normal; investigasi butuh Gemini atau rekaman cache — lihat §8).

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -e ".[dev]"          # Windows: .venv\Scripts\pip
.venv/bin/python data/seed.py --synthetic  # 15 resi demo + video uji bila data/samples kosong
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

Lalu:

```bash
curl http://localhost:8000/api/v1/health
# {"status":"ok","db":"ok","ai_mode":"auto","storage":"local"}

curl -X POST http://localhost:8000/api/v1/monitoring/scan
# memindai 15 resi, menandai 4 anomali
```

Dokumentasi API interaktif: <http://localhost:8000/api/v1/docs>.

> **Mau langsung melihat agent bekerja?** `data/samples/` tidak disertakan di repo. Tanamkan klip CCTV sampel sesuai nama di `data/mock/shipments.json`, lalu isi `GCP_PROJECT` pada `backend/.env` — lihat `docs/data-dummy-dan-video.md`.

---

## 4. Instalasi

### 4.1 Prasyarat

| Kebutuhan | Versi | Catatan |
| --- | --- | --- |
| Python | ≥ 3.12 | `backend/pyproject.toml` |
| FFmpeg | build apa pun dengan `libx264` | dipakai memotong klip; di Docker diambil dari apt, lokal bisa lewat `imageio-ffmpeg` (ikut `[dev]`) |
| Node.js | ≥ 20 | hanya untuk frontend |
| Akun GCP + project dengan Vertex AI | opsional | wajib untuk mode `live`; autentikasi lewat service account/ADC, **tanpa API key** |

### 4.2 Backend dari sumber

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env        # lihat §5
```

### 4.3 Frontend

```bash
cd frontend
npm ci
echo 'NEXT_PUBLIC_API_BASE_URL=http://localhost:8000' > .env.local
npm run dev                 # http://localhost:3000
```

### 4.4 Test dan lint

```bash
cd backend
.venv/bin/python -m pytest -q          # butuh ffmpeg; tanpa Gemini (LLM diganti rekaman)
.venv/bin/ruff check app data scripts tests
```

### 4.5 Format CSV impor resi

Didukung `POST /api/v1/shipments/import` (maks. 2 MB / 5.000 baris). Template: `GET /api/v1/shipments/import/template`.

| Kolom wajib | Nilai |
| --- | --- |
| `tracking_number` | unik; resi yang sudah ada **diperbarui**, tidak diduplikasi |
| `courier` | `jne` `jnt` `spc` `sicepat` `anteraja` `spx` |
| `shipped_at`, `sla_deadline` | ISO-8601; tanpa zona dianggap UTC |
| `status` | `created` `picked_up` `in_transit` `out_for_delivery` `delivered` `returned` |
| `origin`, `destination`, `item_name`, `item_value` | opsional |

Baris rusak dilewati dan dilaporkan per nomor baris; tidak menggagalkan seluruh unggahan.

---

## 5. Konfigurasi

Semua nilai berasal dari environment atau `backend/.env` (`pydantic-settings`). Contoh lengkap **tanpa rahasia**: `backend/.env.example`.

### 5.1 Variabel environment

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `ENV` | `local` | `cloud` mewajibkan `SESSION_SECRET` dan `DEMO_PASSWORD` non-default (gagal cepat bila tidak) |
| `DATABASE_URL` | `sqlite:///./claimguard.db` | Cloud: `postgresql+psycopg://...?host=/cloudsql/...` |
| `STORAGE_BACKEND` | `local` | `local` (folder `./storage`, disajikan di `/media`) atau `gcs` |
| `GCS_BUCKET` | — | wajib bila `STORAGE_BACKEND=gcs` |
| `CORS_ORIGINS` | `["http://localhost:3000"]` | isi dengan URL Cloud Run web |
| `AUTH_REQUIRED` | `false` | bila `true`, endpoint tulis butuh login (`POST /auth/login`) |
| `GCP_PROJECT` | — | kosong ⇒ fitur AI mati, pesan `ai_not_configured` |
| `GCP_LOCATION` | `global` | region Vertex AI |
| `GEMINI_MODEL` | `gemini-2.5-flash` | `gemini-flash-latest` tidak punya alias di Vertex |
| `AI_MODE` | `auto` | `live` |
| `MIN_CONFIDENCE` | `0.6` | ambang penjaga keputusan |
| `SLA_GRACE_HOURS` | `3` | `0` = aturan lama (langsung `sla_deadline`); `>0` menunda penandaan N jam |
| `SCAN_INTERVAL_MIN` | `5` | interval scheduler |
| `SCHEDULER_ENABLED` | `false` | biarkan `false` saat demo |
| `SEED_ON_STARTUP` | `true` | seed data demo bila DB kosong |

### 5.2 Rahasia (jangan pernah di repo)

`DATABASE_URL` lengkap, `DEMO_PASSWORD`, dan `SESSION_SECRET` disimpan di **Secret Manager**dan dipasang lewat `--set-secrets` (`infra/deploy-api.sh` sudah melakukannya). Autentikasi Gemini memakai service account — **tidak ada API key** di kode, deck, maupun rekaman.

### 5.3 Pengaturan saat berjalan

Sebagian nilai bisa diubah tanpa deploy lewat `PATCH /api/v1/settings` (tersimpan di tabel `settings`): interval scan, `sla_grace_hours`, ambang `min_confidence`/`medium_confidence`, `ai_mode`, `scheduler_enabled`, retensi video, `mask_pii`, jam pengingat tenggat, serta status koneksi marketplace. Pengecualian ambang per kurir (hari tertahan) diatur lewat `PUT /api/v1/settings/courier-thresholds`.

---

## 6. Menjalankan dan Men-deploy

### 6.1 Lokal

| Perintah | Hasil |
| --- | --- |
| `.venv/bin/python -m uvicorn app.main:app --reload --port 8000` | API + SSE |
| `npm run dev` (folder `frontend`) | UI di `:3000` |
| `.venv/bin/python data/seed.py` | reset data demo |
| `.venv/bin/python scripts/export_openapi.py` | perbarui `openapi.json` setelah mengubah endpoint |

### 6.2 Google Cloud (dua service Cloud Run)

Prasyarat (sekali, oleh PIC GCP): project, billing/kredit, API aktif, Cloud SQL, bucket GCS, service account, dan secret. Panduan langkah demi langkah beserta role minimum: `infra/setup-gcp.md` (+ script idempoten `infra/setup-gcp.sh`).

```bash
export PROJECT_ID=<project-panitia>
export API_URL=https://claimguard-api-xxx.a.run.app
export CORS_ORIGINS='["https://claimguard-web-xxx.a.run.app"]'

./infra/deploy-api.sh --dry-run     # lihat perintahnya dulu
./infra/deploy-api.sh               # build via Cloud Build + deploy + cek /health
./infra/deploy-web.sh               # Next.js; NEXT_PUBLIC_* dikirim sebagai build-env
```

Batasan Cloud Run backend yang **wajib** (`--min-instances 1 --max-instances 1 --no-cpu-throttling --timeout 3600`): investigasi berjalan sebagai `asyncio.Task` dan SSE memakai event bus di memori proses. Tanpa ini task mati setelah respons terkirim dan stream terputus (lihat NFR-13).

---

## 7. Skenario Demo dan Bukti Pengujian

Langkah A–F mengikuti SRS §14. Hasil yang tercantum di bawah adalah hasil eksekusi nyata di **lokal**; status Cloud Run ditandai terpisah agar tidak ada klaim berlebihan.

| \# | Skenario | Langkah (API) | Kriteria lulus | Status |
| --- | --- | --- | --- | --- |
| A | Paket hilang (utama) | `POST /demo/scenario/lost` → `GET /investigations/{id}/stream` | resign ditandai `lost`; klip CCTV terpotong di sekitar jam scan; keputusan `claim` + alasan; draf memuat nomor resi + kronologi + kebijakan kurir | ✅ lokal (test end-to-end) |
| B | Paket rusak | `POST /demo/scenario/damaged` | verdict `damaged` + `confidence` + timestamp; kebijakan kurir terlampir | ✅ lokal |
| C | Retur curang | `POST /demo/scenario/return_fraud` | keputusan `fraud_suspect`; **tidak ada** klaim ke kurir | ✅ lokal |
| D | Persetujuan HITL | `PATCH /claims/{id}` → `POST /claims/{id}/approve` | status `submitted` (berlabel simulasi), tercatat di audit log; klik kedua ⇒ **409** tanpa duplikat | ✅ lokal |
| E | Gemini gagal | `AI_MODE=auto` + model diblokir | fallback cache berlabel `cache`, alur selesai, dashboard tidak crash | ✅ mekanisme cache lulus di test |
| F | Hentikan Agen | `POST /investigations/{id}/cancel` | status `cancelled`, event `cancelled` terkirim, FFmpeg dihentikan; cancel saat sudah selesai ⇒ 409 | ✅ lokal |

**Bukti pengujian yang dijalankan (verifikasi terakhir di lokal, 21 Okt 2026):**

```text
$ cd backend && .venv/bin/python -m pytest -q
49 passed in 8.74s

$ .venv/bin/ruff check app data scripts tests
All checks passed!

$ curl localhost:8000/api/v1/health
{"status":"ok","db":"ok","ai_mode":"auto","storage":"local"}

$ curl -X POST localhost:8000/api/v1/monitoring/scan
scanned 15 resi → 4 anomali baru (2 tertahan, 1 rusak, 1 retur mencurigakan)
```

Test berjalan **tanpa** memanggil Gemini: LLM diganti rekaman (`FakeLlm`) sehingga pipeline ADK dan seluruh endpoint diuji deterministik. Detail status per komponen, termasuk yang **belum** terverifikasi: `docs/backend-status-2026-10-21.md`.

> **Tidak ada angka performa yang dikarang di README ini.** Target NFR-01 (&lt; 30 detik) baru boleh diklaim setelah diukur dengan Gemini aktif; lihat §8.

---

## 8. Batasan dan Kondisi Gagal

Keterbatasan dinyatakan terbuka — biasanya lebih meyakinkan daripada klaim sempurna.

**1. Pengiriman klaim hanya simulasi.** Tidak ada panggilan ke API kurir sungguhan. Status `submitted` beserta `submission_ref` adalah simulasi dan diberi label `is_simulated` di UI.

**2. Backend satu instance.** Task registry, event bus, dan antrean SSE ada di memori proses. Skala horizontal butuh Pub/Sub atau Redis. `max-instances=1` bukan pilihan estetika.

**3. Video tidak disertakan.** `data/samples/` dan `backend/data/cache/` kosong di repo. Akibatnya, tanpa video sampel investigasi berhenti di `clip_cctv_video`(`media tidak ditemukan`), dan tanpa cache + tanpa `GCP_PROJECT` investigasi gagal dengan `ai_not_configured`. Sistem **tidak** menyamarkan kegagalan ini sebagai hasil.

**4.** `analyze_media` **bergantung pada kuota dan latensi Vertex AI.** Mitigasi: tiga mode AI, cache dua lapis (tool vision + respons model), timeout 25 detik. Latensi tinggi tetap bisa melewati target 30 detik.

**5. Input tidak tepercaya diberi batas, bukan validator sempurna.** Teks `buyer_report`hanya dikirim sebagai isi pesan/hasil tool dan tidak pernah masuk ke template `instruction`; tools hanya menerima ID. Tetapi model tetap dapat salah menilai bukti — karena itulah ada penjaga confidence dan approval manusia.

**6. Monitoring memakai aturan kata kunci, bukan NLP.** Laporan pembeli yang tidak memakai kata seperti "rusak/pecah/retak" tidak akan tertangkap aturan `damaged`.

**7. Auth demo = satu kata sandi.** Tidak ada peran/akun individual. Endpoint baca sengaja tidak diproteksi karena datanya simulasi; *rate limiting* belum ada (Should).

**8. Kegagalan eksplisit, bukan senyap.** Format error seragam `{"error": {"code", "message"}}`. Kesalahan konfigurasi gagal saat start (`ENV=cloud` + secret default ⇒ `ValueError`), bukan saat demo berjalan.

---

## 9. Struktur Repositori

```
ClaimGuard/
├── README.md                     # dokumen ini
├── docs/
│   ├── SRS.md                    # spesifikasi lengkap (acuan implementasi)
│   ├── data-dummy-dan-video.md   # resep data demo & rekaman video
│   ├── backend-status-*.md       # hasil verifikasi, termasuk yang belum beres
│   └── backend-a-handoff.md
├── infra/
│   ├── setup-gcp.md / setup-gcp.sh   # project, IAM, Cloud SQL, bucket, secret
│   ├── deploy-api.sh             # deploy backend
│   └── deploy-web.sh             # deploy frontend
├── backend/
│   ├── pyproject.toml · Dockerfile (python:3.12-slim + ffmpeg)
│   ├── app/
│   │   ├── agents/              # agent.py (SequentialAgent), prompts/, tools/, outcome.py
│   │   ├── api/v1/              # router REST + SSE + ops (impor CSV, koneksi, privasi)
│   │   ├── services/            # monitoring, investigation_runner, claim_service, dll.
│   │   ├── models/ · schemas/ · db/ · core/
│   ├── data/                    # mock/ (resi, kebijakan kurir), cache/, seed.py
│   ├── tests/                   # unit · api · integration
│   └── openapi.json             # kontrak API (27 path)
└── frontend/                    # Next.js App Router + Tailwind
    └── src/app/(dashboard)/settings/   # pengaturan, koneksi, privasi, audit log
```

Kontrak API lengkap: `backend/openapi.json` — juga live di `/api/v1/docs`.

---

## 10. Catatan Sumber, Lisensi, dan Penggunaan AI

Sesuai TOR §6.2 dan §6.3, komponen yang **sudah tersedia sebelum hackathon** dibedakan dari kontribusi selama hackathon.

### 10.1 Komponen pihak ketiga (tersedia sebelumnya)

| Komponen | Lisensi | Pemakaian |
| --- | --- | --- |
| Google Agent Development Kit (`google-adk` 2.11.0) | Apache-2.0 | orkestrasi `SequentialAgent` |
| Google Gen AI SDK (`google-genai`) | Apache-2.0 | klien Vertex AI |
| FastAPI, Uvicorn, Pydantic, SQLAlchemy, APScheduler | MIT / BSD | backend |
| PostgreSQL / SQLite | PostgreSQL / Public Domain | database |
| FFmpeg (x264) | LGPL/GPL | pemotongan klip |
| Next.js, React, Tailwind CSS | MIT | frontend |
| Ikon desain | dibuat tim (ekspor Figma) | `frontend/public/figma/`, `assets/` |

Model: **Gemini 2.5 Flash** di Vertex AI (proprietary, diakses via service account). Dataset: tidak ada data pihak ketiga — seluruh resi, kebijakan kurir, dan video adalah **data simulasi buatan tim**. Tidak ada data pribadi nyata.

### 10.2 Penggunaan AI coding assistant

| Tools | Dipakai oleh | Tujuan | Bagian yang dibantu |
| --- | --- | --- | --- |
| Zed coding agent (LLM) | Ahza | Scaffolding, refactor, penulisan test, dokumentasi | Iterasi awal backend dan frontend |
| Claude Code (Anthropic, model Claude Opus) | Aziza | Implementasi fitur, refactor, test, dan dokumentasi bersama pengembang | Keputusan `seller_error` dan skenario C2 (penjual salah kirim) beserta prompt Investigator/Evaluator/Vision versi 2; draf permintaan bukti ke pembeli (F6); sisa waktu klaim, urutan antrian, filter jenis kasus; laporan per jenis kasus; label keyakinan; waktu keputusan admin, log audit per kasus, checklist bukti wajib kurir; video sintetis C2; pembaruan README ini |
| Gemini 2.5 Flash (Vertex AI) | Produk | Bagian dari solusi (bukan alat bantu coding): analisis video, keputusan, draf klaim | Lihat §2 |

Arsitektur, pemilihan masalah, keputusan produk (misalnya menambah keputusan `seller_error`alih-alih memakai `needs_evidence`), dan verifikasi hasil ditentukan oleh anggota tim. Setiap perubahan dari assistant ditinjau, diuji (`pytest`, `ruff`, `tsc`, `eslint`), lalu di-commit oleh anggota tim.

Seluruh kode dan hasil tetap dipahami dan dipertanggungjawabkan oleh anggota tim yang menulisnya. Tidak ada komponen yang dikerjakan oleh pihak di luar tim.

### 10.3 Komponen yang dikembangkan selama hackathon

Seluruh logika domain ClaimGuard: aturan monitoring, pipeline tiga agent beserta prompt, tools video/vision, kontrak HITL atomik, SSE/event bus, mekanisme cache, dan UI.

---

## 11. Pembagian Kontribusi Tim

Tim **ClaimGuard** (Duo Titut, IPB × ITB). Peran mengikuti format Hacker, Hipster, dan Hustler (TOR §2). Kontribusi kode dapat ditelusuri lewat riwayat git (`git shortlog -sn`).

| Anggota | Peran | Kontribusi selama hackathon |
| --- | --- | --- |
| **Aziza Dharma Putri** (ITB, Teknik Informatika) | Hacker · Chief Executive Officer (ketua tim) | Koordinasi dan prioritas tim. Kode (akun git `zizadhrmaa`): model data dan repositori, pipeline agen ADK (Investigator, Evaluator, Drafter) beserta prompt, tools CCTV/vision/kebijakan kurir, klien Gemini dan cache AI, ekstraksi kebijakan kurir, aturan monitoring, runner investigasi + SSE + pembatalan, layanan klaim HITL, endpoint REST dan kontrak OpenAPI, data simulasi; seluruh halaman frontend utama (Ringkasan, Resi, Investigasi live, Antrian dan Review klaim, Laporan, Panel demo, login); fitur `seller_error`, permintaan bukti ke pembeli, sisa waktu klaim, log audit per kasus, checklist bukti |
| **Ahza Radithya Dwicahyo** (IPB, TRPL) | Hacker · Chief Product Officer | Kode (akun git `radithyaa`/`ahja`): Dockerfile dan skrip deploy Google Cloud Run, endpoint ops dan ambang SLA per kurir, frontend Pengaturan dan Log audit, pemilihan model default `gemini-2.5-flash`, penyusunan README |
| **Anisa Aulia Alhaqi** (ITB, STI) | Hipster · Chief Design Officer | Riset pengguna, alur pengguna dan arsitektur informasi, desain UI dan prototipe Figma yang menjadi acuan frontend (`assets/figma*`) |
| **Alinda Rahma Aulia** (IPB, TRPL) | Hustler · Chief Business Officer | Validasi masalah, model bisnis, ukuran pasar dan unit economics, analisis pendukung untuk tanya jawab juri |
| **Brave Naufal Alfarras** (IPB, TRPL) | Hustler · Chief Technology Officer | Strategi produk dan go-to-market, penerjemahan teknis ke nilai bisnis, narasi dan alur pitching |

Anggota tanpa commit berkontribusi pada desain, riset, bisnis, dan pitch, yang tidak tercatat di repositori kode.

Aturan kerja: satu berkas satu pemilik, perubahan kontrak API lewat PR kecil, `main` selalu dapat di-deploy, dan tidak ada secret di repo.

---

## 12. Mentor: Cara Menilai Tautan Ini

1. **Jalankan** §3 (2 menit) — `/api/v1/health` dan `/api/v1/docs` harus terbuka.
2. **Baca** §2.3 lalu buktikan sendiri: cari `submit_claim` di `backend/app/` — ia **tidak**pernah muncul sebagai `Tool` pada `LlmAgent`.
3. **Baca** §7 untuk skenario yang berjalan beserta cara mereproduksinya, dan §8 untuk apa yang belum.
4. **Bandingkan** dengan `docs/SRS.md` — setiap klaim di README ini dapat dilacak ke kode atau ke hasil perintah.

---

Versi beku: tag/commit dicatat pada saat pembekuan prototype (TOR §7). Dokumen ini diperbarui 22 Oktober 2026. Waktu dalam WIB kecuali disebut lain.