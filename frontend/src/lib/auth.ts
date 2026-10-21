// Sesi login demo (FR-19). Cookie httpOnly dari backend tinggal di domain backend sehingga
// tidak terbaca di sini; token dari /auth/login disimpan dan dikirim sebagai header Bearer,
// karena cookie lintas situs di Cloud Run bisa diblokir browser.

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
