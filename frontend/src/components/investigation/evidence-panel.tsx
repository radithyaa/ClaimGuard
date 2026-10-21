"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Video } from "lucide-react";
import { useRef } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { api, USE_MOCK } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Evidence } from "@/types/api";

const fmtSec = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const SEVERITY = {
  info: "border-border",
  warning: "border-warning/50 bg-warning/5",
  critical: "border-destructive/40 bg-destructive/5",
} as const;

/** Klip CCTV meja packing + temuan Vision AI dengan penanda timestamp (FR-11). */
export function EvidencePanel({ evidence, analyzing }: { evidence: Evidence[]; analyzing: boolean }) {
  const clip = evidence.find((e) => e.kind === "cctv_clip") ?? evidence[0];
  const videoRef = useRef<HTMLVideoElement>(null);
  const media = useQuery({
    queryKey: ["evidence-media", clip?.id],
    queryFn: () => api.evidence.media(clip!.id),
    enabled: !!clip && !USE_MOCK,
    staleTime: 5 * 60_000,
  });
  const a = clip?.analysis_json;
  const marks = a?.timestamp_evidence ?? [];
  const findings = a?.findings ?? [];

  const seek = (t: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = t;
    videoRef.current.play().catch(() => {});
  };

  return (
    <>
      <section className="rounded-xl border bg-accent/40 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Rekaman meja packing</h2>
          {clip?.clip_duration_sec != null && (
            <span className="text-sm text-muted-foreground">Klip {Math.round(clip.clip_duration_sec)} dtk</span>
          )}
        </div>
        <div className="relative grid aspect-video place-items-center overflow-hidden rounded-lg bg-foreground/90 text-background">
          {media.data ? (
            <video ref={videoRef} src={media.data.url} controls preload="metadata" className="size-full" />
          ) : clip ? (
            <p className="flex items-center gap-2 text-sm opacity-80">
              <Video className="size-4" aria-hidden />
              {USE_MOCK ? "Pratinjau video tidak tersedia di mode mock" : media.isError ? "Video tidak dapat dimuat" : "Memuat video…"}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm opacity-80">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Menunggu klip CCTV dipotong…
            </p>
          )}
        </div>
        {marks.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {marks.map((m, i) => (
              <button
                key={i}
                type="button"
                onClick={() => seek(m.t_sec)}
                className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-[13px] hover:border-primary"
              >
                <span className="font-mono text-primary">{fmtSec(m.t_sec)}</span> {m.label}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Temuan visual</h2>
          {findings.length > 0 ? (
            <span className="flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-[13px] text-success">
              <CheckCircle2 className="size-3.5" aria-hidden /> {findings.length} temuan
            </span>
          ) : analyzing ? (
            <span className="flex items-center gap-1 rounded-full border border-primary/30 bg-accent px-2.5 py-0.5 text-[13px] text-primary">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Sedang menganalisis
            </span>
          ) : null}
        </div>
        {findings.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {findings.map((f, i) => (
              <li key={i} className={cn("flex gap-3 rounded-lg border p-3", SEVERITY[f.severity] ?? SEVERITY.info)}>
                <span className="grid size-6 shrink-0 place-items-center rounded bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                <div>
                  <p className="text-sm">{f.description}</p>
                  {marks[i] && (
                    <button type="button" onClick={() => seek(marks[i].t_sec)} className="font-mono text-xs text-muted-foreground hover:text-primary">
                      Stempel waktu CCTV: {fmtSec(marks[i].t_sec)}
                    </button>
                  )}
                </div>
              </li>
            ))}
            {a?.confidence != null && (
              <li className="mt-1 flex justify-between rounded-lg border p-3 text-sm">
                <span>Keyakinan analisis visual</span>
                <span className="font-medium tabular-nums">{Math.round(a.confidence * 100)}%</span>
              </li>
            )}
          </ol>
        ) : analyzing ? (
          <div className="flex flex-col gap-3" aria-busy>
            {[70, 85, 55].map((w) => (
              <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Belum ada temuan visual.</p>
        )}
      </section>
    </>
  );
}
