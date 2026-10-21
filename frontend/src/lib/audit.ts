import type { AuditLog } from "@/lib/api";

/**
 * Katalog aksi audit (`app/services/audit.py` + pemanggilnya). Dipakai untuk label
 * bahasa manusia di tabel, filter jenis kejadian, dan pengelompokan drawer.
 */
export type AuditCategory =
  | "pelanggaran"
  | "keputusan"
  | "konfigurasi"
  | "data"
  | "sistem";

export type AuditMeta = {
  label: string;
  category: AuditCategory;
  icon: string;
  entities: string[];
  /** Ringkasan satu baris dari payload; dipakai di kolom "Ringkasan". */
  summarize: (log: AuditLog) => string;
};

const get = (log: AuditLog, key: string): string | undefined => {
  const value = log.payload_json[key];
  return value === undefined || value === null ? undefined : String(value);
};

export const AUDIT_CATALOG: Record<string, AuditMeta> = {
  anomaly_flagged: {
    label: "Anomali terdeteksi",
    category: "pelanggaran",
    icon: "icon-kamera.svg",
    entities: ["anomaly"],
    summarize: (log) => `Kode ${get(log, "code") ?? "—"} pada resi ${shortId(get(log, "shipment_id"))}`,
  },
  investigation_started: {
    label: "Investigasi dimulai",
    category: "pelanggaran",
    icon: "icon-scan.svg",
    entities: ["investigation"],
    summarize: (log) => `Kasus ${get(log, "case_type") ?? "—"} untuk resi ${shortId(get(log, "shipment_id"))}`,
  },
  decision_made: {
    label: "Keputusan evaluator",
    category: "keputusan",
    icon: "icon-check.svg",
    entities: ["investigation"],
    summarize: (log) => {
      const confidence = log.payload_json.confidence;
      const score = typeof confidence === "number" ? confidence.toFixed(2).replace(".", ",") : "—";
      return `${get(log, "decision") ?? "—"} · keyakinan ${score}`;
    },
  },
  investigation_failed: {
    label: "Investigasi gagal",
    category: "sistem",
    icon: "icon-info.svg",
    entities: ["investigation"],
    summarize: (log) => get(log, "message") ?? get(log, "code") ?? "Kesalahan tidak diketahui",
  },
  investigation_cancelled: {
    label: "Investigasi dihentikan",
    category: "keputusan",
    icon: "icon-trash.svg",
    entities: ["investigation"],
    summarize: () => "Dihentikan operator lewat tombol Hentikan Agen",
  },
  investigation_deleted: {
    label: "Data investigasi dihapus",
    category: "data",
    icon: "icon-trash.svg",
    entities: ["investigation"],
    summarize: (log) =>
      `${get(log, "evidence") ?? 0} bukti, ${get(log, "events") ?? 0} event, ${get(log, "claims") ?? 0} klaim`,
  },
  investigation_purged: {
    label: "Pembersihan investigasi",
    category: "data",
    icon: "icon-trash.svg",
    entities: ["investigation"],
    summarize: (log) =>
      `${get(log, "deleted") ?? 0} investigasi > ${get(log, "older_than_days") ?? "—"} hari dihapus`,
  },
  claim_drafted: {
    label: "Draf klaim dibuat",
    category: "keputusan",
    icon: "icon-antrian.svg",
    entities: ["claim"],
    summarize: (log) => {
      const issues = log.payload_json.issues;
      return Array.isArray(issues) && issues.length > 0
        ? `${issues.length} catatan kelengkapan draf`
        : "Draf siap ditinjau";
    },
  },
  claim_approved: {
    label: "Klaim disetujui & dikirim",
    category: "keputusan",
    icon: "icon-check.svg",
    entities: ["claim"],
    summarize: (log) => get(log, "submission_ref") ?? "Pengajuan simulasi",
  },
  claim_rejected: {
    label: "Klaim ditolak",
    category: "keputusan",
    icon: "icon-info.svg",
    entities: ["claim"],
    summarize: (log) => get(log, "reason") ?? "Tanpa alasan",
  },
  claim_edited: {
    label: "Narasi klaim diedit",
    category: "keputusan",
    icon: "icon-settings.svg",
    entities: ["claim"],
    summarize: (log) => `Panjang narasi ${get(log, "length") ?? "—"} karakter`,
  },
  settings_updated: {
    label: "Pengaturan diubah",
    category: "konfigurasi",
    icon: "icon-settings.svg",
    entities: ["settings"],
    summarize: (log) => {
      const keys = Object.keys(log.payload_json);
      return keys.length === 0 ? "Tanpa detail" : `${keys.length} parameter diubah`;
    },
  },
  courier_thresholds_updated: {
    label: "Pengecualian kurir diubah",
    category: "konfigurasi",
    icon: "icon-kebijakan.svg",
    entities: ["settings"],
    summarize: (log) => {
      const couriers = log.payload_json.couriers;
      return Array.isArray(couriers) ? couriers.join(", ") : "Tanpa detail";
    },
  },
  connection_updated: {
    label: "Koneksi marketplace diubah",
    category: "konfigurasi",
    icon: "icon-koneksi.svg",
    entities: ["connection"],
    summarize: (log) =>
      `${humanize(log.entity_id ?? "koneksi")} ${log.payload_json.connected ? "terhubung" : "diputuskan"}`,
  },
  shipments_imported: {
    label: "Resi diimpor",
    category: "data",
    icon: "icon-upload.svg",
    entities: ["shipment"],
    summarize: (log) =>
      `${get(log, "imported") ?? 0} baru, ${get(log, "updated") ?? 0} diperbarui dari ${get(log, "filename") ?? "berkas"}`,
  },
  demo_reset: {
    label: "Data demo direset",
    category: "sistem",
    icon: "icon-demo.svg",
    entities: ["demo"],
    summarize: () => "Mock data dikembalikan ke kondisi awal",
  },
};

const FALLBACK: Omit<AuditMeta, "summarize"> = {
  label: "Aktivitas sistem",
  category: "sistem",
  icon: "icon-audit.svg",
  entities: [],
};

export function actionMeta(action: string): AuditMeta {
  return (
    AUDIT_CATALOG[action] ?? {
      ...FALLBACK,
      label: humanize(action),
      summarize: (log) => Object.keys(log.payload_json).slice(0, 3).join(", ") || "—",
    }
  );
}

export function humanize(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export type ActorKind = "agen" | "pengguna" | "sistem";

/** `actor` di audit log: `agent:<nama>` (SRS §8), `user`, atau `system`. */
export function actorKind(actor: string): ActorKind {
  if (actor.startsWith("agent:")) return "agen";
  if (actor === "system") return "sistem";
  return "pengguna";
}

export function actorName(actor: string): string {
  const kind = actorKind(actor);
  if (kind === "agen") return humanize(actor.replace(/^agent:/, ""));
  if (kind === "sistem") return "Sistem";
  // Mode demo memakai satu password; nama operator tetap ditampilkan seperti sidebar.
  return "Rina Pratiwi";
}

export const CATEGORY_META: Record<AuditCategory, { label: string; tone: string }> = {
  pelanggaran: { label: "Pelanggaran", tone: "bg-[#fdecec] text-[#ba1a1a]" },
  keputusan: { label: "Keputusan", tone: "bg-brand/10 text-brand-deep" },
  konfigurasi: { label: "Konfigurasi", tone: "bg-info-soft text-info-ink" },
  data: { label: "Data", tone: "bg-[#f1f0ea] text-[#5c5340]" },
  sistem: { label: "Sistem", tone: "bg-subtle text-ink-muted" },
};

export const ENTITY_OPTIONS = Array.from(
  new Set(Object.values(AUDIT_CATALOG).flatMap((meta) => meta.entities)),
).sort();
