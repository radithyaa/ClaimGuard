// Data mock frontend. Sumber kebenaran tetap backend/data/mock/shipments.json milik Backend B;
// bila berbeda, samakan berkas ini dengan milik backend (SRS 15.1 "Mock data milik Backend B").
import type {
  Anomaly,
  AppSettings,
  AuditLog,
  ClaimSummary,
  CourierPolicy,
  ShipmentDetail,
} from "@/types/api";

const d = (iso: string) => new Date(iso).toISOString();

function anomaly(id: string, shipment_id: string, a: Omit<Anomaly, "id" | "shipment_id" | "status" | "detected_at">): Anomaly {
  return { id, shipment_id, status: "open", detected_at: d("2026-10-21T03:00:00Z"), ...a };
}

// claim_deadline diisi di akhir berkas (butuh kebijakan kurir)
const base = { is_simulated: true, buyer_report: null, latest_investigation: null, latest_claim: null, claim_deadline: null };

export const shipments: ShipmentDetail[] = [
  {
    ...base,
    id: "shp-001",
    tracking_number: "JNE0012345678",
    courier: "jne",
    status: "in_transit",
    origin: "Bandung",
    destination: "Surabaya",
    shipped_at: d("2026-10-15T04:00:00Z"),
    sla_deadline: d("2026-10-18T04:00:00Z"),
    item_name: "Sepatu kulit pria",
    item_value: 450000,
    tracking_events: [
      { id: "te-1", status: "Paket dikemas", location: "Gudang Bandung", occurred_at: d("2026-10-15T02:10:20Z") },
      { id: "te-2", status: "Diserahkan ke kurir", location: "Bandung", occurred_at: d("2026-10-15T04:00:00Z") },
      { id: "te-3", status: "Tiba di hub transit", location: "Semarang", occurred_at: d("2026-10-16T09:30:00Z") },
    ],
    anomaly: anomaly("anm-001", "shp-001", {
      code: "SLA_EXCEEDED",
      case_type: "lost",
      severity: "high",
      reason_json: { summary: "Melewati SLA 3 hari tanpa pergerakan sejak hub Semarang", days_late: 3 },
    }),
    active_anomaly: { id: "anm-001", code: "SLA_EXCEEDED", case_type: "lost", severity: "high" },
  },
  {
    ...base,
    id: "shp-002",
    tracking_number: "JT7788990011",
    courier: "jnt",
    status: "delivered",
    origin: "Bandung",
    destination: "Jakarta Selatan",
    shipped_at: d("2026-10-17T05:00:00Z"),
    sla_deadline: d("2026-10-19T05:00:00Z"),
    item_name: "Vas keramik",
    item_value: 275000,
    buyer_report: "Vas pecah saat dibuka, ada video unboxing.",
    tracking_events: [
      { id: "te-4", status: "Diserahkan ke kurir", location: "Bandung", occurred_at: d("2026-10-17T05:00:00Z") },
      { id: "te-5", status: "Diterima pembeli", location: "Jakarta Selatan", occurred_at: d("2026-10-18T10:15:00Z") },
    ],
    anomaly: anomaly("anm-002", "shp-002", {
      code: "BUYER_REPORTED_DAMAGE",
      case_type: "damaged",
      severity: "medium",
      reason_json: { summary: "Pembeli melaporkan barang rusak dengan video unboxing" },
    }),
    active_anomaly: { id: "anm-002", code: "BUYER_REPORTED_DAMAGE", case_type: "damaged", severity: "medium" },
  },
  {
    ...base,
    id: "shp-003",
    tracking_number: "SCP5566778899",
    courier: "sicepat",
    status: "returned",
    origin: "Bandung",
    destination: "Yogyakarta",
    shipped_at: d("2026-10-14T03:00:00Z"),
    sla_deadline: d("2026-10-16T03:00:00Z"),
    item_name: "Earphone nirkabel",
    item_value: 620000,
    buyer_report: "Barang yang diterima kotak kosong, minta retur dana.",
    tracking_events: [
      { id: "te-6", status: "Diterima pembeli", location: "Yogyakarta", occurred_at: d("2026-10-15T08:00:00Z") },
      { id: "te-7", status: "Retur diajukan", location: "Yogyakarta", occurred_at: d("2026-10-17T02:00:00Z") },
    ],
    anomaly: anomaly("anm-003", "shp-003", {
      code: "RETURN_DISPUTE",
      case_type: "return_fraud",
      severity: "high",
      reason_json: { summary: "Klaim kotak kosong bertentangan dengan log packing" },
    }),
    active_anomaly: { id: "anm-003", code: "RETURN_DISPUTE", case_type: "return_fraud", severity: "high" },
  },
  {
    // C2 (docs/data-dummy-dan-video.md): penjual salah kirim -> keputusan seller_error
    ...base,
    id: "shp-011",
    tracking_number: "SCP8899770011",
    courier: "sicepat",
    status: "returned",
    origin: "Bandung",
    destination: "Surabaya",
    shipped_at: d("2026-10-18T03:30:00Z"),
    sla_deadline: d("2026-10-25T03:30:00Z"),
    item_name: "Kaos polos hitam, ukuran L",
    item_value: 95000,
    buyer_report: "Saya pesan kaos hitam ukuran L, tapi yang datang kaos merah ukuran M. Warnanya berbeda dari pesanan. Saya minta retur.",
    tracking_events: [
      { id: "te-8", status: "Paket dikemas", location: "Gudang Bandung", occurred_at: d("2026-10-17T01:03:30Z") },
      { id: "te-9", status: "Diserahkan ke kurir", location: "Bandung", occurred_at: d("2026-10-18T03:30:00Z") },
      { id: "te-10", status: "Diterima pembeli", location: "Surabaya", occurred_at: d("2026-10-19T07:45:00Z") },
      { id: "te-11", status: "Retur diajukan", location: "Surabaya", occurred_at: d("2026-10-20T01:00:00Z") },
    ],
    anomaly: anomaly("anm-011", "shp-011", {
      code: "RETURN_DISPUTE",
      case_type: "return_fraud",
      severity: "high",
      reason_json: { summary: "Pembeli mengklaim isi paket tidak sesuai; perlu dicocokkan dengan bukti packing" },
    }),
    active_anomaly: { id: "anm-011", code: "RETURN_DISPUTE", case_type: "return_fraud", severity: "high" },
  },
  ...[
    ["shp-004", "JNE0099887766", "jne", "in_transit", "Medan", "Kaos polos 3 pcs", 150000],
    ["shp-005", "JT1122334455", "jnt", "out_for_delivery", "Depok", "Tas selempang", 320000],
    ["shp-006", "SCP1029384756", "sicepat", "delivered", "Bekasi", "Botol minum", 89000],
    ["shp-007", "JNE0055443322", "jne", "picked_up", "Malang", "Jaket denim", 380000],
    ["shp-008", "JT6677889900", "jnt", "delivered", "Bogor", "Lampu meja", 210000],
    ["shp-009", "SCP9988776655", "sicepat", "in_transit", "Makassar", "Jam tangan", 540000],
    ["shp-010", "JNE0011223344", "jne", "created", "Tangerang", "Buku resep", 95000],
  ].map(([id, tn, courier, status, dest, item, value], i) => ({
    ...base,
    id: id as string,
    tracking_number: tn as string,
    courier: courier as ShipmentDetail["courier"],
    status: status as ShipmentDetail["status"],
    origin: "Bandung",
    destination: dest as string,
    shipped_at: d(`2026-10-${19 + (i % 2)}T0${i + 1}:00:00Z`),
    sla_deadline: d(`2026-10-${22 + (i % 2)}T0${i + 1}:00:00Z`),
    item_name: item as string,
    item_value: value as number,
    tracking_events: [],
    anomaly: null,
    active_anomaly: null,
  })),
];

export const claims: ClaimSummary[] = [
  {
    id: "clm-001",
    shipment_id: "shp-001",
    tracking_number: "JNE0012345678",
    courier: "jne",
    status: "pending_approval",
    confidence: 0.86,
    claim_value: 450000,
    created_at: d("2026-10-21T03:05:00Z"),
    is_simulated: true,
    case_type: "lost",
    claim_deadline: null,
  },
  // Klaim yang sudah diputuskan, agar laporan uang pulih punya isi
  { id: "clm-002", shipment_id: "shp-002", tracking_number: "JT7788990011", courier: "jnt", status: "submitted", confidence: 0.91, claim_value: 275000, created_at: d("2026-10-18T04:10:00Z"), is_simulated: true, case_type: "damaged", claim_deadline: null },
  { id: "clm-003", shipment_id: "shp-008", tracking_number: "JT6677889900", courier: "jnt", status: "submitted", confidence: 0.84, claim_value: 210000, created_at: d("2026-10-16T07:20:00Z"), is_simulated: true, case_type: "lost", claim_deadline: null },
  { id: "clm-004", shipment_id: "shp-006", tracking_number: "SCP1029384756", courier: "sicepat", status: "submitted", confidence: 0.8, claim_value: 89000, created_at: d("2026-10-14T02:45:00Z"), is_simulated: true, case_type: "damaged", claim_deadline: null },
  { id: "clm-005", shipment_id: "shp-003", tracking_number: "SCP5566778899", courier: "sicepat", status: "rejected", confidence: 0.55, claim_value: 620000, created_at: d("2026-10-19T09:30:00Z"), is_simulated: true, case_type: "return_fraud", claim_deadline: null },
];

export const policies: CourierPolicy[] = [
  {
    courier: "jne",
    claim_window_days: 14,
    required_docs: ["Foto resi", "Video packing", "Bukti nilai barang"],
    max_compensation: "Maks. 10x ongkir atau nilai barang bila diasuransikan",
    extra: {},
    source: "manual",
    extracted_at: d("2026-10-21T02:00:00Z"),
  },
  {
    courier: "jnt",
    claim_window_days: 7,
    required_docs: ["Foto kemasan", "Video unboxing", "Invoice"],
    max_compensation: "Maks. Rp1.000.000 tanpa asuransi",
    extra: {},
    source: "manual",
    extracted_at: d("2026-10-21T02:00:00Z"),
  },
  {
    courier: "sicepat",
    claim_window_days: 10,
    required_docs: ["Foto resi", "Video unboxing", "Foto barang rusak"],
    max_compensation: "Maks. 10x ongkir",
    extra: {},
    source: "manual",
    extracted_at: d("2026-10-21T02:00:00Z"),
  },
];

export const auditLogs: AuditLog[] = [
  { id: "al-3", actor: "agent:drafter", action: "claim_drafted", entity: "claim", entity_id: "clm-001", payload_json: { tracking_number: "JNE0012345678" }, created_at: d("2026-10-21T03:05:00Z") },
  { id: "al-2", actor: "agent:evaluator", action: "decision_made", entity: "investigation", entity_id: "inv-001", payload_json: { decision: "claim", confidence: 0.86 }, created_at: d("2026-10-21T03:04:40Z") },
  { id: "al-1", actor: "system", action: "anomaly_flagged", entity: "anomaly", entity_id: "anm-001", payload_json: { code: "SLA_EXCEEDED" }, created_at: d("2026-10-21T03:00:00Z") },
];

export const settings: AppSettings = {
  scan_interval_min: 5,
  sla_grace_hours: 0,
  min_confidence: 0.6,
  medium_confidence: 0.4,
  ai_mode: "auto",
  scheduler_enabled: false,
};

// Sama dengan backend app/services/deadlines.py: paket sampai/diretur -> event terakhir, selain itu batas SLA
const windowDays = Object.fromEntries(policies.map((p) => [p.courier, p.claim_window_days]));
function claimDeadline(s: ShipmentDetail): string | null {
  const days = windowDays[s.courier];
  if (days === undefined) return null;
  const arrived = s.status === "delivered" || s.status === "returned";
  const last = [...s.tracking_events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
  const ref = arrived && last ? last.occurred_at : s.sla_deadline;
  return new Date(new Date(ref).getTime() + days * 86400e3).toISOString();
}
for (const s of shipments) s.claim_deadline = claimDeadline(s);
for (const c of claims) {
  const s = shipments.find((x) => x.id === c.shipment_id);
  c.claim_deadline = s?.claim_deadline ?? null;
  c.case_type ??= s?.anomaly?.case_type ?? null;
}

// Kasus D: resi tertahan tanpa rekaman CCTV -> investigasi berakhir needs_evidence (F6)
const noCctv = shipments.find((x) => x.id === "shp-004")!;
noCctv.anomaly = anomaly("anm-004", "shp-004", {
  code: "SLA_EXCEEDED",
  case_type: "lost",
  severity: "medium",
  reason_json: { summary: "Tertahan di hub transit melewati batas SLA; rekaman packing tidak ditemukan" },
});
noCctv.active_anomaly = { id: "anm-004", code: "SLA_EXCEEDED", case_type: "lost", severity: "medium" };
