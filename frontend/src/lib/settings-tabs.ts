export type SettingsTab = {
  label: string;
  href: string;
  icon: string;
  /** Isi kotak "Mode Operasional" di bawah sub-navigasi. */
  context: string;
};

export const SETTINGS_TABS: SettingsTab[] = [
  {
    label: "Pemantauan dan ambang",
    href: "/settings",
    icon: "icon-scan.svg",
    context:
      "Parameter di bawah mempengaruhi 5 integrasi kurir aktif dan kecepatan komputasi draf klaim harian.",
  },
  {
    label: "Koneksi dan sumber data",
    href: "/settings/connections",
    icon: "icon-koneksi.svg",
    context:
      "Koneksi aktif ke kanal marketplace, impor berkas resi, dan sinkronisasi kamera meja packing.",
  },
  {
    label: "Privasi dan data",
    href: "/settings/privacy",
    icon: "icon-privasi.svg",
    context:
      "Parameter di bawah mempengaruhi 5 integrasi kurir aktif dan kecepatan komputasi draf klaim harian.",
  },
  {
    label: "Log audit",
    href: "/settings/audit-log",
    icon: "icon-audit.svg",
    context: "Jejak perubahan konfigurasi dan tindakan operator pada sistem.",
  },
  {
    label: "Akun",
    href: "/settings/account",
    icon: "icon-akun.svg",
    context: "Profil operator dan sesi login perangkat demo.",
  },
];
