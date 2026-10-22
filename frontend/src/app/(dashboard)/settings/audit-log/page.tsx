import type { Metadata } from "next";

import { AuditLogView } from "@/components/settings/audit-log-view";

export const metadata: Metadata = {
  title: "Log audit · Pengaturan",
};

export default function AuditLogPage() {
  return <AuditLogView />;
}
