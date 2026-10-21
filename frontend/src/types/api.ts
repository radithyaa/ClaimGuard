// Tipe kontrak API (SRS v2.3 bagian 6 & 8). Ditulis manual sampai Backend B
// mempublikasikan openapi.json; setelah itu diganti hasil `openapi-typescript`.

export type ISODate = string; // UTC ISO 8601

export type ShipmentStatus =
  | "created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "returned";

export type Courier = "jne" | "jnt" | "sicepat";
export type CaseType = "lost" | "damaged" | "return_fraud";
export type Severity = "low" | "medium" | "high";
export type AnalysisSource = "live" | "cache";

export interface Anomaly {
  id: string;
  shipment_id: string;
  code: string;
  case_type: CaseType;
  severity: Severity;
  reason_json: Record<string, unknown> & { summary?: string };
  detected_at: ISODate;
  status: "open" | "investigating" | "resolved";
}

export interface Shipment {
  id: string;
  tracking_number: string;
  courier: Courier;
  status: ShipmentStatus;
  origin: string;
  destination: string;
  shipped_at: ISODate;
  sla_deadline: ISODate;
  item_name: string;
  item_value: number;
  is_simulated: boolean;
  active_anomaly: Pick<Anomaly, "id" | "code" | "case_type" | "severity"> | null;
  /** Tenggat pengajuan klaim (acuan + claim_window_days kurir); null bila kebijakan belum ada. */
  claim_deadline: ISODate | null;
}

export interface TrackingEvent {
  id: string;
  status: string;
  location: string;
  occurred_at: ISODate;
}

export type InvestigationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type Outcome = "claim_drafted" | "needs_evidence" | "fraud_suspect";
export type ClaimStatus = "pending_approval" | "submitted" | "rejected";

export interface InvestigationSummary {
  id: string;
  status: InvestigationStatus;
  outcome: Outcome | null;
  started_at: ISODate;
}

export interface ClaimSummary {
  id: string;
  shipment_id: string;
  tracking_number: string;
  courier: Courier;
  status: ClaimStatus;
  confidence: number | null;
  claim_value: number;
  created_at: ISODate;
  is_simulated: boolean;
  case_type: CaseType | null;
  claim_deadline: ISODate | null;
}

export interface ShipmentDetail extends Shipment {
  buyer_report: string | null;
  tracking_events: TrackingEvent[];
  anomaly: Anomaly | null;
  latest_investigation: InvestigationSummary | null;
  latest_claim: Pick<ClaimSummary, "id" | "status"> | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface CourierPolicy {
  courier: Courier;
  claim_window_days: number;
  required_docs: string[];
  max_compensation: string;
  extra: Record<string, unknown>;
  source: "live" | "cache" | "manual";
  extracted_at: ISODate;
}

export interface MetricsSummary {
  active_anomalies: number;
  pending_claims: number;
  submitted_claims: number;
  estimated_value_saved: number;
  avg_processing_sec: number | null;
  trend: { date: string; anomalies: number; claims: number }[];
  is_simulated: boolean;
}

export interface AuditLog {
  id: string;
  actor: string; // agent:<nama> | user | system
  action: string;
  entity: string;
  entity_id: string | null;
  payload_json: Record<string, unknown>;
  created_at: ISODate;
}

export interface AppSettings {
  scan_interval_min: number;
  sla_grace_hours: number;
  min_confidence: number;
  ai_mode: "live" | "auto" | "cache";
  scheduler_enabled: boolean;
}

export interface ScanResult {
  new_anomalies: Anomaly[];
  scanned: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---------- Investigasi live (SRS 3.6, FR-11) ----------

export type InvestigationEventType =
  | "status"
  | "tool_start"
  | "tool_end"
  | "thought"
  | "decision"
  | "done"
  | "error"
  | "cancelled";

/** Payload SSE `/investigations/{id}/stream`; `seq` juga dikirim sebagai `id:` (Last-Event-ID). */
export interface InvestigationEvent {
  seq: number;
  investigation_id: string;
  type: InvestigationEventType;
  agent: string | null;
  ts: ISODate;
  payload: Record<string, unknown>;
  source: AnalysisSource | null;
}

export interface VisionAnalysis {
  verdict: string;
  confidence: number;
  findings: { description: string; severity: "info" | "warning" | "critical" }[];
  timestamp_evidence: { t_sec: number; label: string }[];
}

export interface Evidence {
  id: string;
  investigation_id: string;
  kind: "cctv_clip" | "unboxing" | "photo";
  clip_start_sec: number | null;
  clip_duration_sec: number | null;
  analysis_json: (Partial<VisionAnalysis> & Record<string, unknown>) | null;
  analysis_source: AnalysisSource | null;
  created_at: ISODate;
}

export interface InvestigationView {
  id: string;
  shipment_id: string;
  anomaly_id: string | null;
  case_type: CaseType;
  status: InvestigationStatus;
  outcome: Outcome | null;
  verdict: string | null;
  confidence: number | null;
  decision_reason: string | null;
  error: string | null;
  started_at: ISODate;
  finished_at: ISODate | null;
  duration_ms: number | null;
  evidence: Evidence[];
  claim_id: string | null;
  tracking_number: string;
  courier: Courier;
  anomaly_reason: (Record<string, unknown> & { summary?: string }) | null;
  courier_policy: CourierPolicy | null;
  is_active: boolean;
}

// ---------- Review klaim & HITL (FR-06, FR-07) ----------

export interface ClaimDraft {
  title?: string;
  tracking_number?: string;
  courier?: string;
  claim_type?: "lost" | "damaged";
  narrative?: string;
  chronology?: { at: ISODate; event: string }[];
  attachments?: string[];
  requested_compensation?: number;
  policy_notes?: string[];
}

export interface ClaimDetail extends ClaimSummary {
  investigation_id: string;
  narrative: string;
  draft: ClaimDraft & Record<string, unknown>;
  draft_issues: string[];
  decision_reason: string | null;
  item_name: string;
  item_value: number;
  updated_at: ISODate;
  submitted_at: ISODate | null;
  submitted_by: string | null;
  submission_ref: string | null;
  reject_reason: string | null;
  evidence: Evidence[];
  courier_policy: CourierPolicy | null;
}
