"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";

/**
 * Panel geser kanan (frame "Log audit", Aside 480px) untuk membaca detail satu
 * catatan audit tanpa meninggalkan tabel.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  icon,
  meta,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  icon?: string;
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Tutup panel"
        onClick={onClose}
        className="absolute inset-0 bg-[#101d28]/20 backdrop-blur-[1px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[480px] flex-col rounded-l-xl border-l border-line-strong bg-surface shadow-[-8px_0_24px_-12px_rgba(16,29,40,0.25)] outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line p-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-deep">
                <Icon src={icon} className="size-3.5" tone="invert" />
              </span>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold leading-7 text-ink">
                {title}
              </h2>
              {subtitle && (
                <p className="mt-0.5 text-[13px] leading-[18px] text-ink-muted">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="focus-ring flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-subtle"
          >
            <Icon src="icon-close.svg" className="size-3.5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {meta}
          {children}
        </div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line p-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** Sub-blok berjudul datar di dalam drawer (payload, konteks, dsb.). */
export function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}
