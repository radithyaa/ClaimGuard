import { formatDateTime } from "@/lib/format";
import type { TrackingEvent } from "@/types/api";

/** `stalled`: event terbaru diberi label "Terhenti" (anomali paket tertahan), selain itu "Terkini". */
export function ShipmentTimeline({ events, stalled }: { events: TrackingEvent[]; stalled?: boolean }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">Belum ada riwayat pelacakan.</p>;
  const ordered = [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return (
    <ol className="relative ml-1.5 border-l">
      {ordered.map((e, i) => (
        <li key={e.id} className="mb-6 ml-5 last:mb-0">
          <span
            className={`absolute -left-[5px] mt-1.5 size-2.5 rounded-full ${i === 0 ? "bg-primary ring-4 ring-primary/20" : "bg-muted-foreground/40"}`}
            aria-hidden
          />
          <p className="flex flex-wrap items-center gap-2">
            {e.status} · {e.location}
            {i === 0 && (
              <span
                className={`rounded-full border px-2 text-[13px] ${stalled ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-success/30 bg-success/10 text-success"}`}
              >
                {stalled ? "Terhenti" : "Terkini"}
              </span>
            )}
          </p>
          <time dateTime={e.occurred_at} className="text-sm text-muted-foreground">
            {formatDateTime(e.occurred_at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
