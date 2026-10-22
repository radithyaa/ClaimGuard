# Memasang Video CCTV dan Unboxing

Dokumen ini menjelaskan cara memasang video sampel agar analisis video benar-benar berjalan,
baik di komputer sendiri maupun di server. Video dipakai oleh:

- alat `clip_cctv_video`, yang memotong rekaman CCTV meja packing di sekitar waktu scan resi;
- alat `analyze_media`, yang menganalisis klip dengan Gemini (fokus `packing`, `damage`, atau `consistency`);
- halaman investigasi, yang memutar klip bukti lewat `GET /evidence/{id}/media`.

Isi tiap video dan skenario yang memakainya dijelaskan di [data-demo.md](data-demo.md).

## 1. Dua jenis video

| Jenis | Dipakai untuk | Cara memasang | Dihubungkan lewat |
| --- | --- | --- | --- |
| **CCTV gudang** (`cctv`) | semua skenario; dipotong dengan FFmpeg | taruh di `backend/data/samples/`, lalu seed | waktu scan resi (`pack_scan.scanned_at`) dan awal rekaman (`recorded_start`) |
| **Unboxing pembeli** (`unboxing`) | kasus rusak dan sengketa retur | taruh di `backend/data/samples/` **atau** unggah lewat `POST /api/v1/media` | nomor resi pemilik video |

Video CCTV **tidak** dipotong per resi. Satu rekaman gudang memuat beberapa paket, dan posisi
klip dihitung dari `scanned_at - recorded_start`.

## 2. Berkas yang dibutuhkan data demo

Jalankan dari `backend/`:

```bash
.venv/bin/python -m app.tools.check_media --plan
```

Keluarannya menyebut berkas, resi yang memakainya, dan statusnya:

| Berkas | Dipakai resi (skenario) | Detik scan resi di video |
| --- | --- | --- |
| `cctv_packing_01.mp4` | `JNE0012345678` (A, paket hilang), `SCP4455667788` (D, penjual salah kirim), dan beberapa resi lain | 80 untuk A · 245 untuk D |
| `inhaler_packing.mp4` | `JT7788990011` (B, paket rusak) | 45 |
| `inhaler_unpacking.mp4` | `JT7788990011` (B, paket rusak) | video unboxing, ±19 detik |
| `needs_evidence.mp4` | `JNE0033445566` (C, sengketa retur tanpa unboxing) | 45 |

Nama berkas boleh berbeda huruf besar/kecil dan ekstensi (`.mov`, `.mkv`, `.m4v` juga dikenali).
Video tidak disimpan di repositori (`.gitignore`) dan tidak ikut image Docker (`.dockerignore`).

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

## 3. Memasang video di komputer sendiri

1. Masukkan rekaman ke folder `backend/data/samples/` dengan nama seperti tabel di atas.
2. Seed ulang (menyalin berkas ke storage, mengukur durasi dengan FFmpeg, mengisi DB):

   ```bash
   .venv/bin/python data/seed.py
   # atau tanpa menutup proses API:
   #   POST /api/v1/demo/reseed
   ```
   Di server (video ada di Cloud Storage), jalankan `./infra/upload-samples.sh` dulu, lihat bagian 2.1.

3. Periksa kesiapan:

   ```bash
   .venv/bin/python -m app.tools.check_media
   ```

   Target: `4/4 rekaman siap`. Berkas yang belum ada dilaporkan di `missing_media`.

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
     -F "file=@inhaler_unpacking.mp4;type=video/mp4"
```

Respons: `media_id`, `kind`, `duration_sec`, `tracking_number`, `uri`.
`analyze_media` bisa langsung memakai `media_id` itu sebagai `ref_id`.

- Berkas harus bisa didekode FFmpeg (bukan hanya ekstensi `.mp4`).
- Unggah ulang untuk resi + jenis yang sama **mengganti** rekaman lama (tidak menumpuk).
- Batas 100 MB per berkas.

## 6. Memastikan analisis jalan (tanpa kuota Gemini)

Mode `cache` membuat analisis tidak bergantung pada Gemini. Hasil analisis disimpan di
`backend/data/cache/vision/` dengan kunci `sha256(uri sumber, clip_start, clip_duration, focus, versi prompt)`.
Kunci memakai **URI**, bukan UUID, jadi cache tetap berlaku setelah `demo reset`.

- Rekaman yang sudah dianalisis sekali (mode `live`/`auto`) akan diputar ulang dari cache.
- Ganti isi video → isi cache untuk rekaman itu **tidak** berlaku lagi (perlu rekam ulang).
- `check_media` tidak memanggil Gemini; ia hanya memeriksa berkas & metadata.

## 7. Mode tiruan (frontend tanpa backend)

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

Lalu di aplikasi: **Panel demo → Jalankan** skenario A (paket hilang) dan B (paket rusak). Yang seharusnya terjadi:
- `clip_cctv_video` berhasil (`duration_sec` ± 25 detik), klip bisa diputar di halaman investigasi.
- `analyze_media` mengembalikan `source: live` (pertama kali), lalu `cache` pada run berikutnya.
- Untuk skenario B, video unboxing ikut dianalisis (`damage`).

## 9. Bila ada kendala

| Gejala | Penyebab | Tindakan |
| --- | --- | --- |
| `missing_media` berisi nama berkas | Berkas belum ada di `data/samples/` | Taruh berkas lalu seed ulang |
| Investigasi gagal `clip_failed` / `file media tidak ditemukan` | Berkas tidak ter-copy ke storage | Cek `backend/storage/samples/`, jalankan seed |
| `scan_outside_recording` | `scanned_at` berada di luar rekaman | Hitung ulang dengan `--scan` |
| `media_missing` pada unboxing | Rekaman belum dipasang atau hilang setelah reset | Unggah ulang / seed ulang |
| `analyze_media` → `ai_unavailable`, "hasil cache belum ada" | Mode `cache` tetapi rekaman belum pernah dianalisis | Jalankan sekali dengan `AI_MODE=live` (atau `auto` + GCP_PROJECT) untuk merekam cache |
| Halaman bukti: "Video tidak dapat dimuat" | `PUBLIC_BASE_URL` tidak cocok / backend tidak berjalan | Samakan dengan asal halaman, lalu restart backend |
| `GCP_PROJECT belum diisi` di log seed | Vertex AI belum dikonfigurasi | Wajar bila berjalan tanpa Gemini; aturan kurir memakai data cadangan |
