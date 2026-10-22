"use client";

import { useQuery } from "@tanstack/react-query";
import { Ban, CircleCheck, Clock, Copy, Download, Info } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CASE_LABEL } from "@/components/shipments/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { COURIER_LABEL, formatDate, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CaseType, ClaimSummary } from "@/types/api";

// Perkiraan waktu admin per klaim manual (belum divalidasi, sama dengan desain)
const MINUTES_PER_CLAIM = 20;
const ALL = "all";
const CASE_ORDER: (CaseType | "unknown")[] = ["lost", "damaged", "return_fraud", "unknown"];

const monthKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const monthLabel = (key: string) =>
  new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
const courierName = (c: string) => COURIER_LABEL[c] ?? c;

const STATUS = {
  submitted: { label: "Terkirim", cls: "bg-success/10 text-success", icon: CircleCheck },
  rejected: { label: "Ditolak", cls: "bg-destructive/10 text-destructive", icon: Ban },
  pending_approval: { label: "Menunggu", cls: "bg-info/10 text-info", icon: Clock },
} as const;

export default function RecoveryReportPage() {
  // limit=100 adalah batas API; cukup untuk skala demo hackathon
  const query = useQuery({ queryKey: ["claims", "report"], queryFn: () => api.claims.list({ limit: 100 }) });
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.metrics.summary });
  const reviewSec = metrics.data?.avg_review_sec;
  const all = useMemo(() => query.data?.items ?? [], [query.data]);
  const months = useMemo(() => [...new Set(all.map((c) => monthKey(c.created_at)))].sort().reverse(), [all]);
  const [month, setMonth] = useState<string>("");
  const active = month || months[0] || ALL;
  const claims = active === ALL ? all : all.filter((c) => monthKey(c.created_at) === active);
  const period = active === ALL ? "semua periode" : monthLabel(active);

  const r = useMemo(() => {
    const by = (s: ClaimSummary["status"]) => claims.filter((c) => c.status === s);
    const submitted = by("submitted");
    const rejected = by("rejected");
    const pending = by("pending_approval");
    const recovered = submitted.reduce((n, c) => n + c.claim_value, 0);
    const decided = submitted.length + rejected.length;
    const perCourier = Object.entries(
      submitted.reduce<Record<string, { value: number; count: number }>>((acc, c) => {
        acc[c.courier] ??= { value: 0, count: 0 };
        acc[c.courier].value += c.claim_value;
        acc[c.courier].count += 1;
        return acc;
      }, {}),
    ).sort((a, b) => b[1].value - a[1].value);
    return {
      submitted, rejected, pending, recovered, decided, perCourier,
      pendingValue: pending.reduce((n, c) => n + c.claim_value, 0),
      rate: decided ? Math.round((submitted.length / decided) * 100) : null,
      hours: Math.round((submitted.length * MINUTES_PER_CLAIM) / 6) / 10,
    };
  }, [claims]);

  const finished = [...r.submitted, ...r.rejected].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const maxCourier = Math.max(1, ...r.perCourier.map(([, v]) => v.value));

  function exportCsv() {
    const rows = [
      ["id_kasus", "resi", "kurir", "jenis_kasus", "status", "nilai_klaim", "dibuat", "simulasi"],
      ...claims.map((c) => [c.id, c.tracking_number, courierName(c.courier), c.case_type ?? "", c.status, c.claim_value, c.created_at, c.is_simulated]),
    ];
    const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `laporan-uang-pulih-${active}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  function copySummary() {
    const text =
      `Laporan uang pulih ClaimGuard (${period})\n` +
      `${formatRupiah(r.recovered)} diajukan kembali dari ${r.submitted.length} klaim terkirim.\n` +
      `Ditolak: ${r.rejected.length} · Menunggu keputusan: ${r.pending.length}` +
      (r.rate !== null ? ` · Tingkat keberhasilan ${r.rate}%` : "") +
      (all.some((c) => c.is_simulated) ? "\n(Data simulasi)" : "");
    navigator.clipboard.writeText(text).then(() => toast.success("Ringkasan disalin"), () => toast.error("Gagal menyalin"));
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] leading-8 font-semibold">Laporan uang pulih</h1>
          {months.length > 0 && (
            <Select value={active} onValueChange={setMonth}>
              <SelectTrigger className="w-44 bg-card" aria-label="Periode"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
                <SelectItem value={ALL}>Semua periode</SelectItem>
              </SelectContent>
            </Select>
          )}
          <SimulatedBadge />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!claims.length}><Download /> Ekspor CSV</Button>
          <Button variant="ghost" className="text-primary" onClick={copySummary} disabled={!claims.length}><Copy /> Salin ringkasan</Button>
        </div>
      </header>

      {query.isError ? (
        <section className="rounded-xl border bg-card"><ErrorState message={`Laporan gagal dihitung. ${query.error.message}`} onRetry={() => query.refetch()} /></section>
      ) : query.isPending ? (
        <div className="flex flex-col gap-6" aria-busy>
          <Skeleton className="h-24 w-96" />
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : claims.length === 0 ? (
        <section className="rounded-xl border bg-card">
          <EmptyState title="Belum ada uang pulih" description="Klaim yang disetujui dan dikirim ke kurir akan dihitung di sini." />
        </section>
      ) : (
        <>
          <section>
            <p className="text-5xl font-semibold tracking-tight tabular-nums">{formatRupiah(r.recovered)}</p>
            <p className="mt-2 text-lg">diajukan kembali ke kurir dari {r.submitted.length} klaim terkirim · {period}</p>
            {r.submitted.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Setara sekitar {r.hours} jam kerja admin yang dihemat (perkiraan {MINUTES_PER_CLAIM} menit per klaim, belum divalidasi).
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="grid divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
              <Stat label="Klaim dibuat agen" value={claims.length} sub={`Total ${period}`} icon={Info} />
              <Stat label="Terkirim" value={r.submitted.length} sub={`Senilai ${formatRupiah(r.recovered)}`} icon={CircleCheck} tone="text-success" />
              <Stat label="Ditolak admin" value={r.rejected.length} sub="Tidak dikirim ke kurir" icon={Ban} tone="text-destructive" />
              <Stat label="Menunggu keputusan" value={r.pending.length} sub={`Senilai ${formatRupiah(r.pendingValue)}`} icon={Clock} tone="text-info" />
            </div>
            {reviewSec != null && (
              <p className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-4 text-sm">
                <span className="flex items-center gap-2">
                  <Clock className="size-4 text-muted-foreground" aria-hidden /> Rata-rata waktu keputusan admin
                </span>
                <span>
                  <span className="font-semibold tabular-nums">
                    {reviewSec >= 60 ? `${Math.floor(reviewSec / 60)} mnt ${Math.round(reviewSec % 60)} dtk` : `${Math.round(reviewSec)} dtk`}
                  </span>
                  <span className="text-muted-foreground"> · dari {metrics.data?.reviewed_claims ?? 0} keputusan, semua periode</span>
                </span>
              </p>
            )}
            {r.rate !== null && (
              <div className="border-t px-5 py-4">
                <div className="mb-2 flex justify-between text-sm">
                  <span>Tingkat keberhasilan · {r.submitted.length} dari {r.decided} yang sudah diputuskan</span>
                  <span className="font-medium text-primary">{r.rate}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${r.rate}%` }} />
                </div>
              </div>
            )}
          </section>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <section className="rounded-xl border bg-card p-5">
              <h2 className="text-xl font-semibold">Uang pulih per kurir</h2>
              <p className="mb-5 text-sm text-muted-foreground">Berdasarkan nilai klaim yang sudah dikirim</p>
              {r.perCourier.length ? (
                <ul className="flex flex-col gap-4">
                  {r.perCourier.map(([courier, v]) => (
                    <li key={courier}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{courierName(courier)}</span>
                        <span className="text-muted-foreground">{v.count} klaim</span>
                      </div>
                      <div className="h-7 overflow-hidden rounded-md bg-muted">
                        <div
                          className="flex h-full min-w-fit items-center justify-end rounded-md bg-primary px-2 text-[13px] font-medium text-primary-foreground"
                          style={{ width: `${(v.value / maxCourier) * 100}%` }}
                        >
                          {formatRupiah(v.value)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Belum ada klaim terkirim pada periode ini.</p>
              )}
            </section>

            <section className="rounded-xl border bg-card p-5">
              <h2 className="text-xl font-semibold">Per jenis kasus</h2>
              <p className="mb-3 text-sm text-muted-foreground">Nilai klaim terkirim dan tingkat keberhasilan per jenis</p>
              <ul className="divide-y">
                {CASE_ORDER.map((type) => {
                  const rows = claims.filter((c) => (c.case_type ?? "unknown") === type);
                  if (!rows.length) return null;
                  const sent = rows.filter((c) => c.status === "submitted");
                  const decided = rows.filter((c) => c.status !== "pending_approval").length;
                  return (
                    <li key={type} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <p>{type === "unknown" ? "Belum tercatat" : CASE_LABEL[type]}</p>
                        <p className="text-[13px] text-muted-foreground">
                          {rows.length} klaim · {sent.length} terkirim
                          {decided ? ` · ${Math.round((sent.length / decided) * 100)}% berhasil` : ""}
                        </p>
                      </div>
                      <span className="tabular-nums">{formatRupiah(sent.reduce((n, c) => n + c.claim_value, 0))}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 flex items-end justify-between border-t pt-4">
                <span className="text-sm">Uang pulih</span>
                <span className="text-2xl font-semibold text-primary tabular-nums">{formatRupiah(r.recovered)}</span>
              </div>
            </section>
          </div>

          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                Klaim selesai <span className="rounded-full bg-muted px-2 text-[13px] font-normal">{finished.length} kasus</span>
              </h2>
              <p className="text-[13px] text-muted-foreground">Kasus yang sudah mencapai keputusan akhir</p>
            </div>
            {finished.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-[13px] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">Kasus</th>
                      <th className="px-3 py-2.5 font-medium">Kurir</th>
                      <th className="px-3 py-2.5 font-medium">Resi</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 text-right font-medium">Nilai pulih</th>
                      <th className="px-3 py-2.5 font-medium">Tanggal</th>
                      <th className="px-3 py-2.5 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {finished.map((c) => {
                      const st = STATUS[c.status];
                      return (
                        <tr key={c.id}>
                          <td className="px-3 py-3 font-mono text-[13px] text-primary">{c.id.toUpperCase()}</td>
                          <td className="px-3 py-3">{courierName(c.courier)}</td>
                          <td className="px-3 py-3 font-mono text-[13px]">{c.tracking_number}</td>
                          <td className="px-3 py-3">
                            <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs", st.cls)}><st.icon className="size-3.5" aria-hidden />{st.label}</span>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{formatRupiah(c.status === "submitted" ? c.claim_value : 0)}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{formatDate(c.created_at)}</td>
                          <td className="px-3 py-3 text-right"><Link href={`/claims/${c.id}`} className="text-primary hover:underline">Lihat detail</Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Belum ada klaim yang diputuskan pada periode ini.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon, tone }: { label: string; value: number; sub: string; icon: typeof Info; tone?: string }) {
  return (
    <div className="p-5">
      <p className={cn("flex items-center justify-between text-sm", tone ?? "text-muted-foreground")}>{label}<Icon className="size-4" aria-hidden /></p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
      <p className={cn("text-[13px]", tone ?? "text-muted-foreground")}>{sub}</p>
    </div>
  );
}
