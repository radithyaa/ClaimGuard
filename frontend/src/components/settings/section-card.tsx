"use client";

import { useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";

/** Kartu seksi dengan judul + deskripsi bergaris bawah tipis (Figma "Section"). */
export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <header className="border-b border-line pb-3">
        <h2 className="text-xl font-semibold leading-7 text-ink">{title}</h2>
        <p className="mt-1 text-[13px] leading-[18px] text-ink-muted">
          {description}
        </p>
      </header>
      <div className="mt-4 flex flex-col gap-6">{children}</div>
    </section>
  );
}

export function InfoHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={text}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring rounded-sm"
      >
        <Icon src="icon-info.svg" className="size-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-5 z-20 w-52 rounded-lg border border-line bg-surface p-2 text-[11px] leading-[16.5px] text-ink-muted shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/** Tautan teks bergaya tombol tersier (Figma "Tertiary Add Button"). */
export function AddLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring inline-flex items-center gap-1.5 rounded pt-1 text-sm font-semibold text-brand hover:underline"
    >
      <Icon src="icon-plus.svg" className="size-2.5" />
      {children}
    </button>
  );
}
