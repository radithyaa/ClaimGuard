"use client";

import { useState } from "react";

import { Switch } from "@/components/settings/controls";
import { PageHeader, StatusPill, type SaveStatus } from "@/components/settings/page-header";
import { SectionCard } from "@/components/settings/section-card";
import { Select } from "@/components/settings/select";
import { SettingsNav } from "@/components/settings/settings-nav";
import { Icon } from "@/components/ui/icon";
import { API_BASE_URL } from "@/lib/api";

const RETENTION_OPTIONS = ["7 hari", "14 hari", "30 hari", "60 hari", "90 hari"];

/** Kasus tertutup demo (CG-0135). Belum ada endpoint daftar kasus tertutup. */
const CLOSED_CASES = [{ value: "CG-0135", label: "CG-0135 · Resi 004512889023 (Ditutup)" }];

export function PrivacyForm() {
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [retention, setRetention] = useState("30 hari");
  const [maskPii, setMaskPii] = useState(true);
  const [selectedCase, setSelectedCase] = useState(CLOSED_CASES[0].value);

  /**
   * Simulasi hapus investigasi: endpoint `DELETE /investigations/{id}` belum ada
   * di SRS §6, jadi UI memverifikasi ketersediaannya dan memberi pesan jelas.
   */
  async function deleteInvestigation() {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v1/investigations/${selectedCase}`,
        { method: "DELETE", credentials: "include" },
      );
      const available = res.status !== 404 && res.status !== 405;
      setStatus({
        kind: available ? "saved" : "error",
        ...(available
          ? { at: new Date() }
          : { message: "Penghapusan data investigasi belum tersedia di backend." }),
      } as SaveStatus);
    } catch {
      setStatus({ kind: "error", message: "Backend tidak dapat dihubungi." });
    }
  }

  async function downloadAccessLog() {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/audit-logs?limit=100`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Gagal mengambil log (HTTP ${res.status}).`);
      const rows = (await res.json()) as Record<string, unknown>[];
      const headers = rows.length ? Object.keys(rows[0]) : ["message"];
      const lines = [
        headers.join(","),
        ...rows.map((row) =>
          headers.map((key) => JSON.stringify(row[key] ?? "")).join(","),
        ),
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "claimguard-log-akses.csv";
      link.click();
      URL.revokeObjectURL(url);
      setStatus({ kind: "saved", at: new Date() });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Unduh log gagal.",
      });
    }
  }

  /**
   * Penyamaran data pembeli belum punya field runtime di backend (SRS §8 tidak
   * menyimpannya), jadi nilainya lokal. Kirim PATCH begitu field-nya ditambahkan.
   */
  function toggleMask(next: boolean) {
    setMaskPii(next);
    setStatus({ kind: "saved", at: new Date() });
    if (typeof window !== "undefined") {
      window.localStorage.setItem("claimguard.mask_pii", String(next));
    }
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
          {/* 1. Retensi */}
          <SectionCard
            title="Retensi"
            description="Pengaturan masa simpan rekaman video meja packing dan berkas bukti"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="retention" className="field-label">
                Simpan rekaman video
              </label>
              <Select
                id="retention"
                label="Simpan rekaman video"
                value={retention}
                options={RETENTION_OPTIONS.map((value) => ({ value, label: value }))}
                onChange={setRetention}
                className="max-w-md"
              />
              <p className="hint">
                Klip sementara dihapus otomatis setelah 7 hari jika tidak ada
                anomali atau klaim terkait.
              </p>
            </div>
          </SectionCard>

          {/* 2. Penyamaran data pembeli */}
          <SectionCard
            title="Penyamaran data pembeli"
            description="Kepatuhan terhadap Undang-Undang Pelindungan Data Pribadi (UU PDP)"
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div className="max-w-lg">
                  <p className="field-label">
                    Samarkan nama, alamat, dan nomor telepon di video dan foto (UU
                    PDP)
                  </p>
                  <p className="mt-1 text-[13px] leading-[21px] text-ink-muted">
                    Secara otomatis memburamkan informasi identitas pembeli sebelum
                    diteruskan ke kurir atau pihak eksternal.
                  </p>
                </div>
                <Switch
                  label="Samarkan data pembeli"
                  checked={maskPii}
                  onChange={toggleMask}
                />
              </div>

              <div className="flex flex-col gap-2">
                <p className="eyebrow">Pratinjau label pengiriman</p>
                <div className="flex flex-col gap-10 rounded-lg border border-line-strong bg-subtle p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Icon src="icon-kamera.svg" className="size-4" />
                      <p className="text-[13px] font-medium text-ink">
                        Kamera Meja 02 · 14.12.08 WIB
                      </p>
                    </div>
                    <span className="rounded border border-line bg-neutral-soft px-2 py-0.5 text-[11px] leading-[16.5px] text-ink-muted">
                      Rekaman Terproteksi
                    </span>
                  </div>

                  <div className="flex justify-center">
                    <span
                      className={[
                        "inline-flex items-center gap-2 rounded px-4 py-2.5 text-[13px] font-medium shadow-sm transition-colors",
                        maskPii
                          ? "bg-ink-muted text-surface"
                          : "bg-brand text-on-brand",
                      ].join(" ")}
                    >
                      <Icon src="icon-data-masked.svg" className="h-3.5 w-4" />
                      {maskPii ? "Data pribadi disamarkan" : "Data pribadi terlihat"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] leading-[16.5px] text-ink-muted">
                    <span>ID Pesanan: INV/20250224/09881</span>
                    <span>Label resi terenkripsi</span>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* 3. Pemrosesan AI */}
          <SectionCard
            title="Pemrosesan AI"
            description="Standar privasi dalam analisis penglihatan komputer dan model bahasa"
          >
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-[22.75px] text-nav">
                Video dan foto hanya dikirim ke Gemini untuk analisis dan tidak
                dipakai untuk tujuan lain. Berkas diproses di server aman
                terenkripsi.
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle p-2">
                <Icon src="icon-encrypt.svg" className="size-4" />
                <p className="text-[13px] leading-[18px] text-ink-muted">
                  Enkripsi AES-256 saat transit dan istirahat (in-transit &
                  at-rest).
                </p>
              </div>
            </div>
          </SectionCard>

          {/* 4. Hapus data */}
          <div className="pb-8">
            <SectionCard
              title="Hapus data"
              description="Pembersihan manual arsip kasus dan berkas investigasi"
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="closed-case" className="field-label">
                  Kasus
                </label>
                <Select
                  id="closed-case"
                  label="Kasus"
                  value={selectedCase}
                  options={CLOSED_CASES}
                  onChange={setSelectedCase}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void deleteInvestigation()}
                  className="focus-ring inline-flex items-center gap-2 rounded-lg border border-danger bg-surface px-3 py-2 text-base text-danger hover:bg-danger/5"
                >
                  <Icon src="icon-trash.svg" className="h-3.5 w-3" />
                  Hapus data investigasi
                </button>
                <button
                  type="button"
                  onClick={() => void downloadAccessLog()}
                  className="focus-ring inline-flex items-center gap-2 rounded-lg px-3 py-2 text-base text-brand hover:bg-subtle"
                >
                  <Icon src="icon-download.svg" className="size-3" />
                  Unduh log akses
                </button>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}
