"use client";

import { useId, type ReactNode } from "react";

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        "focus-ring mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
        checked ? "bg-brand" : "bg-field",
      ].join(" ")}
    >
      <span
        className={[
          "size-5 rounded-full bg-surface shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: ReactNode;
}) {
  const id = useId();

  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-brand"
      />
      <label htmlFor={id} className="cursor-pointer select-none">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-[13px] leading-[18px] text-ink-muted">
          {description}
        </span>
      </label>
    </div>
  );
}

export function ConfidenceMeter({
  high,
  medium,
}: {
  high: number;
  medium: number;
}) {
  const low = 1 - high;
  const bands = [
    { label: "Tinggi", detail: `${fmt(high)} ke atas`, level: 3 },
    { label: "Sedang", detail: `${fmt(medium)} sampai ${fmt(high - 0.01)}`, level: 2 },
    { label: "Perlu dicek", detail: `di bawah ${fmt(medium)}`, level: 1 },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {bands.map((band) => (
        <div key={band.label} className="flex flex-col gap-2">
          <div className="flex gap-1" aria-hidden>
            {[3, 2, 1].map((step) => (
              <span
                key={step}
                className={[
                  "h-1.5 w-4 rounded-sm",
                  step <= band.level ? "bg-ink" : "bg-field",
                ].join(" ")}
              />
            ))}
          </div>
          <div>
            <p className="text-[13px] leading-[18px] font-medium text-ink">
              {band.label}
            </p>
            <p className="text-[13px] leading-[18px] text-ink-muted">
              {band.detail}
            </p>
          </div>
        </div>
      ))}
      <p className="sr-only">
        Ambang rendah {fmt(low)}; kasus di antaranya tetap diperiksa manual.
      </p>
    </div>
  );
}

function fmt(value: number): string {
  return value.toFixed(2).replace(".", ",");
}
