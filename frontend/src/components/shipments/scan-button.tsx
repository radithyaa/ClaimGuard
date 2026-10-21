"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

/** Memicu Monitoring Agent memindai resi sekarang, lalu menyegarkan semua data. */
export function ScanButton() {
  const qc = useQueryClient();
  const scan = useMutation({
    mutationFn: api.monitoring.scan,
    onSuccess: (r) => {
      toast.success(`Memindai ${r.scanned} resi · ${r.new_anomalies.length} anomali baru`);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button variant="outline" onClick={() => scan.mutate()} disabled={scan.isPending}>
      <Radar className={scan.isPending ? "animate-spin" : ""} aria-hidden />
      {scan.isPending ? "Memindai…" : "Scan sekarang"}
    </Button>
  );
}
