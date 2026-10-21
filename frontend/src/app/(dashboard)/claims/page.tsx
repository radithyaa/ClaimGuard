"use client";

import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { Info, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ClaimDeadline } from "@/components/claims/claim-deadline";
import { CASE_LABEL } from "@/components/shipments/status-badge";
import { Button } from "@/components/ui/button";
import { ConfidenceLabel } from "@/components/ui/confidence";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { COURIER_LABEL, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CaseType, ClaimStatus, ClaimSummary } from "@/types/api";

const TABS: { status: ClaimStatus | ""; label: string }[] = [
  { status: "pending_approval", label: "Butuh keputusan" },
  { status: "submitted", label: "Terkirim" },
  { status: "rejected", label: "Ditolak" },
  { status: "", label: "Semua" },
];

const STATUS: Record<ClaimStatus, { label: string; cls: string }> = {
  pending_approval: { label: "Siap ditinjau", cls: "bg-primary text-primary-foreground" },
  submitted: { label: "Terkirim", cls: "bg-info/15 text-info" },
  rejected: { label: "Ditolak", cls: "bg-destructive/10 text-destructive" },
};

const ALL = "all";
const BIG = Number.MAX_SAFE_INTEGER;

/** F2/F8: tenggat klaim paling dekat dulu, lalu nilai tertinggi; tanpa tenggat di akhir. */
function byUrgency(a: ClaimSummary, b: ClaimSummary) {
  const da = a.claim_deadline ? new Date(a.claim_deadline).getTime() : BIG;
  const db = b.claim_deadline ? new Date(b.claim_deadline).getTime() : BIG;
  return da - db || b.claim_value - a.claim_value;
}

export default function ClaimQueuePage() {
  const router = useRouter();
  const [status, setStatus] = useState<ClaimStatus | "">("pending_approval");
  const [q, setQ] = useState("");
  const [caseType, setCaseType] = useState<CaseType | "">("");
  const [cursor, setCursor] = useState(0);

  const query = useQuery({
    queryKey: ["claims", "queue", status],
    queryFn: () => api.claims.list({ status: status || undefined, limit: 100 }),
    placeholderData: keepPreviousData,
  });
  const counts = useQueries({
    queries: TABS.map((t) => ({
      queryKey: ["claims", "count", t.status],
      queryFn: () => api.claims.list({ status: t.status || undefined, limit: 1 }),
    })),
  });

  // API belum punya parameter pencarian: filter di klien atas hasil tab aktif
  const term = q.trim().toLowerCase();
  const rows = (query.data?.items ?? [])
    .filter((c) => !term || c.id.toLowerCase().includes(term) || c.tracking_number.toLowerCase().includes(term))
    .filter((c) => !caseType || c.case_type === caseType)
    // Antrian keputusan diurutkan menurut urgensi; riwayat tetap terbaru dulu (urutan API)
    .sort((a, b) => (status === "pending_approval" ? byUrgency(a, b) : 0));
  const pending = counts[0].data;
  const pendingRows = status === "pending_approval" ? query.data?.items ?? [] : [];
  const pendingValue = pendingRows.reduce((n, c) => n + c.claim_value, 0);

  // Pintasan J/K pindah baris, Enter buka kasus (tidak aktif saat mengetik)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey) return;
      if (e.key === "j") setCursor((c) => Math.min(c + 1, rows.length - 1));
      else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === "Enter" && rows[cursor]) router.push(`/claims/${rows[cursor].id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, router]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-[26px] leading-8 font-semibold">Antrian klaim</h1>
          <SimulatedBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          {pending ? `${pending.total} kasus menunggu keputusan` : "…"}
          {status === "pending_approval" && pendingRows.length > 0 && ` · total ${formatRupiah(pendingValue)} bisa dipulihkan`}
        </p>
      </header>

      <div role="tablist" aria-label="Status klaim" className="flex gap-6 overflow-x-auto border-b">
        {TABS.map((t, i) => {
          const active = status === t.status;
          return (
            <button
              key={t.label}
              role="tab"
              aria-selected={active}
              onClick={() => { setStatus(t.status); setCursor(0); }}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 pb-3 text-sm transition-colors",
                active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active && i === 0 ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {counts[i].data?.total ?? "–"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative sm:w-80">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setCursor(0); }}
          placeholder="Cari ID kasus atau resi"
          aria-label="Cari ID kasus atau resi"
          className="h-10 w-full rounded-lg border bg-card pr-3 pl-9 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </div>
      <Select value={caseType || ALL} onValueChange={(v) => { setCaseType(v === ALL ? "" : (v as CaseType)); setCursor(0); }}>
        <SelectTrigger className="h-10! rounded-lg bg-card sm:w-52" aria-label="Filter jenis kasus">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Semua jenis kasus</SelectItem>
          {Object.entries(CASE_LABEL).map(([v, label]) => (
            <SelectItem key={v} value={v}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      </div>

      <section className="overflow-hidden rounded-xl border bg-card">
        {query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : query.isPending ? (
          <div className="flex flex-col gap-2 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : rows.length === 0 ? (
          term || caseType ? (
            <EmptyState title="Tidak ada kasus yang cocok" description="Coba kata kunci atau jenis kasus lain." />
          ) : status === "pending_approval" ? (
            <EmptyState title="Semua klaim sudah ditinjau" description="Draf klaim baru dari agen akan muncul di sini." />
          ) : (
            <EmptyState title="Belum ada klaim" />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-[13px] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Kasus</th>
                  <th className="px-4 py-3 font-medium">Resi dan kurir</th>
                  <th className="px-4 py-3 text-right font-medium">Bisa diklaim</th>
                  <th className="px-4 py-3 font-medium">Sisa waktu klaim</th>
                  <th className="px-4 py-3 font-medium">Keyakinan</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((c, i) => (
                  <Row key={c.id} c={c} selected={i === cursor} onSelect={() => setCursor(i)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="flex items-center gap-2 rounded-xl border bg-muted px-4 py-3 text-sm">
        <Info className="size-4 shrink-0" aria-hidden /> Persetujuan massal tidak tersedia. Setiap klaim ditinjau satu per satu agar buktinya benar-benar diperiksa.
      </p>
      <p className="text-[13px] text-muted-foreground">
        Pintasan: <kbd className="rounded border px-1.5">J</kbd> dan <kbd className="rounded border px-1.5">K</kbd> untuk pindah baris,{" "}
        <kbd className="rounded border px-1.5">Enter</kbd> untuk membuka kasus.
      </p>
    </div>
  );
}

function Row({ c, selected, onSelect }: { c: ClaimSummary; selected: boolean; onSelect: () => void }) {
  const pending = c.status === "pending_approval";
  return (
    <tr onClick={onSelect} className={cn("cursor-default", selected && "bg-accent/50 shadow-[inset_3px_0_0_var(--primary)]")}>
      <td className="px-4 py-3">
        <div className="font-medium whitespace-nowrap">{c.id.toUpperCase()}</div>
        {c.case_type && <div className="text-xs whitespace-nowrap text-muted-foreground">{CASE_LABEL[c.case_type]}</div>}
      </td>
      <td className="px-4 py-3">
        <div className="font-mono text-[13px]">{c.tracking_number}</div>
        <div className="text-xs text-muted-foreground">{COURIER_LABEL[c.courier] ?? c.courier}</div>
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">{formatRupiah(c.claim_value)}</td>
      <td className="px-4 py-3">{pending ? <ClaimDeadline deadline={c.claim_deadline} /> : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3 whitespace-nowrap"><ConfidenceLabel value={c.confidence} bars /></td>
      <td className="px-4 py-3">
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", STATUS[c.status].cls)}>{STATUS[c.status].label}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <Button asChild size="sm" variant={pending ? "default" : "outline"}>
          <Link href={`/claims/${c.id}`}>{pending ? "Tinjau" : "Lihat"}</Link>
        </Button>
      </td>
    </tr>
  );
}
