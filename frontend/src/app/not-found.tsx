import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="eyebrow">Halaman belum tersedia</p>
      <h1 className="text-h2 font-semibold text-ink">Halaman ini belum dibuat</h1>
      <p className="max-w-md text-base text-ink-muted">
        Rute ini belum punya implementasi. Kembali ke Pengaturan untuk melanjutkan
        konfigurasi pemantauan.
      </p>
      <Link
        href="/settings"
        className="focus-ring mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-surface hover:bg-brand-deep"
      >
        Buka Pengaturan
      </Link>
    </div>
  );
}
