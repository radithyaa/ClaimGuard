import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { SITE } from "@/lib/site";

export const alt = SITE.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Pratinjau tautan (WhatsApp, LinkedIn, X, Slack): logo + nama + janji produk.
export default async function OpengraphImage() {
  const icon = await readFile(join(process.cwd(), "src/app/icon.svg"), "utf8");
  const logo = `data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #f0fdfa 0%, #ffffff 60%)",
          color: "#1e2a36",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <img src={logo} width={96} height={96} alt="" />
          <div style={{ fontSize: 56, fontWeight: 700, color: SITE.themeColor }}>{SITE.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.15, maxWidth: 980 }}>
            Klaim paket bermasalah, siap ditinjau dalam hitungan detik.
          </div>
          <div style={{ fontSize: 30, color: "#4a5968", maxWidth: 980 }}>
            Agen AI memantau resi, memeriksa rekaman CCTV packing, dan menyusun draf klaim kurir untuk Anda setujui.
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 24, color: "#134e4a" }}>
          {["Paket hilang", "Paket rusak", "Retur mencurigakan", "JNE · J&T · SiCepat"].map((t) => (
            <div key={t} style={{ padding: "8px 20px", borderRadius: 999, background: "#ccfbf1" }}>
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
