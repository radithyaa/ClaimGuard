"use client";

import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Keyboard } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { FilterBar, type ShipmentFilters } from "@/components/shipments/filter-bar";
import { ScanButton } from "@/components/shipments/scan-button";
import { ShipmentTable } from "@/components/shipments/shipment-table";
import { Button } from "@/components/ui/button";
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [10, 20, 50];

// Tab = filter status di server; jumlahnya diambil dari `total` (limit=1)
const TABS = [
  { status: "", label: "Semua" },
  { status: "in_transit", label: "Dalam perjalanan" },
  { status: "out_for_delivery", label: "Diantar" },
  { status: "delivered", label: "Terkirim" },
  { status: "returned", label: "Diretur" },
];

export default function ShipmentsPage() {
  // ?q= dari pencarian topbar
  const urlQ = useSearchParams().get("q") ?? "";
  const [filters, setFilters] = useState<ShipmentFilters>({ q: urlQ, status: "", courier: "" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => {
    setFilters((f) => ({ ...f, q: urlQ }));
    setPage(0);
  }, [urlQ]);
  const q = useDebouncedValue(filters.q);

  const query = useQuery({
    queryKey: ["shipments", { ...filters, q, page, pageSize }],
    queryFn: () =>
      api.shipments.list({ q, status: filters.status, courier: filters.courier, limit: pageSize, offset: page * pageSize }),
    placeholderData: keepPreviousData,
  });

  const counts = useQueries({
    queries: TABS.map((t) => ({
      queryKey: ["shipments", "count", t.status],
      queryFn: () => api.shipments.list({ status: t.status, limit: 1 }),
    })),
  });
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.metrics.summary });

  const update = (v: Partial<ShipmentFilters>) => {
    setFilters((f) => ({ ...f, ...v }));
    setPage(0);
  };

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const rows = query.data?.items ?? [];
  const allCount = counts[0].data?.total;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[26px] leading-8 font-semibold">Resi</h1>
            <SimulatedBadge />
          </div>
          <p className="text-sm text-muted-foreground">
            {allCount ?? "…"} resi · {metrics.data?.active_anomalies ?? "…"} dengan anomali
          </p>
        </div>
        <ScanButton />
      </header>

      <div role="tablist" aria-label="Status pengiriman" className="flex gap-6 overflow-x-auto border-b">
        {TABS.map((t, i) => {
          const active = filters.status === t.status;
          return (
            <button
              key={t.label}
              role="tab"
              aria-selected={active}
              onClick={() => update({ status: t.status })}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 pb-3 text-sm transition-colors",
                active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className={cn("rounded-md px-1.5 text-[13px] tabular-nums", active ? "bg-accent" : "")}>
                {counts[i].data?.total ?? "–"}
              </span>
            </button>
          );
        })}
      </div>

      <FilterBar value={filters} onChange={update} />

      <section className="overflow-hidden rounded-xl border bg-card">
        {query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : !query.isPending && rows.length === 0 ? (
          <EmptyState title="Tidak ada resi yang cocok" description="Coba ubah kata kunci, tab, atau filter kurir." />
        ) : (
          <ShipmentTable rows={rows} loading={query.isPending} />
        )}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
            <label className="flex items-center gap-2">
              Baris per halaman:
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="h-8 rounded-md border bg-background px-2 text-foreground"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-3">
              <span aria-live="polite">
                {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} dari {total}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="size-8" aria-label="Halaman sebelumnya" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="icon" className="size-8" aria-label="Halaman berikutnya" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Keyboard className="size-4" aria-hidden /> Tekan Ctrl K untuk mencari resi dari halaman mana pun.
      </p>
    </div>
  );
}
