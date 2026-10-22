# Data Demo ClaimGuard

Dokumen ini menjelaskan isi data simulasi yang dipakai aplikasi: resi, video, aturan kurir, dan
empat skenario demo. Gunanya agar penguji bisa memeriksa apakah keputusan agen sesuai bukti.

Sumber data: [`backend/data/mock/shipments.json`](../backend/data/mock/shipments.json) dan
[`backend/data/mock/courier_policies/`](../backend/data/mock/courier_policies/).

## Prinsip

1. **Semuanya simulasi.** Resi, nama barang, video, dan aturan kurir dibuat tim. Dokumen aturan
   kurir adalah tiruan dan **bukan** ketentuan resmi JNE, J&T, atau SiCepat.
2. **Tidak ada hasil AI palsu.** Setelah **Reset data demo**, tabel investigasi, bukti, klaim,
   dan log audit selalu kosong. Isinya hanya muncul dari proses yang benar-benar berjalan.
3. **Bisa diulang.** Reset selalu menghasilkan data awal yang sama.
4. **Waktu konsisten.** Jam di rekaman CCTV sama dengan waktu scan resi di data. Dengan begitu,
   agen bisa memotong klip tepat di detik paket dikemas.

## Isi data

| Data | Jumlah | Keterangan |
| --- | --- | --- |
| Resi | 24 | JNE, J&T, SiCepat; dikirim dari gudang Bandung |
| Video CCTV meja packing | 3 | satu rekaman bisa memuat beberapa paket |
| Video unboxing pembeli | 1 | untuk kasus inhaler rusak |
| Aturan klaim kurir | 3 | JNE, J&T, SiCepat |

Saat **Scan sekarang** ditekan (per 22 Oktober 2026), **11 dari 24 resi** ditandai:

| Jenis tanda | Aturan | Contoh resi |
| --- | --- | --- |
| Melewati batas waktu | resi belum diterima setelah batas waktu kurir + toleransi 3 jam | `JNE0012345678`, `JNE0099887766` |
| Laporan rusak | resi diterima dan laporan pembeli memuat kata seperti rusak, pecah, sobek, penyok | `JT7788990011` |
| Sengketa retur | resi diretur dan pembeli mengeluhkan isi kosong, kurang, atau berbeda | `SCP4455667788`, `JNE0033445566`, `JNE0044558899` |

Resi yang **tidak** ditandai juga penting, karena membuktikan sistem tidak asal menuduh. Contohnya
`SCP9911223344` (retur sah karena ukuran kekecilan, barang lengkap) dan `SCP1029384756`
("Barang sudah diterima, terima kasih").

Karena aturan batas waktu bergantung pada tanggal hari ini, jumlah resi yang ditandai bisa
bertambah seiring waktu.

## Aturan klaim kurir (tiruan)

| Kurir | Batas waktu klaim | Bukti yang diminta |
| --- | --- | --- |
| JNE | 14 hari kalender | resi, video packing, bukti nilai barang, foto/video kerusakan |
| J&T | 7 hari | nomor resi, video unboxing tanpa jeda, foto kemasan luar, invoice |
| SiCepat | 10 hari | foto resi, video unboxing, foto barang rusak |

Agen membaca dokumen ini lewat alat `get_courier_policy` dan mengutipnya di draf klaim.

## Empat skenario demo

### A. Paket hilang — `JNE0012345678`

| | |
| --- | --- |
| Barang | Kaos polos navy, ukuran L · Rp129.000 |
| Rute | Bandung → Surabaya, JNE |
| Riwayat | Dikemas 17 Okt 08.01 WIB → diserahkan ke kurir → tiba di hub transit Semarang, lalu berhenti |
| Bukti | CCTV meja packing 1: kaos navy dimasukkan ke plastik dan diberi label |
| Keputusan yang diharapkan | **Ajukan klaim** ke JNE |
| Alasannya | Barang terbukti dikemas dan diserahkan; paket berhenti di jaringan kurir melewati batas waktu |

### B. Paket rusak — `JT7788990011`

| | |
| --- | --- |
| Barang | Inhaler · Rp275.000 |
| Rute | Bandung → Jakarta Selatan, J&T |
| Laporan pembeli | "Saat paket dibuka, kotak inhaler sudah sobek dan penyok di salah satu ujungnya…" |
| Bukti | CCTV packing: kotak inhaler utuh dibungkus plastik dan polymailer. Video unboxing: kotak sobek dan penyok |
| Keputusan yang diharapkan | **Ajukan klaim** ke J&T |
| Alasannya | Barang utuh saat dikemas dan rusak saat diterima, sehingga kerusakan terjadi di perjalanan |

### C. Sengketa retur tanpa unboxing — `JNE0033445566`

| | |
| --- | --- |
| Barang | Kaos polos putih, ukuran M · Rp89.000 |
| Laporan pembeli | "…kaos putih yang saya pesan tidak ada di dalam paket… belum merekam saat membuka paket." |
| Bukti | CCTV packing: kaos putih dilipat, dimasukkan ke plastik, dan diberi label. Tidak ada video unboxing |
| Keputusan yang diharapkan | **Butuh bukti tambahan** |
| Alasannya | Bukti penjual kuat, tetapi tanpa video unboxing tidak bisa dipastikan siapa yang salah. Agen tidak menuduh dan menyarankan meminta bukti ke pembeli |

### D. Penjual salah kirim — `SCP4455667788`

| | |
| --- | --- |
| Barang dipesan | Kaos polos putih, ukuran L · Rp89.000 |
| Laporan pembeli | "Saya pesan kaos polos putih ukuran L, tetapi yang datang kaos hijau tua…" |
| Bukti | CCTV meja packing 1 di waktu scan resi ini: gudang mengemas kaos **hijau tua** |
| Keputusan yang diharapkan | **Kesalahan penjual** |
| Alasannya | Rekaman gudang sendiri menunjukkan barang yang salah dikemas. Tidak ada klaim ke kurir, dan kesimpulan pada resi menunjuk penjual |

## Video

Video tidak disimpan di repositori karena ukurannya. Di server, video ada di Cloud Storage
(`gs://<bucket>/samples/`). Untuk lokal, taruh di `backend/data/samples/`.

| Berkas | Jenis | Isi |
| --- | --- | --- |
| `cctv_packing_01.mp4` | CCTV, ±6 menit | beberapa paket dikemas berurutan: kaos navy, kemeja krem, kaos hijau tua, kaos putih dan kemeja kotak-kotak |
| `inhaler_packing.mp4` | CCTV, ±1 menit | kotak inhaler ditunjukkan, dibungkus, dimasukkan ke polymailer, label J&T ditempel |
| `inhaler_unpacking.mp4` | unboxing, ±20 detik | polymailer dibuka, kotak inhaler sobek dan penyok |
| `needs_evidence.mp4` | CCTV, ±2 menit | kaos putih dilipat dan dikemas, lalu paket kemeja flanel |

Cara memasang dan memeriksa video: [`media-setup.md`](media-setup.md).

## Catatan untuk yang mengubah data

- **Jangan ubah nomor resi skenario.** Rekaman cadangan hasil AI disimpan per nomor resi.
- **Jam CCTV harus cocok.** Waktu scan resi = `recorded_start` video + detik ketika label
  ditempel. Bila rekaman berbeda, ubah waktu di `shipments.json`, bukan videonya.
- Setelah mengubah data, tekan **Reset data demo** atau jalankan `python data/seed.py`.
