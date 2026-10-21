import { NextResponse } from "next/server";

/**
 * Logout: hapus cookie sesi milik domain WEB (first-party), lalu beri tahu backend agar
 * cookie di domainnya sendiri juga dibersihkan. Idempoten — aman dipanggil tanpa sesi.
 */

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const COOKIE = "cg_session";

export async function POST() {
  try {
    await fetch(`${BASE_URL}/api/v1/auth/logout`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* backend tak terjangkau: cookie lokal tetap dihapus di bawah */
  }

  const res = new NextResponse(null, { status: 204 });
  res.cookies.set({ name: COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
}
