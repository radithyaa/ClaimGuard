"use client";

import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icon";

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string };

export function StatusPill({ status }: { status: SaveStatus }) {
  const text =
    status.kind === "saving"
      ? "Menyimpan…"
      : status.kind === "saved"
        ? `Semua perubahan tersimpan ${formatSavedAt(status.at)} WIB`
        : status.kind === "error"
          ? status.message
          : "Semua perubahan tersimpan";

  return (
    <p
      role="status"
      aria-live="polite"
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium",
        status.kind === "error"
          ? "border-danger/30 bg-danger/5 text-danger"
          : "border-line bg-subtle text-ink-muted",
      ].join(" ")}
    >
      {status.kind !== "error" && <Icon src="icon-check.svg" className="size-3.5" />}
      {text}
    </p>
  );
}

function formatSavedAt(date: Date): string {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

export function PageHeader({
  title,
  description,
  aside,
}: {
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div>
        <h1 className="text-h2 font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-base text-ink-muted">{description}</p>
      </div>
      {aside}
    </div>
  );
}
