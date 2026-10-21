import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 px-4 pb-8 pt-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
