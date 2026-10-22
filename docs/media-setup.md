# Media rekaman (CCTV & unboxing)

Dokumen ini menjelaskan cara menaruh video agar **analisis video benar-benar berjalan**:
Fitur yang memakai video:
- `clip_cctv_video` — memotong rekaman CCTV meja packing di sekitar waktu scan resi (FR-03).
- `analyze_media` — analisis Gemini untuk `packing`, `damage`, dan `consistency` (FR-04).
- Halaman investigasi — memutar klip bukti lewat `GET /evidence/{id}/media`.

## 1. Dua jenis video, dua cara memasang

| Jenis | Dipakai untuk | Cara memasang | Direferensikan oleh |
| --- | --- | --- | --- |
| **CCTV gudang** (`cctv`, `cctv_packing_01`, `cctv_packing_02`) | Skenario hilang / rusak / sengketa; dipotong via FFmpeg | Taruh berkas di `backend/data/samples/` lalu jalankan seed | `pack_scan_logs.scanned_at` + `media_assets.recorded_start` |
| **Unboxing pembeli** (`unboxing`) | Kasus rusak (damage) & sengketa retur (consistency) | Taruh di `backend/data/samples/` **atau** unggah lewat `POST /api/v1/media` | `media_assets.shipment_id` |

Video CCTV **tidak** dipotong per resi: satu rekaman gudang melayani beberapa resi, dan klip
dihitung dari `scanned_at - recorded_start`.

## 2. Tujuh berkas yang harus ada (data demo)

Jalankan dari `backend/`:

```bash
.venv/bin/python -m app.tools.check_media --plan
```

Outputnya menyebut berkas, resi pemakainya, dan **detik penting** yang harus terlihat:

| Berkas | Dipakai resi (skenario) | Detik penting |
| --- | --- | --- |
| `cctv_packing_01.mp4` | `JNE0012345678` (A/lost), `SCP5566778899` (C1/return_fraud), resi lain tanpa skenario | **40** — scan resi masuk kardus |
| `cctv_packing_02.mp4` | `SCP8899770011` (C2/wrong_item_seller) | **30** — kaos merah M masuk kardus |
| `inhaler_packing.mp4` | `JT7788990011` (B/damaged) | **33** — inhaler dibungkus, resi J&T dipindai (di video: ±00:33–00:48) |
| `unboxing_vas.mp4` | (rekaman cadangan; tidak lagi dirujuk `shipments.json`) | adegan kerusakan |
| `unboxing_earphone.mp4` | `SCP5566778899` (C1/return_fraud) | adegan isi paket |
| `unboxing_kaos_hitam.mp4` | `SCP8899770011` (C2/wrong_item_seller) | adegan kaos merah M |
| `inhaler_unpacking.mp4` | `JT7788990011` (B/damaged) | adegan pembukaan kiriman inhaler |

Nama berkas boleh berbeda huruf besar/kecil dan ekstensi (`.mov`, `.mkv`, `.m4v` juga dikenali).
Berkas tidak di-commit (`.gitignore`: `backend/data/samples/`) dan tidak ikut image
(`backend/.dockerignore`).

### 2.1 Server deployment (Cloud Run + GCS)

Image backend **tidak membawa** `data/samples/`. Di cloud, `media_assets.uri` berbentuk
`gs://<BUCKET>/samples/<file>`, jadi berkas harus ada di bucket **dan** DB harus di-seed ulang
supaya baris media menunjuk ke sana:

```bash
export PROJECT_ID=hackathon-primestep-18
./infra/upload-samples.sh               # rsync backend/data/samples -> gs://<BUCKET>/samples/
./infra/upload-samples.sh --check       # pastikan semua berkas yang diminta shipments.json ada
curl -X POST "$API_URL/api/v1/demo/reseed" -H "Cookie: cg_session=$TOKEN"
```

Seed mengukur durasi asli dari GCS (bukan `duration_sec` di JSON), sehingga klip CCTV tidak
pernah meminta area di luar rekaman. Bila berkas belum ada di bucket, `clip_cctv_video` gagal
dengan `file media tidak ditemukan` dan `analyze_media` dengan `media_missing`.

## 3. Menaruh rekaman di DB dummy

1. Masukkan rekaman ke folder `backend/data/samples/` dengan nama seperti tabel di atas.
2. Seed ulang (menyalin berkas ke storage, mengukur durasi dengan FFmpeg, mengisi DB):

   ```bash
   .venv/bin/python data/seed.py
   # atau tanpa menutup proses API:
   #   POST /api/v1/demo/reseed
   ```
   Di server deployment (video ada di GCS), pakai `./infra/upload-samples.sh` dulu — lihat §2.1.

3. Periksa kesiapan:

   ```bash
   .venv/bin/python -m app.tools.check_media
   ```

   Target: `7/7 rekaman siap`. Berkas yang belum ada dilaporkan di `missing_media`.

> **Durasi diukur, bukan dipercaya.** `duration_sec` di `shipments.json` hanya dipakai bila video
> dibuat sintetis (`--synthetic`). Video asli yang lebih pendek dari angka di JSON akan memakai
> durasi sebenarnya, sehingga klip tidak pernah meminta area di luar rekaman.

## 4. Kalau waktu scan di video bergeser

`pack_scan.scanned_at` = `recorded_start` + detik scan. Hitung nilai barunya:

```bash
.venv/bin/python -m app.tools.check_media --scan cctv_packing_01=00:00:40
```

Salin baris `-> "..."` ke `pack_scan.scanned_at` resi terkait di `backend/data/mock/shipments.json`,
lalu seed ulang. Bila selisihnya melebihi durasi rekaman, `check_media` memberi peringatan
`scan_outside_recording` dan investigasi akan gagal di `clip_cctv_video`.

## 5. Unggah video unboxing lewat API

Cocok untuk rekaman baru atau saat backend berjalan di cloud (tidak bisa menyalin berkas ke kontainer).

```bash
# $TOKEN dari cookie sesi (login lewat web). Cukup dari curl bila AUTH_REQUIRED=false.
curl -X POST "http://localhost:8000/api/v1/media?shipment=JT7788990011" \
     -H "Cookie: cg_session=$TOKEN" \
     -F "file=@unboxing_vas.mp4;type=video/mp4"
```

Respons: `media_id`, `kind`, `duration_sec`, `tracking_number`, `uri`.
`analyze_media` bisa langsung memakai `media_id` itu sebagai `ref_id`.

- Berkas harus bisa didekode FFmpeg (bukan hanya ekstensi `.mp4`).
- Unggah ulang untuk resi + jenis yang sama **mengganti** rekaman lama (tidak menumpuk).
- Batas 100 MB per berkas.

## 6. Memastikan analisis jalan (tanpa kuota Gemini)

Mode `cache` dipakai saat demo agar tidak bergantung pada jaringan. Hasil analisis disimpan di
`backend/data/cache/vision/` dengan kunci `sha256(uri sumber, clip_start, clip_duration, focus, versi prompt)`.
Kunci memakai **URI**, bukan UUID, jadi cache tetap berlaku setelah `demo reset`.

- Rekaman yang sudah dianalisis sekali (mode `live`/`auto`) akan diputar ulang dari cache.
- Ganti isi video → isi cache untuk rekaman itu **tidak** berlaku lagi (perlu rekam ulang).
- `check_media` tidak memanggil Gemini; ia hanya memeriksa berkas & metadata.

## 7. Didapat di mode mock (frontend tanpa backend)

`NEXT_PUBLIC_API_MOCK=1` memakai data di memori: **tidak ada** pemotongan FFmpeg dan **tidak ada**
pemanggilan Gemini — seluruh hasil analisis adalah skrip tetap. Untuk benar-benar menguji video,
jalankan backend + frontend **tanpa** `NEXT_PUBLIC_API_MOCK`:

```bash
# terminal 1
cd backend && .venv/bin/uvicorn app.main:app --reload
# terminal 2
cd frontend && npm run dev
```

## 8. Menjalankan end-to-end dengan Gemini

```bash
# backend/.env
GCP_PROJECT=nama-project
# login: gcloud auth application-default login
cd backend
.venv/bin/python data/seed.py
.venv/bin/uvicorn app.main:app --reload
```

Lalu di UI: **Panel demo → Jalankan** skenario A (hilang) dan B (rusak). Yang diharapkan:
- `clip_cctv_video` berhasil (`duration_sec` ± 25 detik), klip bisa diputar di halaman investigasi.
- `analyze_media` mengembalikan `source: live` (pertama kali), lalu `cache` pada run berikutnya.
- Untuk skenario B/C2, unboxing ikut dianalisis (`damage` / `consistency`).

## 9. Troubleshooting

| Gejala | Penyebab | Tindakan |
| --- | --- | --- |
| `missing_media` berisi nama berkas | Berkas belum ada di `data/samples/` | Taruh berkas lalu seed ulang |
| Investigasi gagal `clip_failed` / `file media tidak ditemukan` | Berkas tidak ter-copy ke storage | Cek `backend/storage/samples/`, jalankan seed |
| `scan_outside_recording` | `scanned_at` berada di luar rekaman | Hitung ulang dengan `--scan` |
| `media_missing` pada unboxing | Rekaman belum dipasang atau hilang setelah reset | Unggah ulang / seed ulang |
| `analyze_media` → `ai_unavailable`, "hasil cache belum ada" | Mode `cache` tetapi rekaman belum pernah dianalisis | Jalankan sekali dengan `AI_MODE=live` (atau `auto` + GCP_PROJECT) untuk merekam cache |
| Halaman bukti: "Video tidak dapat dimuat" | `PUBLIC_BASE_URL` tidak cocok / backend tidak berjalan | Samakan dengan asal halaman, lalu restart backend |
| `GCP_PROJECT belum diisi` di log seed | Vertex AI belum dikonfigurasi | Wajar untuk demo cache/manual — kebijakan kurir memakai fallback |
