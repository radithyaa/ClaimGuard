"use client";

import { useEffect } from "react";

import { hasSession, redirectToLogin } from "@/lib/auth";

/**
 * Lapisan kedua penjaga rute. Pengecekan utama ada di server (`app/(dashboard)/layout.tsx`),
 * yang sudah menolak pengguna tanpa sesi sebelum HTML dikirim.
 *
 * Komponen ini menangani kasus sesi HABIS saat tab dibiarkan terbuka lama: token di browser
 * kedaluwarsa sehingga aksi tulis akan gagal 401. Konten tidak disembunyikan, agar tidak ada
 * kedipan saat pindah halaman.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!hasSession()) redirectToLogin();
  }, []);

  return <>{children}</>;
}
