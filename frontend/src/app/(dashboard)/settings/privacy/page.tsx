import type { Metadata } from "next";

import { PrivacyForm } from "@/components/settings/privacy-form";

export const metadata: Metadata = {
  title: "Privasi dan data · Pengaturan",
};

export default function PrivacyPage() {
  return <PrivacyForm />;
}
