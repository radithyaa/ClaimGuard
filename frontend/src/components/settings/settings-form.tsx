"use client";

import { useEffect, useState } from "react";

import { Checkbox, ConfidenceMeter, Switch } from "@/components/settings/controls";
import { CourierTable, type CourierRule } from "@/components/settings/courier-table";
import { PageHeader } from "@/components/settings/page-header";
import { InfoHint, SectionCard } from "@/components/settings/section-card";
import { Select } from "@/components/settings/select";
import { SettingsNav } from "@/components/settings/settings-nav";
import {
  SettingsBody,
  SettingsStatusPill,
  UnsavedBar,
  type SettingsStatus,
} from "@/components/settings/settings-status";
import { parseDraftNumber, useSettingsDraft } from "@/components/settings/use-settings-draft";
import { fetchSettings, type AiMode, type CourierThresholdPatch } from "@/lib/api";

const SCAN_OPTIONS = [1, 5, 10, 15, 30, 60];

const SLA_OPTIONS = [
  { value: 72, label: "72 jam", desc: "Penandaan awal di antrian klaim (warna abu-abu netral)." },
  { value: 24, label: "24 jam", desc: "Peringatan mendesak (ikon jam & warna amber)." },
  { value: 6, label: "6 jam", desc: "Peringatan kritis (ikon seru & warna merah di header antrian)." },
];

const AI_MODES = [
  { value: "auto", label: "Otomatis (live, cadangan cache)", desc: "Analisis langsung; bila Gemini gagal, pakai hasil cache dan tandai sumbernya." },
  { value: "live", label: "Live saja", desc: "Selalu memanggil Gemini. Bila gagal, investigasi berakhir dengan error." },
  { value: "cache", label: "Cache saja", desc: "Selalu memakai hasil analisis tersimpan; tidak ada biaya kuota." },
];

/** Disimpan untuk tampilan tabel; nilai yang tersimpan di backend adalah `hold_days`. */
function toRule(item: CourierThresholdPatch): CourierRule {
  return {
    id: item.courier,
    name: item.display_name,
    days: item.hold_days,
    sla: item.sla_note,
    tag: item.tag ?? undefined,
  };
}

export function SettingsForm() {
  const store = useSettingsDraft();
  const { draft, dirty, saving, error, update, updateThreshold, addThreshold, save, discard } =
    store;

  const [thresholdsLoaded, setThresholdsLoaded] = useState(false);

  // GET /settings bersifat publik; bila backend belum hidup form tetap bisa dicoba
  // dan simpan akan menampilkan pesan yang jelas.
  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((data) => {
        if (cancelled) return;
        store.replace(data);
        setThresholdsLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Sengaja sekali saat mount; `replace` stabil dari hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status: SettingsStatus = error
    ? { kind: "error", message: error }
    : dirty
      ? { kind: "dirty" }
      : { kind: "idle" };

  const rules = Object.values(store.thresholds).map(toRule);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Pengaturan"
        description="Konfigurasi pemantauan resi, ambang batas deteksi AI, dan notifikasi sistem."
        aside={<SettingsStatusPill status={status} />}
      />

      <div className="flex flex-1 flex-col gap-6 md:flex-row">
        <SettingsNav />

        <SettingsBody>
          {/* 1. Pemindaian otomatis */}
          <SectionCard
            title="Pemindaian otomatis"
            description="Frekuensi agen memeriksa status pelacakan resi ke API kurir dan sistem marketplace."
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <span className="field-label">Interval scan</span>
                <InfoHint text="Semakin cepat interval, semakin banyak panggilan API kurir dan kuota AI yang dipakai." />
              </div>

              <Select
                label="Interval scan"
                value={String(draft.scan_interval_min)}
                options={SCAN_OPTIONS.map((value) => ({
                  value: String(value),
                  label: `Setiap ${value} menit`,
                }))}
                onChange={(next) => update({ scan_interval_min: Number(next) })}
                className="max-w-md"
              />

              <p className="hint">
                {draft.scheduler_enabled
                  ? "Penjadwal aktif · scan berjalan otomatis di latar belakang."
                  : "Penjadwal nonaktif · scan hanya dipicu manual dari Ringkasan."}
              </p>
            </div>

            <div className="flex items-start justify-between gap-4 pt-1">
              <div className="max-w-lg">
                <p className="field-label">
                  Mulai investigasi otomatis untuk anomali prioritas tinggi
                </p>
                <p className="mt-1 text-[13px] leading-[21px] text-ink-muted">
                  Agen tetap berhenti di persetujuan Anda sebelum mengirim. Draf
                  klaim disiapkan otomatis tanpa memicu tindakan eksternal.
                </p>
              </div>
              <Switch
                label="Mulai investigasi otomatis"
                checked={draft.scheduler_enabled}
                onChange={(value) => update({ scheduler_enabled: value })}
              />
            </div>
          </SectionCard>

          {/* 2. Ambang tertahan */}
          <SectionCard
            title="Ambang tertahan"
            description="Batas hari resi tidak bergerak sebelum agen menandainya sebagai anomali 'Tertahan'."
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <span className="field-label">Default batas tertahan</span>
                <InfoHint text="Batas per hari keterlambatan untuk kurir tanpa pengecualian di bawah; dibandingkan dengan batas SLA 72 jam." />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={draft.sla_grace_hours}
                  aria-label="Default batas tertahan"
                  onChange={(e) =>
                    update({ sla_grace_hours: Number(e.target.value) || 0 })
                  }
                  className="field w-28"
                />
                <span className="text-base text-ink-muted">
                  jam tanpa pergerakan
                </span>
              </div>
            </div>

            <div className="border-t border-line" />

            <div className="flex flex-col gap-3">
              <div>
                <p className="field-label">Pengecualian per kurir</p>
                <p className="mt-1 text-[13px] leading-[18px] text-ink-muted">
                  Atur batas spesifik sesuai SLA dan performa rute tiap mitra
                  kurir.
                </p>
              </div>
              <CourierTable
                rules={rules}
                loaded={thresholdsLoaded}
                onChange={updateThreshold}
                onAdd={addThreshold}
              />
            </div>
          </SectionCard>

          {/* 3. Ambang keyakinan */}
          <SectionCard
            title="Ambang keyakinan"
            description="Di bawah ambang, kasus diarahkan ke peninjauan manual dan diberi label Perlu dicek."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <label htmlFor="threshold-high" className="field-label">
                    Tinggi mulai dari
                  </label>
                  <InfoHint text="Dipakai penjaga deterministik FR-12: keputusan di bawah nilai ini dipaksa menjadi Perlu bukti." />
                </div>
                <input
                  id="threshold-high"
                  inputMode="decimal"
                  value={draft.min_confidence}
                  onChange={(e) =>
                    update({ min_confidence: parseDraftNumber(e.target.value, draft.min_confidence) })
                  }
                  className="field"
                />
                <p className="hint">
                  Klaim siap ditinjau dengan verifikasi cepat.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <label htmlFor="threshold-medium" className="field-label">
                    Sedang mulai dari
                  </label>
                  <InfoHint text="Hanya memengaruhi label pada meter keyakinan; tidak boleh lebih besar dari ambang tinggi." />
                </div>
                <input
                  id="threshold-medium"
                  inputMode="decimal"
                  value={draft.medium_confidence}
                  onChange={(e) =>
                    update({ medium_confidence: parseDraftNumber(e.target.value, draft.medium_confidence) })
                  }
                  className="field"
                />
                <p className="hint">
                  Perlu pemeriksaan visual dokumen pendukung.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-line bg-subtle p-4">
              <p className="eyebrow">
                Pratinjau meter keyakinan (ConfidenceMeter)
              </p>
              <ConfidenceMeter high={draft.min_confidence} medium={draft.medium_confidence} />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="field-label">Mode Analisis AI</span>
              <div className="flex flex-col gap-1.5">
                {AI_MODES.map((mode) => (
                  <label
                    key={mode.value}
                    className={[
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition",
                      draft.ai_mode === mode.value
                        ? "border-brand bg-brand/5"
                        : "border-line hover:bg-subtle",
                    ].join(" ")}
                  >
                    <input
                      type="radio"
                      name="ai-mode"
                      value={mode.value}
                      checked={draft.ai_mode === mode.value}
                      onChange={() => update({ ai_mode: mode.value as AiMode })}
                      className="mt-1 size-4 shrink-0 accent-brand"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ink">
                        {mode.label}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-[18px] text-ink-muted">
                        {mode.desc}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </SectionCard>

          {/* 4. Pengingat tenggat */}
          <SectionCard
            title="Pengingat tenggat"
            description="Notifikasi dan penandaan visual sebelum batas waktu pengajuan klaim kurir kedaluwarsa."
          >
            <div className="flex flex-col gap-4">
              {SLA_OPTIONS.map((option) => (
                <Checkbox
                  key={option.value}
                  label={`${option.label} sebelum batas`}
                  description={option.desc}
                  checked={draft.deadline_reminder_hours.includes(option.value)}
                  onChange={(checked) =>
                    update({
                      deadline_reminder_hours: checked
                        ? [...draft.deadline_reminder_hours, option.value].sort((a, b) => b - a)
                        : draft.deadline_reminder_hours.filter((v) => v !== option.value),
                    })
                  }
                />
              ))}
            </div>
          </SectionCard>

          <UnsavedBar
            dirty={dirty}
            saving={saving}
            error={error}
            onSave={() => void save()}
            onDiscard={discard}
          />
        </SettingsBody>
      </div>
    </div>
  );
}
