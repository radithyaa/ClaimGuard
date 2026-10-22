// Router mock in-memory untuk NEXT_PUBLIC_API_MOCK=1. Meniru kontrak SRS bagian 6.
import { ApiError } from "@/lib/api-client";
import type { MetricsSummary, Shipment, ShipmentDetail } from "@/types/api";
import * as db from "./data";
import { mockClaimApprove, mockClaimCreate, mockClaimGet, mockClaimReject, mockClaimsReset, mockClaimUpdate } from "./claims";
import { mockBuyerRequest, mockCancel, mockPause, mockRunsReset, mockStart, mockView } from "./investigation";

// Skenario demo -> resi mock (backend: field "scenario" di shipments.json)
const SCENARIO_SHIPMENT: Record<string, string> = { lost: "shp-001", damaged: "shp-002", needs_evidence: "shp-003", wrong_item_seller: "shp-011" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toSummary({ tracking_events, anomaly, buyer_report, latest_investigation, latest_claim, ...s }: ShipmentDetail): Shipment {
  void tracking_events; void anomaly; void buyer_report; void latest_investigation; void latest_claim;
  return s;
}

const DAY_MS = 86400e3;
const lastActivity = (s: ShipmentDetail) =>
  Math.max(new Date(s.sla_deadline).getTime(), ...s.tracking_events.map((e) => new Date(e.occurred_at).getTime()));

/** Lama admin meninjau per status akhir (H5); disimulasikan deterministik per klaim. */
const REVIEW_SEC: Record<string, number> = { submitted: 42, rejected: 65, pending_approval: 0 };

/** Ringkasan KPI dihitung dari data, supaya angka konsisten dengan tabel & antrian. */
function metricsSummary(): MetricsSummary {
  const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const days = [...Array(7)].map((_, i) => dayKey(Date.now() - (6 - i) * DAY_MS));
  const active = db.shipments.filter((s) => s.active_anomaly);
  const pending = db.claims.filter((c) => c.status === "pending_approval");
  const reviewed = db.claims.filter((c) => c.status !== "pending_approval");
  const reviewSecs = reviewed.map((c) => REVIEW_SEC[c.status] ?? 48);
  return {
    // Anomali yang sudah diputuskan tidak lagi dihitung sebagai aktif
    active_anomalies: db.shipments.filter((s) => s.active_anomaly && !s.latest_investigation?.outcome && s.anomaly?.status !== "resolved").length,
    pending_claims: pending.length,
    submitted_claims: db.claims.filter((c) => c.status === "submitted").length,
    estimated_value_saved: active.reduce((n, s) => n + s.item_value, 0),
    avg_processing_sec: 24.6,
    avg_review_sec: reviewSecs.length ? Math.round(reviewSecs.reduce((n, v) => n + v, 0) / reviewSecs.length) : null,
    reviewed_claims: reviewed.length,
    trend: days.map((date) => ({
      date,
      anomalies: active.filter((s) => dayKey(lastActivity(s)) === date).length,
      claims: db.claims.filter((c) => dayKey(new Date(c.created_at).getTime()) === date).length,
    })),
    is_simulated: true,
  };
}

type Opts = { query?: Record<string, unknown>; body?: unknown };

export async function mockRequest<T>(method: string, path: string, { query = {}, body }: Opts): Promise<T> {
  await sleep(250 + Math.random() * 250);
  const q = (k: string) => (query[k] === undefined || query[k] === "" ? undefined : String(query[k]));
  // "/shipments/shp-001" -> "/shipments/:id"; rute lain dibiarkan apa adanya
  const route = `${method} ${path
    .replace(/^\/shipments\/[\w-]+$/, "/shipments/:id")
    .replace(/^\/investigations\/[\w-]+(\/cancel|\/buyer-request)?$/, "/investigations/:id$1")
    .replace(/^\/claims\/[\w-]+(\/approve|\/reject)?$/, "/claims/:id$1")
    .replace(/^\/demo\/scenario\/[\w-]+$/, "/demo/scenario/:id")
    .replace(/^\/demo\/pause\/[\w-]+$/, "/demo/pause/:id")}`;
  const id = path.replace(/\/(cancel|approve|reject|buyer-request)$/, "").split("/").pop()!;

  switch (route) {
    case "POST /auth/login": {
      // Sama dengan DEMO_PASSWORD default backend (core/config.py)
      if ((body as { password?: string })?.password !== "claimguard-demo") throw new ApiError(401, "invalid_credentials", "Password salah");
      return { token: "mock-token", expires_in: 12 * 3600 } as T;
    }
    case "GET /shipments": {
      const term = q("q")?.toLowerCase();
      const rows = db.shipments.filter(
        (s) =>
          (!q("status") || s.status === q("status")) &&
          (!q("courier") || s.courier === q("courier")) &&
          (!term ||
            s.tracking_number.toLowerCase().includes(term) ||
            s.destination.toLowerCase().includes(term) ||
            s.origin.toLowerCase().includes(term) ||
            s.item_name.toLowerCase().includes(term)),
      );
      const limit = Number(q("limit") ?? 20);
      const offset = Number(q("offset") ?? 0);
      return { items: rows.slice(offset, offset + limit).map(toSummary), total: rows.length, limit, offset } as T;
    }
    case "GET /shipments/:id": {
      const s = db.shipments.find((x) => x.id === id);
      if (!s) throw new ApiError(404, "not_found", "Resi tidak ditemukan");
      return s as T;
    }
    case "POST /monitoring/scan":
      return { scanned: db.shipments.length, new_anomalies: [] } as T;
    case "POST /investigations": {
      const invId = `inv-mock-${(body as { shipment_id: string }).shipment_id}`;
      mockStart(invId);
      return { investigation_id: invId } as T;
    }
    case "GET /investigations/:id":
      return mockView(id) as T;
    case "GET /investigations/:id/buyer-request":
      try {
        return mockBuyerRequest(id) as T;
      } catch {
        throw new ApiError(409, "invalid_status", "Permintaan bukti hanya untuk investigasi yang butuh bukti tambahan");
      }
    case "POST /investigations/:id/buyer-request":
      return { status: "recorded" } as T;
    case "POST /investigations/:id/cancel":
      mockCancel(id);
      return { status: "cancelling" } as T;
    case "GET /claims": {
      const rows = db.claims.filter((c) => !q("status") || c.status === q("status"));
      const limit = Number(q("limit") ?? 20);
      const offset = Number(q("offset") ?? 0);
      return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset } as T;
    }
    case "POST /claims":
      return mockClaimCreate((body as { shipment_id: string }).shipment_id) as T;
    case "GET /claims/:id":
      return mockClaimGet(id) as T;
    case "PATCH /claims/:id":
      return mockClaimUpdate(id, (body as { narrative: string }).narrative) as T;
    case "POST /claims/:id/approve":
      return mockClaimApprove(id) as T;
    case "POST /claims/:id/reject":
      return mockClaimReject(id, (body as { reason: string }).reason) as T;
    case "POST /demo/reset":
      mockClaimsReset();
      mockRunsReset();
      return { shipments: db.shipments.length, media: 5, missing_media: [] } as T;
    case "POST /demo/scenario/:id": {
      const sid = SCENARIO_SHIPMENT[id];
      if (!sid) throw new ApiError(422, "validation_error", "Skenario tidak dikenal");
      mockStart(`inv-mock-${sid}`);
      return { investigation_id: `inv-mock-${sid}` } as T;
    }
    case "POST /demo/pause/:id": {
      // Mock-only: hentikan waktu skrip di titik tertentu (mis. tepat setelah event `decision`).
      mockPause(`inv-mock-${id}`, (body as { seconds: number }).seconds);
      return { status: "paused" } as T;
    }
    case "GET /health":
      return { status: "ok", db: "ok", ai_mode: "cache", storage: "local" } as T;
    case "GET /couriers/policies":
      return db.policies as T;
    case "GET /metrics/summary":
      return metricsSummary() as T;
    case "GET /audit-logs": {
      // Backend mendukung dua filter: `entity` (jenis) dan `entity_id` (daftar id, untuk log per kasus)
      const entity = q("entity");
      const ids = query.entity_id as string[] | undefined;
      const rows = db.auditLogs
        .filter((l) => !entity || l.entity === entity)
        .filter((l) => !ids || (l.entity_id !== null && ids.includes(l.entity_id)));
      return rows.slice(0, Number(q("limit") ?? 10)) as T;
    }
    case "GET /settings":
      return db.settings as T;
    case "PATCH /settings":
      Object.assign(db.settings, body);
      return db.settings as T;
  }
  throw new ApiError(404, "mock_not_found", `Mock belum tersedia: ${method} ${path}`);
}
