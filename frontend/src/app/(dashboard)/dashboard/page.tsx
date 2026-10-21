"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Info, Zap } from "lucide-react";
import Link from "next/link";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ClaimDeadline, deadlineUrgency } from "@/components/claims/claim-deadline";
import { Button } from "@/components/ui/button";
import { ConfidenceLabel } from "@/components/ui/confidence";
import { ScanButton } from "@/components/shipments/scan-button";
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { COURIER_LABEL, formatDate, formatRupiah } from "@/lib/format";
import type { AuditLog, ClaimSummary } from "@/types/api";

const TARGET_SEC = 30;

const ACTOR_LABEL: Record<string, string> = {
  "agent:monitor": "Monitoring Agent",
  "agent:investigator": "Investigation Agent",
  "agent:vision": "Investigation Agent",
  "agent:evaluator": "Investigation Agent",
  "agent:drafter": "Action Agent",
  system: "Sistem",
  user: "Admin",
};

const ACTION_LABEL: Record<string, string> = {
  anomaly_flagged: "menandai anomali",
  decision_made: "memutuskan hasil investigasi",
  claim_drafted: "menyusun draf klaim",
  claim_submitted: "mengirim klaim",
  claim_rejected: "menolak draf klaim",
  settings_updated: "mengubah pengaturan",
};


function Panel({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <section className={`rounded-xl border bg-card p-5 ${className}`}>{children}</section>;
}

function Kpi({ label, value, sub, accent, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 p-5">
      <p className="flex items-center gap-1 text-sm text-muted-foreground">
        {label} <Info className="size-3.5" aria-hidden />
      </p>
      <p className={`text-4xl leading-tight font-semibold tracking-tight break-words ${accent ? "text-success" : ""}`}>{value}</p>
      {sub && <p className="text-[13px] text-muted-foreground">{sub}</p>}
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.metrics.summary });
  const pending = useQuery({ queryKey: ["claims", "pending_approval"], queryFn: () => api.claims.list({ status: "pending_approval", limit: 5 }) });
  const submitted = useQuery({ queryKey: ["claims", "submitted"], queryFn: () => api.claims.list({ status: "submitted", limit: 100 }) });
  const logs = useQuery({ queryKey: ["audit-logs", 6], queryFn: () => api.auditLogs.list(6) });


  const m = metrics.data;
  const pendingRows = pending.data?.items ?? [];
  const pendingTotal = pendingRows.reduce((n, c) => n + c.claim_value, 0);
  const urgentCount = pendingRows.filter((c) => deadlineUrgency(c.claim_deadline) === "critical").length;
  const recovered = (submitted.data?.items ?? []).reduce((n, c) => n + c.claim_value, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] leading-8 font-semibold">Ringkasan</h1>
          {/* HTML prerender bisa berbeda hari dengan browser */}
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {formatDate(new Date().toISOString())}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {m?.is_simulated && <SimulatedBadge />}
          <ScanButton />
        </div>
      </header>

      {/* Baris 1: KPI */}
      {metrics.isError ? (
        <Panel>
          <ErrorState message={metrics.error.message} onRetry={() => metrics.refetch()} />
        </Panel>
      ) : (
        <section className="grid divide-y rounded-xl border bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {!m ? (
            Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-3 p-5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))
          ) : (
            <>
              <Kpi label="Butuh keputusan Anda" value={<span className="text-primary">{m.pending_claims}</span>} sub={`Total ${formatRupiah(pendingTotal)}${urgentCount ? ` · ${urgentCount} kasus kurang dari 24 jam` : ""}`}>
                <Link href="/claims" className="flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
                  Buka antrian <ArrowRight className="size-3.5" />
                </Link>
              </Kpi>
              <Kpi label="Anomali aktif" value={m.active_anomalies} sub="Resi yang perlu diinvestigasi" />
              <Kpi label="Nilai bisa dipulihkan" value={formatRupiah(m.estimated_value_saved)} sub={`Dari ${m.active_anomalies} anomali aktif`} />
              <Kpi label="Sudah pulih" value={formatRupiah(recovered)} sub={`${m.submitted_claims} klaim terkirim`} accent />
            </>
          )}
        </section>
      )}

      {/* Baris 2: antrian keputusan + aktivitas agen */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel className="flex flex-col">
          <h2 className="text-xl font-semibold">Butuh keputusan Anda</h2>
          <p className="mb-4 text-[13px] text-muted-foreground">Diurutkan dari sisa waktu tersingkat, lalu nilai tertinggi</p>
          <DecisionTable rows={pendingRows} loading={pending.isPending} error={pending.error?.message} onRetry={() => pending.refetch()} />
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-[13px] text-muted-foreground">
            <span>Tidak ada klaim yang dikirim tanpa persetujuan Anda.</span>
            <Link href="/claims" className="flex items-center gap-1 font-medium text-primary hover:underline">
              Lihat semua {pending.data?.total ?? ""} kasus antrian <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </Panel>

        <Panel className="flex flex-col">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Aktivitas agen</h2>
            <span className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-primary">
              <Zap className="size-3" aria-hidden /> LIVE
            </span>
          </div>
          <ActivityFeed logs={logs.data} loading={logs.isPending} error={logs.error?.message} />
          <Link href="/settings/audit-log" className="mt-auto flex items-center gap-1 border-t pt-4 text-[13px] font-medium text-primary hover:underline">
            Lihat log audit <ArrowRight className="size-3.5" />
          </Link>
        </Panel>
      </div>

      {/* Baris 3: tren + kinerja */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Tren {m?.trend.length ?? 7} hari</h2>
            <div className="flex gap-4 text-[13px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-chart-2" />Anomali terdeteksi</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-primary" />Klaim diajukan</span>
            </div>
          </div>
          <div className="h-48">
            {!m ? (
              <Skeleton className="size-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={m.trend} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tickFormatter={(d: string) => formatDate(d).replace(/ \d{4}$/, "")} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip labelFormatter={(d: string) => formatDate(d)} />
                  <Line type="linear" dataKey="anomalies" name="Anomali" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 3, fill: "white" }} isAnimationActive={false} />
                  <Line type="linear" dataKey="claims" name="Klaim" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3, fill: "white" }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel className="flex flex-col gap-5">
          <h2 className="text-xl font-semibold">Kinerja agen</h2>
          {m?.avg_processing_sec != null ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[13px] font-medium">
                <span>Rata-rata waktu proses</span>
                <span className="text-primary">
                  {Math.round(m.avg_processing_sec)} dtk <span className="font-normal text-muted-foreground">(target &lt; {TARGET_SEC} dtk)</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${m.avg_processing_sec <= TARGET_SEC ? "bg-primary" : "bg-destructive"}`}
                  style={{ width: `${Math.min(100, (m.avg_processing_sec / TARGET_SEC) * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">{m ? "Belum ada investigasi selesai." : "Memuat…"}</p>
          )}
          <p className="mt-auto border-t pt-3 text-[13px] text-muted-foreground">Diukur dari kasus dibuka sampai draf klaim siap.</p>
        </Panel>
      </div>
    </div>
  );
}

function DecisionTable({ rows, loading, error, onRetry }: { rows: ClaimSummary[]; loading: boolean; error?: string; onRetry: () => void }) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading) return <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (!rows.length) return <EmptyState title="Semua klaim sudah ditinjau" description="Draf klaim baru dari agen akan muncul di sini." />;

  // Sama dengan Antrian klaim (F2): tenggat terdekat dulu, lalu nilai tertinggi
  const due = (c: ClaimSummary) => (c.claim_deadline ? new Date(c.claim_deadline).getTime() : Number.MAX_SAFE_INTEGER);
  const sorted = [...rows].sort((a, b) => due(a) - due(b) || b.claim_value - a.claim_value);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-[13px] text-muted-foreground">
          <tr>
            <th className="px-2 py-2 font-medium">Kasus</th>
            <th className="px-2 py-2 font-medium">Resi &amp; kurir</th>
            <th className="px-2 py-2 text-right font-medium">Bisa diklaim</th>
            <th className="px-2 py-2 font-medium">Sisa waktu</th>
            <th className="px-2 py-2 font-medium">Keyakinan</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((c) => {
            return (
              <tr key={c.id}>
                <td className="px-2 py-3 font-medium whitespace-nowrap">{c.id.toUpperCase()}</td>
                <td className="px-2 py-3">
                  <div className="font-mono text-[13px]">{c.tracking_number}</div>
                  <div className="text-xs text-muted-foreground">{COURIER_LABEL[c.courier] ?? c.courier}</div>
                </td>
                <td className="px-2 py-3 text-right tabular-nums">{formatRupiah(c.claim_value)}</td>
                <td className="px-2 py-3"><ClaimDeadline deadline={c.claim_deadline} /></td>
                <td className="px-2 py-3"><ConfidenceLabel value={c.confidence} /></td>
                <td className="px-2 py-3 text-right">
                  <Button asChild size="sm" variant={c.confidence === null ? "outline" : "default"}>
                    <Link href={`/claims/${c.id}`}>{c.confidence === null ? "Lengkapi" : "Tinjau"}</Link>
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActivityFeed({ logs, loading, error }: { logs?: AuditLog[]; loading: boolean; error?: string }) {
  if (error) return <p className="py-6 text-sm text-destructive">{error}</p>;
  if (loading) return <div className="flex flex-col gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (!logs?.length) return <EmptyState title="Belum ada aktivitas" />;

  const time = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  return (
    <ol className="mb-4 flex flex-col gap-4">
      {logs.map((l, i) => {
        const ref = (l.payload_json.tracking_number as string | undefined) ?? l.entity_id?.toUpperCase();
        return (
          <li key={l.id} className="flex gap-3">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${i === 0 ? "bg-primary" : "bg-muted-foreground/50"}`} />
            <div className="text-sm">
              <p className="text-[13px] text-muted-foreground">{time.format(new Date(l.created_at))}</p>
              <p>
                {ACTOR_LABEL[l.actor] ?? l.actor} {ACTION_LABEL[l.action] ?? l.action.replaceAll("_", " ")}
                {ref && <span className="font-mono text-[13px]"> {ref}</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
