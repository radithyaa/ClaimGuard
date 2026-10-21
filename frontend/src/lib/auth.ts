// Sesi login demo (FR-19).
//
// Sumber kebenaran ada di COOKIE httpOnly yang diset backend (`cg_session`). Cookie itu tidak
// terbaca JavaScript, jadi pengecekan di sisi server memakai `GET /auth/session`.
//
// Token juga disimpan di storage browser sebagai cadangan, karena di Cloud Run frontend dan
// backend berada di domain berbeda dan cookie lintas situs dapat diblokir browser. Token
// dikirim ulang lewat header Bearer (EventSource SSE tidak bisa mengirim header, jadi SSE
// tetap bergantung pada cookie).
//
// `remember` = localStorage (bertahan setelah browser ditutup), selain itu sessionStorage.

const KEY = "cg_session";

interface Session {
  token: string;
  exp: number; // epoch ms
}

function stores(): Storage[] {
  try {
    return [localStorage, sessionStorage];
  } catch {
    return [];
  }
}

function read(): Session | null {
  for (const s of stores()) {
    try {
      const raw = s.getItem(KEY);
      if (!raw) continue;
      const session = JSON.parse(raw) as Session;
      if (session.exp > Date.now()) return session;
      s.removeItem(KEY);
    } catch {
      /* data rusak: abaikan */
    }
  }
  return null;
}

/** `remember` = localStorage (bertahan setelah browser ditutup), selain itu sessionStorage. */
export function saveSession(token: string, expiresInSec: number, remember: boolean) {
  clearSession();
  const session: Session = { token, exp: Date.now() + expiresInSec * 1000 };
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session));
  } catch {
    /* storage diblokir: sesi tetap jalan lewat cookie selama tab terbuka */
  }
}

export function clearSession() {
  for (const s of stores()) {
    try {
      s.removeItem(KEY);
    } catch {
      /* abaikan */
    }
  }
}

export const getToken = () => read()?.token ?? null;
export const hasSession = () => read() !== null;

/**
 * Info sesi untuk ditampilkan di halaman Akun. Token TIDAK pernah dikembalikan.
 * `remember` menandakan sesi disimpan di localStorage (bertahan setelah browser ditutup)
 * alih-alih sessionStorage.
 */
export function sessionInfo(): { expiresAt: Date; remember: boolean } | null {
  const session = read();
  if (!session) return null;
  let remember = false;
  try {
    remember = localStorage.getItem(KEY) !== null;
  } catch {
    /* storage diblokir: anggap sesi tab saja */
  }
  return { expiresAt: new Date(session.exp), remember };
}

/** Ke halaman login, membawa halaman asal agar bisa kembali setelah masuk. */
export function redirectToLogin() {
  if (typeof window === "undefined" || window.location.pathname === "/login") return;
  const next = window.location.pathname + window.location.search;
  window.location.replace(`/login?next=${encodeURIComponent(next)}`);
}

/** Hanya path internal yang diterima sebagai tujuan setelah login (cegah open redirect). */
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}
