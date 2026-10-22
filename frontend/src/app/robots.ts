import type { MetadataRoute } from "next";

import { SITE } from "@/lib/site";

// Hanya halaman masuk yang publik. Halaman dashboard tetap boleh dirayapi agar mesin pencari
// membaca `noindex` di (dashboard)/layout.tsx; proxy API tidak perlu dirayapi sama sekali.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
