import { AlertTriangle, Clock, XCircle } from "lucide-react";

import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const HOUR = 3600e3;

/** Sisa waktu dalam kata: "46 jam lagi", "5 hari 3 jam lagi", "lewat 2 hari". */
export function remainingText(deadline: string, now = Date.now()) {
  const diff = new Date(deadline).getTime() - now;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / (24 * HOUR));
  const hours = Math.floor((abs % (24 * HOUR)) / HOUR);
  const span = abs < HOUR ? "< 1 jam" : days === 0 ? `${hours} jam` : days < 3 && hours ? `${days} hari ${hours} jam` : `${days} hari`;
  return diff < 0 ? `lewat ${span}` : `${span} lagi`;
}

export function deadlineUrgency(deadline: string | null, now = Date.now()) {
  if (!deadline) return "none" as const;
  const left = new Date(deadline).getTime() - now;
  return left < 0 ? ("expired" as const) : left < 24 * HOUR ? ("critical" as const) : left < 72 * HOUR ? ("soon" as const) : ("ok" as const);
}

const STYLE = {
  expired: { icon: XCircle, cls: "text-destructive", sr: "Batas klaim sudah lewat" },
  critical: { icon: AlertTriangle, cls: "text-destructive", sr: "Kurang dari 24 jam" },
  soon: { icon: Clock, cls: "text-warning-foreground dark:text-warning", sr: "Kurang dari 3 hari" },
  ok: { icon: Clock, cls: "text-muted-foreground", sr: "" },
} as const;

/**
 * Sisa waktu klaim (F3): hitung mundur ke `claim_deadline` dengan ikon dan teks,
 * tidak hanya warna (Panduan UX).
 */
export function ClaimDeadline({ deadline, className, showDate = false }: { deadline: string | null; className?: string; showDate?: boolean }) {
  const urgency = deadlineUrgency(deadline);
  if (urgency === "none" || !deadline) return <span className={cn("text-muted-foreground", className)}>Aturan kurir belum ada</span>;
  const s = STYLE[urgency];
  return (
    <span className={cn("inline-flex flex-col", className)} title={`Batas klaim ${formatDateTime(deadline)}`}>
      <span className={cn("flex items-center gap-1.5 whitespace-nowrap", s.cls, urgency !== "ok" && "font-medium")}>
        <s.icon className="size-4 shrink-0" aria-hidden />
        {remainingText(deadline)}
        {s.sr && <span className="sr-only">, {s.sr}</span>}
      </span>
      {showDate && <span className="text-xs text-muted-foreground">Batas {formatDateTime(deadline)}</span>}
    </span>
  );
}
