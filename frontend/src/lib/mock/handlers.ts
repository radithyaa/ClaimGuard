// Router mock in-memory untuk NEXT_PUBLIC_API_MOCK=1. Meniru kontrak SRS bagian 6.
import { ApiError } from "@/lib/api-client";
import type { MetricsSummary, Shipment, ShipmentDetail } from "@/types/api";
import * as db from "./data";
import { mockClaimApprove, mockClaimGet, mockClaimReject, mockClaimsReset, mockClaimUpdate } from "./claims";
import { mockCancel, mockRunsReset, mockStart, mockView } from "./investigation";

// Skenario demo -> resi mock (backend: field "scenario" di shipments.json)
const SCENARIO_SHIPMENT: Record<string, string> = { lost: "shp-001", damaged: "shp-002", return_fraud: "shp-003" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toSummary({ tracking_events, anomaly, buyer_report, latest_investigation, latest_claim, ...s }: ShipmentDetail): Shipment {
  void tracking_events; void anomaly; void buyer_report; void latest_investigation; void latest_claim;
  return s;
}

type Opts = { query?: Record<string, unknown>; body?: unknown };

export async function mockRequest<T>(method: string, path: string, { query = {}, body }: Opts): Promise<T> {
  await sleep(250 + Math.random() * 250);
  const q = (k: string) => (query[k] === undefined || query[k] === "" ? undefined : String(query[k]));
  // "/shipments/shp-001" -> "/shipments/:id"; rute lain dibiarkan apa adanya
  const route = `${method} ${path
    .replace(/^\/shipments\/[\w-]+$/, "/shipments/:id")
    .replace(/^\/investigations\/[\w-]+(\/cancel)?$/, "/investigations/:id$1")
    .replace(/^\/claims\/[\w-]+(\/approve|\/reject)?$/, "/claims/:id$1")
    .replace(/^\/demo\/scenario\/[\w-]+$/, "/demo/scenario/:id")}`;
  const id = path.replace(/\/(cancel|approve|reject)$/, "").split("/").pop()!;

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
          (!term || s.tracking_number.toLowerCase().includes(term) || s.destination.toLowerCase().includes(term)),
      );
      const limit = Number(q("limit") ?? 20);
      const offset = Number(q("offset") ?? 0);
      return { items: rows.slice(offset, offset + limit).map(toSummary), total: rows.length, limit, offset } as T;
    }
    case "GET /shipments/:id": {
      const s = db.shipments.find((x) => x.id === id);
      if (!s) throw new ApiError(404, "not_found", "Resi tidak ditemukan");
      return { ...s, latest_claim: db.claims.find((c) => c.shipment_id === s.id) ?? null } as T;
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
    case "POST /investigations/:id/cancel":
      mockCancel(id);
      return { status: "cancelling" } as T;
    case "GET /claims": {
      const rows = db.claims.filter((c) => !q("status") || c.status === q("status"));
      return { items: rows, total: rows.length, limit: 20, offset: 0 } as T;
    }
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
      return { shipments: db.shipments.length, media: 3, missing_media: [] } as T;
    case "POST /demo/scenario/:id": {
      const sid = SCENARIO_SHIPMENT[id];
      if (!sid) throw new ApiError(422, "validation_error", "Skenario tidak dikenal");
      mockStart(`inv-mock-${sid}`);
      return { investigation_id: `inv-mock-${sid}` } as T;
    }
    case "GET /health":
      return { status: "ok", db: "ok", ai_mode: "cache", storage: "local" } as T;
    case "GET /couriers/policies":
      return db.policies as T;
    case "GET /metrics/summary": {
      const summary: MetricsSummary = {
        active_anomalies: db.shipments.filter((s) => s.active_anomaly).length,
        pending_claims: db.claims.filter((c) => c.status === "pending_approval").length,
        submitted_claims: db.claims.filter((c) => c.status === "submitted").length,
        estimated_value_saved: db.claims.filter((c) => c.status === "pending_approval").reduce((n, c) => n + c.claim_value, 0),
        avg_processing_sec: 24.6,
        trend: ["15", "16", "17", "18", "19", "20", "21"].map((day, i) => ({
          date: `2026-10-${day}`,
          anomalies: [1, 0, 2, 1, 3, 1, 3][i],
          claims: [0, 0, 1, 1, 1, 0, 1][i],
        })),
        is_simulated: true,
      };
      return summary as T;
    }
    case "GET /audit-logs":
      return db.auditLogs.slice(0, Number(q("limit") ?? 10)) as T;
    case "GET /settings":
      return db.settings as T;
    case "PATCH /settings":
      Object.assign(db.settings, body);
      return db.settings as T;
  }
  throw new ApiError(404, "mock_not_found", `Mock belum tersedia: ${method} ${path}`);
}
