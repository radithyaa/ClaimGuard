"use client";

import { useEffect, useState } from "react";

import { hasSession, redirectToLogin } from "@/lib/auth";

/**
 * Penjaga rute dashboard: tanpa sesi tersimpan, arahkan ke /login?next=.
 * Konten baru dirender setelah dicek di browser agar halaman tidak sempat berkedip.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (hasSession()) setOk(true);
    else redirectToLogin();
  }, []);

  return ok ? <>{children}</> : null;
}
