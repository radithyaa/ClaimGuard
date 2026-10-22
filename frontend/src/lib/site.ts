/**
 * Identitas situs untuk metadata, manifest, robots, sitemap, dan gambar pratinjau tautan.
 *
 * `NEXT_PUBLIC_SITE_URL` dibaca saat build; tanpa nilai itu dipakai URL Cloud Run produksi agar
 * tautan kanonis dan gambar Open Graph tetap absolut.
 */
export const SITE = {
  name: "ClaimGuard",
  title: "ClaimGuard — Asisten Klaim Logistik Berbasis AI untuk UMKM",
  shortDescription: "Klaim paket hilang, rusak, dan retur bermasalah otomatis dengan agen AI.",
  description:
    "ClaimGuard memantau resi JNE, J&T, dan SiCepat, mendeteksi paket hilang, rusak, atau retur " +
    "mencurigakan, lalu mengumpulkan bukti dari rekaman CCTV meja packing dan aturan kurir untuk " +
    "menyusun draf klaim. Klaim baru dikirim setelah pemilik toko menyetujuinya.",
  url: (process.env.NEXT_PUBLIC_SITE_URL || "https://claimguard-web-5rzsoa7j3a-et.a.run.app").replace(/\/$/, ""),
  locale: "id_ID",
  themeColor: "#0f766e",
  keywords: [
    "klaim logistik",
    "klaim paket hilang",
    "klaim paket rusak",
    "retur curang",
    "asuransi pengiriman",
    "UMKM",
    "e-commerce",
    "agen AI",
    "agentic AI",
    "CCTV packing",
    "bukti packing",
    "JNE",
    "J&T",
    "SiCepat",
    "Gemini",
  ],
} as const;
