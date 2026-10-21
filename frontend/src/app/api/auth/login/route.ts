import { NextRequest, NextResponse } from "next/server";

/**
 * Login proxy: meneruskan kredensial ke API, lalu MENYIMPAN cookie sesi di domain WEB.
 *
 * Kenapa harus lewat route handler ini (bug produksi, 22 Okt 2026):
 * - Backend Cloud Run berada di host berbeda dari web. Cookie yang diset backend menempel
 *   pada domain API, sehingga `cookies()` di Server Component (domain web) TIDAK pernah
 *   menerimanya. Guard server selalu melihat "belum login" dan melempar pengguna kembali
 *   ke /login — persis gejala "login berhasil tapi terpental".
 * - Dengan menyetel cookie dari route handler ini, cookie menjadi first-party milik domain
 *   web: guard server, SSE, dan navigasi semuanya melihat sesi yang sama.
 *
 * Token tidak pernah dikirim ke JavaScript; hanya cookie httpOnly.
 */

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const COOKIE = "cg_session";

/** Selaras dengan `secure=ENV=cloud` di backend: di lokal (http) cookie tidak boleh Secure. */
const isHttps = BASE_URL.startsWith("https://");

export async function POST(req: NextRequest) {
  let password = "";
  try {
    const body = (await req.json()) as { password?: string };
    password = body.password ?? "";
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Permintaan tidak valid." } },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json(
      { error: { code: "api_unreachable", message: "Server tidak dapat dihubungi." } },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => ({}))) as {
    token?: string;
    expires_in?: number;
    error?: { code: string; message: string };
  };

  if (!upstream.ok || !data.token) {
    console.warn("[auth] login.failed", { status: upstream.status, code: data.error?.code });
    return NextResponse.json(
      data.error ? data : { error: { code: "login_failed", message: "Gagal masuk." } },
      { status: upstream.status === 502 ? 502 : 401 },
    );
  }

  const res = NextResponse.json({ ok: true, expires_in: data.expires_in ?? 86400 });
  res.cookies.set({
    name: COOKIE,
    value: data.token,
    httpOnly: true,
    sameSite: "lax", // first-party: cukup lax, tidak perlu None
    secure: isHttps,
    path: "/",
    maxAge: data.expires_in ?? 86400,
  });
  console.info("[auth] login.set_cookie", {
    upstreamStatus: upstream.status,
    secure: isHttps,
    sameSite: "lax",
    maxAge: data.expires_in ?? 86400,
  });
  return res;
}
