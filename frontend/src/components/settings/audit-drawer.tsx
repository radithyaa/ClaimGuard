"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { Drawer, DrawerSection } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import {
  CATEGORY_META,
  actionMeta,
  actorKind,
  actorName,
  humanize,
  shortId,
} from "@/lib/audit";
import type { AuditLog } from "@/lib/api";

const PAYLOAD_KEY_LABELS: Record<string, string> = {
  decision: "Keputusan",
  confidence: "Keyakinan",
  code: "Kode anomali",
  case_type: "Jenis kasus",
  shipment_id: "ID resi",
  message: "Pesan",
  reason: "Alasan",
  length: "Panjang narasi",
  issues: "Catatan kelengkapan",
  filename: "Berkas",
  imported: "Resi baru",
  updated: "Resi diperbarui",
  skipped: "Dilewati",
  connected: "Status",
  couriers: "Kurir",
  hold_days: "Batas tertahan (hari)",
  older_than_days: "Lebih tua dari (hari)",
  deleted: "Dihapus",
  evidence: "Bukti",
  events: "Event",
  claims: "Klaim",
  submission_ref: "Nomor pengajuan",
  medium_confidence: "Ambang sedang",
  min_confidence: "Ambang tinggi",
  scan_interval_min: "Interval scan (menit)",
  scheduler_enabled: "Investigasi otomatis",
  deadline_reminder_hours: "Pengingat tenggat (jam)",
  sla_grace_hours: "Batas tertahan (jam)",
  ai_mode: "Mode analisis AI",
  video_retention_days: "Retensi video (hari)",
  mask_pii: "Samarkan data pribadi",
};

function payloadEntries(log: AuditLog): [string, unknown][] {
  return Object.entries(log.payload_json).filter(([, value]) => value !== null);
}

function renderPayloadValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(String).join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function payloadLabel(key: string): string {
  return PAYLOAD_KEY_LABELS[key] ?? humanize(key);
}

export function AuditDrawer({
  log,
  onClose,
  entityHref,
}: {
  log: AuditLog;
  onClose: () => void;
  /** Rute halaman entitas terkait, `null` bila halaman belum ada. */
  entityHref: string | null;
}) {
  const meta = actionMeta(log.action);
  const kind = actorKind(log.actor);
  const category = CATEGORY_META[meta.category];
  const entries = payloadEntries(log);
  const confidence =
    typeof log.payload_json.confidence === "number" ? log.payload_json.confidence : null;

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyDiff() {
    const lines = [
      `${meta.label} (${log.action})`,
      `pelaku: ${log.actor}`,
      `waktu: ${new Date(log.created_at).toISOString()}`,
      `entitas: ${log.entity}${log.entity_id ? `/${log.entity_id}` : ""}`,
      ...entries.map(([key, value]) => `${key}: ${renderPayloadValue(value)}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      icon={meta.icon}
      title={meta.label}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span>{actorName(log.actor)}</span>
          <span aria-hidden className="text-ink-faint">·</span>
          <span>{formatDateTime(log.created_at)}</span>
          <span aria-hidden className="text-ink-faint">·</span>
          <span className={`rounded px-1.5 py-0.5 text-[11px] leading-[16.5px] ${category.tone}`}>
            {category.label}
          </span>
        </span>
      }
      meta={
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-subtle p-3">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.05em] text-ink-muted">Waktu</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink">
              {formatDateTime(log.created_at)} WIB
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.05em] text-ink-muted">Pelaku</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-ink">
              {kind === "agen" && <span className="size-1.5 rounded-full bg-brand" />}
              {kind === "agen" ? `Agen · ${actorName(log.actor)}` : actorName(log.actor)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.05em] text-ink-muted">Entitas</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink">
              {log.entity}
              {log.entity_id && (
                <span className="text-ink-muted"> · {shortId(log.entity_id)}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.05em] text-ink-muted">ID catatan</dt>
            <dd className="mt-0.5 truncate text-sm font-medium text-ink" title={log.id}>
              {log.id.slice(0, 13)}
            </dd>
          </div>
        </dl>
      }
      footer={
        <>
          <button
            type="button"
            onClick={() => void copyDiff()}
            className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-subtle"
          >
            {copied && <Icon src="icon-check.svg" className="size-3" />}
            {copied ? "Tersalin" : "Salin detail"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-surface hover:bg-brand-deep"
          >
            Tutup
          </button>
        </>
      }
    >
      <DrawerSection title="Ringkasan">
        <p className="rounded-lg border border-line p-3 text-[13px] leading-[21px] text-ink">
          {meta.summarize(log)}
        </p>
      </DrawerSection>

      {confidence !== null && (
        <DrawerSection title="Keyakinan evaluator">
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-ink">
              {confidence.toFixed(2).replace(".", ",")}
            </span>
          </div>
          <p className="hint">
            Di bawah ambang keyakinan, kasus dipaksa menjadi Perlu bukti (FR-12).
          </p>
        </DrawerSection>
      )}

      <DrawerSection title="Payload">
        {entries.length === 0 ? (
          <p className="hint">Tidak ada detail tambahan.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full border-collapse text-left">
              <tbody>
                {entries.map(([key, value], index) => (
                  <tr key={key} className={index > 0 ? "border-t border-line" : undefined}>
                    <th scope="row" className="w-[40%] bg-subtle px-3 py-2 align-top text-[13px] font-medium text-ink-muted">
                      {payloadLabel(key)}
                    </th>
                    <td className="px-3 py-2 align-top">
                      <code className="break-words text-[13px] leading-[18px] text-ink">
                        {renderPayloadValue(value)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DrawerSection>

      <DrawerSection title="Jejak">
        <ol className="flex flex-col gap-2">
          <li className="flex items-start gap-2 text-[13px] leading-[18px] text-ink-muted">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
            <span>
              Tercatat oleh <strong className="font-medium text-ink">{log.actor}</strong> pada
              aksi <code className="rounded bg-subtle px-1 text-ink">{log.action}</code>.
            </span>
          </li>
          <li className="flex items-start gap-2 text-[13px] leading-[18px] text-ink-muted">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-field" />
            <span>
              Catatan audit bersifat tambah-saja; tidak ada aksi yang menghapusnya.
            </span>
          </li>
        </ol>
      </DrawerSection>

      {entityHref && (
        <Link
          href={entityHref}
          className="focus-ring inline-flex w-fit items-center gap-1 rounded pt-1 text-sm font-semibold text-brand hover:underline"
        >
          <Icon src="icon-arrow-right.svg" className="size-2.5" />
          {log.entity === "investigation" ? "Buka investigasi" : `Buka ${log.entity}`}
        </Link>
      )}
    </Drawer>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}
