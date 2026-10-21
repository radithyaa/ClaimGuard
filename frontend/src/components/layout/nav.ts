import { Banknote, FlaskConical, Inbox, LayoutDashboard, Scale, Settings, Truck } from "lucide-react";

export const NAV_GROUPS = [
  {
    label: "Kerja harian",
    items: [
      { href: "/dashboard", label: "Ringkasan", icon: LayoutDashboard },
      { href: "/claims", label: "Antrian klaim", icon: Inbox, badge: "pending_claims" },
      { href: "/shipments", label: "Resi", icon: Truck },
    ],
  },
  {
    label: "Analisis",
    items: [
      { href: "/reports", label: "Laporan uang pulih", icon: Banknote },
      { href: "/couriers", label: "Kebijakan kurir", icon: Scale },
    ],
  },
  {
    label: "Sistem",
    items: [
      { href: "/demo", label: "Panel demo", icon: FlaskConical },
      { href: "/settings", label: "Pengaturan", icon: Settings },
    ],
  },
] as const;

/** Grup & label halaman aktif untuk breadcrumb topbar. */
export function findNav(pathname: string) {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return { group: group.label, item };
    }
  }
  return null;
}
