"use client";

import type { CourierThresholdPatch } from "@/lib/api";

export type CourierRule = {
  /** Kode kurir (mis. `jne`), dipakai backend sebagai kunci. */
  id: string;
  name: string;
  days: number;
  sla: string;
  tag?: string | null;
};

/** Pilihan kurir baru: kode harus sama dengan kode yang dikenal monitoring. */
const COURIER_OPTIONS = [
  { id: "jnt", name: "J&T Express", sla: "Standar SLA" },
  { id: "spx", name: "Shopee Xpress (SPX)", sla: "Standar SLA" },
  { id: "jne", name: "JNE Express", sla: "Kargo & Reguler" },
  { id: "sicepat", name: "SiCepat", sla: "Standar SLA" },
  { id: "anteraja", name: "Anteraja", sla: "Standar SLA" },
];

export function CourierTable({
  rules,
  loaded = true,
  onChange,
  onAdd,
  onRemove,
}: {
  rules: CourierRule[];
  /** `false` selama GET /settings belum selesai; tombol tambah ditahan agar tidak menimpa. */
  loaded?: boolean;
  onChange: (id: string, days: number) => void;
  onAdd: (courier: CourierThresholdPatch) => void;
  onRemove?: (id: string) => void;
}) {
  const available = COURIER_OPTIONS.filter(
    (option) => !rules.some((rule) => rule.id === option.id),
  );

  const addCourier = (option: (typeof COURIER_OPTIONS)[number]) =>
    onAdd({
      courier: option.id,
      display_name: option.name,
      hold_days: 3,
      sla_note: option.sla,
      tag: null,
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-line-strong">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-subtle text-[13px] font-bold leading-[18px] text-ink-muted">
              <th scope="col" className="px-3 py-2.5 font-bold">Kurir</th>
              <th scope="col" className="w-[168px] px-3 py-2.5 font-bold">
                Batas Tertahan
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-bold">
                Aksi/Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr
                key={rule.id}
                className="border-b border-line last:border-b-0 bg-surface"
              >
                <td className="px-3 py-3 text-base text-ink">{rule.name}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={rule.days}
                      aria-label={`Batas tertahan ${rule.name}`}
                      onChange={(e) =>
                        onChange(rule.id, Math.min(Math.max(Number(e.target.value) || 1, 1), 30))
                      }
                      className="h-8 w-16 rounded border border-field bg-surface px-2 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                    />
                    <span className="text-[13px] leading-[18px] text-ink-muted">
                      hari
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {rule.tag ? (
                      <span className="rounded-full bg-info-soft px-2 text-[11px] leading-[16.5px] text-info-ink">
                        {rule.tag}
                      </span>
                    ) : (
                      <span className="text-[13px] font-medium text-ink-muted">
                        {rule.sla}
                      </span>
                    )}
                    {onRemove && (
                      <button
                        type="button"
                        aria-label={`Hapus pengecualian ${rule.name}`}
                        onClick={() => onRemove(rule.id)}
                        className="focus-ring rounded px-1 text-[13px] text-ink-faint hover:text-danger"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <button
          type="button"
          disabled={!loaded || available.length === 0}
          onClick={() => available[0] && addCourier(available[0])}
          className="focus-ring inline-flex items-center gap-1.5 rounded pt-1 text-sm font-semibold text-brand hover:underline disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline"
        >
          + Tambah kurir
        </button>
      </div>
    </div>
  );
}
