import { redirectToLogin } from "@/lib/auth";

export type RuntimeSettings = {
  scan_interval_min: number;
  sla_grace_hours: number;
  min_confidence: number;
  medium_confidence: number;
  ai_mode: "live" | "auto" | "cache";
  scheduler_enabled: boolean;
  video_retention_days: number;
  mask_pii: boolean;
  deadline_reminder_hours: number[];
  shopee_connected: boolean;
  tiktok_shop_connected: boolean;
  courier_thresholds: CourierThreshold[];
};

export type CourierThreshold = {
  courier: string;
  display_name: string;
  hold_days: number;
  sla_note: string;
  tag: string | null;
};

/** Nilai awal = default `config.py` backend, dipakai sebelum GET selesai. */
export const DEFAULT_SETTINGS: RuntimeSettings = {
  scan_interval_min: 5,
  sla_grace_hours: 0,
  min_confidence: 0.6,
  medium_confidence: 0.4,
  ai_mode: "auto",
  scheduler_enabled: false,
  video_retention_days: 30,
  mask_pii: true,
  deadline_reminder_hours: [72, 24, 6],
  shopee_connected: false,
  tiktok_shop_connected: false,
  courier_thresholds: [],
};

/** PATCH hanya mengirim field yang berubah (schema `RuntimeSettingsPatch`). */
export type SettingsPatch = Partial<Omit<RuntimeSettings, "courier_thresholds">>;

export type AiMode = RuntimeSettings["ai_mode"];

/** Input `PUT /settings/courier-thresholds` (seluruh daftar diganti sekaligus). */
export type CourierThresholdPatch = Omit<CourierThreshold, "tag"> & { tag?: string | null };

export type AuditLog = {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  payload_json: Record<string, unknown>;
  created_at: string;
};

export type Marketplace = {
  id: "shopee" | "tiktok_shop";
  name: string;
  kind: "marketplace";
  connected: boolean;
  available: boolean;
  detail: string;
};

export type CameraDrift = {
  camera: string;
  label: string;
  source: string;
  drift_sec: number;
  calibrated_at: string;
  status: "ok" | "perlu_kalibrasi";
};

export type Connections = {
  marketplaces: Marketplace[];
  cameras: CameraDrift[];
};

export type CsvImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  errors: { line: number; message: string }[];
  filename: string;
};

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type ApiErrorBody = { error?: { code: string; message: string } };

/** Pesan cadangan bila body error kosong/bukan JSON (mis. 502 dari proxy). */
function errorMessage(status: number, body: ApiErrorBody | null): string {
  if (status === 502) return "Layanan AI tidak tersedia dan tidak ada hasil cadangan.";
  if (status === 409) return "Status data sudah berubah. Muat ulang halaman.";
  if (status === 401) return "Sesi berakhir. Silakan masuk kembali.";
  return body?.error?.code
    ? `Permintaan gagal (${body.error.code}).`
    : `Permintaan gagal (HTTP ${status}).`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Sesi memakai cookie httpOnly first-party dari route handler Next.js.
  const headers = new Headers(init?.headers);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1${path}`, {
      credentials: "include",
      ...init,
      headers,
    });
  } catch {
    throw new ApiError(0, "network_error", "Tidak dapat terhubung ke server.");
  }
  if (res.status === 401 && path !== "/auth/login") {
    redirectToLogin();
  }
  if (!res.ok) {
    const body: ApiErrorBody | null = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      body?.error?.code ?? `http_${res.status}`,
      body?.error?.message ?? errorMessage(res.status, body),
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** GET bersifat publik di backend; PATCH butuh sesi login (cookie/Bearer). */
export const fetchSettings = () => request<RuntimeSettings>("/settings", { cache: "no-store" });

export const patchSettings = (patch: SettingsPatch) =>
  request<RuntimeSettings>("/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

export const putCourierThresholds = (items: CourierThresholdPatch[]) =>
  request<CourierThreshold[]>("/settings/courier-thresholds", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items),
  });

export const fetchConnections = () => request<Connections>("/connections", { cache: "no-store" });

export const setMarketplaceConnection = (id: string, connected: boolean) =>
  request<{ id: string; connected: boolean; detail: string }>(`/connections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connected }),
  });

export const importShipmentsCsv = (file: File) => {
  const body = new FormData();
  body.append("file", file);
  return request<CsvImportResult>("/shipments/import", { method: "POST", body });
};

/** Templat CSV berasal dari backend agar formatnya selalu selaras dengan parser. */
export const csvTemplateUrl = () => `${API_BASE_URL}/api/v1/shipments/import/template`;

export const deleteInvestigation = (id: string) =>
  request<{ id: string; deleted_evidence: number; deleted_events: number }>(
    `/investigations/${id}`,
    { method: "DELETE" },
  );

export const purgeInvestigations = (olderThanDays: number) =>
  request<{ deleted: number; media_deleted: number; skipped_active: string[] }>(
    `/investigations/purge?older_than_days=${olderThanDays}`,
    { method: "POST" },
  );

export const fetchAuditLogs = (params: { limit?: number; entity?: string } = {}) => {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 100));
  if (params.entity) query.set("entity", params.entity);
  return request<AuditLog[]>(`/audit-logs?${query}`, { cache: "no-store" });
};

/** Password tunggal mode demo (FR-19); backend menyimpan token di cookie httpOnly. */
export const login = (password: string) =>
  request<{ token: string; expires_in: number }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
