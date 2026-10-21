"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { SETTINGS_TABS } from "@/lib/settings-tabs";

export function SettingsNav() {
  const pathname = usePathname();
  const activeTab =
    SETTINGS_TABS.find((tab) => tab.href === pathname) ?? SETTINGS_TABS[0];

  return (
    <nav
      aria-label="Sub-navigasi pengaturan"
      className="flex w-full flex-col gap-1 md:w-60 md:shrink-0"
    >
      {SETTINGS_TABS.map((tab) => {
        const active = tab.href === activeTab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={[
              "focus-ring flex items-start gap-2 rounded-lg p-2.5 text-base transition",
              active
                ? "bg-subtle font-medium text-brand shadow-[inset_4px_0_0_var(--color-brand)]"
                : "text-ink-muted hover:bg-subtle",
            ].join(" ")}
          >
            <Icon src={tab.icon} className="mt-1 size-4" />
            <span className="leading-6">{tab.label}</span>
          </Link>
        );
      })}

      <div className="mt-8 rounded-lg border border-line bg-subtle p-3">
        <div className="flex items-center gap-1.5">
          <Icon src="icon-mode.svg" className="size-3.5" />
          <p className="text-[13px] font-medium text-ink">Mode Operasional</p>
        </div>
        <p className="mt-1 text-[13px] leading-[21px] text-ink-muted">
          {activeTab.context}
        </p>
      </div>
    </nav>
  );
}
