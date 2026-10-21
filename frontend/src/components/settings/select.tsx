"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";

export type SelectOption = { value: string; label: string };

/** Dropdown bergaya "Options" Figma: tinggi 40px, chevron kanan. */
export function Select({
  id,
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  id?: string;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (next: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="field flex items-center justify-between pr-3 text-left"
      >
        <span className="truncate">{current.label}</span>
        <Icon src="icon-chevron.svg" className="ml-2 size-2.5" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-line-strong bg-surface py-1 shadow-lg"
        >
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  setOpen(false);
                  onChange(option.value);
                }}
                className={[
                  "w-full px-3 py-2 text-left text-base hover:bg-subtle",
                  option.value === value ? "font-medium text-brand" : "text-ink",
                ].join(" ")}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
