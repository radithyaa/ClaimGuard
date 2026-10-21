import { cookies } from "next/headers";

/**
 * Pengecekan sesi di sisi server (Server Component), bukan di browser.
 *
 * Backend adalah sumber kebenaran: `GET /auth/session` memvalidasi tanda tangan token dan
 * masa berlakunya. Cookie `cg_session` diteruskan ke backend.
 *
 * Catatan penting (pernah menyesatkan saat deploy):
 * - Cookie `Secure; SameSite=None` bisa ditolak sebagian browser saat dikirim lintas host.
 *   Karena itu token cadangan di storage browser TIDAK cukup: server tidak bisa membacanya.
 *   Bila cookie tidak ada, frontend tetap bisa memakai Bearer header (lihat `api-client`),
 *   sedangkan penjaga server memakai cookie. Keduanya sah di backend.
 * - Hasil TIDAK pernah di-cache: satu-satunya nilai yang benar adalah kondisi sesi saat ini.
 */
export type ServerSession = {
  authenticated: boolean;
  user: string | null;
  authRequired: boolean;
  /** true bila backend tidak dapat dihubungi — dipakai untuk pesan yang jujur di UI. */
  unreachable: boolean;
};

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function getServerSession(): Promise<ServerSession> {
  const jar = await cookies();
  const token = jar.get("cg_session")?.value;
  const cookieHeader = jar.toString();

  const headers: Record<string, string> = {};
  if (cookieHeader) headers.cookie = cookieHeader;
  // Cadangan bila cookie tidak terkirim ke fetch server-to-server.
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/session`, {
      headers,
      cache: "no-store",
      // Jangan pernah di-cache Next.js; sesi berubah tanpa perubahan URL.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return { authenticated: false, user: null, authRequired: true, unreachable: false };
    }
    const body = (await res.json()) as { authenticated: boolean; user: string | null; auth_required: boolean };
    return {
      authenticated: body.authenticated,
      user: body.user,
      authRequired: body.auth_required,
      unreachable: false,
    };
  } catch {
    return { authenticated: false, user: null, authRequired: true, unreachable: true };
  }
}
