import { Suspense } from "react";

import { AuthGuard } from "@/components/auth/auth-guard";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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
