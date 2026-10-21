"use client";

import { useState } from "react";

import { PageHeader, StatusPill, type SaveStatus } from "@/components/settings/page-header";
import { SectionCard } from "@/components/settings/section-card";
import { SettingsNav } from "@/components/settings/settings-nav";
import { Icon } from "@/components/ui/icon";
import { API_BASE_URL } from "@/lib/api";

type Marketplace = {
  id: string;
  name: string;
  icon: string;
  badge: string;
  detail: string;
  action: string;
  disabled: boolean;
  connected: boolean;
};

/**
 * Status integrasi marketplace belum ada di kontrak API (SRS §6); nilainya
 * mengikuti desain. Saat endpoint koneksi tersedia, ganti dengan fetch.
 */
const MARKETPLACES: Marketplace[] = [
  {
    id: "shopee",
    name: "Shopee",
    icon: "icon-marketplace.svg",
    badge: "Belum terhubung",
    detail: "Akses Shopee Open Platform sedang diajukan",
    action: "Hubungkan",
    disabled: false,
    connected: false,
  },
  {
    id: "tiktok",
    name: "TikTok Shop",
    icon: "icon-tiktok.svg",
    badge: "Belum tersedia",
    detail: "Dalam pengembangan",
    action: "Segera Hadir",
    disabled: true,
    connected: false,
  },
];

type Camera = {
  id: string;
  name: string;
  type: string;
  offset: string;
  calibratedAt: string;
};

const CAMERAS: Camera[] = [
  { id: "cam-1", name: "Kamera Meja Packing 1", type: "HP Android", offset: "-2 dtk", calibratedAt: "20 Okt 16.10" },
  { id: "cam-2", name: "Kamera Meja Packing 2", type: "CCTV RTSP", offset: "+4 dtk", calibratedAt: "21 Okt 13.52" },
];

type CsvMeta = {
  uploadedAt: string;
  filename: string;
  activeCount: number;
};

const LAST_CSV: CsvMeta = {
  uploadedAt: "21 Okt 2026, 13.40 WIB",
  filename: "resi_oktober.csv",
  activeCount: 148,
};

/** Upload resi belum punya endpoint resmi; cek dulu, jangan gagal diam-diam. */
async function uploadCsv(file: File): Promise<{ imported: number }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/v1/shipments/import`, {
    method: "POST",
    credentials: "include",
    body,
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Endpoint impor CSV belum tersedia di backend."
        : `Unggah gagal (HTTP ${res.status}).`,
    );
  }
  return res.json();
}

export function ConnectionsForm() {
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [csv, setCsv] = useState<CsvMeta>(LAST_CSV);
  const [cameras, setCameras] = useState<Camera[]>(CAMERAS);

  async function handleUpload(file: File) {
    setStatus({ kind: "saving" });
    try {
      const result = await uploadCsv(file);
      setCsv({
        uploadedAt: new Date().toLocaleString("id-ID", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
        }) + " WIB",
        filename: file.name,
        activeCount: result.imported,
      });
      setStatus({ kind: "saved", at: new Date() });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Unggah gagal.",
      });
    }
  }

  function downloadTemplate() {
    const header = "tracking_number,courier,order_id,status,last_moved_at\n";
    const blob = new Blob([header], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "templat-resi-claimguard.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function calibrate(cameraId: string) {
    setCameras((prev) =>
      prev.map((camera) =>
        camera.id === cameraId
          ? {
              ...camera,
              offset: "0 dtk",
              calibratedAt: new Date().toLocaleString("id-ID", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                timeZone: "Asia/Jakarta",
              }),
            }
          : camera,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pengaturan"
        description="Konfigurasi pemantauan resi, ambang batas deteksi AI, dan notifikasi sistem."
        aside={<StatusPill status={status} />}
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <SettingsNav />

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {/* 1. Marketplace */}
          <SectionCard
            title="Marketplace"
            description="Integrasi otomatis pesanan, kurir, dan nomor resi dari marketplace"
          >
            <div className="flex flex-col">
              {MARKETPLACES.map((marketplace, index) => (
                <div
                  key={marketplace.id}
                  className={[
                    "flex items-center justify-between gap-4",
                    index > 0 ? "border-t border-line pt-3" : "pb-3",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg border border-line bg-subtle">
                      <Icon src={marketplace.icon} className="size-4" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-ink">
                          {marketplace.name}
                        </p>
                        <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] leading-[16.5px] text-ink-muted">
                          {marketplace.badge}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[13px] leading-[18px] text-ink-muted">
                        {marketplace.detail}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={marketplace.disabled}
                    onClick={() =>
                      setStatus({
                        kind: "error",
                        message: `Integrasi ${marketplace.name} belum tersedia pada demo.`,
                      })
                    }
                    className="focus-ring shrink-0 rounded-lg border border-line bg-subtle px-3 py-1.5 text-sm text-ink-faint transition hover:bg-subtle-strong disabled:cursor-not-allowed"
                  >
                    {marketplace.action}
                  </button>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* 2. Impor CSV resi */}
          <SectionCard
            title="Impor CSV resi"
            description="Unggah daftar resi harian secara manual jika API belum aktif"
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle p-3">
                <Icon src="icon-csv.svg" className="size-4" />
                <p className="text-base text-ink-muted">
                  Terakhir diunggah:{" "}
                  <strong className="font-bold text-ink">{csv.uploadedAt}</strong>{" "}
                  · {csv.activeCount} resi aktif ·{" "}
                  <code className="rounded bg-subtle-strong px-1.5 py-0.5 text-base text-ink">
                    {csv.filename}
                  </code>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-base text-info-ink hover:bg-info-soft/80">
                  <Icon src="icon-upload.svg" className="size-3" />
                  <span>Unggah CSV</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleUpload(file);
                      event.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="focus-ring inline-flex items-center gap-2 rounded-lg px-3 py-2 text-base text-brand hover:bg-subtle"
                >
                  <Icon src="icon-download-alt.svg" className="size-3" />
                  Unduh templat CSV
                </button>
              </div>
            </div>
          </SectionCard>

          {/* 3. Kamera meja packing */}
          <SectionCard
            title="Kamera meja packing"
            description="Kamera merekam proses packing. Agen memotong video secara otomatis berdasarkan jam scan barcode."
          >
            <div className="flex flex-col gap-3">
              <div className="overflow-x-auto rounded-lg border border-line-strong">
                <table className="w-full min-w-[640px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line bg-subtle text-[13px] font-bold leading-[18px] text-ink-muted">
                      <th scope="col" className="px-3 py-2.5 font-bold">Kamera</th>
                      <th scope="col" className="px-3 py-2.5 font-bold">Jenis</th>
                      <th scope="col" className="px-3 py-2.5 font-bold">Selisih jam</th>
                      <th scope="col" className="px-3 py-2.5 font-bold">Kalibrasi terakhir</th>
                      <th scope="col" className="px-3 py-2.5 font-bold">Status</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-bold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cameras.map((camera) => (
                      <tr key={camera.id} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2 text-base text-ink">{camera.name}</td>
                        <td className="px-3 py-2 text-base text-ink-muted">{camera.type}</td>
                        <td className="px-3 py-2 text-base text-ink">{camera.offset}</td>
                        <td className="px-3 py-2 text-base text-ink-muted">{camera.calibratedAt}</td>
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-success-soft px-2 text-[11px] leading-[16.5px] text-success-ink">
                            Aktif
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => calibrate(camera.id)}
                            className="focus-ring rounded px-3 py-1 text-[13px] font-medium text-brand hover:underline"
                          >
                            Kalibrasi ulang
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-line bg-subtle p-3">
                <Icon src="icon-bulb.svg" className="mt-0.5 size-3.5" />
                <p className="text-[13px] leading-[21px] text-ink-muted">
                  Scan satu resi uji di depan kamera. ClaimGuard mencocokkan jam di
                  video dengan jam scan.
                </p>
              </div>
            </div>
          </SectionCard>

          {/* 4. Persetujuan akses data */}
          <div className="pb-8">
            <SectionCard
              title="Persetujuan akses data"
              description="Kepatuhan privasi data transaksi dan rekaman CCTV"
            >
              <div className="flex flex-col gap-4">
                <p className="text-sm leading-[22.75px] text-nav">
                  Data pesanan dan video hanya dipakai untuk menyusun klaim toko
                  Anda. Data tidak dijual atau dibagikan ke pihak ketiga tanpa izin.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setStatus({
                      kind: "error",
                      message: "Naskah persetujuan belum tersedia pada demo.",
                    })
                  }
                  className="focus-ring inline-flex w-fit items-center gap-1 rounded pt-1 text-sm font-semibold text-brand hover:underline"
                >
                  Lihat naskah persetujuan
                  <Icon src="icon-arrow-right.svg" className="size-2.5" />
                </button>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}
