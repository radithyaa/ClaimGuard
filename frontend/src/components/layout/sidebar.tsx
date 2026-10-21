"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { NAV_GROUPS } from "@/lib/nav";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between border-r border-line bg-surface lg:flex">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex h-16 items-center border-b border-line px-4">
          <Image
            src="/figma/logo-3cca7e.png"
            alt="ClaimGuard"
            width={174}
            height={32}
            priority
            className="h-8 w-auto"
          />
        </div>

        <nav className="flex flex-col gap-4 px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-1">
              {group.title && (
                <p className="eyebrow px-2">{group.title}</p>
              )}
              {group.items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "focus-ring flex items-center justify-between gap-2 rounded-lg p-2 text-base transition",
                      active
                        ? "bg-subtle font-medium text-brand shadow-[inset_4px_0_0_var(--color-brand)]"
                        : "text-nav hover:bg-subtle",
                    ].join(" ")}
                  >
                    <span className="flex items-center gap-2">
                      <Icon src={item.icon} />
                      <span>{item.label}</span>
                    </span>
                    {item.badge && (
                      <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] leading-[16.5px] text-info-ink">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-2 border-t border-line p-3">
        <div className="flex items-center gap-2 px-1">
          <span className="size-2 rounded-full bg-brand" />
          <span className="text-[13px] text-ink-muted">Agen siaga</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-subtle p-1">
          <span className="flex size-8 items-center justify-center rounded-full bg-brand-deep">
            <Icon src="icon-avatar.svg" className="size-3" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-ink">Rina Pratiwi</span>
            <span className="text-[13px] leading-[18px] text-ink-muted">
              Admin gudang
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
