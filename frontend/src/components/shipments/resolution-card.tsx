"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, Loader2, Scale, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { RESOLUTION } from "@/lib/shipment-resolution";
import { cn } from "@/lib/utils";
import type { ShipmentDetail } from "@/types/api";

/**
 * Kesimpulan agentic yang tertulis pada resi sendiri: siapa yang bersalah menurut bukti, beserta
 * alasannya. Bila bukti belum cukup, kartu berubah menjadi ajakan mengumpulkan bukti.
 */
export function ResolutionCard({ shipment: s }: { shipment: ShipmentDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const inv = s.latest_investigation;
  const running = inv?.status === "queued" || inv?.status === "running";
  const canInvestigate = Boolean(s.anomaly) && !running;
  const start = useMutation({
    mutationFn: () => api.investigations.start(s.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shipment", s.id] }),
    onError: (err) => toast.error("Investigasi gagal dimulai", { description: err.message }),
  });
  const openInvestigation = () => (inv ? router.push(`/investigations/${inv.id}`) : start.mutate());

  const res = s.resolution ? RESOLUTION[s.resolution] : null;
  if (!res) {
    return (
      <section className="rounded-xl border bg-card p-6">
        <h2 className="flex items-center gap-2 font-semibold">
          <Scale className="size-4 text-muted-foreground" aria-hidden /> Kesimpulan sistem
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {inv?.outcome === "needs_evidence"
            ? "Agen belum bisa menetapkan siapa yang bersalah karena bukti masih kurang."
            : "Belum ada kesimpulan. Agent akan membandingkan rekaman packing dengan klaim pembeli, lalu menuliskan hasilnya di sini."}
        </p>
        {canInvestigate && (
          <Button variant="outline" className="mt-3" onClick={openInvestigation} disabled={start.isPending}>
            {running ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Investigasi dengan AI
          </Button>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <BadgeCheck className="size-4 text-muted-foreground" aria-hidden /> Kesimpulan sistem
        </h2>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[13px] font-medium", res.cls)}>{res.long}</span>
      </div>
      {s.resolution_reason && <p className="mt-3 text-sm">{s.resolution_reason}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
        {s.resolution !== "courier" && <span>Klaim ke kurir sebaiknya tidak diajukan.</span>}
        {inv?.id && (
          <Link href={`/investigations/${inv.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            Lihat bukti <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
    </section>
  );
}
