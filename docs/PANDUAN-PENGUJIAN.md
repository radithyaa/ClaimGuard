# Panduan Pengujian ClaimGuard

Panduan ini untuk juri, mentor, dan siapa pun yang ingin mencoba ClaimGuard. Setiap langkah
dilengkapi **hasil yang seharusnya terlihat**, sehingga Anda bisa menilai sendiri apakah fitur
bekerja sesuai klaim.

| | |
| --- | --- |
| **Alamat aplikasi** | https://claimguard-web-5rzsoa7j3a-et.a.run.app |
| **Cara masuk** | Tombol **Masuk sebagai juri** di halaman login |
| **Akun manual** | email `admin@claimguard.demo` · kata sandi `juri2026` |
| **Perkiraan waktu** | 5 menit (jalur singkat) · 20 menit (semua skenario) |
| **Peramban** | Chrome, Edge, Firefox, atau Safari versi terbaru; layar laptop disarankan |

> **Semua data adalah simulasi.** Resi, video, dan aturan kurir dibuat tim. Tidak ada klaim
> yang benar-benar dikirim ke kurir; status "Terkirim" adalah simulasi dan diberi label.
>
> **Aplikasi dipakai bersama.** Bila juri lain sedang menguji di waktu yang sama, data bisa
> berubah. Tekan **Reset data demo** sebelum mulai agar kondisinya bersih.

---

## Jalur singkat (5 menit)

1. Buka alamat aplikasi, tekan **Masuk sebagai juri**.
2. Di menu kiri, buka **Panel demo**, tekan **Reset data demo**, lalu konfirmasi.
3. Pada skenario **A. Paket hilang**, tekan **Jalankan**.
4. Tonton agen bekerja di halaman investigasi (sekitar 30–90 detik).
5. Tekan **Tinjau draf klaim**, baca drafnya, lalu tekan **Setujui & kirim klaim**.
6. Buka tab **Log audit** di halaman klaim untuk melihat jejak siapa melakukan apa.

Bagian di bawah menjelaskan tiap langkah lebih rinci dan menambahkan skenario lainnya.

---

## Peta skenario

ClaimGuard menyiapkan empat kasus yang sengaja dibuat berbeda hasilnya. Tujuannya membuktikan
bahwa sistem tidak asal menagih kurir: ia bisa **mengajukan klaim**, **menahan diri ketika bukti
kurang**, dan **mengakui kesalahan penjual sendiri**.

| | Skenario | Resi | Situasi | Keputusan yang diharapkan | Klaim ke kurir? |
| --- | --- | --- | --- | --- | --- |
| A | Paket hilang | `JNE0012345678` | Resi berhenti di hub transit Semarang, melewati batas waktu JNE | Ajukan klaim | Ya |
| B | Paket rusak | `JT7788990011` | Pembeli melapor kotak inhaler sobek dan penyok, ada video unboxing | Ajukan klaim | Ya |
| C | Sengketa retur tanpa unboxing | `JNE0033445566` | Pembeli bilang kaos tidak ada di paket, tapi tidak merekam unboxing; CCTV memperlihatkan kaos dikemas | Butuh bukti tambahan | Tidak |
| D | Penjual salah kirim | `SCP4455667788` | Pembeli pesan kaos putih, datang kaos hijau tua; CCTV memperlihatkan gudang mengemas kaos hijau | Kesalahan penjual | Tidak |

Rincian bukti tiap skenario: [`data-demo.md`](data-demo.md).

---

## Uji 1 — Masuk

| Langkah | Hasil yang seharusnya |
| --- | --- |
| Buka alamat aplikasi | Diarahkan ke halaman **Masuk** |
| Tekan **Masuk sebagai juri** | Kolom email dan kata sandi terisi otomatis, lalu langsung masuk ke halaman **Ringkasan** |
| *(opsional)* Keluar, isi kata sandi yang salah, tekan **Masuk** | Muncul pesan "Kata sandi salah. Coba lagi." dan tetap di halaman login |
| *(opsional)* Buka `/dashboard` di jendela penyamaran tanpa login | Diarahkan kembali ke halaman login |

## Uji 2 — Menyiapkan data dan memeriksa kesiapan

1. Buka **Panel demo**.
2. Tekan **Reset data demo**, lalu konfirmasi.

**Hasil yang seharusnya:**

- Muncul notifikasi "Data demo direset" dengan jumlah resi yang dimuat ulang.
- Kotak kesiapan di kanan menampilkan **Backend terhubung**. Bila ada catatan "media tidak
  ditemukan", berarti video sampel belum terpasang di server dan investigasi akan berhenti di
  tahap pemotongan klip.
- Antrian klaim, investigasi, dan log audit kembali kosong. Reset tidak membuat hasil AI palsu.

## Uji 3 — Pemantauan otomatis (tanpa AI)

1. Buka menu **Resi**. Daftar berisi resi simulasi dari JNE, J&T, dan SiCepat.
2. Tekan **Scan sekarang**.

**Hasil yang seharusnya:**

- Sekitar 11 dari 24 resi ditandai bermasalah, misalnya `JNE0012345678` (melewati batas waktu),
  `JT7788990011` (laporan rusak), dan `SCP4455667788` (sengketa retur).
- Resi yang normal **tidak** ditandai. Contohnya `SCP9911223344`, retur sah karena ukuran
  kekecilan dengan barang lengkap, dan `SCP1029384756` dengan laporan "Barang sudah diterima,
  terima kasih".
- Menekan **Scan sekarang** lagi tidak membuat tanda ganda.

Tahap ini sengaja tidak memakai AI: aturannya pasti, cepat, dan tanpa biaya.

## Uji 4 — Skenario A: paket hilang (alur utama)

1. Buka **Panel demo**, tekan **Jalankan** pada **A. Paket hilang**.
2. Anda otomatis dibawa ke halaman investigasi.

**Yang seharusnya terlihat selama agen bekerja:**

| Tahap | Yang tampil |
| --- | --- |
| Investigator | Memanggil alat satu per satu: konteks kasus → potong CCTV → analisis video → aturan kurir JNE. Setiap alat tampil dengan status dan hasilnya |
| Klip CCTV | Potongan video meja packing di sekitar detik resi discan. Bisa diputar. Terlihat kaos navy dikemas dan diberi label |
| Label sumber | Setiap hasil analisis bertanda **live** (Gemini saat itu juga) atau **cache** (rekaman cadangan) |
| Evaluator | Keputusan **ajukan klaim**, tingkat keyakinan, dan alasan tertulis: barang terbukti dikemas, paket berhenti di hub transit, masih dalam batas waktu klaim JNE |
| Drafter | Draf klaim disusun; muncul tombol **Tinjau draf klaim** |

3. Tekan **Tinjau draf klaim**.

**Yang seharusnya terlihat di halaman klaim:**

- Draf memuat nomor resi `JNE0012345678`, kronologi pengiriman, temuan dari CCTV, dan ketentuan
  klaim JNE.
- Status **Siap ditinjau**.
- Teks "Tidak ada yang dikirim sebelum Anda menekan Setujui".

4. Tekan **Edit draf klaim**, ubah satu kalimat, lalu **Simpan draf**. Perubahan tersimpan.
5. Tekan **Setujui & kirim klaim**, lalu konfirmasi.

**Hasil yang seharusnya:**

- Status berubah menjadi **Terkirim** dengan label simulasi.
- Tombol persetujuan hilang, sehingga klaim tidak bisa dikirim dua kali.
- Tab **Log audit** mencatat suntingan dan persetujuan beserta waktunya.
- Menu **Laporan uang pulih** menghitung nilai klaim ini.

## Uji 5 — Skenario B: paket rusak

1. **Panel demo** → **Jalankan** pada **B. Paket rusak**.

**Hasil yang seharusnya:**

- Agen menganalisis **dua** video: CCTV packing (inhaler dikemas rapi) dan video unboxing pembeli
  (kotak sobek dan penyok).
- Temuan kerusakan tampil dengan tingkat keyakinan dan stempel waktu di video.
- Keputusan **ajukan klaim** ke J&T, dengan ketentuan klaim J&T terlampir di draf.

## Uji 6 — Skenario C: sengketa retur tanpa unboxing

1. **Panel demo** → **Jalankan** pada **C. Sengketa retur tanpa unboxing**.

**Hasil yang seharusnya:**

- CCTV menunjukkan kaos putih **dikemas**, tetapi pembeli tidak punya video unboxing.
- Keputusan **butuh bukti tambahan**. Agen tidak menuduh pembeli maupun kurir.
- **Tidak ada** draf klaim yang dibuat.
- Muncul tombol **Minta bukti pembeli** untuk menyusun permintaan bukti.

Inilah perilaku yang diinginkan: ketika bukti tidak cukup, sistem menahan diri.

## Uji 7 — Skenario D: penjual salah kirim

1. **Panel demo** → **Jalankan** pada **D. Penjual salah kirim**.

**Hasil yang seharusnya:**

- CCTV memperlihatkan gudang mengemas kaos **hijau tua**, padahal pesanan kaos **putih**.
- Keputusan **kesalahan penjual**. **Tidak ada** klaim ke kurir.
- Di halaman resi `SCP4455667788`, kartu **Kesimpulan sistem** menunjuk penjual beserta alasannya.

Ini kasus kontrol: sistem jujur bahkan ketika kesalahannya ada di pihak penggunanya sendiri.

## Uji 8 — Menghentikan agen

1. Reset data demo, lalu jalankan skenario apa pun.
2. Selagi agen masih bekerja, tekan **Hentikan agen** dan konfirmasi.

**Hasil yang seharusnya:** status investigasi menjadi **dibatalkan**, tidak ada langkah baru yang
muncul, dan tidak ada draf klaim yang dibuat.

## Uji 9 — Halaman pendukung

| Menu | Yang bisa diperiksa |
| --- | --- |
| **Ringkasan** | Jumlah anomali, klaim menunggu persetujuan, dan tenggat klaim terdekat |
| **Antrian klaim** | Semua draf beserta status: Siap ditinjau, Terkirim, Ditolak |
| **Laporan uang pulih** | Total nilai klaim yang disetujui |
| **Kebijakan kurir** | Ringkasan aturan klaim JNE, J&T, dan SiCepat yang dibaca agen |
| **Pengaturan** | Mode AI (Otomatis, Live saja, Cache saja), ambang keyakinan, toleransi keterlambatan, ambang per kurir |
| **Pengaturan → Log audit** | Riwayat seluruh aksi agen dan manusia |

---

## Pemeriksaan teknis (opsional)

Untuk juri yang ingin memverifikasi klaim keamanan langsung ke API. Jalankan di terminal:

```bash
API=https://claimguard-api-5rzsoa7j3a-et.a.run.app

# 1. Server sehat
curl -s $API/api/v1/health
# {"status":"ok","db":"ok","ai_mode":"auto","storage":"gcs"}

# 2. Aksi yang mengubah data ditolak tanpa login
curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/api/v1/monitoring/scan
# 401

# 3. Login dan ambil token
TOKEN=$(curl -s -X POST $API/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"password":"juri2026"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# 4. Klaim yang sudah disetujui tidak bisa disetujui lagi (ganti CLAIM_ID dari URL halaman klaim)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/api/v1/claims/CLAIM_ID/approve \
  -H "Cookie: cg_session=$TOKEN"
# 409
```

Dokumentasi API interaktif tersedia di `$API/api/v1/docs`.

**Memeriksa kode bahwa agen tidak bisa mengirim klaim:**

```bash
grep -rn "submit_claim" backend/app/
```

Fungsi itu hanya muncul di `services/claim_service.py` dan endpoint persetujuan, tidak pernah
di daftar alat agen (`backend/app/agents/`).

---

## Pengujian otomatis

Backend punya test otomatis yang berjalan tanpa memanggil Gemini (jawaban model diganti
rekaman supaya hasilnya selalu sama):

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest -q
```

Hasil terakhir (22 Oktober 2026): **79 passed**. Yang diuji antara lain aturan pemantauan,
keempat alat agen, pipeline tiga agen, penjaga ambang keyakinan, persetujuan atomik (klik
ganda menghasilkan 409), pembatalan agen, impor CSV, dan seluruh endpoint API.

---

## Bila ada kendala

| Gejala | Penyebab | Yang bisa dilakukan |
| --- | --- | --- |
| "Data demo belum ada" saat menjalankan skenario | Data belum di-reset | Tekan **Reset data demo** |
| Skenario menolak dijalankan karena resi tidak ditandai | Skenario sudah dijalankan juri lain | Tekan **Reset data demo**, lalu coba lagi |
| Investigasi berhenti di tahap potong CCTV dengan pesan "media tidak ditemukan" | Video sampel tidak ada di server | Hubungi tim |
| Analisis lebih dari 2 menit | Gemini sedang lambat | Tunggu, atau ubah **Pengaturan → Mode AI** ke **Cache saja** |
| Hasil bertanda **cache** | Gemini gagal dan sistem memakai rekaman cadangan | Normal di mode Otomatis; label ini sengaja ditampilkan |
| Terlempar ke halaman login | Sesi berakhir | Tekan **Masuk sebagai juri** lagi |
