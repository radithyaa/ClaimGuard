"use client";

import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icon";

/**
 * Pil status di header Pengaturan:
 * - `idle` / `saved` → "Semua perubahan tersimpan"
 * - `dirty` → "Ada perubahan belum disimpan" (amber, frame "Pengaturan, validasi…")
 * - `error` → pesan kegagalan (merah)
 */
export type SettingsStatus =
  | { kind: "idle" }
  | { kind: "saved"; at: Date }
  | { kind: "dirty" }
  | { kind: "error"; message: string };

export function SettingsStatusPill({ status }: { status: SettingsStatus }) {
  const tone =
    status.kind === "dirty"
      ? "border-[#ffb59799] bg-[#ffdbcd4d] text-[#8e3400]"
      : status.kind === "error"
        ? "border-danger/30 bg-danger/5 text-danger"
        : "border-line bg-subtle text-ink-muted";

  const text =
    status.kind === "dirty"
      ? "Ada perubahan belum disimpan"
      : status.kind === "error"
        ? status.message
        : status.kind === "saved"
          ? `Semua perubahan tersimpan ${formatTime(status.at)} WIB`
          : "Semua perubahan tersimpan";

  return (
    <p
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium ${tone}`}
    >
      {status.kind === "dirty" ? (
        <Icon src="icon-info.svg" className="size-4" />
      ) : (
        status.kind !== "error" && <Icon src="icon-check.svg" className="size-3.5" />
      )}
      {text}
    </p>
  );
}

/** Sticky footer yang hanya muncul saat ada perubahan (frame "…belum disimpan"). */
export function UnsavedBar({
  dirty,
  saving,
  error,
  onSave,
  onDiscard,
  idleNote,
}: {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
  idleNote?: string;
}) {
  if (!dirty && !error && !idleNote) return null;

  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-auto border-t border-line bg-surface/95 px-4 py-3.5 backdrop-blur lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {dirty || error ? (
          <div className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-1.5 size-2 shrink-0 rounded-full ${error ? "bg-danger" : "bg-[#8e3400]"}`}
            />
            <div>
              <p className="text-sm font-semibold text-ink">
                {error ? "Perubahan belum dapat disimpan" : "Perubahan belum disimpan"}
              </p>
              <p className="text-[13px] leading-[18px] text-ink-muted">
                {error ?? "Simpan untuk menerapkan ke agen monitoring dan investigasi."}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-ink-muted">{idleNote}</p>
        )}

        <div className="flex items-center gap-3">
          {dirty && (
            <button
              type="button"
              onClick={onDiscard}
              disabled={saving}
              className="focus-ring rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink-muted transition hover:bg-subtle disabled:cursor-not-allowed"
            >
              Buang perubahan
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className="focus-ring inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-surface transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:bg-[#e6e8ea] disabled:text-ink-faint"
          >
            {saving && <Spinner />}
            {saving ? "Menyimpan…" : "Simpan perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

/** Bungkus konten tab pengaturan agar footer sticky bisa menempel di dasar kolom. */
export function SettingsBody({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>;
}
