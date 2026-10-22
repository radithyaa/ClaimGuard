// Mock detail & transisi klaim (HITL). Meniru claim_service backend: hanya status
// pending_approval yang boleh diubah; selain itu 409 invalid_status.
import { ApiError } from "@/lib/api-client";
import type { ClaimDetail, Evidence } from "@/types/api";

import * as db from "./data";
import { EVIDENCE } from "./investigation";

const details = new Map<string, ClaimDetail>();
const initialStatus = new Map(db.claims.map((c) => [c.id, c.status]));

const COURIER_NAME = { jne: "JNE", jnt: "J&T", sicepat: "SiCepat" } as const;

// Draf yang dibuat manual pada mock agar pagar kesimpulan resi bisa diuji dari UI.
const forgedDrafts = new Set<string>();

/** POST /demo/reset: kembalikan status & draf klaim ke kondisi awal. */
export function mockClaimsReset() {
  details.clear();
  forgedDrafts.clear();
  for (const c of db.claims) {
    c.status = initialStatus.get(c.id) ?? c.status;
    const s = db.shipments.find((x) => x.id === c.shipment_id);
    if (s) s.latest_claim = { id: c.id, status: c.status };
  }
}

/** Draf generik untuk klaim yang tidak punya seed khusus (klaim baru dari skenario live). */
function genericDraft(id: string): Pick<ClaimDetail, "narrative" | "draft" | "draft_issues" | "decision_reason"> {
  const c = db.claims.find((x) => x.id === id)!;
  const s = db.shipments.find((x) => x.id === c.shipment_id)!;
  const policy = db.policies.find((p) => p.courier === s.courier);
  const lost = c.case_type !== "damaged";
  const draft: ClaimDetail["draft"] = {
    title: `Klaim ${lost ? "paket hilang" : "barang rusak"} ${s.tracking_number}`,
    tracking_number: s.tracking_number,
    courier: s.courier,
    claim_type: lost ? "lost" : "damaged",
    chronology: s.tracking_events
      .map((e) => ({ at: e.occurred_at, event: `${e.status} · ${e.location}` }))
      .sort((a, b) => a.at.localeCompare(b.at)),
    attachments: ["evd-001"],
    requested_compensation: c.claim_value,
    policy_notes: [
      ...(policy ? [`Diajukan dalam batas ${policy.claim_window_days} hari`] : []),
      "Video packing tersedia",
      "Nilai barang tidak melebihi batas ganti rugi",
    ],
  };
  return {
    narrative:
      `Dengan hormat, kami mengajukan klaim ${lost ? "paket hilang" : "barang rusak"} untuk resi ${s.tracking_number}. ` +
      `Paket berisi ${s.item_name} senilai ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(c.claim_value)}, ` +
      `dikemas dan dipindai di meja packing, lalu diserahkan ke ${COURIER_NAME[s.courier]}. Rekaman packing dan riwayat resi terlampir.`,
    draft,
    draft_issues: [],
    decision_reason: lost
      ? "Rekaman packing menunjukkan barang dikemas dan label resi cocok; pelacakan berhenti setelah hub transit melewati batas SLA."
      : "Video unboxing menunjukkan kerusakan saat kardus dibuka; rekaman packing tidak menemukan benturan saat pengemasan.",
  };
}

/** Bukti klaim: klip CCTV packing yang sama dengan investigasi asal resi. */
function evidenceFor(shipmentId: string, investigationId: string, claimId: string): Evidence[] {
  const s = db.shipments.find((x) => x.id === shipmentId);
  if (!s?.latest_investigation || s.latest_investigation.outcome === "needs_evidence") return [];
  return [{ ...EVIDENCE, id: `evd-${claimId.slice(-3)}`, investigation_id: investigationId }];
}

function detail(id: string): ClaimDetail {
  const existing = details.get(id);
  if (existing) return existing;
  const c = db.claims.find((x) => x.id === id);
  if (!c) throw new ApiError(404, "not_found", "Klaim tidak ditemukan");
  const s = db.shipments.find((x) => x.id === c.shipment_id)!;
  const seed = db.claimSeeds[id];
  const picked = seed ?? genericDraft(id);
  const investigationId = `inv-mock-${s.id}`;
  const submitted = c.status === "submitted";
  const d: ClaimDetail = {
    ...c,
    investigation_id: investigationId,
    narrative: picked.narrative,
    draft: picked.draft,
    draft_issues: picked.draft_issues,
    decision_reason: picked.decision_reason,
    shipment_resolution: s.resolution,
    item_name: s.item_name,
    item_value: s.item_value,
    // Tanggal dasar: investigasi selesai, draf dibuat, lalu diputuskan admin
    updated_at: c.created_at,
    submitted_at: submitted ? new Date(new Date(c.created_at).getTime() + 3600e3).toISOString() : null,
    submitted_by: submitted ? (seed?.submitted_by ?? "admin") : null,
    submission_ref: submitted ? (seed?.submission_ref ?? `SIM-${c.courier.toUpperCase()}-${c.id.slice(-3)}001`) : null,
    reject_reason: c.status === "rejected" ? (seed?.reject_reason ?? "Bukti packing kurang jelas, perlu dicek manual") : null,
    evidence: evidenceFor(s.id, investigationId, id),
    courier_policy: db.policies.find((p) => p.courier === s.courier) ?? null,
  };
  details.set(id, d);
  return d;
}

function transition(id: string, patch: Partial<ClaimDetail>): ClaimDetail {
  const d: ClaimDetail = detail(id);
  if (d.status !== "pending_approval") throw new ApiError(409, "invalid_status", `Klaim sudah berstatus '${d.status}'`);
  Object.assign(d, patch, { updated_at: new Date().toISOString() });
  // Sinkronkan ringkasan agar antrian & KPI ikut berubah
  const summary = db.claims.find((c) => c.id === id);
  if (summary) summary.status = d.status;
  const s = db.shipments.find((x) => x.id === d.shipment_id);
  if (s?.latest_claim?.id === id) s.latest_claim = { id, status: d.status };
  if (s && patch.status === "rejected") {
    // Penolakan admin = putusan manusia: kesimpulan agen tidak lagi mengikat resi.
    forgedDrafts.delete(id);
    s.resolution = null;
    s.resolution_reason = null;
  }
  return { ...d };
}

/** POST /claims: draf buatan manusia untuk resi yang sudah diputuskan; dipakai uji pagar approve. */
export function mockClaimCreate(shipmentId: string): ClaimDetail {
  const s = db.shipments.find((x) => x.id === shipmentId);
  if (!s) throw new ApiError(404, "not_found", "Resi tidak ditemukan");
  const id = `clm-${s.id}`;
  if (!db.claims.some((c) => c.id === id)) {
    db.claims.unshift({
      id, shipment_id: s.id, tracking_number: s.tracking_number, courier: s.courier,
      status: "pending_approval", confidence: 0.8, claim_value: s.item_value,
      created_at: new Date().toISOString(), is_simulated: true, case_type: "lost", claim_deadline: null,
    });
  }
  forgedDrafts.add(id);
  details.delete(id);
  return { ...detail(id) };
}

export const mockClaimGet = (id: string) => ({ ...detail(id) });

export const mockClaimUpdate = (id: string, narrative: string) => {
  if (!narrative || narrative.trim().length < 20) throw new ApiError(422, "validation_error", "Narasi minimal 20 karakter");
  return transition(id, { narrative });
};

export const mockClaimApprove = (id: string) => {
  const d = detail(id);
  const s = db.shipments.find((x) => x.id === d.shipment_id);
  // Pagar yang sama dengan claim_service._ensure_no_other_party di backend.
  if (!forgedDrafts.has(id) && (s?.resolution === "seller" || s?.resolution === "buyer")) {
    const party = s.resolution === "seller" ? "penjual" : "pembeli";
    throw new ApiError(409, "resolution_blocks_claim",
      `Investigasi menyimpulkan kesalahan ada di pihak ${party}, bukan kurir. Tolak draf ini dan tangani langsung dengan pihak tersebut`);
  }
  return transition(id, {
    status: "submitted",
    submitted_at: new Date().toISOString(),
    submitted_by: "admin",
    submission_ref: `SIM-${d.courier.toUpperCase()}-${Date.now().toString().slice(-6)}`,
  });
};

export const mockClaimReject = (id: string, reason: string) => transition(id, { status: "rejected", reject_reason: reason });
