"use client";

import { useRouter } from "next/navigation";

import { api } from "@/lib/api-client";
import { clearSession } from "@/lib/auth";

/**
 * Keluar dari sesi: hapus token lokal, hapus cookie httpOnly di backend, lalu muat ulang
 * penjaga rute di server. Kegagalan memanggil backend tidak menghalangi pengguna keluar —
 * token lokal sudah dibuang, jadi aksi tulis tidak mungkin lagi berhasil.
 */
export function useLogout() {
  const router = useRouter();

  return async function logout() {
    try {
      await api.auth.logout();
    } catch {
      /* backend mati/jaringan putus: tetap keluar secara lokal */
    }
    clearSession();
    router.replace("/login");
    router.refresh();
  };
}
