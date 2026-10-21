"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icon";

/** Peta rute → jejak breadcrumb (Figma: "Sistem › Pengaturan"). */
const CRUMBS: Record<string, string> = {
  "/dashboard": "Ringkasan",
  "/shipments": "Resi",
  "/claims": "Antrian klaim",
  "/reports": "Laporan uang pulih",
  "/couriers": "Kebijakan kurir",
  "/demo": "Panel demo",
  "/settings": "Pengaturan",
};

/** Judul anak sub-navigasi di breadcrumb (frame "Sistem › Pengaturan › Log audit"). */
const SETTINGS_CRUMBS: Record<string, string> = {
  "/settings/connections": "Koneksi dan sumber data",
  "/settings/privacy": "Privasi dan data",
  "/settings/audit-log": "Log audit",
  "/settings/account": "Akun",
};

export function Header() {
  const pathname = usePathname();
  const current =
    Object.entries(CRUMBS).find(([href]) => pathname.startsWith(href))?.[1] ??
    "Ringkasan";
  const sub = Object.entries(SETTINGS_CRUMBS).find(([href]) =>
    pathname.startsWith(href),
  )?.[1];

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-line bg-surface px-4 lg:px-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2">
        <span className="text-base text-ink-muted">Sistem</span>
        <Icon src="icon-breadcrumb.svg" className="size-2" />
        {sub ? (
          <>
            <Link href="/settings" className="text-base text-ink-muted hover:text-ink">
              {current}
            </Link>
            <Icon src="icon-breadcrumb.svg" className="size-2" />
            <span aria-current="page" className="text-base text-brand">
              {sub}
            </span>
          </>
        ) : (
          <span className="text-base text-ink">{current}</span>
        )}
      </nav>

      <div className="flex items-center gap-4">
        <label className="relative hidden md:block">
          <span className="sr-only">Cari resi atau ID kasus</span>
          <div className="flex h-10 w-72 items-center gap-2 rounded-lg border border-line-strong bg-subtle pl-9 pr-2 text-base focus-within:border-brand focus-within:bg-surface">
            <input
              type="search"
              placeholder="Cari resi atau ID kasus (Ctrl K)"
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
            />
            <kbd className="shrink-0 rounded border border-line bg-[#eceef0] px-1.5 py-0.5 text-[11px] leading-[16.5px] text-ink-muted">
              Ctrl K
            </kbd>
          </div>
          <Icon
            src="icon-search.svg"
            className="pointer-events-none absolute left-3.5 top-3.5 size-3.5"
          />
        </label>

        <span className="rounded-full bg-info-soft px-2.5 py-1 text-[13px] font-medium tracking-[0.025em] text-info-ink">
          MODE DEMO
        </span>

        <button
          type="button"
          aria-label="Notifikasi (3 belum dibaca)"
          className="focus-ring relative flex size-10 items-center justify-center rounded-lg hover:bg-subtle"
        >
          <Icon src="icon-bell.svg" className="h-[18px] w-[15px]" />
          <span className="absolute right-2 top-1.5 flex size-4 items-center justify-center rounded-full bg-danger text-[10px] leading-[15px] text-surface">
            3
          </span>
        </button>

        <Link
          href="/settings"
          aria-label="Buka pengaturan akun"
          className="focus-ring flex size-8 items-center justify-center rounded-full bg-brand-deep"
        >
          <Icon src="icon-avatar.svg" className="size-3" />
        </Link>
      </div>
    </header>
  );
}
