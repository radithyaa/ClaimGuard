export type NavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: string;
};

export type NavGroup = {
  title?: string;
  items: NavItem[];
};

/**
 * Menu utama — mengikuti rute halaman di SRS §5. Entri yang halamannya belum
 * dibuat tetap ditampilkan (seperti desain Figma), cukup menambah `page.tsx`
 * di rute yang bersangkutan.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Kerja harian",
    items: [
      { label: "Ringkasan", href: "/dashboard", icon: "icon-ringkasan.svg" },
      { label: "Antrian klaim", href: "/claims", icon: "icon-antrian.svg", badge: "4" },
      { label: "Resi", href: "/shipments", icon: "icon-resi.svg" },
    ],
  },
  {
    title: "Analisis",
    items: [
      { label: "Laporan uang pulih", href: "/reports", icon: "icon-laporan.svg" },
      { label: "Kebijakan kurir", href: "/couriers", icon: "icon-kebijakan.svg" },
    ],
  },
  {
    title: "Sistem",
    items: [
      { label: "Panel demo", href: "/demo", icon: "icon-demo.svg" },
      { label: "Pengaturan", href: "/settings", icon: "icon-settings.svg" },
    ],
  },
];
