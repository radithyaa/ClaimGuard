"use client";

import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { actionLabel, actorLabel } from "@/lib/audit-labels";
import { formatDateTime } from "@/lib/format";
import { RESOLUTION } from "@/lib/shipment-resolution";
import type { ShipmentResolution } from "@/types/api";

function detail(payload: Record<string, unknown>) {
  const parts: string[] = [];
  if (typeof payload.review_sec === "number") parts.push(`waktu tinjau ${Math.round(payload.review_sec)} dtk`);
  if (typeof payload.reason === "string") parts.push(`alasan: ${payload.reason}`);
  if (typeof payload.submission_ref === "string") parts.push(`tiket ${payload.submission_ref}`);
  if (payload.guard_applied === true) parts.push("diturunkan oleh ambang keyakinan");
  if (typeof payload.party === "string") {
    const party = RESOLUTION[payload.party as ShipmentResolution]?.short ?? payload.party;
    parts.push(`kesalahan: ${party}`);
  }
  return parts.join(" · ");
}

/** Log audit satu kasus (klaim + investigasinya): siapa melakukan apa, kapan. */
export function CaseAuditLog({ ids }: { ids: string[] }) {
  const logs = useQuery({ queryKey: ["audit-logs", ...ids], queryFn: () => api.auditLogs.forEntities(ids) });
  return (
    <section className="rounded-xl border bg-card p-5">
      {logs.isError ? (
        <ErrorState message={logs.error.message} onRetry={() => logs.refetch()} />
      ) : !logs.data ? (
        <Skeleton className="h-32" />
      ) : !logs.data.length ? (
        <p className="text-sm text-muted-foreground">Belum ada catatan untuk kasus ini.</p>
      ) : (
        <ol className="relative ml-1.5 border-l">
          {[...logs.data].reverse().map((l) => {
            const extra = detail(l.payload_json);
            return (
              <li key={l.id} className="mb-5 ml-5 last:mb-0">
                <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-muted-foreground/40" aria-hidden />
                <p>
                  <span className="font-medium">{actorLabel(l.actor)}</span> {actionLabel(l.action)}
                </p>
                {extra && <p className="text-sm text-muted-foreground">{extra}</p>}
                <time dateTime={l.created_at} className="text-sm text-muted-foreground">{formatDateTime(l.created_at)}</time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
