import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthGuard } from "@/components/auth/auth-guard";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { getServerSession } from "@/lib/server-session";

/**
 * Semua halaman di bawah `(dashboard)` butuh sesi. Pengecekan dilakukan di SERVER sebelum
 * HTML dikirim, sehingga konten tidak pernah sempat berkedip bagi pengguna yang belum masuk.
 *
 * PENTING (pernah gagal di produksi):
 * 1. Layout ini WAJIB dinamis. Tanpa `force-dynamic`, Next.js dapat menyajikan hasil render
 *    lama yang masih berisi `redirect('/login')`, sehingga pengguna yang BARU SAJA login
 *    langsung terlempar kembali ke halaman login.
 * 2. Redirect membawa `?next=` agar setelah masuk pengguna kembali ke halaman yang dituju,
 *    bukan selalu ke dashboard.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Halaman di balik login tidak perlu diindeks mesin pencari.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  if (!session.authenticated) {
    console.warn("[auth] layout.redirect_login", { unreachable: session.unreachable });
    redirect("/login");
  }

  console.info("[auth] layout.allow", { user: session.user });

  return (
    <AuthGuard>
      <div className="flex min-h-dvh">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          {/* Suspense dibutuhkan halaman yang memakai useSearchParams */}
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:p-8">
            <Suspense>{children}</Suspense>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
