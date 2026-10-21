"use client";

import { useEffect, useId, type ReactNode } from "react";

/** Dialog konfirmasi untuk aksi yang tidak boleh terjadi karena salah klik. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "brand",
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "brand" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Batal"
        onClick={onCancel}
        className="absolute inset-0 bg-[#101d28]/30"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-xl border border-line-strong bg-surface p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-xl font-semibold leading-7 text-ink">
          {title}
        </h2>
        <div className="mt-2 text-[13px] leading-[21px] text-ink-muted">{description}</div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink-muted hover:bg-subtle"
          >
            Batal
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={pending}
            className={[
              "focus-ring inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-surface transition disabled:cursor-not-allowed",
              tone === "danger"
                ? "bg-danger hover:bg-danger/90"
                : "bg-brand hover:bg-brand-deep",
            ].join(" ")}
          >
            {pending && (
              <span
                aria-hidden
                className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
