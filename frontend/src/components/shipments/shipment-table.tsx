"use client";

import { AlertTriangle, Clock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ClaimDeadline } from "@/components/claims/claim-deadline";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COURIER_LABEL, formatRelative, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Severity, Shipment } from "@/types/api";

import { CASE_LABEL, STATUS_OPTIONS } from "./status-badge";

const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));
const PRIORITY: Record<Severity, string> = { high: "Prioritas tinggi", medium: "Prioritas sedang", low: "Prioritas rendah" };
const URGENT_MS = 48 * 3600 * 1000;

function SlaCell({ s }: { s: Shipment }) {
  if (s.status === "delivered" || s.status === "returned") return <span className="text-muted-foreground">Selesai</span>;
  const left = new Date(s.sla_deadline).getTime() - Date.now();
  const urgent = left < URGENT_MS;
  return (
    <span className={cn("flex items-center gap-1.5", urgent ? "text-destructive" : "text-muted-foreground")}>
      {urgent && <Clock className="size-4 shrink-0" aria-hidden />}
      {left < 0 ? `lewat ${formatRelative(s.sla_deadline).replace(/ yang lalu$/, "")}` : formatRelative(s.sla_deadline)}
    </span>
  );
}

export function ShipmentTable({ rows, loading }: { rows: Shipment[]; loading?: boolean }) {
  const router = useRouter();
  return (
    <Table>
      <TableHeader className="bg-muted">
        <TableRow>
          <TableHead className="pl-4">Resi</TableHead>
          <TableHead>Pesanan</TableHead>
          <TableHead className="hidden md:table-cell">Status pengiriman</TableHead>
          <TableHead>Anomali</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Nilai barang</TableHead>
          <TableHead className="hidden pr-4 md:table-cell">Sisa waktu</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading
          ? Array.from({ length: 6 }, (_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 6 }, (_, j) => (
                  <TableCell key={j} className={cn("py-4", j === 2 || j === 5 ? "hidden md:table-cell" : j === 4 ? "hidden lg:table-cell" : "")}>
                    <Skeleton className="h-4 w-full max-w-28" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : rows.map((s) => (
              <TableRow
                key={s.id}
                className={cn("cursor-pointer", s.active_anomaly?.severity === "high" && "bg-muted/50")}
                onClick={() => router.push(`/shipments/${s.id}`)}
                data-anomaly={s.active_anomaly ? "true" : undefined}
              >
                <TableCell className="py-4 pl-4">
                  {/* Link tetap ada agar baris dapat diakses keyboard (NFR-09) */}
                  <Link href={`/shipments/${s.id}`} className="font-mono text-sm hover:underline" onClick={(e) => e.stopPropagation()}>
                    {s.tracking_number}
                  </Link>
                  <div className="text-[13px] text-muted-foreground">{COURIER_LABEL[s.courier] ?? s.courier}</div>
                </TableCell>
                <TableCell className="max-w-48 py-4 whitespace-normal">
                  <div>{s.item_name}</div>
                  <div className="text-[13px] text-muted-foreground">
                    {s.origin} → {s.destination}
                  </div>
                </TableCell>
                <TableCell className="hidden py-4 md:table-cell">{STATUS_LABEL[s.status] ?? s.status}</TableCell>
                <TableCell className="py-4 whitespace-normal">
                  {s.active_anomaly ? (
                    <>
                      <div className="flex items-start gap-1.5 text-warning-foreground dark:text-warning">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                        {CASE_LABEL[s.active_anomaly.case_type]}
                      </div>
                      <div className="text-[13px] text-muted-foreground">{PRIORITY[s.active_anomaly.severity]}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Normal</span>
                  )}
                </TableCell>
                <TableCell className="hidden py-4 text-right tabular-nums lg:table-cell">{formatRupiah(s.item_value)}</TableCell>
                <TableCell className="hidden py-4 pr-4 md:table-cell">
                  {/* Resi beranomali: tenggat klaim kurir (F3); selainnya batas SLA pengiriman */}
                  {s.active_anomaly ? (
                    <span className="flex flex-col">
                      <ClaimDeadline deadline={s.claim_deadline} />
                      <span className="text-xs text-muted-foreground">tenggat klaim</span>
                    </span>
                  ) : (
                    <SlaCell s={s} />
                  )}
                </TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );
}
