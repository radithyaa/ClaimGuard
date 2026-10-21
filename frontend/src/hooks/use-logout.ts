"use client";

import { useRouter } from "next/navigation";

import { api } from "@/lib/api-client";

/**
 * Keluar dari sesi: route handler `/api/auth/logout` menghapus cookie first-party di domain
 * web sekaligus cookie di backend, lalu penjaga rute di server dimuat ulang.
 * Kegagalan memanggil backend tidak menghalangi pengguna keluar.
 */
export function useLogout() {
  const router = useRouter();

  return async function logout() {
    try {
      await api.auth.logout();
    } catch {
      /* backend mati/jaringan putus: cookie lokal tetap dihapus oleh route handler */
    }
    router.replace("/login");
    router.refresh();
  };
}
