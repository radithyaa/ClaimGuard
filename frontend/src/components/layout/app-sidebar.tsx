"use client";

import { useQuery } from "@tanstack/react-query";
import { LogOut, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { api } from "@/lib/api-client";
import { useLogout } from "@/hooks/use-logout";
import { cn } from "@/lib/utils";

import { NAV_GROUPS } from "./nav";

export function Brand() {
  return (
    <Link href="/dashboard" className="flex h-16 shrink-0 items-center border-b px-4">
      <Image src="/brand/claimguard-logo.png" alt="ClaimGuard" width={152} height={28} priority />
    </Link>
  );
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  // Berbagi cache dengan KPI di Ringkasan
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.metrics.summary });

  return (
    <nav aria-label="Navigasi utama" className="flex flex-col gap-4 px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-2 text-[13px] font-medium tracking-[0.65px] text-muted-foreground/80 uppercase">{group.label}</p>
          {group.items.map((item) => {
            const { href, label, icon: Icon } = item;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const count = "badge" in item ? metrics.data?.[item.badge] : undefined;
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-r-lg border-l-3 py-2 pr-2 pl-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  active
                    ? "border-primary bg-accent text-primary"
                    : "border-transparent text-foreground/80 hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-[18px]" aria-hidden />
                {label}
                {!!count && (
                  <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[13px] leading-[18px] font-medium text-primary-foreground">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function UserCard() {
  const logout = useLogout();
  return (
    <div className="flex items-center gap-2 border-t p-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <User className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">Admin</p>
        <p className="truncate text-[13px] font-medium text-muted-foreground">Admin gudang</p>
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        aria-label="Keluar"
        title="Keluar"
        className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <LogOut className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function AppSidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-card lg:flex">
      <Brand />
      <div className="flex-1 overflow-y-auto">
        <NavLinks />
      </div>
      <UserCard />
    </aside>
  );
}
