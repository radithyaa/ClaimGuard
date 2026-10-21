"use client";

/**
 * Lapisan kedua penjaga rute. Pengecekan utama ada di server (`app/(dashboard)/layout.tsx`),
 * yang menolak pengguna tanpa sesi sebelum HTML dikirim.
 *
 * Sesi kini berupa cookie httpOnly first-party yang tidak dapat dibaca JavaScript, sehingga
 * komponen ini tidak lagi memeriksa token sendiri. Bila sesi kedaluwarsa, backend membalas
 * 401 pada aksi tulis dan `api-client` mengarahkan pengguna ke halaman login.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
