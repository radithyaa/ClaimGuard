"use client";

import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { Info, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { COURIER_LABEL, formatRelative, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClaimStatus, ClaimSummary } from "@/types/api";

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

function Confidence({ value }: { value: number | null }) {
  const level = value === null ? 0 : value >= 0.8 ? 3 : value >= 0.6 ? 2 : 1;
  const label = value === null ? "Perlu dicek" : ["", "Rendah", "Sedang", "Tinggi"][level];
  return (
    <span className="flex items-center gap-2" title={value !== null ? `${Math.round(value * 100)}%` : undefined}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => <span key={i} className={cn("h-1.5 w-3 rounded-full", i <= level ? "bg-foreground" : "bg-muted-foreground/30")} />)}
      </span>
      {label}
    </span>
  );
}

export default function ClaimQueuePage() {
  const router = useRouter();
  const [status, setStatus] = useState<ClaimStatus | "">("pending_approval");
  const [q, setQ] = useState("");
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
  const rows = (query.data?.items ?? []).filter(
    (c) => !term || c.id.toLowerCase().includes(term) || c.tracking_number.toLowerCase().includes(term),
  );
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

      <section className="overflow-hidden rounded-xl border bg-card">
        {query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : query.isPending ? (
          <div className="flex flex-col gap-2 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : rows.length === 0 ? (
          term ? (
            <EmptyState title="Tidak ada kasus yang cocok" description="Coba kata kunci lain." />
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
                  <th className="px-4 py-3 font-medium">Dibuat</th>
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
      <td className="px-4 py-3 font-medium whitespace-nowrap">{c.id.toUpperCase()}</td>
      <td className="px-4 py-3">
        <div className="font-mono text-[13px]">{c.tracking_number}</div>
        <div className="text-xs text-muted-foreground">{COURIER_LABEL[c.courier] ?? c.courier}</div>
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">{formatRupiah(c.claim_value)}</td>
      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatRelative(c.created_at)}</td>
      <td className="px-4 py-3 whitespace-nowrap"><Confidence value={c.confidence} /></td>
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
