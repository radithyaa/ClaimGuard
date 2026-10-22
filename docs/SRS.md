# SRS ClaimGuard — Sistem Agentic AI Otonom untuk Otomatisasi Klaim Logistik UMKM

Versi 2.4 · 22 Oktober 2026 · Status: **disinkronkan dengan kode (`main` @ `a03321b`)** — menggantikan v2.3

> **Ringkasan perubahan v2.4** (detail di bagian 18): dokumen diselaraskan dengan implementasi nyata. Delapan operasi API yang sudah berjalan tetapi belum tercatat (impor CSV, koneksi/drift kamera, hapus & purge investigasi, ambang per kurir) ditambahkan; FR-23 s.d. FR-27 baru mendokumentasikan fitur yang **sudah ada di kode** (tenggat klaim, laporan uang pulih, impor CSV, koneksi & drift kamera, ambang tertahan per kurir); struktur direktori §9 ditulis ulang dari berkas nyata; tabel frontend §5 dan matriks keterlacakan §17 diperbarui; bagian 19 baru mencatat celah yang diketahui. Tidak ada perubahan arsitektur agen dari v2.3.
>
> **Cara menjaga dokumen tidak drift:** setiap PR yang mengubah endpoint, tabel, rute halaman, atau `RuntimeSettings` **wajib** memperbarui bagian 4, 5, 6, atau 8 yang terkait. Kontrak API yang berlaku adalah `backend/openapi.json`; bila keduanya berbeda, `openapi.json` menang dan SRS yang harus diperbaiki.

## 1. Pendahuluan

### 1.1 Tujuan Dokumen

Dokumen ini mendefinisikan spesifikasi perangkat lunak ClaimGuard: kebutuhan fungsional dan non-fungsional, arsitektur, rute halaman, kontrak API, model data, struktur direktori, tech stack, deployment, serta pembagian kerja. Dokumen ditujukan bagi tim developer, juri, dan pemangku kepentingan. Bila ada yang bertentangan dengan dokumen lain, dokumen ini yang berlaku.

### 1.2 Lingkup Produk

ClaimGuard mengotomatisasi pendeteksian anomali pengiriman, investigasi bukti (pemotongan CCTV gudang dan analisis Vision AI), hingga penyusunan draf tiket klaim ganti rugi bagi penjual online dan UMKM. Sistem terdiri dari **Monitoring Agent** (layanan aturan deterministik), **Investigation Agent** dan **Action Agent** (agen ADK berbasis Gemini), dengan **Approval Dashboard** sebagai kendali Human-in-the-Loop (HITL).

Di sekeliling alur agen ada lapisan operasional yang sudah berjalan: **tenggat klaim per resi** (FR-23), **laporan uang pulih** (FR-24), **impor resi dari CSV** (FR-25), **koneksi marketplace & deteksi drift jam kamera** (FR-26), dan **ambang tertahan per kurir** (FR-27).

**Di luar lingkup (out of scope) untuk versi hackathon:**

- Pengiriman klaim sungguhan ke API kurir (hanya simulasi "submit" dan status internal).
- Integrasi CCTV real-time (RTSP); memakai file video sampel di Cloud Storage.
- Sinkronisasi otomatis ke Shopee/TikTok Shop. Status koneksi di FR-26 adalah **penanda konfigurasi dan tampilan**, bukan integrasi API marketplace.
- Multi-tenant penuh dan sistem penagihan.
- Skala horizontal backend (lebih dari satu instance Cloud Run), lihat NFR-13.
- Pemisahan peran pengguna (admin vs peninjau). Saat ini satu password demo dengan hak setara (FR-19).

### 1.3 Definisi dan Singkatan

- **AI**: Artificial Intelligence · **LLM**: Large Language Model
- **HITL**: Human-in-the-Loop · **API**: Application Programming Interface
- **ADK**: Google Agent Development Kit · **GCS**: Google Cloud Storage · **GCP**: Google Cloud Platform
- **3PL**: Third-Party Logistics (ekspedisi kurir) · **SLA**: batas waktu layanan pengiriman
- **SSE**: Server-Sent Events · **MoSCoW**: Must/Should/Could/Won't

### 1.4 Referensi

SRS ClaimGuard v2.2, dokumentasi Google ADK (adk.dev), Vertex AI Gemini API, Cloud Run, Cloud SQL, FastAPI, Next.js, Shadcn UI.

## 2. Deskripsi Umum

### 2.1 Perspektif Produk

Sistem berbasis web. Backend FastAPI menjalankan agen ADK dan tools lokal (FFmpeg) di dalam satu container Cloud Run, memanggil Gemini lewat Vertex AI, menyimpan data di Cloud SQL dan video di Cloud Storage. Progres agen dikirim ke frontend secara real-time melalui SSE agar admin melihat "agen sedang berpikir".

### 2.2 Karakteristik Pengguna

| Aktor | Peran | Hak akses |
| --- | --- | --- |
| Admin Gudang / Pemilik Toko UMKM | Memantau paket, meninjau draf, menyetujui atau menolak klaim | Dashboard penuh |
| Sistem Agen | Memotong video, menganalisis bukti, memutuskan tindak lanjut, menyusun draf | Tools investigasi saja; **tidak memiliki tool untuk mengirim klaim** |
| Juri / Demo Viewer | Menonton demo | Mode demo (tombol skenario) |

### 2.3 Batasan (Constraints)

- Hacking berlangsung Rabu 21 Oktober 13.00 sampai Kamis 22 Oktober 13.00 WIB; timer tetap berjalan saat mentoring, makan, dan istirahat.
- Pembekuan versi Kamis 22 Oktober 13.00 WIB: setelah itu kode, prompt agen, konfigurasi workflow, dan data uji tidak boleh berubah; hanya perbaikan kendala eksekusi dengan izin PIC teknis.
- **Wajib memakai Google ADK** untuk orkestrasi agen (ketentuan panitia).
- **Wajib di-deploy ke Google Cloud** (ketentuan panitia). Project GCP disediakan panitia; akun Owner dipegang **zizadhrmaa** (PIC GCP).
- Backend berjalan sebagai **satu instance** Cloud Run (lihat 3.6 dan NFR-13).
- Memakai mock data resi dan video sampel buatan sendiri untuk live demo.
- Ketergantungan pada kuota dan latensi Gemini di Vertex AI (dimitigasi dengan cache dan fallback, bagian 13).

### 2.4 Asumsi dan Ketergantungan

- Koneksi internet stabil saat demo; tersedia hasil analisis cadangan (cache) bila Gemini gagal.
- Video CCTV sampel memiliki overlay jam yang konsisten dengan jam scan resi di data mock.
- Ketentuan klaim kurir (JNE, J&T, SiCepat) ditulis sebagai dokumen kebijakan lokal (Markdown) lalu diekstrak menjadi JSON.
- Data sampel (resi, video CCTV, video unboxing) dibuat selama periode hacking dan tidak memuat data pribadi nyata.
- Kuota Vertex AI di project panitia cukup untuk pengembangan dan demo (diverifikasi PIC GCP pada jam pertama).

## 3. Arsitektur Sistem

### 3.1 Gambaran Arsitektur

```
                         Google Cloud (project panitia)
┌────────────────────────────────────────────────────────────────────────┐
│  Cloud Run "claimguard-web"  (Next.js standalone)                      │
│          │ REST + SSE                                                  │
│  Cloud Run "claimguard-api"  (FastAPI, min=1 max=1, no-cpu-throttling) │
│   ├─ Monitoring service ── aturan SLA deterministik ──► tabel anomalies│
│   │                        (sla_grace_hours atau hold_days per kurir)   │
│   ├─ Investigation runner ── ADK Runner (satu run per resi)            │
│   │     SequentialAgent: Investigator → Evaluator → Drafter            │
│   │     tools: get_case_context, clip_cctv_video (FFmpeg),             │
│   │            analyze_media, get_courier_policy                       │
│   ├─ Claim service ── approve / reject / submit_claim (simulasi)       │
│   ├─ Operasional ── tenggat klaim · impor CSV · koneksi & drift kamera │
│   └─ Event bus ── tabel investigation_events ──► SSE                   │
│        │                 │                    │                        │
│   Cloud SQL Postgres   Cloud Storage       Vertex AI Gemini            │
│   (data, audit)        (video, klip)       (model, via service acct)   │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Monitoring (di luar agen, deterministik)

Monitoring adalah layanan Python biasa (`services/monitoring.py`), **bukan** agen LLM:

1. Memuat resi aktif dari database.
2. Menerapkan aturan: melewati `sla_deadline` (stuck/hilang), `buyer_report` berisi kerusakan (damaged), laporan retur yang perlu diverifikasi (fraud_suspect).
3. Menulis baris `anomalies` dengan kode, severity, alasan terstruktur, dan **`case_type`** (`lost`, `damaged`, `return_fraud`). Idempoten: anomali aktif yang sama tidak dibuat dua kali.

Dipicu oleh `POST /monitoring/scan` (tombol "Scan Sekarang") dan penjadwal APScheduler. **Penjadwal dimatikan saat mode demo** agar tidak menyela skenario.

Alasan pemisahan: monitoring bekerja pada semua resi sekaligus dalam waktu kurang dari 1 detik tanpa LLM, sedangkan investigasi bekerja pada satu resi selama belasan detik dengan LLM. Kontrak di antara keduanya adalah tabel `anomalies`. Dalam presentasi, Monitoring tetap disebut "Monitoring Agent": deteksi sengaja dibuat deterministik karena murah, cepat, dan dapat diuji.

### 3.3 Agen Investigasi (ADK)

Satu **run ADK per resi**, dipicu `POST /investigations` dengan `shipment_id` (dari anomali). Root agent berupa `SequentialAgent`:

| Urutan | Agen | Jenis ADK | Tugas | Output (`output_key`) |
| --- | --- | --- | --- | --- |
| 1 | **Investigator** (Investigation Agent) | `LlmAgent` + tools | Memilih dan memanggil tool sesuai `case_type`: ambil konteks kasus, potong CCTV, analisis klip/unboxing, ambil kebijakan kurir | `investigation_notes` |
| 2 | **Evaluator** | `LlmAgent` + `output_schema` | Menilai kekuatan bukti dan **mengambil keputusan**: `claim`, `needs_evidence`, atau `fraud_suspect`, beserta alasan | `evaluation` |
| 3 | **Drafter** (Action Agent) | `LlmAgent` + `output_schema` | Menyusun narasi klaim dari fakta di state; **dilewati** bila keputusan bukan `claim` (`before_agent_callback`) | `claim_draft` |

Catatan teknis:

- Di ADK, agen dengan `output_schema` tidak dapat memanggil tool. Karena itu pengumpulan bukti (Investigator) dan keputusan terstruktur (Evaluator) sengaja dipisah.
- **Penjaga deterministik**: bila `evaluation.confidence` di bawah ambang (`settings.min_confidence`), kode aplikasi memaksa keputusan menjadi `needs_evidence` terlepas dari jawaban LLM.
- Setelah run selesai, kode aplikasi (bukan agen) menyimpan hasil ke DB:
  - `claim`: membuat baris `claims` berstatus `pending_approval`, dan menulis `shipments.resolution = courier`.
  - `needs_evidence`: investigasi selesai dengan outcome `needs_evidence`; tidak ada klaim, dan kesimpulan resi tidak diubah (bukti kurang tidak boleh menuduh siapa pun).
  - `fraud_suspect`: investigasi selesai dengan outcome `fraud_suspect`; UI menyarankan menolak retur pembeli; tidak ada klaim ke kurir.
- **Kesimpulan tertulis pada resi sendiri** (`shipments.resolution` = `courier` | `seller` | `buyer`, plus `resolution_reason`). Status pelacakan (`shipments.status`) **tidak** ditimpa karena itu data dari kurir; kesimpulan agentic disimpan terpisah agar keduanya tidak saling merusak. Setiap perubahan dicatat sebagai aksi audit `shipment_resolution_set` dan ikut dikirim di event SSE `decision` (`payload.shipment_resolution`).
- Kesimpulan agen di atas kebijakan manusia, tetapi bukan pengganti manusia: bila `resolution` menunjuk penjual/pembeli, `POST /claims/{id}/approve` menolak dengan **409 `resolution_blocks_claim`**. Admin yang menilai lain memutuskan dengan menolak draf (alasan penolakan wajib), dan penolakan itu **mencabut** kesimpulan agen dari resi.
- Inilah titik "agentic" yang harus terlihat jelas di demo: Investigator memilih tool sendiri, dan Evaluator memutuskan tindak lanjut dengan alasan yang ditampilkan di UI.

### 3.4 HITL lewat Status Database

Aturan kunci: **agen tidak pernah dapat mengirim klaim**. Ini dijamin secara struktural:

1. `submit_claim` **tidak terdaftar sebagai tool ADK** di agen mana pun. Fungsi itu hanya ada di `services/claim_service.py`.
2. Run agen **berakhir** setelah draf tersimpan berstatus `pending_approval`. Tidak ada run yang menunggu atau dilanjutkan.
3. `POST /claims/{id}/approve` memanggil `submit_claim` lewat update atomik: `UPDATE claims SET status='submitted' ... WHERE id=:id AND status='pending_approval'`. Bila tidak ada baris yang berubah, respons 409. Klik ganda tidak membuat duplikat.
4. Setiap persetujuan, penolakan, dan edit dicatat di `audit_logs`.

Fitur tool confirmation ADK sengaja **tidak dipakai**: statusnya eksperimental dan tidak mendukung session service persisten, sehingga persetujuan yang tertunda akan hilang saat container restart. Dengan desain ini, restart backend tidak menghilangkan klaim yang menunggu persetujuan.

### 3.5 Hentikan Agen (FR-20)

- `investigation_runner` menyimpan `asyncio.Task` per `investigation_id` di memori proses.
- `POST /investigations/{id}/cancel` memanggil `task.cancel()`. Handler `CancelledError` menghentikan subprocess FFmpeg yang berjalan, menulis status `cancelled`, mengirim event SSE `cancelled`, dan mencatat `audit_logs`.
- Panggilan Gemini yang sudah terkirim tidak dapat ditarik, tetapi hasilnya dibuang.
- Cancel pada investigasi yang sudah selesai mengembalikan 409.

### 3.6 State, Sesi, dan Event

- **Sesi ADK** memakai `InMemorySessionService`. Sesi hanya hidup selama satu run, jadi tidak perlu persisten. **Sumber kebenaran ada di Cloud SQL** (`investigations`, `evidence`, `investigation_events`, `claims`).
- Kunci `session.state`: `shipment_id`, `case_type`, `courier`, `evidence` (daftar `evidence_id` + ringkasan analisis), `courier_policy`, `investigation_notes`, `evaluation`, `claim_draft`.
- **Input tidak tepercaya** (teks `buyer_report`, catatan kurir) dikirim sebagai isi pesan atau hasil tool, **tidak pernah** disisipkan ke template `instruction` agen.
- Pemetaan event ADK ke SSE dilakukan oleh `investigation_runner`:

| Event ADK / aplikasi | Event SSE |
| --- | --- |
| Run dimulai | `status` (`running`) |
| `event.get_function_calls()` | `tool_start` (nama tool, input ringkas) |
| `event.get_function_responses()` | `tool_end` (output ringkas, durasi, `analysis_source`) |
| Teks dari agen | `thought` (dengan nama agen) |
| `evaluation` tersimpan | `decision` (keputusan, confidence, alasan) |
| Run selesai | `done` (`outcome`, `claim_id` bila ada) |
| Exception | `error` (kode, pesan terbaca) |
| Task dibatalkan | `cancelled` |

- Setiap event juga ditulis ke tabel `investigation_events` dengan nomor urut. SSE mendukung `Last-Event-ID`, sehingga reconnect atau refresh halaman memutar ulang event yang terlewat.
- Karena event bus, task registry, dan antrean SSE ada di memori proses, backend **wajib satu instance** (NFR-13).

## 4. Kebutuhan Fungsional

Prioritas memakai MoSCoW.

### 4.1 Modul Monitoring & Anomaly Detection

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| FR-01 | Memuat data resi aktif dari database (mock, ditandai `is_simulated`) | Must |
| FR-02 | Layanan Monitoring menandai paket stuck (melebihi SLA), rusak, atau retur mencurigakan dengan aturan deterministik, tanpa LLM | Must |
| FR-08 | Penjadwal berkala (misalnya setiap 5 menit, nonaktif di mode demo) plus tombol "Scan Sekarang" manual | Should |
| FR-09 | Setiap flag memiliki alasan terstruktur (kode anomali, hari keterlambatan, severity, `case_type`) | Must |

### 4.2 Modul Investigation Agent

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| FR-03 | Tool memotong video CCTV (FFmpeg) di sekitar timestamp scan packing resi; video dipilih dari DB berdasarkan `shipment_id`, bukan path dari agen | Must |
| FR-04 | Analisis klip CCTV, video unboxing, atau foto kondisi barang dengan Gemini multimodal untuk mendeteksi kerusakan atau potensi kecurangan | Must |
| FR-05 | Ketentuan klaim per kurir (batas waktu klaim, dokumen wajib, batas ganti rugi) diekstrak dari dokumen kebijakan menjadi JSON terstruktur (sekali saat seed, disimpan di DB) | Must |
| FR-10 | Hasil analisis berupa structured output: `verdict`, `confidence`, `findings[]`, `timestamp_evidence[]` | Must |
| FR-11 | Jejak investigasi (agen, tool yang dipanggil, input, output ringkas, durasi) ditampilkan live di UI | Must |
| FR-12 | Bila bukti tidak cukup atau confidence di bawah ambang, investigasi berakhir dengan outcome `needs_evidence` dan tidak ada klaim yang dibuat | Should |
| FR-22 | Evaluator memutuskan `claim`, `needs_evidence`, atau `fraud_suspect` dengan alasan yang ditampilkan di UI | Must |

### 4.3 Modul Action Agent & Approval Dashboard

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| FR-06 | Menyusun draf tiket klaim otomatis: narasi kronologi, nomor resi, lampiran (klip CCTV, hasil analisis AI, ketentuan kurir) | Must |
| FR-07 | Tombol persetujuan satu klik (One-Click HITL); pengiriman hanya terjadi lewat endpoint approve, bukan oleh agen | Must |
| FR-13 | Pemilik dapat mengedit narasi draf sebelum menyetujui, atau menolak dengan alasan | Should |
| FR-14 | Riwayat klaim dengan status: `pending_approval`, `submitted`, `rejected` | Must |
| FR-15 | Ekspor draf klaim ke PDF atau salin teks untuk dikirim manual | Could |
| FR-16 | Notifikasi in-app saat draf baru siap ditinjau | Could |
| FR-20 | Pemilik dapat menghentikan investigasi yang berjalan lewat tombol "Hentikan Agen"; status menjadi `cancelled` dan tercatat di audit log | Must |
| FR-23 | **Tenggat pengajuan klaim per resi** dihitung dari kebijakan kurir dan ditampilkan pada resi serta klaim, agar admin tahu sisa waktu sebelum klaim kedaluwarsa | Should |
| FR-24 | **Laporan uang pulih**: rekap klaim `submitted`/`rejected`/`pending_approval` per bulan dan per kurir, beserta nilai yang dipulihkan dan estimasi waktu admin yang dihemat | Could |

### 4.4 Modul Pendukung

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| FR-17 | Mode demo: tombol skenario (paket hilang, paket rusak, retur curang) yang memicu alur penuh, plus reset data | Must |
| FR-18 | Halaman ringkasan metrik: jumlah anomali, klaim diajukan, estimasi nilai klaim, rata-rata waktu proses | Should |
| FR-19 | Autentikasi sederhana untuk admin: password tunggal mode demo (disimpan di Secret Manager); sesi dicek di server lewat cookie httpOnly | Should |
| FR-21 | Setiap hasil ditandai sumbernya: `live` atau `cache` untuk analisis AI, dan "data simulasi" untuk data mock serta pengiriman klaim; hasil cache tidak pernah ditampilkan sebagai eksekusi langsung | Must |
| FR-25 | **Impor resi dari CSV**: unggah berkas (maks 2 MB / 5.000 baris), validasi kolom, resi dengan nomor yang sama diperbarui, baris rusak dilaporkan tanpa menggagalkan seluruh unggahan; tersedia templat CSV | Should |
| FR-26 | **Koneksi & sumber data**: status koneksi marketplace (Shopee, TikTok Shop) dan **deteksi drift jam kamera** (`scanned_at` − `recorded_start`; status `perlu_kalibrasi` bila selisih > 3 detik) | Should |
| FR-27 | **Ambang tertahan per kurir**: `hold_days` per kurir menggantikan `sla_grace_hours` global; dapat diubah dari Pengaturan dan dibaca Monitoring | Should |

Catatan prioritas: FR-23 s.d. FR-27 sudah **diimplementasikan** di kode. Prioritas di atas menyatakan bobotnya bagi demo, bukan status pengerjaan. FR-15 dan FR-16 belum dikerjakan.

## 5. Rute Halaman Frontend (Next.js App Router)

| Rute | Halaman | Fungsi utama | Komponen kunci |
| --- | --- | --- | --- |
| `/login` | Login | Masuk admin: email akun demo, kata sandi tim, "Ingat perangkat", tautan lupa kata sandi, dan tombol **Coba sebagai juri** | `LoginForm` |
| `/` | Redirect | Arahkan ke `/dashboard` | n/a |
| `/dashboard` | Ringkasan | KPI, grafik tren, aktivitas terbaru (dari audit log), tombol "Scan Sekarang" | `StatCard`, `TrendChart`, `AgentActivityFeed` |
| `/shipments` | Daftar resi | Tabel resi dengan filter status/kurir, pencarian, badge anomali; tombol investigasi | `ShipmentTable`, `StatusBadge`, `FilterBar`, `ScanButton` |
| `/shipments/[id]` | Detail resi | Timeline pengiriman, alasan flag, tombol "Investigasi dengan AI", tautan ke investigasi dan klaim terakhir | `ShipmentTimeline`, `AnomalyCard`, `ClaimPanel` |
| `/investigations/[id]` | Investigasi live | Progres agen real-time (SSE), klip CCTV, temuan Vision AI dengan penanda timestamp, ketentuan kurir, **keputusan Evaluator**, tombol Hentikan Agen | `AgentSteps`, `EvidencePanel`, `useInvestigationStream` |
| `/claims` | Daftar klaim | Antrean persetujuan (pending dulu), riwayat, filter status | Tabel klaim + `claim-actions` |
| `/claims/[id]` | Review klaim (HITL) | Pratinjau draf, lampiran bukti, skor keyakinan, edit narasi, tombol **Setujui & Kirim**, **Tolak** | `ClaimActions`, `ConfirmDialog` |
| `/reports` | Laporan uang pulih | Rekap klaim per bulan dan per kurir, nilai dipulihkan, estimasi waktu admin (FR-24) | Halaman laporan |
| `/couriers` | Kebijakan kurir | Ketentuan klaim hasil ekstraksi per kurir (read-only) | `CourierPolicy` + `courier-table` |
| `/demo` | Panel demo | Pemicu skenario (`lost`, `damaged`, `return_fraud`) dan reset data | Halaman demo |
| `/settings` | Pengaturan: pemantauan & ambang | Interval scan, ambang SLA, ambang confidence, mode AI, ambang tertahan per kurir | `SettingsForm`, `controls`, `courier-table` |
| `/settings/connections` | Koneksi & sumber data | Status marketplace, impor CSV resi, drift jam kamera | `connections-form` |
| `/settings/privacy` | Privasi & data | Retensi video, masking PII, hapus/purge data investigasi | `privacy-form` |
| `/settings/audit-log` | Log audit | Jejak aksi agen dan operator | `AuditLogView`, `audit-drawer` |
| `/settings/account` | Akun | Profil operator demo, masa berlaku sesi perangkat ini, status layanan dari `/health`, dan tombol keluar (FR-19) | `AccountForm` |

Catatan UX: skeleton loading, toast untuk hasil aksi, konfirmasi sebelum "Setujui & Kirim", bahasa Indonesia sederhana (NFR-03). Navigasi sidebar (`lib/nav.ts`) mengelompokkan halaman menjadi **Kerja harian**, **Analisis**, dan **Sistem**.

**Halaman Akun sengaja tidak memuat field palsu.** Sistem demo memakai satu kata sandi tim tanpa pemisahan peran, sehingga halaman ini tidak menyediakan "ubah kata sandi", "ubah nama", atau "kelola anggota". Yang ditampilkan adalah data yang benar-benar ada: status sesi dari token tersimpan (`sessionStorage` vs `localStorage`), waktu berakhirnya, kondisi backend dari `GET /health`, dan aksi keluar. Diganti kata sandi dilakukan lewat secret `DEMO_PASSWORD`, dan hal itu dinyatakan di halaman.

**Mode mock frontend:** bila `NEXT_PUBLIC_API_MOCK=1`, `lib/api-client.ts` dan `lib/sse.ts` memakai data mock lokal (`lib/mock/`) sehingga UI dapat didemokan tanpa backend. Topbar menampilkan label "Mode mock". Default (variabel tidak diisi) adalah **backend nyata**.

## 6. Spesifikasi API Backend (FastAPI)

Prefix `/api/v1`. Semua respons JSON kecuali SSE. Skema divalidasi Pydantic. Seluruh waktu dalam UTC ISO 8601.

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| GET | `/health` | Cek kesehatan layanan (termasuk koneksi DB, `ai_mode`, `storage`) |
| POST | `/auth/login` | Login password tunggal mode demo, mengembalikan token sesi dan menyetel cookie `cg_session` httpOnly |
| GET | `/auth/session` | Status sesi dari cookie (`{authenticated, user, auth_required}`); **token tidak pernah dikembalikan**. Dipakai penjaga rute di server Next.js |
| POST | `/auth/logout` | Menghapus cookie sesi (204). Idempoten, aman dipanggil tanpa sesi |
| GET | `/shipments` | Daftar resi (filter `status`, `courier`, `q`, paginasi `limit`/`offset`) |
| GET | `/shipments/{shipment_id}` | Detail resi, event tracking, anomali aktif, `claim_deadline`, investigasi dan klaim terakhir |
| POST | `/shipments/import` | Impor resi dari CSV (`multipart/form-data`, maks 2 MB) — FR-25 |
| GET | `/shipments/import/template` | Unduh templat CSV agar format selalu selaras dengan parser — FR-25 |
| POST | `/monitoring/scan` | Menjalankan Monitoring, mengembalikan daftar anomali baru |
| GET | `/anomalies` | Daftar anomali (filter `status`, `case_type`) |
| POST | `/investigations` | Memulai investigasi untuk `shipment_id`; langsung mengembalikan `investigation_id` (202) |
| GET | `/investigations` | Daftar investigasi (filter `shipment_id`, `status`) |
| GET | `/investigations/{investigation_id}` | Status, outcome, keputusan, evidence, dan trace |
| GET | `/investigations/{investigation_id}/stream` | SSE: `status`, `tool_start`, `tool_end`, `thought`, `decision`, `done`, `error`, `cancelled`; mendukung `Last-Event-ID` |
| POST | `/investigations/{investigation_id}/cancel` | Menghentikan investigasi yang berjalan (409 bila sudah selesai) |
| DELETE | `/investigations/{investigation_id}` | Hapus satu investigasi beserta evidence dan event-nya (NFR-11) |
| POST | `/investigations/purge?older_than_days=N` | Hapus investigasi lama sekaligus; investigasi aktif dilewati dan dilaporkan di `skipped_active` (NFR-11) |
| GET | `/claims` | Daftar klaim (filter `status`, `shipment_id`) |
| GET | `/claims/{claim_id}` | Detail draf klaim beserta lampiran |
| PATCH | `/claims/{claim_id}` | Edit narasi draf (hanya saat `pending_approval`) |
| POST | `/claims/{claim_id}/approve` | Persetujuan HITL: status menjadi `submitted` (simulasi); 409 bila bukan `pending_approval` |
| POST | `/claims/{claim_id}/reject` | Menolak dengan alasan; 409 bila bukan `pending_approval` |
| GET | `/evidence/{evidence_id}/media` | Mengembalikan signed URL GCS (berlaku 1 jam) untuk klip/video; Range ditangani GCS |
| GET | `/couriers/policies` | Ketentuan klaim hasil ekstraksi, termasuk `claim_window_days` (FR-05, FR-23) |
| GET | `/metrics/summary` | Data KPI dashboard, termasuk deret tren 7 hari |
| GET | `/audit-logs` | Aktivitas terbaru (filter `limit`, `entity`) untuk `AgentActivityFeed` |
| GET | `/settings` | Pengaturan aktif (`RuntimeSettings`, termasuk `courier_thresholds`) |
| PATCH | `/settings` | Ubah interval scan, ambang SLA, ambang confidence, mode AI (`live`/`auto`/`cache`), retensi, dan penanda koneksi — FR-27 |
| GET | `/settings/courier-thresholds` | Daftar ambang tertahan per kurir — FR-27 |
| PUT | `/settings/courier-thresholds` | Mengganti **seluruh** daftar ambang kurir sekaligus — FR-27 |
| GET | `/connections` | Status koneksi marketplace dan drift jam kamera packing — FR-26 |
| PATCH | `/connections/{connection_id}` | Menyalakan/mematikan penanda koneksi (`shopee`, `tiktok_shop`) — FR-26 |
| POST | `/demo/scenario/{name}` | Memicu skenario demo (`lost`, `damaged`, `return_fraud`): menyiapkan data lalu memulai investigasi; mengembalikan `investigation_id` |
| POST | `/demo/reset` | Mengembalikan mock data ke kondisi awal; mengembalikan `missing_media` bila video sampel tidak ada |

**Total: 34 operasi** pada 29 path (lihat `backend/openapi.json`).

**Konvensi error:** format seragam `{ "error": { "code": "...", "message": "..." } }` dengan kode HTTP yang tepat: 400, 401, 404, 409 (status tidak valid), 422, 502 (layanan AI gagal tanpa cache).

**Autentikasi per endpoint.** Bila `AUTH_REQUIRED=true`: seluruh endpoint **baca (GET)** tetap publik agar dashboard dapat dibuka penilai, sedangkan **endpoint tulis dan pemicu AI** (`POST`, `PATCH`, `PUT`, `DELETE`, kecuali `/auth/login`, `/auth/session`, `/auth/logout`, dan `/health`) memerlukan token `Authorization: Bearer` atau cookie sesi dan mengembalikan 401 tanpa keduanya. Ini keputusan sadar untuk demo: menutup penyalahgunaan kuota Vertex tanpa memaksa login berlapis. **Rate limiting belum ada** — tercatat sebagai celah di bagian 19.

**Sesi di sisi klien.** Sesi **first-party**: cookie httpOnly `cg_session` diset oleh route handler Next.js (`/api/auth/login`), bukan oleh backend, lalu diteruskan ke backend. Guard di `app/(dashboard)/layout.tsx` dan proxy SSE membaca cookie yang sama. Tidak ada token di `localStorage`. Alternatif `Authorization: Bearer` tetap sah di backend (dipakai oleh pengujian dan alat CLI), tetapi bukan jalur utama browser.

**Format event SSE:** `id: <seq>`, `event: <type>`, `data: {"investigation_id", "agent", "ts", "payload", "source"}`.

## 7. Daftar Tools dan Layanan

### 7.1 Tools ADK (hanya untuk Investigator)

| Tool | Input | Output | Implementasi |
| --- | --- | --- | --- |
| `get_case_context` | `shipment_id` | resi, anomali, `case_type`, waktu scan packing, daftar media tersedia | Query DB |
| `clip_cctv_video` | `shipment_id`, `pre_sec`, `post_sec` (dibatasi 5–30) | `evidence_id`, durasi | Video sumber dicari dari DB; FFmpeg encode ulang H.264 `ultrafast`; unggah ke GCS |
| `analyze_media` | `evidence_id`, `focus` (`packing`/`damage`/`consistency`) | `verdict`, `confidence`, `findings`, `timestamp_evidence`, `source` | Gemini multimodal via Vertex (`gs://` URI), structured output, cache |
| `get_courier_policy` | `courier` | JSON ketentuan klaim | Membaca `courier_policies` di DB |

Aturan tools: input divalidasi; tool **tidak pernah menerima path file** dari LLM (hanya ID); setiap tool punya timeout; tool mengembalikan error yang terbaca agen (bukan stack trace); semua pemanggilan dicatat lewat `after_tool_callback` ke `investigation_events` dan `audit_logs`.

### 7.2 Layanan non-agen

| Layanan | Fungsi | Dipanggil oleh |
| --- | --- | --- |
| `monitoring.scan()` | Aturan anomali deterministik | `POST /monitoring/scan`, scheduler |
| `policy_extractor.extract_all()` | Ekstraksi dokumen kebijakan kurir ke JSON dengan Gemini (sekali) | `seed.py` |
| `claim_service.create_from_draft()` | Menyimpan draf hasil Drafter sebagai klaim `pending_approval` | `investigation_runner` |
| `claim_service.submit_claim()` | Simulasi pengiriman klaim | **Hanya** `POST /claims/{id}/approve` |
| `investigation_runner.start()/cancel()` | Menjalankan ADK Runner sebagai task, memetakan event ke SSE | `POST /investigations`, `/cancel`, `/demo/scenario` |
| `deadlines.claim_deadline()` | Menghitung tenggat klaim dari kebijakan kurir (FR-23) | Router shipments & claims saat menyusun respons |
| `csv_import.import_rows()` | Validasi dan impor CSV resi, idempoten per `tracking_number` (FR-25) | `POST /shipments/import` |
| `connections.list_cameras()/marketplaces()` | Drift jam kamera dan status koneksi (FR-26) | `GET /connections` |
| `settings_service.RuntimeSettings` | Baca/tulis pengaturan runtime, termasuk ambang per kurir (FR-27) | `GET/PATCH /settings`, Monitoring, agen |
| `demo_data.reset_and_seed()` | Seed deterministik dan penyalinan/penghasilan video sampel | `POST /demo/reset`, `seed.py` |

## 8. Model Data

| Tabel | Kolom utama |
| --- | --- |
| `shipments` | id, tracking_number, courier, status, origin, destination, shipped_at, sla_deadline, item_name, item_value, buyer_report, resolution (`courier`/`seller`/`buyer`, nullable), resolution_reason, is_simulated |
| `tracking_events` | id, shipment_id, status, location, occurred_at |
| `pack_scan_logs` | id, shipment_id, scanned_at, cctv_media_id |
| `media_assets` | id, kind (`cctv`/`unboxing`/`photo`), uri (`gs://…` atau `local://…`), recorded_start, duration_sec, shipment_id (nullable), description |
| `anomalies` | id, shipment_id, code, case_type (`lost`/`damaged`/`return_fraud`), severity (`low`/`medium`/`high`), reason_json, detected_at, status (`open`/`investigating`/`resolved`) |
| `investigations` | id, shipment_id, anomaly_id, case_type, status (`queued`/`running`/`completed`/`failed`/`cancelled`), outcome (`claim_drafted`/`needs_evidence`/`fraud_suspect`), verdict, confidence, decision_reason, error, started_at, finished_at, duration_ms |
| `investigation_events` | seq, investigation_id, type, agent, payload_json, source (`live`/`cache`), created_at |
| `evidence` | id, investigation_id, kind (`cctv_clip`/`unboxing`/`photo`), uri, source_media_id, clip_start_sec, clip_duration_sec, analysis_json, analysis_source (`live`/`cache`), created_at |
| `courier_policies` | id, courier, claim_window_days, required_docs_json, max_compensation, extra_json, source_text, extraction_source (`live`/`cache`/`manual`), extracted_at |
| `claims` | id, shipment_id, investigation_id, narrative, draft_json, status (`pending_approval`/`submitted`/`rejected`), created_at, updated_at, submitted_at, submitted_by, submission_ref, reject_reason, is_simulated |
| `audit_logs` | id, actor (`agent:<nama>`/`user`/`system`), action, entity, entity_id, payload_json, created_at |
| `courier_thresholds` | courier (PK), display_name, hold_days, sla_note, tag, updated_at — ambang tertahan per kurir (FR-27) |
| `settings` | key, value_json, updated_at — nilai `RuntimeSettings` yang dapat diubah saat berjalan |

Ketentuan:

- Primary key UUID (kecuali `investigation_events.seq` berupa bigint berurutan dan `courier_thresholds.courier` berupa string). Waktu selalu disimpan sebagai UTC timezone-aware (`UTCDateTime` memaksa konversi dan mengembalikan tzinfo meski SQLite membuangnya).
- Indeks pada `shipments.courier`, `shipments.status`, `claims.status`, `anomalies.shipment_id`, `investigations.status`, `media_assets.shipment_id`, `pack_scan_logs.shipment_id`, `evidence.investigation_id`, `investigation_events.investigation_id`, `audit_logs.created_at`, `audit_logs.entity_id`.
- Kolom JSON memakai `JSON` di SQLite dan `JSONB` di Postgres (`Json = JSON().with_variant(JSONB(), "postgresql")`).
- **Produksi (demo): Cloud SQL Postgres. Lokal: SQLite.** Skema dibuat dengan SQLAlchemy 2 `create_all` saat startup dan `seed.py`; Alembic tidak dipakai di hackathon.
- Klip dan video disimpan di GCS dengan pola `gs://<bucket>/samples/...` (video sampel) dan `gs://<bucket>/clips/<investigation_id>/...` (klip). Secara lokal, `STORAGE_BACKEND=local` memakai folder `storage/` dan URI `local://…`, disajikan lewat mount `/media`.
- **Tenggat klaim tidak disimpan sebagai kolom**, melainkan dihitung (`services/deadlines.py`): acuan = event pelacakan terakhir bila status `delivered`/`returned`, selain itu `sla_deadline`; ditambah `courier_policies.claim_window_days`. Dihitung saat respons API (`claim_deadline` pada resi dan klaim).

## 9. Struktur Direktori

```
ClaimGuard/
├── README.md                     # cara jalan lokal + deploy + skenario demo
├── .gitignore                    # .env, storage/, *.db, node_modules, .next
├── .github/
│   └── workflows/                # kosong: auto-deploy butuh role GCP tambahan
├── assets/                       # ekspor Figma (referensi desain)
├── docs/
│   ├── SRS.md                    # dokumen ini
│   ├── backend-a-handoff.md      # kontrak agen untuk Backend B
│   ├── backend-status-2026-10-21.md  # verifikasi backend vs SRS
│   └── data-dummy-dan-video.md   # rencana & spesifikasi data demo
├── infra/
│   ├── deploy-api.sh             # gcloud run deploy --source (backend)
│   ├── deploy-web.sh             # gcloud run deploy --source (frontend)
│   ├── setup-gcp.md              # langkah setup project, IAM, SQL, bucket
│   └── setup-gcp.sh              # pembuatan resource GCP
├── backend/
│   ├── pyproject.toml            # dependensi di-pin, termasuk google-adk==2.11.0
│   ├── requirements.lock
│   ├── Dockerfile                # python:3.12-slim + ffmpeg
│   ├── .env.example
│   ├── env.cloud.yaml.example
│   ├── openapi.json              # ekspor kontrak API (scripts/export_openapi.py)
│   ├── app/
│   │   ├── main.py               # FastAPI entrypoint, CORS, lifespan, mount /media, /health
│   │   ├── core/
│   │   │   ├── config.py         # pydantic-settings, gagal cepat
│   │   │   ├── errors.py         # handler error seragam {error:{code,message}}
│   │   │   ├── logging.py        # log JSON ke stdout (Cloud Logging)
│   │   │   └── security.py       # token sesi demo (HMAC)
│   │   ├── api/
│   │   │   ├── deps.py           # dependency auth, session DB
│   │   │   └── v1/
│   │   │       ├── shipments.py      # termasuk impor CSV
│   │   │       ├── monitoring.py
│   │   │       ├── investigations.py # SSE, cancel, delete, purge
│   │   │       ├── claims.py
│   │   │       ├── evidence.py
│   │   │       ├── metrics.py
│   │   │       ├── demo.py
│   │   │       ├── settings.py
│   │   │       └── ops.py            # koneksi, drift kamera, ambang kurir, login
│   │   ├── agents/
│   │   │   ├── agent.py          # build_root_agent(): SequentialAgent
│   │   │   ├── callbacks.py      # before/after tool & model, skip Drafter, fallback cache
│   │   │   ├── outcome.py        # persist_outcome(state) -> InvestigationOutcome
│   │   │   ├── prompts/          # instruksi agen (.md, diversikan)
│   │   │   └── tools/
│   │   │       ├── case_tools.py     # get_case_context, get_courier_policy
│   │   │       ├── video_tools.py    # clip_cctv_video
│   │   │       ├── vision_tools.py   # analyze_media
│   │   │       └── _common.py        # validasi ID & guard path
│   │   ├── services/
│   │   │   ├── ai_cache.py                 # cache respons Gemini & tool vision
│   │   │   ├── gemini_client.py            # google-genai (Vertex), retry, timeout
│   │   │   ├── video_service.py            # FFmpeg (dapat dibatalkan)
│   │   │   ├── storage_service.py          # GCS / lokal, signed URL
│   │   │   ├── policy_extractor.py
│   │   │   ├── monitoring.py
│   │   │   ├── claim_service.py
│   │   │   ├── investigation_runner.py     # task registry, event bus, SSE
│   │   │   ├── audit.py
│   │   │   ├── scheduler.py
│   │   │   ├── settings_service.py         # RuntimeSettings (DB)
│   │   │   ├── deadlines.py                # tenggat klaim (FR-23)
│   │   │   ├── connections.py              # marketplace & drift kamera (FR-26)
│   │   │   ├── csv_import.py               # impor CSV (FR-25)
│   │   │   └── demo_data.py                # seed deterministik & media sampel
│   │   ├── models/               # SQLAlchemy models
│   │   ├── schemas/              # Pydantic (agent_outputs, claim, common, evidence,
│   │   │                         #   investigation, metrics, ops, shipment)
│   │   ├── repositories/         # shipments, investigations, policies
│   │   └── db/session.py         # engine SQLite WAL / Postgres
│   ├── data/
│   │   ├── seed.py               # seed + --synthetic (video uji bila samples kosong)
│   │   ├── mock/shipments.json
│   │   ├── mock/courier_policies/  # jne.md, jnt.md, sicepat.md, fallback.json
│   │   ├── samples/              # video CCTV/unboxing (diisi tim; lihat 15.5)
│   │   └── cache/                # rekaman respons AI untuk fallback (di-commit)
│   ├── scripts/export_openapi.py
│   ├── storage/                  # lokal saja, di-gitignore
│   └── tests/
│       ├── conftest.py
│       ├── unit/                 # monitoring, video, tool, policy extractor
│       ├── integration/          # pipeline ADK dengan LLM di-mock
│       └── api/                  # API end-to-end, SSE, cancel, HITL
└── frontend/
    ├── package.json
    ├── Dockerfile                # Next.js output: standalone
    ├── next.config.ts
    ├── components.json           # Shadcn UI
    └── src/
        ├── app/
        │   ├── (auth)/login/page.tsx
        │   ├── (dashboard)/
        │   │   ├── layout.tsx
        │   │   ├── dashboard/page.tsx
        │   │   ├── shipments/{page.tsx, [id]/page.tsx}
        │   │   ├── investigations/[id]/page.tsx
        │   │   ├── claims/{page.tsx, [id]/page.tsx}
        │   │   ├── reports/page.tsx
        │   │   ├── couriers/page.tsx
        │   │   ├── demo/page.tsx
        │   │   └── settings/{page.tsx, connections/, privacy/, audit-log/, account/}
        │   ├── layout.tsx
        │   ├── providers.tsx
        │   ├── page.tsx
        │   └── not-found.tsx
        ├── components/
        │   ├── ui/                 # Shadcn + token desain
        │   ├── auth/               # auth-guard, login-form
        │   ├── layout/             # sidebar, topbar, nav.ts
        │   ├── shipments/          # tabel, timeline, anomaly, claim-panel, scan-button
        │   ├── investigation/      # agent-steps, evidence-panel, derive.ts
        │   ├── claims/             # claim-actions
        │   └── settings/           # form, controls, connections-form, privacy-form, account-form, audit-log
        ├── lib/
        │   ├── api-client.ts       # klien API (mode mock opsional)
        │   ├── api.ts              # settings/ops endpoints
        │   ├── sse.ts              # useInvestigationStream (Last-Event-ID)
        │   ├── auth.ts, format.ts, audit.ts, settings-tabs.ts, utils.ts
        │   └── mock/               # data & handler mock (NEXT_PUBLIC_API_MOCK=1)
        └── types/api.ts
```

> **Catatan drift:** `next.config.ts`/`app/error.tsx` versi awal SRS tidak ada di repositori saat ini; penanganan error halaman memakai `components/ui/states.tsx` (`ErrorState`) dan `not-found.tsx`. `frontend/hooks/` juga belum dibuat. Bila akan ditambahkan, perbarui bagian ini.

**Kepemilikan berkas** (satu berkas, satu pemilik; pihak lain mengubah lewat PR kecil):

| Area | Pemilik |
| --- | --- |
| `backend/app/{db/, models/, repositories/}` | Backend A |
| `backend/app/schemas/{agent_outputs, evidence, investigation}.py` | Backend A |
| `backend/app/agents/` (semua) | Backend A |
| `backend/app/services/{ai_cache, gemini_client, video_service, storage_service, policy_extractor}.py` | Backend A |
| `backend/data/cache/` | Backend A |
| `backend/app/main.py`, `core/` (config, errors, logging, security) | Backend B |
| `backend/app/api/` (semua router) | Backend B |
| `backend/app/schemas/{common, claim, metrics, ops, shipment}.py` | Backend B |
| `backend/app/services/{monitoring, claim_service, investigation_runner, audit, scheduler, settings_service, deadlines, connections, csv_import, demo_data}.py` | Backend B |
| `backend/data/mock/`, `seed.py`, `openapi.json`, `scripts/` | Backend B |
| `backend/Dockerfile`, `infra/`, `.github/`, `.gitignore`, `.env.example`, README | Backend B |
| `frontend/src/components/{ui, layout, shipments, dashboard}/`, root `layout.tsx`, `(dashboard)/layout.tsx` | Frontend A |
| `frontend/src/app/(dashboard)/{dashboard, shipments, couriers, settings, claims/page.tsx, reports}` | Frontend A |
| `frontend/src/lib/{api-client, api, auth, format, audit}.ts`, `types/`, `frontend/Dockerfile`, `next.config.ts` | Frontend A |
| `frontend/src/app/(auth)/login/`, `(dashboard)/{investigations, claims/[id], demo}` | Frontend B |
| `frontend/src/components/{investigation, claims}/`, `lib/{sse.ts, mock/}`, `not-found.tsx` | Frontend B |
| Video sampel (rekaman fisik) | Frontend B (lihat 15.5); diunggah ke GCS oleh Backend B |

Antarmuka antar-backend:

- Backend A menyediakan `build_root_agent()` dan fungsi `persist_outcome(state)` yang mengembalikan keputusan terstruktur.
- Backend B menjalankannya lewat `investigation_runner` dan membuat klaim lewat `claim_service`.
- Backend A tidak menyentuh router. Backend B tidak menyentuh agen dan prompt.
- Model data dimiliki Backend A; kebutuhan kolom baru dari Backend B diajukan lewat PR kecil.

## 10. Tech Stack

| Lapisan | Pilihan | Catatan |
| --- | --- | --- |
| Orkestrasi agen | Python 3.12, **Google ADK** (`google-adk==2.11.0`, di-pin) | Wajib dari panitia. Semua developer dan Dockerfile memakai versi yang sama; banyak tutorial daring masih memakai API 1.x |
| Model AI | Gemini `gemini-2.5-flash` di **Vertex AI** (`GOOGLE_GENAI_USE_VERTEXAI=true`, default `GCP_LOCATION=global`) | Dapat diganti lewat `GEMINI_MODEL`; autentikasi lewat service account, tanpa API key |
| Backend | FastAPI, Pydantic v2, SQLAlchemy 2, Uvicorn | |
| Penjadwal | APScheduler (in-process) | Berjalan aman karena satu instance dengan CPU selalu aktif |
| Video | FFmpeg (encode ulang H.264 `-preset ultrafast`) | Bukan stream copy: potongan akurat ke detik dan dapat diputar browser |
| Database | Cloud SQL Postgres (demo), SQLite (lokal) | Koneksi lewat Cloud SQL connector / socket Cloud Run |
| Penyimpanan | Cloud Storage | Signed URL untuk pemutar video |
| Secrets | Secret Manager | Password DB dan password demo |
| Frontend | Next.js (App Router, TypeScript strict, `output: standalone`), Tailwind CSS, Shadcn UI | |
| Data fetching | TanStack Query | |
| Real-time | SSE (EventSource) | |
| Kualitas kode | Ruff, pytest · ESLint, Prettier | mypy dan CI bersifat Could |
| Deployment | **Cloud Run** (dua service) via `gcloud run deploy --source` (Cloud Build) | Tidak memerlukan Docker lokal; Agent Engine tidak dipakai |
| Pengujian | pytest (unit, integrasi ADK dengan LLM di-*mock*, API end-to-end) · Ruff untuk lint | Tidak membutuhkan kredit Gemini; lihat 12.6 |

**Konfigurasi runtime (`app/core/config.py`, `pydantic-settings`, gagal cepat).** Variabel yang wajib/menentukan: `ENV` (`local`/`cloud`), `DATABASE_URL`, `CORS_ORIGINS`, `AUTH_REQUIRED`, `DEMO_PASSWORD`, `SESSION_SECRET`, `STORAGE_BACKEND`, `GCS_BUCKET`, `GCP_PROJECT`, `GCP_LOCATION`, `GEMINI_MODEL`, `AI_MODE`, `MIN_CONFIDENCE`, `MEDIUM_CONFIDENCE`, `SLA_GRACE_HOURS`, `SCAN_INTERVAL_MIN`, `SCHEDULER_ENABLED`, `FFMPEG_PATH`. Bila `ENV=cloud`, aplikasi **menolak start** jika `SESSION_SECRET`/`DEMO_PASSWORD` masih bernilai default.

Konfigurasi Cloud Run backend: `--min-instances=1 --max-instances=1 --no-cpu-throttling --timeout=3600 --memory=2Gi`, service account khusus dengan role `Vertex AI User`, `Cloud SQL Client`, `Storage Object Admin` (bucket proyek), `Secret Manager Secret Accessor`, serta `iam.serviceAccountTokenCreator` **pada dirinya sendiri** agar signed URL GCS dapat ditandatangani (signBlob) tanpa private key.

## 11. Kebutuhan Non-Fungsional

| ID | Kategori | Kebutuhan |
| --- | --- | --- |
| NFR-01 | Performa | Waktu dari mulai investigasi hingga draf klaim siap kurang dari 30 detik pada skenario demo (mode live); diukur pertama kali paling lambat Rabu 23.00 |
| NFR-02 | Keandalan | Dashboard stabil tanpa crash selama live demo; fallback cache bila Gemini gagal |
| NFR-03 | Kegunaan | UI intuitif, bahasa Indonesia sederhana untuk admin non-teknis |
| NFR-04 | Keamanan | Tidak ada secret di repo; Gemini lewat service account (tanpa API key); secret lain di Secret Manager; `.env.example` tersedia |
| NFR-05 | Keamanan | Validasi seluruh input; tools hanya menerima ID, bukan path; batasi durasi klip dan ukuran file |
| NFR-06 | Keamanan | CORS dibatasi ke URL frontend Cloud Run (dan localhost saat pengembangan); endpoint pemicu AI membutuhkan login |
| NFR-07 | Auditabilitas | Setiap aksi agen, keputusan manusia, dan pembatalan tercatat di `audit_logs` |
| NFR-08 | Observabilitas | Log terstruktur JSON ke stdout (terbaca Cloud Logging) dengan `request_id` dan `investigation_id`; trace agen tersimpan di `investigation_events` |
| NFR-09 | Aksesibilitas | Kontras memadai, navigasi keyboard, label ARIA pada komponen interaktif |
| NFR-10 | Responsif | Dashboard nyaman di laptop dan tablet |
| NFR-11 | Privasi | Video dan data pembeli hanya diproses di project GCP tim (Vertex AI, GCS, Cloud SQL); ada opsi hapus data investigasi |
| NFR-12 | Deployment | Seluruh sistem dapat diakses lewat URL Cloud Run; `/health` hijau; deploy ulang dapat dilakukan oleh minimal dua anggota tim |
| NFR-13 | Batasan skala | Backend satu instance (task registry, event bus, dan SSE di memori proses); batasan ini dinyatakan terbuka sebagai keputusan hackathon, dengan jalur produksi berupa Pub/Sub atau Redis |

## 12. Best Practices

### 12.1 Agentic AI dan LLM

- **HITL dijamin secara struktural**: agen tidak memiliki tool kirim; pengiriman hanya lewat endpoint approve dengan update atomik.
- **Structured output**: `output_schema` Pydantic untuk hasil vision, keputusan Evaluator, dan draf klaim.
- **Pisahkan keputusan deterministik dari LLM**: SLA dan stuck memakai aturan biasa; ambang confidence ditegakkan kode, bukan prompt.
- **Batasi langkah dan biaya**: batas panggilan tool per run (misalnya 8), timeout per tool, retry eksponensial di `gemini_client`, batas token.
- **Prompt sebagai aset**: instruksi agen di `agents/prompts/`, diversikan, dengan contoh (few-shot) format klaim.
- **Kurangi halusinasi**: narasi klaim hanya memakai fakta dari state; setelah Drafter selesai, kode memeriksa nomor resi dan timestamp yang dikutip memang ada di state; temuan dengan confidence rendah ditandai "perlu ditinjau".
- **Input eksternal tidak tepercaya**: teks pembeli atau kurir tidak pernah masuk ke `instruction`; tool tidak menerima path.
- **Evaluasi**: golden set 5 sampai 10 kasus dengan keputusan yang diharapkan, dijalankan setiap kali prompt berubah.

### 12.2 Pemrosesan Video

- FFmpeg encode ulang (`-ss` sebelum `-i`, `-t`, `-c:v libx264 -preset ultrafast -an`, resolusi maksimal 720p). Potongan akurat dan langsung dapat diputar browser.
- Kirim klip pendek (10 sampai 30 detik) ke Gemini sebagai URI `gs://`; tidak perlu Files API.
- Cache hasil analisis berdasarkan hash (URI sumber + offset + versi prompt + focus).
- Klip sementara di `/tmp` (memori Cloud Run) dihapus segera setelah diunggah.

### 12.3 Backend

- Arsitektur berlapis: router → service → repository.
- Investigasi berjalan sebagai `asyncio.Task`; endpoint langsung mengembalikan ID; Cloud Run wajib `--no-cpu-throttling` agar task tetap jalan setelah respons terkirim.
- Idempotensi approve/reject lewat update atomik bersyarat status (409).
- Konfigurasi lewat `pydantic-settings`; gagal cepat bila variabel wajib hilang.
- Pin versi dependensi (lockfile).

### 12.4 Frontend

- Server Components untuk halaman statis, Client Components untuk SSE, player, dan form.
- Tipe API didefinisikan manual di `frontend/src/types/api.ts` dan dijaga selaras dengan `backend/openapi.json`; `openapi-typescript` belum dipakai (Could).
- Klien API tunggal (`lib/api-client.ts`) dengan auth Bearer, penanganan 401 (redirect login) dan 409 (muat ulang); mode mock opsional lewat `NEXT_PUBLIC_API_MOCK=1`.
- Tangani semua state: loading (skeleton), kosong, error, sukses.
- Tampilkan **alasan** di balik keputusan AI (keputusan, temuan, timestamp, confidence, sumber live/cache) beserta label data simulasi.
- Tombol persetujuan menampilkan ringkasan dan konfirmasi; nonaktif saat request berjalan.

### 12.5 Keamanan dan Secrets

- `.env`, `storage/`, `*.db` masuk `.gitignore`; `.env.example` tanpa nilai asli.
- Gemini memakai service account Cloud Run; tidak ada kunci API Gemini di mana pun.
- Password DB dan password demo di Secret Manager, dipasang sebagai env var Cloud Run.
- IAM: PIC GCP memberi role yang cukup (Editor atau role spesifik) kepada anggota yang bertugas deploy; tidak membagikan kredensial akun pribadi.
- Pre-commit gitleaks bersifat Should.

### 12.6 Pengujian

- Unit test aturan SLA, tool video (fixture video pendek), penjaga confidence, dan transisi status klaim (termasuk 409).
- Integration test run ADK dengan model di-mock (callback cache) untuk ketiga skenario.
- API end-to-end: kontrak endpoint, SSE + replay `Last-Event-ID`, cancel, HITL approve/reject, impor CSV, dan auth.
- Per 22 Oktober 2026: **49 test lulus** tanpa kredit Gemini (`pytest -q`, ±10 detik), `ruff check` bersih.
- Smoke test end-to-end skenario A pada URL Cloud Run (**belum dijalankan** — lihat §19).
- Dry run demo minimal 3 kali sebelum presentasi.
- **Golden-set** keputusan Evaluator: 5–10 kasus dengan keputusan harapan, dijalankan setiap prompt berubah (**belum ada**, §19).

### 12.7 DevOps dan Kolaborasi

- **Deploy awal, deploy sering**: hello world di Cloud Run paling lambat Rabu 17.00, lalu deploy ulang di setiap checkpoint.
- `gcloud run deploy --source` (Cloud Build); tidak perlu Docker lokal di Windows.
- Lokal: `uvicorn` + `npm run dev` dengan SQLite dan storage lokal; dokumentasikan di README (setup kurang dari 5 menit).
- Git: branch per fitur, commit konvensional, PR kecil; `main` selalu dapat di-deploy.
- **Sinkronisasi dokumen:** PR yang mengubah endpoint, tabel, rute, atau `RuntimeSettings` wajib memperbarui §4/§5/§6/§8 dan menjalankan `backend/scripts/export_openapi.py`.

## 13. Strategi Keandalan Demo (NFR-01 dan NFR-02)

- **Mode AI** (`settings.ai_mode`):
  - `live`: selalu memanggil Gemini.
  - `auto` (default demo): Gemini dengan timeout, lalu fallback ke cache bila gagal.
  - `cache`: hanya cache.

  Setiap hasil membawa label `source` (FR-21).
- **Fallback dua lapis**, karena di ADK setiap langkah agen adalah panggilan LLM:
  1. Tool `analyze_media` membaca cache hasil vision.
  2. Callback model agen (`before_model_callback` untuk mode `cache`; penanganan error model untuk mode `auto`, mekanisme persisnya diverifikasi pada versi ADK yang di-pin) mengembalikan respons LLM yang telah direkam untuk Investigator, Evaluator, dan Drafter.
- **Rekam lalu putar ulang**: setiap skenario demo dijalankan sekali dalam mode live, lalu respons tiap agen dan tool disimpan ke `data/cache/` dan di-commit sebelum pembekuan.
- **Instance hangat**: `min-instances=1` menghilangkan cold start.
- **Paralelisasi yang benar**: jalur terpanjang adalah potong CCTV → analisis klip (berurutan). Analisis unboxing dan pengambilan kebijakan kurir dapat berjalan bersamaan bila model memanggil beberapa tool dalam satu giliran.
- **Mode demo terkunci**: scheduler mati, data reset deterministik.
- **Rencana cadangan**: seluruh sistem dapat dijalankan lokal; rekaman layar demo sukses; koneksi internet kedua.

Estimasi anggaran waktu skenario A: konteks kasus kurang dari 1 detik, potong dan unggah klip 2 sampai 4 detik, analisis vision 5 sampai 12 detik, tiga sampai empat giliran Investigator 4 sampai 6 detik, Evaluator 2 sampai 4 detik, Drafter 3 sampai 5 detik. Total 17 sampai 31 detik, jadi target 30 detik ketat dan harus diukur sejak awal.

## 14. Skenario Demo dan Kriteria Penerimaan

| Skenario | Langkah | Kriteria lulus |
| --- | --- | --- |
| A. Paket stuck / hilang (utama) | Scan → resi melewati SLA ditandai `lost` → investigasi → CCTV dipotong di jam scan packing → analisis membuktikan barang dikemas → keputusan `claim` → draf klaim | Klip tampil dan dapat diputar, keputusan dan alasan tampil, draf memuat nomor resi + kronologi + ketentuan kurir, total waktu di bawah 30 detik |
| B. Paket rusak (opsional) | Laporan pembeli → analisis video unboxing → temuan kerusakan dengan timestamp → keputusan `claim` → draf | Verdict `damaged` dengan confidence dan timestamp ditampilkan, ketentuan kurir terlampir |
| C. Retur curang (opsional) | Video unboxing pembeli dibandingkan dengan klip packing → tidak konsisten → keputusan `fraud_suspect` | Tidak ada klaim ke kurir; UI menyarankan menolak retur dan menampilkan temuan perbandingan |
| D. Persetujuan HITL (bagian dari A) | Pemilik membuka draf → edit → klik Setujui | Status `submitted` (berlabel simulasi), tercatat di audit log; klik ganda menghasilkan 409 tanpa duplikat |
| E. Kegagalan AI | Mode `auto` dengan Gemini diblokir (timeout paksa) | Sistem memakai cache berlabel "cache", alur selesai, dashboard tidak crash |
| F. Hentikan Agen | Mulai investigasi → klik Hentikan Agen | Status `cancelled` dalam waktu kurang dari 2 detik, event `cancelled` tampil, tercatat di audit log |

## 15. Rencana Pengerjaan

> **Catatan status:** bagian ini adalah **rencana kerja asli** dan dipertahankan sebagai catatan proses. Sebagian besar item sudah selesai. Nama komponen frontend di sini (mis. `AgentTrace`, `ApprovalBar`, `ClaimDraftViewer`) adalah nama **rencana** yang berganti saat implementasi — daftar komponen yang benar ada di §5 dan §9. Status terkini dan celah yang tersisa ada di **§19**.

Hacking dimulai Rabu 13.00. Jam 0–2 bertabrakan dengan mentoring (14.00–16.00), sehingga checkpoint Fondasi digeser ke 16.00.

| Jam | Waktu (WIB) | Fokus | Output |
| --- | --- | --- | --- |
| 0–3 | Rabu 13.00–16.00 | Setup repo, setup GCP, skema DB, skeleton FastAPI dan Next.js, kontrak API, design spike | Proyek lokal berjalan kosong; kontrak dan token desain dibekukan |
| 3–4 | Rabu 16.00–17.00 | **Deploy pertama** | `/health` dan halaman kosong di Cloud Run, terhubung Cloud SQL, satu panggilan Gemini via Vertex berhasil |
| 4–6 | Rabu 17.00–19.00 | Monitoring, endpoint resi, halaman resi, rekam video sampel | FR-01, FR-02, FR-09 |
| 6–10 | Rabu 19.00–23.00 | Tools video & vision, ekstraksi kebijakan, agen Investigator; dashboard | FR-03, FR-04, FR-05, FR-10; ukur NFR-01 pertama |
| 10–15 | Rabu 23.00–Kamis 04.00 | Evaluator + Drafter, runner + SSE + cancel, klaim & HITL; halaman investigasi live | FR-06, FR-07, FR-11, FR-20, FR-22 |
| 15–19 | Kamis 04.00–08.00 | Review klaim, mode demo, metrik, label sumber, cache rekam-putar | FR-13, FR-14, FR-17, FR-18, FR-21 |
| 19–22 | Kamis 08.00–11.00 | Pengujian skenario A–F di Cloud Run, perbaikan bug; fitur baru dihentikan | NFR-01, NFR-02 |
| 22–24 | Kamis 11.00–13.00 | Pembekuan: tes akhir dan tag versi beku | Versi beku sebelum 13.00 |

Timer berjalan saat mentoring (Rabu 14.00–16.00 dan 19.00–21.00; Kamis 09.30–10.00 dan 10.30–12.00), makan, ibadah, dan istirahat. Empat orang bergiliran istirahat; minimal satu orang di kanal backend dan satu di kanal frontend sepanjang waktu, **dan minimal satu orang yang aktif selalu mampu men-deploy**.

Prioritaskan semua kebutuhan **Must**. Skenario B dan C dikerjakan hanya bila skenario A berjalan di Cloud Run sebelum Kamis 04.00. Fitur **Could** (FR-15, FR-16) dianulir lebih dulu bila waktu kurang.

### 15.1 Pembagian Tugas

- **PIC GCP (zizadhrmaa)**: setup project panitia, billing/kredit, API, IAM, Cloud SQL, bucket, kuota Vertex. Bila PIC GCP juga salah satu dari empat developer, tugas ini dikerjakan di jam 0–3 sebelum tugas peran.
- **Backend A — Agen & AI**: model data, agen ADK, prompt, tools video/vision, Gemini, cache dan fallback.
- **Backend B — Domain, API & Ops**: kontrak API, monitoring, runner + SSE + cancel, klaim & HITL, demo & metrik, audit, Dockerfile & deploy.
- **Frontend A — Design System & Halaman Data**: token, komponen `ui/`, layout, resi, dashboard, kurir, pengaturan, daftar klaim, deploy frontend.
- **Frontend B — Alur Live, HITL & Demo**: investigasi live (SSE), review klaim, demo, login, komponen investigasi & klaim, **rekaman video sampel**.

**Aturan kerja bersama**

| Aturan | Penjelasan |
| --- | --- |
| Kontrak API dulu | Jam 0–3 Backend B mempublikasikan `openapi.json` dan contoh respons; frontend membangun di atas MSW |
| Kontrak berubah lewat PR | Perubahan `openapi.json` lewat PR kecil dengan reviewer Backend B; frontend generate ulang tipe setelah merge |
| Kepemilikan berkas | Sesuai tabel bagian 9; titik rawan adalah `models/`, `main.py`, dan `components/ui/`, jadi perubahan di sana lewat PR kecil |
| Mock data milik Backend B | Frontend menyalin dari `data/mock/`, tidak mengarang data berbeda |
| Git | Branch `feat/<area>-<nama>`, PR kecil, merge ke `main` di setiap checkpoint; `main` selalu dapat di-deploy |
| Secret | Tidak ada secret di repo; akses GCP lewat IAM, bukan berbagi kata sandi |
| Komunikasi | Sinkron 5 menit berempat di setiap checkpoint; blocker dilaporkan langsung |

**Checkpoint integrasi**

| Waktu (WIB) | Checkpoint | Kriteria lulus |
| --- | --- | --- |
| Rabu 16.00 | Fondasi | Repo berjalan lokal; `/health` dan halaman kosong; kontrak API dipublikasikan; token desain dibekukan; GCP siap (API aktif, Cloud SQL dan bucket dibuat, IAM dibagikan) |
| Rabu 17.00 | Deploy pertama | Kedua service hidup di Cloud Run; backend terhubung Cloud SQL dan berhasil memanggil Gemini via Vertex |
| Rabu 19.00 | Monitoring | Resi dan flag anomali tampil di `/shipments` dari backend (lokal dan Cloud Run); video sampel tersedia di GCS |
| Rabu 23.00 | Tools AI | Klip CCTV dan hasil vision tampil di UI sementara; Investigator memanggil tools; waktu pertama NFR-01 tercatat |
| Kamis 04.00 | Agen lengkap | Alur resi sampai draf klaim berjalan di Cloud Run; SSE mengalir; Hentikan Agen berfungsi |
| Kamis 08.00 | Fitur lengkap | Skenario A, D, E, F lulus end-to-end di Cloud Run; restyle desain selesai |
| Kamis 11.00 | Dry run dan kode beku | Satu putaran demo penuh tanpa error; cache rekam-putar di-commit; setelahnya hanya perbaikan kendala eksekusi |

### 15.2 Checklist PIC GCP (jam 0–3)

- [ ] Pasang gcloud CLI; `gcloud auth login` dan `gcloud auth application-default login` dengan akun panitia
- [ ] Pastikan billing/kredit project aktif
- [ ] Aktifkan API: Cloud Run, Cloud Build, Artifact Registry, Cloud SQL Admin, Cloud Storage, Vertex AI, Secret Manager
- [ ] Buat Cloud SQL Postgres tier terkecil (mulai paling awal karena provisioning 5–10 menit), database `claimguard`, user aplikasi
- [ ] Buat bucket GCS (region sama dengan Cloud Run)
- [ ] Verifikasi kuota dan region model Gemini di Vertex AI; uji satu panggilan
- [ ] Buat service account backend dengan role di bagian 10
- [ ] Berikan IAM kepada anggota tim yang men-deploy (minimal Backend B dan Frontend A)
- [ ] Simpan password DB dan password demo di Secret Manager
- [ ] Catat semua nama resource di `infra/setup-gcp.md` (tanpa secret)

### 15.3 Checklist Backend A (Agen & AI)

**Fase 0 (Rabu 13.00–16.00)**

- [ ] Model SQLAlchemy untuk semua tabel bagian 8, `db/session.py` (SQLite lokal, Postgres via env)
- [ ] Repository dasar: shipments, tracking_events, pack_scan_logs, media_assets, anomalies, investigations, evidence
- [ ] `gemini_client.py` minimal: satu panggilan Gemini via Vertex berhasil (dipakai untuk uji deploy)
- [ ] Pin versi `google-adk` dan `google-genai` di `pyproject.toml`

**Fase 1 (Rabu 16.00–19.00)**

- [ ] `storage_service.py` (GCS + lokal, signed URL)
- [ ] `video_service.py` + tool `clip_cctv_video` (encode ulang H.264, input ID saja) — FR-03, NFR-05
- [ ] Unit test tool video dengan fixture video pendek

**Fase 2 (Rabu 19.00–23.00)**

- [ ] Tool `analyze_media` dengan structured output dan cache — FR-04, FR-10, FR-21
- [ ] `policy_extractor.py` (dipanggil `seed.py`) — FR-05
- [ ] Tool `get_case_context`, `get_courier_policy`
- [ ] Agen Investigator dengan prompt per `case_type`; uji run ADK lokal (`adk web` boleh dipakai untuk debug)
- [ ] Ukur waktu skenario A pertama kali — NFR-01

**Fase 3 (Rabu 23.00–Kamis 04.00)**

- [ ] Agen Evaluator (`output_schema` keputusan) dan Drafter (`output_schema` draf) — FR-06, FR-22
- [ ] `build_root_agent()` (SequentialAgent) dan callback skip Drafter
- [ ] Penjaga confidence deterministik dan validasi fakta draf — FR-12
- [ ] `after_tool_callback` yang memancarkan event untuk runner milik Backend B — FR-11
- [ ] Batas panggilan tool per run dan timeout

**Fase 4 (Kamis 04.00–08.00)**

- [ ] `ai_cache.py` + callback fallback model (mode `live`/`auto`/`cache`) — NFR-02
- [ ] Rekam respons live skenario A (lalu B, C bila ada) ke `data/cache/`
- [ ] Golden set dan integration test run ADK dengan model di-mock

**Fase 5 (Kamis 08.00–11.00)**

- [ ] Optimasi waktu bila NFR-01 belum tercapai (resolusi klip, panjang prompt, jumlah giliran)
- [ ] Perbaikan bug dari dry run pada agen dan tools

### 15.4 Checklist Backend B (Domain, API & Ops)

**Fase 0 (Rabu 13.00–16.00)**

- [ ] Inisialisasi repo, `.gitignore`, `.env.example` — NFR-04
- [ ] `main.py`, `core/config.py`, CORS, `/health`, format error seragam
- [ ] Publikasikan `openapi.json` dan contoh respons seluruh endpoint bagian 6
- [ ] `data/mock/shipments.json`: 15 sampai 20 resi mencakup skenario A, B, C, plus log scan dan pemetaan media
- [ ] Dokumen kebijakan kurir tiruan (JNE, J&T, SiCepat) di `data/mock/courier_policies/`

**Fase 1 (Rabu 16.00–19.00)**

- [ ] `backend/Dockerfile` (python:3.12-slim + ffmpeg) dan `infra/deploy-api.sh`; **deploy pertama paling lambat 17.00** — NFR-12
- [ ] `seed.py` (idempoten, `is_simulated = true`) — FR-01, FR-21
- [ ] `services/monitoring.py`: aturan anomali dengan kode, severity, `case_type` — FR-02, FR-09
- [ ] Endpoint `GET /shipments`, `GET /shipments/{id}`, `POST /monitoring/scan`, `GET /anomalies`
- [ ] Unggah video sampel (dari Frontend B) ke GCS dan petakan di seed
- [ ] Unit test aturan SLA

**Fase 2 (Rabu 19.00–23.00)**

- [ ] `GET /couriers/policies`, `GET /evidence/{id}/media` (signed URL)
- [ ] `GET/PATCH /settings`, `POST /auth/login` (password dari Secret Manager) — FR-19
- [ ] Scheduler APScheduler, nonaktif di mode demo — FR-08
- [ ] `services/audit.py` dan `GET /audit-logs` — NFR-07

**Fase 3 (Rabu 23.00–Kamis 04.00)**

- [ ] `investigation_runner.py`: task registry, menjalankan ADK Runner, pemetaan event ke `investigation_events`
- [ ] `POST /investigations`, `GET /investigations`, `GET /investigations/{id}`, SSE `/stream` dengan `Last-Event-ID` — FR-11
- [ ] `POST /investigations/{id}/cancel` — FR-20
- [ ] `claim_service.py`: `create_from_draft`, `submit_claim` (simulasi), transisi status atomik — FR-07, FR-14
- [ ] Endpoint klaim: list, detail, PATCH, approve (409), reject (409) — FR-13
- [ ] Deploy ulang ke Cloud Run dan uji alur di sana

**Fase 4 (Kamis 04.00–08.00)**

- [ ] `GET /metrics/summary` — FR-18
- [ ] `POST /demo/scenario/{name}` dan `POST /demo/reset` — FR-17
- [ ] Log JSON dengan `request_id` dan `investigation_id` — NFR-08

**Fase 5 (Kamis 08.00–11.00)**

- [ ] Smoke test skenario A, D, E, F di Cloud Run
- [ ] `openapi.json` final disinkronkan ke frontend
- [ ] Perbaikan bug dari dry run

### 15.5 Checklist Frontend A (Design System & Halaman Data)

**Fase 0 (Rabu 13.00–16.00)**

- [ ] Inisialisasi Next.js (TypeScript strict, `output: standalone`), Tailwind, Shadcn UI, ESLint, Prettier
- [ ] **Design spike** bersama Frontend B: token warna, tipografi, spacing, radius di `styles/` dan `components/ui/`
- [ ] Layout dashboard: sidebar, topbar
- [ ] `lib/api-client.ts` dan `types/` dari `openapi.json`

**Fase 1 (Rabu 16.00–19.00)**

- [ ] `frontend/Dockerfile` dan `infra/deploy-web.sh`; deploy pertama paling lambat 17.00 — NFR-12
- [ ] `/shipments`: tabel, filter, pencarian, `StatusBadge`, paginasi
- [ ] `/shipments/[id]`: `ShipmentTimeline`, `AnomalyCard`, tombol "Investigasi dengan AI", tautan investigasi/klaim terakhir
- [ ] State loading, kosong, error pada tabel

**Fase 2 (Rabu 19.00–23.00)**

- [ ] `/dashboard`: `StatCard`, `TrendChart`, `AgentActivityFeed`, tombol "Scan Sekarang" — FR-18, FR-08
- [ ] `/couriers` (`PolicyCard`) — FR-05
- [ ] `/settings` (`SettingsForm`, termasuk mode AI)
- [ ] Label "Data simulasi" pada KPI dan tabel — FR-21

**Fase 3 (Rabu 23.00–Kamis 04.00)**

- [ ] `/claims` dengan `ClaimTable` (`components/claims/ClaimTable.tsx`, pengecualian kepemilikan per berkas) — FR-14
- [ ] Ganti MSW dengan backend nyata endpoint demi endpoint (resi, anomali, metrik, kurir, settings)
- [ ] Terapkan desain akhir bila sudah tersedia

**Fase 4–5 (Kamis 04.00–11.00)**

- [ ] `NotificationBell` (Could) — FR-16
- [ ] Aksesibilitas, responsif, konsistensi bahasa — NFR-03, NFR-09, NFR-10
- [ ] Tidak ada error console di halaman data pada alur demo

### 15.6 Checklist Frontend B (Alur Live, HITL & Demo)

**Fase 0 (Rabu 13.00–16.00)**

- [ ] Ikut design spike bersama Frontend A
- [ ] MSW handler untuk `/investigations`, `/claims`, dan SSE palsu (memutar ulang event dari JSON)
- [ ] Data mock investigasi (event trace, temuan, keputusan) dan klaim

**Fase 1 (Rabu 16.00–19.00)**

- [ ] **Rekam video sampel paling lambat 18.00** (serahkan ke Backend B dan Backend A):
  - CCTV packing skenario A dengan overlay jam yang jelas dan label resi terlihat;
  - unboxing barang rusak (B);
  - unboxing yang isinya berbeda dengan packing (C);
  - semua 10–60 detik, tanpa wajah atau data pribadi nyata.
- [ ] `/login` — FR-19
- [ ] `AgentTrace` presentasional dengan data mock

**Fase 2 (Rabu 19.00–23.00)**

- [ ] `EvidencePlayer` (signed URL, lompat ke timestamp temuan), `VisionFindings`, `DecisionCard`
- [ ] Kerangka `/investigations/[id]` dengan state loading, error, kosong
- [ ] `/demo` dengan `ScenarioLauncher` dan reset — FR-17

**Fase 3 (Rabu 23.00–Kamis 04.00)**

- [ ] `lib/sse.ts` (EventSource, reconnect dengan `Last-Event-ID`, cleanup)
- [ ] Sambungkan `/investigations/[id]` ke SSE nyata — FR-11
- [ ] Tombol **Hentikan Agen** dengan konfirmasi — FR-20
- [ ] Lencana `Live`/`Cache` pada hasil AI — FR-21

**Fase 4 (Kamis 04.00–08.00)**

- [ ] `/claims/[id]`: `ClaimDraftViewer`, `ConfidenceMeter`, edit narasi, **Tolak** dengan alasan — FR-06, FR-13
- [ ] `ApprovalBar`: **Setujui & Kirim** dengan dialog konfirmasi, nonaktif saat request berjalan, penanganan 409 — FR-07
- [ ] Label "Data simulasi" pada hasil submit — FR-21

**Fase 5 (Kamis 08.00–11.00)**

- [ ] Rekaman layar demo sukses sebagai cadangan
- [ ] Uji skenario E dan F dari sisi UI — NFR-02
- [ ] Aksesibilitas dan responsif untuk player, SSE, dialog — NFR-09, NFR-10

### 15.7 Checklist Bersama

- [ ] Jam 0: sepakati kontrak API, nama skenario (`lost`, `damaged`, `return_fraud`), format waktu (UTC ISO 8601), token desain
- [ ] Setiap checkpoint: merge ke `main`, deploy ke Cloud Run, jalankan alur dari awal di URL Cloud Run
- [ ] Skenario A, D, E, F lulus (B dan C bila sempat)
- [ ] Dry run demo penuh minimal 3 kali, termasuk skenario E
- [ ] README: jalan lokal kurang dari 5 menit dan langkah deploy
- [ ] Tidak ada secret di repo maupun riwayat commit — NFR-04
- [ ] Slide dan naskah demo: satu orang bicara, satu mengoperasikan, dua siaga bug

**Fase 6, Pembekuan Versi (Kamis 11.00–13.00)**

- [ ] Smoke test skenario A dan E di Cloud Run
- [ ] Hentikan perubahan kode, prompt, konfigurasi, dan data uji sebelum Kamis 13.00
- [ ] Git tag versi beku; catat revisi Cloud Run yang aktif dan waktunya
- [ ] Setelah pembekuan: perbaikan hanya untuk kendala eksekusi dengan izin PIC teknis, dicatat per perubahan

## 16. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Deploy baru dicoba di akhir | Demo gagal di cloud | Deploy pertama Rabu 17.00, deploy ulang tiap checkpoint |
| Kuota atau region Vertex tidak cukup | Gemini gagal | Verifikasi di jam pertama; region model terpisah dari region Cloud Run bila perlu; cache rekam-putar |
| Latensi Gemini | NFR-01 gagal | Klip pendek 720p, URI `gs://`, ukur sejak Rabu 23.00, cache |
| Perbedaan versi ADK antar developer | Kode tidak kompatibel | Versi di-pin di lockfile; jangan menyalin contoh 1.x mentah-mentah |
| Background task membeku di Cloud Run | Investigasi macet | `--no-cpu-throttling`, min=max=1 |
| Video sampel terlambat | FR-03/FR-04 tidak teruji | PIC Frontend B, tenggat Rabu 18.00 |
| Hasil Vision AI tidak konsisten | Keputusan salah | Structured output, penjaga confidence, tinjauan manusia wajib |
| Timestamp CCTV tidak sinkron | Klip salah | Overlay jam pada rekaman, margin pre/post, encode ulang yang akurat |
| Scope terlalu besar | Fitur tidak selesai | MoSCoW; B dan C opsional; Could dianulir dulu |
| Kredensial GCP bocor | Penyalahgunaan kredit panitia | IAM per anggota, tanpa kunci di repo, service account khusus |
| Prompt injection dari teks eksternal | Agen menyimpang | Teks eksternal tidak masuk instruksi, tools hanya menerima ID, agen tanpa tool kirim |
| Endpoint pemicu AI dipanggil berulang saat demo | Kredit Vertex terkuras / antrean penuh | Login wajib untuk endpoint tulis (FR-19), guard investigasi ganda (409), tombol nonaktif saat request berjalan. **Rate limiting belum ada** |
| `data/samples/` kosong | Investigasi berhenti di `clip_cctv_video` | Rekam 5 video sesuai `docs/data-dummy-dan-video.md` §2 sebelum pembekuan |
| `data/cache/` kosong | Fallback mode `auto` tidak berfungsi saat Gemini gagal | Rekam ketiga skenario dalam `AI_MODE=live` lalu commit |
| Data demo terasa "sudah diatur" | Juri menganggap hasil palsu | Label `is_simulated`/`source` di semua keluaran; siapkan skenario E (Gemini gagal) dan F (cancel) untuk menunjukkan perilaku nyata |

## 17. Matriks Keterlacakan Ringkas

| Kebutuhan | Komponen | Halaman | Endpoint |
| --- | --- | --- | --- |
| FR-01, FR-02, FR-09 | `services/monitoring.py` | `/shipments`, `/dashboard` | `/shipments`, `/monitoring/scan`, `/anomalies` |
| FR-03, FR-04, FR-05, FR-10 | Investigator + tools | `/investigations/[id]` | `/investigations`, `/investigations/{id}/stream`, `/evidence/{id}/media` |
| FR-22, FR-12 | Evaluator + penjaga confidence | `/investigations/[id]` | `/investigations/{id}` |
| FR-06 | Drafter + `claim_service.create_from_draft` | `/claims/[id]` | `/claims/{id}` |
| FR-07, FR-13, FR-14 | `claim_service` (update atomik) | `/claims`, `/claims/[id]` | `/claims/{id}/approve`, `/reject`, `PATCH /claims/{id}` |
| FR-08, FR-27 | `scheduler.py`, `settings_service`, `courier_thresholds` | `/settings` | `/monitoring/scan`, `/settings/courier-thresholds` |
| FR-11 | `investigation_runner`, `investigation_events` | `/investigations/[id]` | `/investigations/{id}/stream` |
| FR-17 | `demo_data.py` | `/demo` | `/demo/scenario/{name}`, `/demo/reset` |
| FR-18, FR-24 | `metrics.py`, daftar klaim | `/dashboard`, `/reports` | `/metrics/summary`, `/claims` |
| FR-19 | `core/security.py`, `api/deps.py` | `/login` | `/auth/login` |
| FR-20 | `investigation_runner.cancel` | `/investigations/[id]` | `/investigations/{id}/cancel` |
| FR-21 | `ai_cache`, kolom `source`/`is_simulated` | Semua halaman | Respons API dan event SSE |
| FR-23 | `services/deadlines.py` | `/shipments/[id]`, `/claims`, `/claims/[id]` | `claim_deadline` pada `/shipments`, `/claims` |
| FR-25 | `services/csv_import.py` | `/settings/connections` | `/shipments/import`, `/shipments/import/template` |
| FR-26 | `services/connections.py` | `/settings/connections` | `/connections`, `/connections/{id}` |
| NFR-11 | hapus/purge investigasi, retensi | `/settings/privacy` | `DELETE /investigations/{id}`, `/investigations/purge` |

## 18. Catatan Perubahan

**Versi 2.5 (22 Oktober 2026) — alur login disempurnakan**

- **Endpoint baru:** `GET /auth/session` (status sesi dari cookie, tanpa membocorkan token) dan `POST /auth/logout` (204). Total kini **34 operasi / 29 path**.
- **Sesi diverifikasi di server:** `app/(dashboard)/layout.tsx` memanggil `/auth/session` sebelum HTML dikirim, sehingga halaman tidak lagi sempat berkedip untuk pengguna tanpa sesi. `/login` otomatis mengalihkan ke `/dashboard` bila sudah masuk.
- **Halaman login:** field email akun demo, tautan **"Lupa kata sandi?"** (menjelaskan jalur PIC, bukan form reset palsu), dan tombol **"Coba sebagai juri"** yang digerakkan `NEXT_PUBLIC_DEMO_PASSWORD`.
- **Logout terpusat** di `hooks/use-logout.ts`: menghapus cookie backend + token lokal, lalu menyegarkan penjaga di server.
- **Pembatasan yang dinyatakan:** registrasi, akun per pengguna, dan reset lewat email **tidak** dibuat (lihat §19 nomor 10). Paywall/subscription juga tidak dibuat (nomor 11).

**Bug produksi yang ditemukan saat deploy (22 Okt)** — semuanya sudah diperbaiki:

1. **`CORS_ORIGINS` membuat container gagal start.** `cors_origins` bertipe `list[str]`, dan pydantic-settings mem-parsing env sebagai JSON; skrip mengirim URL mentah → `SettingsError`. Artinya deploy dengan CORS **selalu** gagal dan CORS tidak pernah aktif. Kini `deploy-api.sh` mengubah daftar koma menjadi JSON array.
2. **Juri terlempar balik ke `/login` setelah berhasil masuk.** Layout memakai hasil render/RSC yang masih "belum login" karena `router.replace()` berjalan sebelum `router.refresh()`. Diperbaiki dengan urutan `refresh()` → `replace()`, `export const dynamic = "force-dynamic"`, dan Bearer cadangan di `getServerSession()`.
3. **Verifikasi bundle `deploy-web.sh` memberi "GAGAL" palsu.** Skrip memindai `/settings`, yang kini 307 ke `/login` dan tidak memuat chunk aplikasi. Diperbaiki dengan memindai `/login`.
4. **Login berhasil tetapi pengguna terpental balik ke `/login` (akar masalah sebenarnya).** Cookie `cg_session` diset oleh **domain API**, sedangkan guard server berjalan di **domain web**. `cookies()` di Server Component hanya membaca cookie milik host web, sehingga guard selalu melihat "belum login". Token di `localStorage` tidak menolong karena tidak dikirim ke web.
   **Perbaikan:** sesi kini **first-party**. Route handler `app/api/auth/login` meneruskan kredensial ke API lalu menyetel cookie httpOnly di domain web; `app/api/auth/logout` menghapusnya. Tidak ada lagi token di storage browser.
5. **SSE 401 setelah sesi first-party.** `EventSource` memanggil domain API yang tidak lagi memegang cookie sesi. Ditambahkan proxy `app/api/stream/[id]` yang meneruskan cookie web ke API tanpa buffering (termasuk `Last-Event-ID`).
6. **Celah: `GET /investigations/{id}/stream` terbuka tanpa login.** Endpoint tidak memakai dependency `User`, padahal stream memuat isi investigasi. Kini wajib sesi (NFR-06), dengan test regresi.

**Versi 2.4 (22 Oktober 2026) — sinkronisasi dokumen dengan kode**

Dokumen sebelumnya (v2.3) ditulis sebagai *rencana*. Setelah implementasi, beberapa bagian tertinggal dari kode. v2.4 menutup selisih itu tanpa mengubah arsitektur agen.

- **§4:** ditambahkan FR-23 (tenggat klaim), FR-24 (laporan uang pulih), FR-25 (impor CSV), FR-26 (koneksi & drift kamera), FR-27 (ambang tertahan per kurir). Semuanya sudah berjalan di kode tetapi belum tercatat.
- **§5:** tabel rute frontend diperluas: `/reports`, `/settings/connections`, `/settings/privacy`, `/settings/audit-log`, dan `/settings/account`; nama komponen disesuaikan dengan nama berkas nyata; dicatat mode mock frontend.
- **§6:** delapan operasi yang hilang ditambahkan (`/shipments/import`, `/shipments/import/template`, `DELETE /investigations/{id}`, `/investigations/purge`, `/settings/courier-thresholds` GET & PUT, `/connections` GET & PATCH). Total kini **32 operasi / 27 path**, sesuai `openapi.json`. Kebijakan auth per endpoint dinyatakan eksplisit.
- **§7:** layanan baru didaftarkan (`deadlines`, `csv_import`, `connections`, `settings_service`, `demo_data`).
- **§8:** model data dikoreksi: `uri` (bukan `gcs_uri`), `media_assets.description`, `claims.draft_json`, `investigations.case_type`/`error`, `courier_policies.extra_json`/`extraction_source`, serta tabel `courier_thresholds`. Dicatat bahwa tenggat klaim adalah nilai terhitung, bukan kolom.
- **§9:** struktur direktori ditulis ulang dari berkas nyata; `docs/architecture.md` dan `frontend/mocks/` (MSW) yang tidak ada dihapus; `router ops.py`, `agents/outcome.py`, `scripts/`, `.github/workflows/` ditambahkan. Kepemilikan berkas diselaraskan.
- **§10:** versi ADK dan model di-pin (`google-adk==2.11.0`, `gemini-2.5-flash`); daftar variabel environment pokok dan syarat startup `ENV=cloud` dicatat; role IAM `serviceAccountTokenCreator` ditambahkan.
- **§16:** risiko baru: rate limiting yang belum ada, video sampel dan cache AI kosong, serta risiko persepsi "data diatur".
- **§17:** matriks keterlacakan diperluas untuk FR-23 s.d. FR-27 dan NFR-11.
- **§19** (baru): daftar celah yang diketahui pada versi beku.

**Versi 2.3 (21 Oktober 2026)**

- Orkestrasi diganti dari LangGraph ke **Google ADK** (wajib panitia): `SequentialAgent` Investigator → Evaluator → Drafter. Checkpointer, node interrupt, dan resume dihapus.
- **Deploy ke Google Cloud** (wajib panitia): Cloud Run (backend satu instance, CPU selalu aktif), Cloud SQL Postgres, Cloud Storage, Vertex AI, Secret Manager. Vercel, docker-compose, dan Alembic dihapus.
- **Monitoring dipisah dari agen**: node `scan_shipments` dan `triage` dihapus dari graf; monitoring menjadi layanan deterministik yang menulis `anomalies` beserta `case_type`.
- **HITL lewat status DB**: agen tidak memiliki tool `submit_claim`; approve memakai update atomik bersyarat status. Tool confirmation ADK sengaja tidak dipakai (eksperimental, tidak persisten).
- Ditambahkan **FR-22** (keputusan Evaluator: `claim`/`needs_evidence`/`fraud_suspect`) sebagai titik keputusan agentic yang eksplisit.
- FR-14: status klaim disederhanakan menjadi `pending_approval`, `submitted`, `rejected`. `needs_evidence` dan `fraud_suspect` menjadi outcome investigasi, bukan status klaim (memperbaiki kontradiksi dengan FR-12).
- FR-11 dinaikkan ke Must karena trace live adalah inti demo.
- Video: stream copy diganti encode ulang H.264 (akurat dan dapat diputar browser); analisis memakai URI `gs://` tanpa Files API; tools hanya menerima ID.
- Koreksi paralelisasi: potong CCTV dan analisis klip bersifat berurutan.
- Endpoint baru: `/auth/login`, `GET /investigations`, `/audit-logs`, `/settings`, `/couriers/policies`; `/evidence/{id}/video` diganti `/evidence/{id}/media` (signed URL). Event SSE ditambah `status`, `decision`, `cancelled`, dengan dukungan `Last-Event-ID`.
- Model data: `media_assets` menggantikan `cctv_videos`, tambahan `investigation_events`, `settings`, `is_simulated`, `outcome`, `case_type`.
- Kepemilikan berkas dibereskan: `draft_claim_ticket` tidak lagi dimiliki dua orang, `main.py` milik Backend B, komponen investigasi/klaim milik Frontend B, rekaman video sampel ditugaskan ke Frontend B.
- Ditambahkan PIC GCP, checkpoint deploy pertama Rabu 17.00, skenario F (Hentikan Agen), NFR-12 dan NFR-13.
- Checkpoint Fondasi digeser ke 16.00 karena bentrok dengan mentoring.

**Versi 2.2**: pembagian tugas empat developer, design spike, pemetaan kepemilikan berkas.

**Versi 2.1**: jadwal dipetakan ke waktu asli, fase pembekuan, FR-20 dan FR-21.

## 19. Celah yang Diketahui (Known Gaps)

Bagian ini mencatat selisih antara **yang dijanjikan** dan **yang berjalan** pada versi beku, agar tidak ada klaim berlebihan di depan juri. Status per 22 Oktober 2026.

| # | Celah | Dampak | Tindakan |
| --- | --- | --- | --- |
| 1 | `backend/data/samples/` kosong; video hanya dapat dihasilkan `seed.py --synthetic` | Investigasi berhenti di `clip_cctv_video` bila media tidak ada; analisis Vision atas rekaman asli belum terbukti | Rekam 5 video sesuai `docs/data-dummy-dan-video.md` §2 |
| 2 | `backend/data/cache/` kosong | Mode `auto`/`cache` tidak punya rekaman; skenario E belum lulus end-to-end | Rekam ketiga skenario di `AI_MODE=live`, commit hasilnya |
| 3 | Belum ada **rate limiting** pada endpoint pemicu AI (NFR-06, Should) | Klik berulang dapat menguras kredit Vertex | Middleware in-memory sederhana |
| 4 | ~~`/settings/account` tertaut tetapi halamannya tidak ada~~ | **Sudah diperbaiki** (22 Okt): halaman `AccountForm` ditambahkan | — |
| 5 | **Golden-set evaluasi** agen (§12.1) belum diimplementasikan | Kualitas keputusan agent tidak diuji regresi saat prompt berubah | 5–10 kasus + skrip pembanding |
| 6 | Pemisahan peran pengguna belum ada (satu password demo) | Peninjau demo memegang hak menyetujui | Diterima sebagai batasan; sampaikan terbuka |
| 7 | **Deploy berhasil** — diverifikasi `claimguard-api-00007` dan `claimguard-web-00006` (22 Okt 2026). Sebelumnya `deploy-api.sh` gagal start karena `CORS_ORIGINS` dikirim sebagai URL mentah, padahal `cors_origins` bertipe `list[str]` dan pydantic-settings mem-parsing env sebagai JSON. Sudah diperbaiki di `infra/deploy-api.sh` | NFR-12 terpenuhi | — |
| 8 | Frontend belum mengonsumsi beberapa endpoint ops di UI (mis. purge, `/settings/courier-thresholds` PUT, `/connections` PATCH) | Fitur backend ada tetapi tidak terlihat di demo | Pastikan tombolnya ada di `/settings/privacy` dan `/settings/connections` |
| 9 | Pemisahan peran (admin vs peninjau) belum ada di UI Akun | Semua sesi berhak menyetujui klaim | Diterima sebagai batasan demo, dinyatakan di `/settings/account` |
| 10 | ~~Browser menolak API dengan "No `Access-Control-Allow-Origin`"~~ | **Sudah diperbaiki** (22 Okt): `--set-env-vars` mengganti seluruh env, dan `CORS_ORIGINS` yang tidak ada di environment deploy membuat origin web hilang dari allow-list. Kini `deploy-api.sh` **berhenti** bila `CORS_ORIGINS` kosong, `CORSMiddleware` didaftarkan paling luar (header CORS ikut pada respons error/500), `PUT`/`OPTIONS` masuk `allow_methods`, `allow_origins` dicatat di log saat start, dan `tests/api/test_api.py::test_cors_allows_web_origin_on_claims_endpoint` menguji preflight endpoint `/claims` | Re-deploy API dengan `CORS_ORIGINS=https://<web>.run.app` |
| 10 | **Registrasi, akun per pengguna, dan reset kata sandi lewat email belum ada** | Halaman login memakai email akun demo tunggal; tautan lupa kata sandi menjelaskan jalur PIC | Sengaja di luar lingkup (single-tenant). Ditambah tabel user + verifikasi email bila produk dikomersialkan |
| 11 | **Tidak ada paywall/subscription** | Semua fitur terbuka selama demo | Keputusan sadar: paywall tidak menambah nilai penilaian dan menyembunyikan fitur yang dinilai. Model bisnis disampaikan di deck, bukan dikunci di produk |

Celah nomor 1, 2, dan 7 adalah **blocking** untuk demo utama; sisanya bersifat penyempurnaan atau dinyatakan terbuka sebagai batasan.
