// Format tampilan: data API selalu UTC, ditampilkan dalam WIB.
const TZ = "Asia/Jakarta";

export const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(new Date(iso)) +
  " WIB";

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: TZ }).format(new Date(iso));

export function formatRelative(iso: string, now = Date.now()) {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

export const COURIER_LABEL: Record<string, string> = { jne: "JNE", jnt: "J&T", sicepat: "SiCepat" };
