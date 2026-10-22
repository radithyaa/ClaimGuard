# ClaimGuard — Frontend

Dashboard web ClaimGuard: memantau resi, menonton agen AI menginvestigasi secara langsung, lalu
meninjau dan menyetujui draf klaim. Dibangun dengan Next.js (App Router), React, Tailwind CSS,
dan TanStack Query.

Gambaran produk ada di [README utama](../README.md). Alur pengetesan ada di
[`../docs/PANDUAN-PENGUJIAN.md`](../docs/PANDUAN-PENGUJIAN.md).

## Menjalankan

Kebutuhan: Node.js 20+ dan backend yang berjalan di `http://localhost:8000`
(lihat [`../backend/README.md`](../backend/README.md)).

```bash
cd frontend
npm ci
echo 'NEXT_PUBLIC_API_BASE_URL=http://localhost:8000' > .env.local
npm run dev
```

Buka http://localhost:3000 lalu tekan **Masuk sebagai juri**.

**Tanpa backend:** jalankan `NEXT_PUBLIC_API_MOCK=1 npm run dev`. Semua halaman memakai data
tiruan di memori browser, termasuk simulasi agen yang sedang bekerja.

## Variabel environment

Nilai `NEXT_PUBLIC_*` ditanam ke kode saat `next build`. Mengubahnya butuh build ulang.

| Variabel | Keterangan |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | alamat backend; default `http://localhost:8000` |
| `NEXT_PUBLIC_DEMO_PASSWORD` | kata sandi yang dipakai tombol **Masuk sebagai juri**; default `claimguard-demo` (sama dengan backend lokal) |
| `NEXT_PUBLIC_HIDE_DEMO_LOGIN` | `1` menyembunyikan tombol juri |
| `NEXT_PUBLIC_API_MOCK` | `1` memakai data tiruan tanpa backend |

Kata sandi tombol juri ikut terbaca di kode browser. Gunakan hanya untuk akun demo.

## Halaman

| Rute | Isi |
| --- | --- |
| `/login` | masuk dengan akun demo |
| `/dashboard` | ringkasan: klaim yang butuh keputusan, anomali aktif, nilai yang bisa dipulihkan |
| `/shipments`, `/shipments/[id]` | daftar resi, pemindaian, riwayat pelacakan, kesimpulan sistem |
| `/investigations/[id]` | progres agen secara langsung, klip bukti, keputusan, tombol hentikan |
| `/claims`, `/claims/[id]` | antrian draf klaim, edit, setujui, tolak, log audit per kasus |
| `/reports` | laporan uang yang berhasil dipulihkan |
| `/couriers` | aturan klaim tiap kurir |
| `/demo` | panel demo: reset data dan menjalankan empat skenario |
| `/settings` | mode AI, ambang, koneksi, privasi, akun, log audit |

## Cara kerja login

Halaman login memanggil route handler Next.js (`src/app/api/auth/login`), yang meneruskan kata
sandi ke backend lalu menyimpan sesi sebagai cookie `httpOnly` di domain web. Token tidak pernah
bisa dibaca JavaScript. Cara ini dipakai karena backend dan frontend berjalan di domain berbeda
di Cloud Run.

## Struktur

| Folder | Isi |
| --- | --- |
| `src/app/` | halaman dan route handler |
| `src/components/` | komponen per fitur (`claims`, `investigation`, `shipments`, `settings`) dan `ui/` |
| `src/lib/` | klien API, SSE, format, dan data tiruan (`mock/`) |
| `src/types/` | tipe data API |

## Perintah

```bash
npm run dev      # mode pengembangan
npm run build    # build produksi
npm run lint     # ESLint
```

Deploy ke Cloud Run: [`../infra/deploy-web.sh`](../infra/deploy-web.sh).
