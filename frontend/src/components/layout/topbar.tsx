"use client";

import { FolderOpen, Menu, Moon, Search, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { USE_MOCK } from "@/lib/api-client";

import { Brand, NavLinks, UserCard } from "./app-sidebar";
import { findNav } from "./nav";

export function Topbar() {
  const [open, setOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const crumb = findNav(pathname);

  // Ctrl/Cmd+K memfokuskan pencarian
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get("q")?.toString().trim();
    if (q) router.push(`/shipments?q=${encodeURIComponent(q)}`);
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-card px-4 lg:px-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Buka menu">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 gap-0 bg-card p-0">
          <SheetHeader className="p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <Brand />
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
          <UserCard />
        </SheetContent>
      </Sheet>

      {crumb && (
        <nav aria-label="Breadcrumb" className="hidden items-center gap-2 text-sm sm:flex">
          <FolderOpen className="size-[18px] text-muted-foreground" aria-hidden />
          <span>{crumb.group === "Kerja harian" ? "Operasional" : crumb.group}</span>
          <span className="text-base text-muted-foreground">/</span>
          {pathname === crumb.item.href ? (
            <span className="text-primary" aria-current="page">
              {crumb.item.label}
            </span>
          ) : (
            <>
              <Link href={crumb.item.href} className="text-muted-foreground hover:text-foreground">
                {crumb.item.label}
              </Link>
              <span className="text-base text-muted-foreground">/</span>
              <span className="text-primary" aria-current="page">
                Detail
              </span>
            </>
          )}
        </nav>
      )}

      <div className="ml-auto flex items-center gap-4">
        <form role="search" onSubmit={onSearch} className="relative hidden w-[280px] md:block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={searchRef}
            name="q"
            type="search"
            placeholder="Cari resi atau ID kasus (Ctrl K)"
            aria-label="Cari resi atau ID kasus"
            className="h-10 w-full rounded-lg border bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </form>

        <span className="rounded-full border border-border/60 bg-info/15 px-3 py-1 text-[13px] font-medium text-foreground/80">
          {USE_MOCK ? "Mode mock" : "Mode demo"}
        </span>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Ganti tema terang/gelap"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="hidden dark:block" />
          <Moon className="dark:hidden" />
        </Button>

        <span className="hidden size-8 place-items-center rounded-full bg-primary text-primary-foreground sm:grid" aria-hidden>
          <User className="size-3.5" />
        </span>
      </div>
    </header>
  );
}
