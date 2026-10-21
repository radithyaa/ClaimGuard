// Sesi login demo (FR-19).
//
// Sesi kini SEPENUHNYA first-party: cookie httpOnly `cg_session` diset oleh route handler
// Next.js (`app/api/auth/login/route.ts`), bukan oleh backend. Tidak ada token di
// localStorage/sessionStorage dan tidak ada yang bisa dibaca JavaScript.
//
// Latar belakang bug produksi (22 Okt 2026): saat cookie diset backend (host berbeda),
// `cookies()` di Server Component domain web tidak pernah menerimanya, sehingga guard
// selalu menganggap "belum login" dan melempar pengguna balik ke /login.

const KEY = "cg_session";

/** Menghapus sisa token lama (versi sebelum cookie first-party). Aman bila tidak ada. */
export function clearLegacySession() {
  for (const s of [safeStorage("local"), safeStorage("session")]) {
    try {
      s?.removeItem(KEY);
    } catch {
      /* storage diblokir: abaikan */
    }
  }
}

function safeStorage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? localStorage : sessionStorage;
  } catch {
    return null;
  }
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
