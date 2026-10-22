import { redirectToLogin } from "@/lib/auth";
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
  // Sesi memakai cookie httpOnly first-party; tidak ada header Authorization.
  return h;
}

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
  if (USE_MOCK) {
    const { mockRequest } = await import("@/lib/mock/handlers");
    return mockRequest<T>(method, path, opts);
  }
  // Penanda `web:` = path relatif terhadap origin WEB (route handler Next.js), bukan API.
  // Tanpa ini `/auth/login` menjadi `https://api.../api/v1/auth/login` sehingga cookie sesi
  // menempel di domain API dan guard server di domain web tidak pernah menerimanya.
  // Catatan: jangan memakai awalan `//` — browser membacanya sebagai URL protocol-relative
  // (`http://api/...`) dan gagal resolve.
  const isWebRoute = path.startsWith("web:");
  const url = isWebRoute
    ? `${path.slice(4)}${toQuery(opts.query)}`
    : `${API_PREFIX}${path}${toQuery(opts.query)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: authHeaders(opts.body !== undefined),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, "network_error", "Tidak dapat terhubung ke server. Periksa koneksi.");
  }
  // Sesi habis/tidak valid: kembali ke login (kecuali login/logout itu sendiri, dan
  // `/auth/session` yang memang 401 saat belum masuk).
  const isAuthPath = path === "/auth/session" || path.startsWith("web:");
  if (res.status === 401 && !isAuthPath) {
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

export type SessionStatus = { authenticated: boolean; user: string | null; auth_required: boolean };

export const api = {
  auth: {
    /**
     * Login lewat route handler Next.js (`/api/auth/login`), BUKAN langsung ke backend.
     * Route itu menyimpan cookie sesi di domain web sehingga guard server bisa membacanya.
     * Memanggil backend langsung membuat cookie menempel di domain API dan guard selalu
     * melihat "belum login" -> pengguna terpental balik ke halaman login.
     */
    login: (password: string) =>
      request<{ ok: boolean; expires_in: number }>("POST", "web:/api/auth/login", { body: { password } }),
    /** Status sesi dari cookie httpOnly; token tidak ikut dikirim balik. */
    session: () => request<SessionStatus>("GET", "/auth/session"),
    logout: () => request<void>("POST", "web:/api/auth/logout"),
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
    // Lewat proxy Next.js agar cookie sesi first-party ikut terkirim (EventSource tak bisa
    // mengirim header; cookie domain API tidak terbaca dari domain web).
    streamUrl: (id: string) => `/api/stream/${id}`,
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
