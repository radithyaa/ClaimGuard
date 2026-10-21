import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { formatDateTime } from "@/lib/format";
import type { Severity, ShipmentDetail } from "@/types/api";

import { CASE_LABEL } from "./status-badge";

const PRIORITY: Record<Severity, { label: string; cls: string }> = {
  high: { label: "Prioritas tinggi", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  medium: { label: "Prioritas sedang", cls: "border-warning/40 bg-warning/15 text-warning-foreground dark:text-warning" },
  low: { label: "Prioritas rendah", cls: "border-border bg-muted text-muted-foreground" },
};

const ANOMALY_STATUS = { open: "Terbuka", investigating: "Sedang diinvestigasi", resolved: "Selesai" } as const;

/** Kartu utama detail resi: anomali aktif, atau status normal + progres menuju batas SLA. */
export function AnomalyCard({ shipment: s }: { shipment: ShipmentDetail }) {
  const a = s.anomaly;

  if (!a) {
    const start = new Date(s.shipped_at).getTime();
    const end = new Date(s.sla_deadline).getTime();
    const done = s.status === "delivered" || s.status === "returned";
    const pct = Math.round(Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) * 100);
    return (
      <section className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden /> Status normal
          </p>
          <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-[13px] text-success">
            {done ? "Pengiriman selesai" : "Dalam batas SLA"}
          </span>
        </div>
        <h2 className="mt-2 text-xl font-semibold">Tidak ada anomali</h2>
        <p className="text-sm text-muted-foreground">Pengiriman ini berjalan normal menurut aturan SLA.</p>
        {!done && (
          <div className="mt-4 flex flex-col gap-2 border-t pt-4">
            <div className="flex justify-between text-sm">
              <span>Waktu berjalan menuju batas SLA</span>
              <span className="text-muted-foreground tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${pct >= 80 ? "bg-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[13px] text-muted-foreground">Batas SLA {formatDateTime(s.sla_deadline)}</p>
          </div>
        )}
        <p className="mt-4 border-t pt-3 text-[13px] text-muted-foreground">
          Dipantau berkala oleh <span className="font-medium text-foreground">Monitoring Agent</span>
        </p>
      </section>
    );
  }

  const summary = typeof a.reason_json.summary === "string" ? a.reason_json.summary : CASE_LABEL[a.case_type];
  const facts: [string, React.ReactNode][] = [
    ["Kode anomali", <code key="c" className="rounded bg-muted px-2 py-0.5 font-mono text-[13px]">{a.code}</code>],
    ["Jenis kasus", CASE_LABEL[a.case_type]],
    ["Status", ANOMALY_STATUS[a.status]],
    ["Terdeteksi", `${formatDateTime(a.detected_at)} oleh Monitoring Agent`],
  ];

  return (
    <section className="rounded-xl border bg-card p-6">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-warning-foreground dark:text-warning">
          <AlertTriangle className="size-4 text-warning" aria-hidden /> {CASE_LABEL[a.case_type]}
        </p>
        <span className={`rounded-full border px-2.5 py-0.5 text-[13px] ${PRIORITY[a.severity].cls}`}>{PRIORITY[a.severity].label}</span>
      </div>
      <h2 className="mt-2 text-xl font-semibold">{summary}</h2>
      <dl className="mt-4 grid grid-cols-[minmax(0,12rem)_1fr] gap-x-4 gap-y-3 border-t pt-4 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
