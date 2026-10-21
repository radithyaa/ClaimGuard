"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  ApiError,
  DEFAULT_SETTINGS,
  patchSettings,
  putCourierThresholds,
  type CourierThreshold,
  type CourierThresholdPatch,
  type RuntimeSettings,
  type SettingsPatch,
} from "@/lib/api";

/** Bagian pengaturan yang dapat berubah lewat PATCH /settings. */
export type Draft = Omit<RuntimeSettings, "courier_thresholds">;

export type SettingsDraft = {
  draft: Draft;
  baseline: Draft;
  /** Pengecualian kurir per `courier`; urutan tombol "+ Tambah kurir" memakai urutan ini. */
  thresholds: Record<string, CourierThresholdPatch>;
  baselineThresholds: Record<string, CourierThresholdPatch>;
  dirtyKeys: Set<string>;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  update: (patch: SettingsPatch) => void;
  updateThreshold: (courier: string, holdDays: number) => void;
  addThreshold: (courier: CourierThresholdPatch) => void;
  /** Mengganti seluruh isi dengan nilai dari server (setelah GET / PUT). */
  replace: (settings: RuntimeSettings) => void;
  save: () => Promise<void>;
  discard: () => void;
};

function split(settings: RuntimeSettings): { draft: Draft; thresholds: Record<string, CourierThresholdPatch> } {
  const { courier_thresholds, ...rest } = settings;
  return {
    draft: rest,
    thresholds: Object.fromEntries(courier_thresholds.map((t) => [t.courier, t])),
  };
}

/**
 * Perubahan ditahan di state sampai operator menekan "Simpan". Alasan: waktu scan,
 * ambang tertahan, dan ambang keyakinan saling mengunci di backend (medium ≤ high),
 * jadi menyimpan per-ketukan menghasilkan transisi setengah jadi seperti 0,5 → 0,7.
 */
export function useSettingsDraft(initial: RuntimeSettings = DEFAULT_SETTINGS): SettingsDraft {
  const initialSplit = useMemo(() => split(initial), [initial]);
  const [draft, setDraft] = useState<Draft>(initialSplit.draft);
  const [baseline, setBaseline] = useState<Draft>(initialSplit.draft);
  const [thresholds, setThresholds] = useState(initialSplit.thresholds);
  const [baselineThresholds, setBaselineThresholds] = useState(initialSplit.thresholds);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const update = useCallback((patch: SettingsPatch) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setDirtyKeys((prev) => new Set([...prev, ...Object.keys(patch)]));
  }, []);

  const updateThreshold = useCallback((courier: string, holdDays: number) => {
    setThresholds((prev) =>
      prev[courier] ? { ...prev, [courier]: { ...prev[courier], hold_days: holdDays } } : prev,
    );
  }, []);

  const addThreshold = useCallback((item: CourierThresholdPatch) => {
    setThresholds((prev) => ({ ...prev, [item.courier]: item }));
  }, []);

  const replace = useCallback((settings: RuntimeSettings) => {
    const next = split(settings);
    setDraft(next.draft);
    setBaseline(next.draft);
    setThresholds(next.thresholds);
    setBaselineThresholds(next.thresholds);
    setDirtyKeys(new Set());
    setError(null);
  }, []);

  /** Validasi ringan sebelum kirim; pesan sama dengan validator Pydantic backend. */
  const validate = useCallback((): string | null => {
    if (draft.medium_confidence > draft.min_confidence) {
      return "Ambang sedang tidak boleh lebih besar dari ambang tinggi.";
    }
    for (const item of Object.values(thresholds)) {
      if (item.hold_days < 1 || item.hold_days > 30) {
        return `Batas tertahan ${item.display_name} harus 1–30 hari.`;
      }
    }
    return null;
  }, [draft.min_confidence, draft.medium_confidence, thresholds]);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);

    const patch: SettingsPatch = {};
    for (const key of dirtyKeys) {
      if (key in draft) Object.assign(patch, { [key]: draft[key as keyof Draft] });
    }

    try {
      if (Object.keys(patch).length > 0) {
        const saved = await patchSettings(patch);
        const next = split(saved);
        setDraft(next.draft);
        setBaseline(next.draft);
        setDirtyKeys(new Set());
      }

      const changedThresholds = Object.values(thresholds).filter((item) => {
        const before = baselineThresholds[item.courier];
        return !before || before.hold_days !== item.hold_days;
      });
      if (changedThresholds.length > 0) {
        const saved = await putCourierThresholds(Object.values(thresholds));
        const next = Object.fromEntries(saved.map((t: CourierThreshold) => [t.courier, t]));
        setThresholds(next);
        setBaselineThresholds(next);
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Sesi berakhir. Masuk ulang sebagai admin untuk menyimpan."
          : err instanceof Error
            ? err.message
            : "Gagal menyimpan perubahan.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [baselineThresholds, draft, dirtyKeys, thresholds, validate]);

  const discard = useCallback(() => {
    setDraft(baseline);
    setThresholds(baselineThresholds);
    setDirtyKeys(new Set());
    setError(null);
  }, [baseline, baselineThresholds]);

  return {
    draft,
    baseline,
    thresholds,
    baselineThresholds,
    dirtyKeys,
    dirty: dirtyKeys.size > 0,
    saving,
    error,
    update,
    updateThreshold,
    addThreshold,
    replace,
    save,
    discard,
  };
}

/** Nilai input teks dikosongkan saat diketik; dikembalikan ke nilai valid saat blur. */
export function parseDraftNumber(raw: string, fallback: number, min = 0, max = 1): number {
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
