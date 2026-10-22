import type { Metadata } from "next";

import { AccountForm } from "@/components/settings/account-form";

export const metadata: Metadata = {
  title: "Akun · Pengaturan",
};

export default function AccountPage() {
  return <AccountForm />;
}
