"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Clock, Info, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { COURIER_LABEL, formatDateTime, formatRelative, formatRupiah } from "@/lib/format";
import type { ShipmentDetail } from "@/types/api";

/** Panel kanan detail resi: batas waktu, nilai, aturan klaim kurir, dan aksi investigasi. */
export function ClaimPanel({ shipment: s }: { shipment: ShipmentDetail }) {
  const router = useRouter();
  const courier = COURIER_LABEL[s.courier] ?? s.courier;
  const policies = useQuery({ queryKey: ["courier-policies"], queryFn: api.couriers.policies });
  const policy = policies.data?.find((p) => p.courier === s.courier);

  const { anomaly, latest_investigation: inv, latest_claim: claim } = s;
  const running = inv?.status === "queued" || inv?.status === "running";
  const start = useMutation({
    mutationFn: () => api.investigations.start(s.id),
    onSuccess: ({ investigation_id }) => router.push(`/investigations/${investigation_id}`),
    onError: (err) => toast.error("Investigasi gagal dimulai", { description: err.message }),
  });

  const left = new Date(s.sla_deadline).getTime() - Date.now();
  const done = s.status === "delivered" || s.status === "returned";

  return (
    <aside className="flex flex-col gap-5 rounded-xl border bg-card p-6">
      <div>
        <p className="text-sm text-muted-foreground">Batas SLA</p>
        {done ? (
          <p className="mt-1 flex items-center gap-2"><Info className="size-4 text-muted-foreground" aria-hidden /> Pengiriman sudah selesai</p>
        ) : (
          <p className={`mt-1 flex items-center gap-2 text-2xl font-semibold ${left < 48 * 3600e3 ? "text-destructive" : ""}`}>
            <Clock className="size-5" aria-hidden />
            {left < 0 ? `lewat ${formatRelative(s.sla_deadline).replace(/ yang lalu$/, "")}` : formatRelative(s.sla_deadline)}
          </p>
        )}
        <p className="text-sm text-muted-foreground">Batas: {formatDateTime(s.sla_deadline)}</p>
      </div>

      <div className="border-t pt-5">
        <p className="text-[13px] font-medium tracking-[0.65px] text-muted-foreground uppercase">Nilai barang</p>
        <p className="text-4xl font-semibold tracking-tight">{formatRupiah(s.item_value)}</p>
        <p className="text-sm text-muted-foreground">Ganti rugi akhir mengikuti aturan {courier}.</p>
      </div>

      <div className="border-t pt-5">
        <p className="mb-2 flex items-center justify-between">
          Aturan klaim {courier}
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
        </p>
        {policies.isPending ? (
          <Skeleton className="h-20" />
        ) : policy ? (
          <>
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />Batas pengajuan {policy.claim_window_days} hari</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />Ganti rugi: {policy.max_compensation}</li>
              {policy.required_docs.length > 0 && (
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />Bukti wajib: {policy.required_docs.join(", ")}</li>
              )}
            </ul>
            <p className="mt-3 text-[13px] text-muted-foreground">
              Diekstrak {formatDateTime(policy.extracted_at)}{policy.source === "cache" ? " (cache)" : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Aturan kurir belum tersedia.</p>
        )}
        <Link href="/couriers" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
          Lihat aturan <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <div className="flex flex-col gap-3 border-t pt-5 text-center">
        {anomaly ? (
          <>
            {running ? (
              <Button asChild size="lg">
                <Link href={`/investigations/${inv!.id}`}><Loader2 className="animate-spin" /> Lihat investigasi berjalan</Link>
              </Button>
            ) : (
              <Button size="lg" onClick={() => start.mutate()} disabled={start.isPending}>
                {start.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Investigasi dengan AI
              </Button>
            )}
            <p className="text-sm text-muted-foreground">
              Agen memotong rekaman packing, membaca aturan {courier}, lalu menyusun draf. Tidak ada yang dikirim tanpa persetujuan Anda.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Investigasi tersedia saat Monitoring Agent menandai anomali.</p>
        )}
        {inv && !running && (
          <Button variant="outline" asChild><Link href={`/investigations/${inv.id}`}>Investigasi terakhir</Link></Button>
        )}
        {claim && (
          <Button variant="outline" asChild><Link href={`/claims/${claim.id}`}>Buka klaim</Link></Button>
        )}
        <Link href="/shipments" className="text-[13px] text-muted-foreground hover:text-foreground">Kembali ke daftar resi</Link>
      </div>
    </aside>
  );
}
