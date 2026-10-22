import type { Metadata } from "next";

import { ConnectionsForm } from "@/components/settings/connections-form";

export const metadata: Metadata = {
  title: "Koneksi dan sumber data · Pengaturan",
};

export default function ConnectionsPage() {
  return <ConnectionsForm />;
}
