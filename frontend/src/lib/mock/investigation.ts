// Mock investigasi live: skrip event SSE yang diputar ulang menurut waktu sejak run dimulai,
// sehingga refresh/reconnect tetap konsisten (meniru replay Last-Event-ID backend).
import type { Evidence, InvestigationEvent, InvestigationView } from "@/types/api";

import * as db from "./data";

type Step = { at: number; type: InvestigationEvent["type"]; agent?: string; payload: Record<string, unknown>; source?: "live" | "cache" };

const SCRIPT: Step[] = [
  { at: 0, type: "status", payload: { status: "running" } },
  { at: 600, type: "thought", agent: "investigator", payload: { text: "Paket tidak bergerak 3 hari sejak hub transit. Mengumpulkan konteks kasus." } },
  { at: 1200, type: "tool_start", agent: "investigator", payload: { tool: "get_case_context", args: { shipment_id: "shp-001" } } },
  { at: 1800, type: "tool_end", agent: "investigator", payload: { tool: "get_case_context", status: "ok", duration_ms: 420 } },
  { at: 2400, type: "tool_start", agent: "investigator", payload: { tool: "clip_cctv_for_shipment", args: { window_sec: 40 } } },
  { at: 2600, type: "tool_start", agent: "investigator", payload: { tool: "get_courier_policy", args: { courier: "jne" } } },
  { at: 3800, type: "tool_end", agent: "investigator", payload: { tool: "get_courier_policy", status: "ok", duration_ms: 1300 }, source: "cache" },
  { at: 4600, type: "tool_end", agent: "investigator", payload: { tool: "clip_cctv_for_shipment", status: "ok", duration_ms: 2100, result: { evidence_id: "evd-001" } } },
  { at: 5200, type: "tool_start", agent: "investigator", payload: { tool: "analyze_media_for", args: { focus: "packing" } } },
  { at: 9500, type: "tool_end", agent: "investigator", payload: { tool: "analyze_media_for", status: "ok", duration_ms: 4300 }, source: "live" },
  { at: 10000, type: "thought", agent: "investigator", payload: { text: "Barang terlihat dikemas dan label resi terbaca. Paket diserahkan ke kurir dalam kondisi baik." } },
  { at: 11500, type: "decision", agent: "evaluator", payload: { decision: "claim", outcome: "claim_drafted", confidence: 0.86, verdict: "Paket hilang setelah diserahkan ke kurir", reason: "Rekaman packing menunjukkan barang dikemas dan label resi cocok; pelacakan berhenti di hub transit lebih dari batas SLA.", evidence_ids: ["evd-001"], missing_evidence: [] } },
  { at: 12500, type: "thought", agent: "drafter", payload: { text: "Draf klaim selesai disusun." } },
  { at: 13000, type: "done", payload: { outcome: "claim_drafted", claim_id: "clm-001", duration_ms: 13000 } },
];

const COMMON_START: Step[] = SCRIPT.slice(0, 4);

const SELLER_SCRIPT: Step[] = [
  ...COMMON_START,
  { at: 2400, type: "tool_start", agent: "investigator", payload: { tool: "clip_cctv_for_shipment", args: { window_sec: 40 } } },
  { at: 4400, type: "tool_end", agent: "investigator", payload: { tool: "clip_cctv_for_shipment", status: "ok", duration_ms: 2000, result: { evidence_id: "evd-011" } } },
  { at: 5000, type: "tool_start", agent: "investigator", payload: { tool: "analyze_media_for", args: { focus: "packing" } } },
  { at: 9000, type: "tool_end", agent: "investigator", payload: { tool: "analyze_media_for", status: "ok", duration_ms: 4000 }, source: "live" },
  { at: 9400, type: "tool_start", agent: "investigator", payload: { tool: "get_courier_policy", args: { courier: "sicepat" } } },
  { at: 10200, type: "tool_end", agent: "investigator", payload: { tool: "get_courier_policy", status: "ok", duration_ms: 800 }, source: "cache" },
  { at: 10600, type: "thought", agent: "investigator", payload: { text: "Rekaman packing memperlihatkan kaos merah ukuran M yang dikemas, sedangkan pesanan tertulis kaos hitam ukuran L." } },
  { at: 12000, type: "decision", agent: "evaluator", payload: { decision: "seller_error", outcome: "seller_error", confidence: 0.9, verdict: "Barang yang dikemas berbeda dari pesanan", reason: "CCTV meja packing detik 0:30 memperlihatkan kaos merah ukuran M dimasukkan ke kardus, padahal pesanan kaos hitam ukuran L. Ketidaksesuaian terjadi saat pengemasan di gudang, jadi klaim ke kurir tidak diajukan. Sebaiknya retur pembeli ditindaklanjuti.", evidence_ids: ["evd-011"], missing_evidence: [] } },
  { at: 12400, type: "done", payload: { outcome: "seller_error", claim_id: null, duration_ms: 12400 } },
];

const NO_CCTV_SCRIPT: Step[] = [
  ...COMMON_START,
  { at: 2400, type: "tool_start", agent: "investigator", payload: { tool: "clip_cctv_for_shipment", args: { window_sec: 40 } } },
  { at: 3600, type: "tool_end", agent: "investigator", payload: { tool: "clip_cctv_for_shipment", status: "error", duration_ms: 1200 } },
  { at: 4000, type: "tool_start", agent: "investigator", payload: { tool: "get_courier_policy", args: { courier: "jne" } } },
  { at: 4800, type: "tool_end", agent: "investigator", payload: { tool: "get_courier_policy", status: "ok", duration_ms: 800 }, source: "cache" },
  { at: 5200, type: "thought", agent: "investigator", payload: { text: "Rekaman meja packing untuk resi ini tidak ditemukan, jadi isi paket saat dikemas tidak bisa dibuktikan." } },
  { at: 6600, type: "decision", agent: "evaluator", payload: { decision: "needs_evidence", outcome: "needs_evidence", confidence: 0.55, verdict: "Bukti isi paket belum ada", reason: "Paket tertahan melewati batas SLA, tetapi rekaman packing tidak tersedia. Tanpa bukti isi paket, klaim ke JNE berisiko ditolak.", evidence_ids: [], missing_evidence: ["Foto atau video saat barang dikemas", "Bukti nilai barang (invoice pesanan)"] } },
  { at: 7000, type: "done", payload: { outcome: "needs_evidence", claim_id: null, duration_ms: 7000 } },
];

const SELLER_EVIDENCE_FINDINGS = {
  verdict: "item_packed",
  confidence: 0.9,
  findings: [
    { description: "Kaos berwarna merah diambil dari rak dan dimasukkan ke kardus", severity: "critical" as const },
    { description: "Pesanan tertulis kaos polos hitam ukuran L; yang dikemas kaos merah ukuran M", severity: "critical" as const },
    { description: "Resi SCP8899770011 dipindai dan kardus disegel rapi", severity: "info" as const },
  ],
  timestamp_evidence: [
    { t_sec: 30, label: "Scan resi" },
    { t_sec: 32, label: "Kaos merah diambil" },
    { t_sec: 37, label: "Masuk kardus" },
  ],
};

/** Skrip per resi: C2 -> seller_error, shp-004 (tanpa CCTV) -> needs_evidence, lainnya -> klaim. */
function scriptFor(id: string): Step[] {
  const sid = id.replace(/^inv-mock-/, "");
  if (sid === "shp-011") return SELLER_SCRIPT;
  if (sid === "shp-004") return NO_CCTV_SCRIPT;
  return SCRIPT;
}

export const EVIDENCE: Evidence = {
  id: "evd-001",
  investigation_id: "",
  kind: "cctv_clip",
  clip_start_sec: 12,
  clip_duration_sec: 40,
  analysis_source: "live",
  created_at: new Date().toISOString(),
  analysis_json: {
    verdict: "item_packed",
    confidence: 0.88,
    findings: [
      { description: "1 unit sepatu kulit masuk ke kotak", severity: "info" },
      { description: "Label resi JNE0012345678 terbaca dan cocok dengan pesanan", severity: "info" },
      { description: "Kotak disegel dan diletakkan di area serah terima", severity: "info" },
    ],
    timestamp_evidence: [
      { t_sec: 12, label: "Barang masuk kotak" },
      { t_sec: 18, label: "Scan label resi" },
      { t_sec: 31, label: "Kotak disegel" },
    ],
  },
};

const runs = new Map<string, { startedAt: number; cancelledAt?: number }>();

function run(id: string) {
  if (!runs.has(id)) runs.set(id, { startedAt: Date.now() });
  return runs.get(id)!;
}

function shipmentFor(id: string) {
  const sid = id.replace(/^inv-mock-/, "");
  return db.shipments.find((s) => s.id === sid) ?? db.shipments[0];
}

/** Event yang sudah "terjadi" sampai saat ini. */
export function eventsSoFar(id: string): InvestigationEvent[] {
  const r = run(id);
  const now = r.cancelledAt ?? Date.now();
  const out: InvestigationEvent[] = scriptFor(id).filter((s) => r.startedAt + s.at <= now).map((s, i) => ({
    seq: i + 1,
    investigation_id: id,
    type: s.type,
    agent: s.agent ?? null,
    ts: new Date(r.startedAt + s.at).toISOString(),
    payload: s.payload,
    source: s.source ?? null,
  }));
  if (r.cancelledAt && out.at(-1)?.type !== "done") {
    out.push({ seq: out.length + 1, investigation_id: id, type: "cancelled", agent: null, ts: new Date(r.cancelledAt).toISOString(), payload: { message: "Investigasi dihentikan oleh pengguna" }, source: null });
  }
  return out;
}

export function mockView(id: string): InvestigationView {
  const s = shipmentFor(id);
  const events = eventsSoFar(id);
  const last = events.at(-1);
  const done = last?.type === "done";
  const decision = events.find((e) => e.type === "decision")?.payload as Record<string, unknown> | undefined;
  const r = run(id);
  const end = events.find((e) => e.type === "done")?.payload;
  const analyzed = events.some((e) => e.type === "tool_end" && e.payload.tool === "analyze_media_for");
  const evidence: Evidence[] = !analyzed
    ? []
    : s.id === "shp-011"
      ? [{ ...EVIDENCE, id: "evd-011", investigation_id: id, clip_start_sec: 20, clip_duration_sec: 25, analysis_json: SELLER_EVIDENCE_FINDINGS }]
      : [{ ...EVIDENCE, investigation_id: id }];
  return {
    id,
    shipment_id: s.id,
    anomaly_id: s.anomaly?.id ?? null,
    case_type: s.anomaly?.case_type ?? "lost",
    status: done ? "completed" : last?.type === "cancelled" ? "cancelled" : "running",
    outcome: (end?.outcome as InvestigationView["outcome"]) ?? null,
    verdict: (decision?.verdict as string) ?? null,
    confidence: (decision?.confidence as number) ?? null,
    decision_reason: (decision?.reason as string) ?? null,
    error: null,
    started_at: new Date(r.startedAt).toISOString(),
    finished_at: done || last?.type === "cancelled" ? last!.ts : null,
    duration_ms: (end?.duration_ms as number) ?? null,
    evidence,
    claim_id: (end?.claim_id as string | null) ?? null,
    tracking_number: s.tracking_number,
    courier: s.courier,
    anomaly_reason: s.anomaly?.reason_json ?? null,
    courier_policy: db.policies.find((p) => p.courier === s.courier) ?? null,
    is_active: !done && last?.type !== "cancelled",
  };
}

/** POST /demo/reset: hentikan & lupakan semua run. */
export function mockRunsReset() {
  runs.clear();
}

/** POST /investigations: mulai ulang skrip dari awal. */
export function mockStart(id: string) {
  runs.set(id, { startedAt: Date.now() });
}

export function mockCancel(id: string) {
  const r = run(id);
  if (!r.cancelledAt) r.cancelledAt = Date.now();
}

/** Pengganti EventSource di mode mock: kirim event setelah `afterSeq` sesuai jadwal skrip. */
export function mockStream(id: string, afterSeq: number, onEvent: (e: InvestigationEvent) => void): () => void {
  let sent = afterSeq;
  const tick = () => {
    for (const e of eventsSoFar(id)) {
      if (e.seq > sent) {
        sent = e.seq;
        onEvent(e);
      }
    }
  };
  tick();
  const timer = setInterval(tick, 200);
  return () => clearInterval(timer);
}

/** F6 mock: sama dengan backend app/services/buyer_request.py (draf, tidak dikirim). */
export function mockBuyerRequest(id: string) {
  const view = mockView(id);
  if (view.outcome !== "needs_evidence") throw new Error("invalid_status");
  const s = shipmentFor(id);
  const decision = eventsSoFar(id).find((e) => e.type === "decision")?.payload;
  const missing = (decision?.missing_evidence as string[] | undefined) ?? [];
  const courier = { jne: "JNE", jnt: "J&T", sicepat: "SiCepat" }[s.courier];
  const deadline = s.claim_deadline;
  const tgl = deadline
    ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(deadline))
    : null;
  const message = [
    "Halo Kak, terima kasih sudah menghubungi kami.",
    "",
    `Agar kami dapat menindaklanjuti pesanan dengan nomor resi ${s.tracking_number} (${s.item_name}) ke ${courier}, mohon bantuan Kakak mengirimkan:`,
    ...missing.map((m) => `- ${m}`),
    "",
    ...(tgl ? [`Mohon dikirim paling lambat ${tgl}, karena batas pengajuan klaim ke ${courier} berakhir pada tanggal tersebut.`] : []),
    "Bila merekam video, mulai dari sebelum segel dibuka sampai isi paket terlihat jelas, tanpa dipotong.",
    "",
    "Terima kasih atas bantuannya.",
  ].join("\n");
  return { investigation_id: id, tracking_number: s.tracking_number, courier: s.courier, missing_evidence: missing, deadline, message };
}
