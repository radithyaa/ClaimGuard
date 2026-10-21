"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type ConfidenceLevel = "high" | "medium" | "check";

const LEVEL = {
  high: { label: "Tinggi", cls: "bg-success/10 text-success", bars: 3 },
  medium: { label: "Sedang", cls: "bg-info/10 text-info", bars: 2 },
  check: { label: "Perlu dicek", cls: "bg-warning/20 text-warning-foreground dark:text-warning", bars: 1 },
} as const;

/** Ambang dari Pengaturan (min_confidence = tinggi, medium_confidence = sedang). */
export function useConfidenceLevel() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings.get, staleTime: 60_000 });
  const high = settings.data?.min_confidence ?? 0.6;
  const medium = settings.data?.medium_confidence ?? 0.4;
  return (value: number | null | undefined): ConfidenceLevel =>
    value == null ? "check" : value >= high ? "high" : value >= medium ? "medium" : "check";
}

/**
 * Label keyakinan (Panduan UX): teks Tinggi / Sedang / Perlu dicek, bukan persentase mentah.
 * Persentase tetap tersedia lewat tooltip untuk juri teknis.
 */
export function ConfidenceLabel({ value, bars = false, className }: { value: number | null | undefined; bars?: boolean; className?: string }) {
  const level = LEVEL[useConfidenceLevel()(value)];
  const title = value == null ? "Belum dinilai" : `Skor model ${Math.round(value * 100)}%`;
  if (bars) {
    return (
      <span className={cn("flex items-center gap-2", className)} title={title}>
        <span className="flex gap-0.5" aria-hidden>
          {[1, 2, 3].map((i) => (
            <span key={i} className={cn("h-1.5 w-3 rounded-full", i <= level.bars ? "bg-foreground" : "bg-muted-foreground/30")} />
          ))}
        </span>
        {level.label}
      </span>
    );
  }
  return (
    <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", level.cls, className)} title={title}>
      {level.label}
    </span>
  );
}
