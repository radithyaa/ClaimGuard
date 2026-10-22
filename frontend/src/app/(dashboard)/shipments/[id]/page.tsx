"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, MessageSquareWarning } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { AnomalyCard } from "@/components/shipments/anomaly-card";
import { ClaimPanel } from "@/components/shipments/claim-panel";
import { ResolutionCard } from "@/components/shipments/resolution-card";
import { ShipmentTimeline } from "@/components/shipments/shipment-timeline";
import { Button } from "@/components/ui/button";
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api-client";
import { COURIER_LABEL, formatDate, formatDateTime, formatRupiah } from "@/lib/format";

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: ["shipment", id], queryFn: () => api.shipments.get(id) });

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <section className="rounded-xl border bg-card">
        {notFound ? (
          <div className="flex flex-col items-center pb-8">
            <EmptyState title="Resi tidak ditemukan" description="Periksa kembali nomor resi, atau cari dari daftar resi." />
            <Button asChild variant="outline"><Link href="/shipments">Kembali ke daftar resi</Link></Button>
          </div>
        ) : (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        )}
      </section>
    );
  }

  if (query.isPending)
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton className="h-14 w-80" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <Skeleton className="h-56" />
            <Skeleton className="h-80" />
          </div>
          <Skeleton className="h-[32rem]" />
        </div>
      </div>
    );

  const s = query.data;
  const courier = COURIER_LABEL[s.courier] ?? s.courier;
  const latest = [...s.tracking_events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];

  function copy() {
    navigator.clipboard.writeText(s.tracking_number).then(
      () => toast.success("Nomor resi disalin"),
      () => toast.error("Gagal menyalin"),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-[26px] leading-8 font-semibold">{s.tracking_number}</h1>
            {s.is_simulated && <SimulatedBadge />}
          </div>
          <p className="text-muted-foreground">
            {courier} · dikirim {formatDate(s.shipped_at)} · {s.item_name} ({formatRupiah(s.item_value)})
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={copy} aria-label="Salin nomor resi" title="Salin nomor resi">
          <Copy />
        </Button>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <AnomalyCard shipment={s} />
          <ResolutionCard shipment={s} />

          {s.buyer_report && (
            <section className="rounded-xl border bg-card p-6">
              <h2 className="mb-2 flex items-center gap-2 font-semibold">
                <MessageSquareWarning className="size-4 text-muted-foreground" aria-hidden /> Laporan pembeli
              </h2>
              <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic">{s.buyer_report}</blockquote>
            </section>
          )}

          <section className="rounded-xl border bg-card p-6">
            <div className="mb-5 flex items-center justify-between border-b pb-4">
              <h2 className="text-xl font-semibold">Riwayat pengiriman</h2>
              <span className="text-sm text-muted-foreground">{s.tracking_events.length} pembaruan log</span>
            </div>
            <ShipmentTimeline events={s.tracking_events} stalled={s.anomaly?.case_type === "lost"} />
            <div className="mt-5 flex flex-wrap justify-between gap-2 border-t pt-4 text-sm text-muted-foreground">
              <span>
                Sumber: pelacakan {courier}
                {s.is_simulated ? " (simulasi)" : ""}
              </span>
              {latest && <span>Pembaruan terakhir: {formatDateTime(latest.occurred_at)}</span>}
            </div>
          </section>
        </div>

        <ClaimPanel shipment={s} />
      </div>
    </div>
  );
}
