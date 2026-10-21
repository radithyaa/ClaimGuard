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
  const out: InvestigationEvent[] = SCRIPT.filter((s) => r.startedAt + s.at <= now).map((s, i) => ({
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
  return {
    id,
    shipment_id: s.id,
    anomaly_id: s.anomaly?.id ?? null,
    case_type: s.anomaly?.case_type ?? "lost",
    status: done ? "completed" : last?.type === "cancelled" ? "cancelled" : "running",
    outcome: done ? "claim_drafted" : null,
    verdict: (decision?.verdict as string) ?? null,
    confidence: (decision?.confidence as number) ?? null,
    decision_reason: (decision?.reason as string) ?? null,
    error: null,
    started_at: new Date(r.startedAt).toISOString(),
    finished_at: done || last?.type === "cancelled" ? last!.ts : null,
    duration_ms: done ? 13000 : null,
    evidence: events.some((e) => e.type === "tool_end" && e.payload.tool === "analyze_media_for") ? [{ ...EVIDENCE, investigation_id: id }] : [],
    claim_id: done ? "clm-001" : null,
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
