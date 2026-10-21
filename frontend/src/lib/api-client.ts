import { clearSession, getToken, redirectToLogin } from "@/lib/auth";
import type {
  AppSettings,
  AuditLog,
  BuyerRequest,
  ClaimDetail,
  ClaimStatus,
  ClaimSummary,
  CourierPolicy,
  InvestigationView,
  MetricsSummary,
  Paginated,
  ScanResult,
  Shipment,
  ShipmentDetail,
} from "@/types/api";

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const API_PREFIX = `${BASE_URL}/api/v1`;
// Mode mock: halaman dapat dibangun tanpa backend. Dimatikan endpoint demi endpoint
// saat backend nyata siap (SRS 15.5 Fase 3).
export const USE_MOCK = process.env.NEXT_PUBLIC_API_MOCK === "1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

function toQuery(params?: Query): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function authHeaders(json: boolean): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
  if (USE_MOCK) {
    const { mockRequest } = await import("@/lib/mock/handlers");
    return mockRequest<T>(method, path, opts);
  }
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}${toQuery(opts.query)}`, {
      method,
      headers: authHeaders(opts.body !== undefined),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, "network_error", "Tidak dapat terhubung ke server. Periksa koneksi.");
  }
  // Sesi habis/tidak valid: kembali ke login (kecuali saat memanggil login itu sendiri)
  if (res.status === 401 && path !== "/auth/login") {
    clearSession();
    redirectToLogin();
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = `Permintaan gagal (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) ({ code, message } = body.error);
    } catch {
      /* respons bukan JSON */
    }
    throw new ApiError(res.status, code, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export type DemoScenario = "lost" | "damaged" | "return_fraud" | "wrong_item_seller";

export interface ShipmentQuery extends Query {
  status?: string;
  courier?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export const api = {
  auth: {
    login: (password: string) => request<{ token: string; expires_in: number }>("POST", "/auth/login", { body: { password } }),
  },
  shipments: {
    list: (query: ShipmentQuery) => request<Paginated<Shipment>>("GET", "/shipments", { query }),
    get: (id: string) => request<ShipmentDetail>("GET", `/shipments/${id}`),
  },
  monitoring: {
    scan: () => request<ScanResult>("POST", "/monitoring/scan"),
  },
  investigations: {
    start: (shipment_id: string) =>
      request<{ investigation_id: string }>("POST", "/investigations", { body: { shipment_id } }),
    get: (id: string) => request<InvestigationView>("GET", `/investigations/${id}`),
    cancel: (id: string) => request<{ status: string }>("POST", `/investigations/${id}/cancel`),
    buyerRequest: (id: string) => request<BuyerRequest>("GET", `/investigations/${id}/buyer-request`),
    markBuyerRequestSent: (id: string, message: string) =>
      request<{ status: string }>("POST", `/investigations/${id}/buyer-request`, { body: { message } }),
    streamUrl: (id: string) => `${API_PREFIX}/investigations/${id}/stream`,
  },
  demo: {
    reset: () => request<{ shipments: number; media: number; missing_media: string[] }>("POST", "/demo/reset"),
    scenario: (name: DemoScenario) => request<{ investigation_id: string }>("POST", `/demo/scenario/${name}`),
  },
  health: () => request<{ status: string; db: string; ai_mode: string; storage: string }>("GET", "/health"),
  evidence: {
    media: (id: string) => request<{ evidence_id: string; kind: string; url: string; expires_in: number | null }>("GET", `/evidence/${id}/media`),
  },
  claims: {
    list: (query: { status?: ClaimStatus; shipment_id?: string; limit?: number; offset?: number }) =>
      request<Paginated<ClaimSummary>>("GET", "/claims", { query }),
    get: (id: string) => request<ClaimDetail>("GET", `/claims/${id}`),
    update: (id: string, narrative: string) => request<ClaimDetail>("PATCH", `/claims/${id}`, { body: { narrative } }),
    // review_sec: lama admin meninjau (H5), disimpan di log audit
    approve: (id: string, reviewSec?: number) => request<ClaimDetail>("POST", `/claims/${id}/approve`, { body: { review_sec: reviewSec } }),
    reject: (id: string, reason: string, reviewSec?: number) =>
      request<ClaimDetail>("POST", `/claims/${id}/reject`, { body: { reason, review_sec: reviewSec } }),
  },
  couriers: {
    policies: () => request<CourierPolicy[]>("GET", "/couriers/policies"),
  },
  metrics: {
    summary: () => request<MetricsSummary>("GET", "/metrics/summary"),
  },
  auditLogs: {
    list: (limit = 10) => request<AuditLog[]>("GET", "/audit-logs", { query: { limit } }),
    forEntities: (ids: string[]) => request<AuditLog[]>("GET", "/audit-logs", { query: { entity_id: ids, limit: 50 } }),
  },
  settings: {
    get: () => request<AppSettings>("GET", "/settings"),
    update: (patch: Partial<AppSettings>) => request<AppSettings>("PATCH", "/settings", { body: patch }),
  },
};
