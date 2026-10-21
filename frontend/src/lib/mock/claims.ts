// Mock detail & transisi klaim (HITL). Meniru claim_service backend: hanya status
// pending_approval yang boleh diubah; selain itu 409 invalid_status.
import { ApiError } from "@/lib/api-client";
import type { ClaimDetail } from "@/types/api";

import * as db from "./data";
import { EVIDENCE } from "./investigation";

const NARRATIVE =
  "Dengan hormat, kami mengajukan klaim paket hilang untuk resi JNE0012345678. Paket berisi 1 pasang Sepatu kulit pria senilai Rp450.000, " +
  "dikemas dan dipindai di meja packing pada 15 Okt 2026 pukul 09.10 WIB, lalu diserahkan ke kurir pukul 11.00 WIB. Sejak 16 Okt 2026 status paket " +
  "tidak bergerak di hub transit Semarang melewati batas SLA. Rekaman packing dan riwayat resi terlampir.";

const details = new Map<string, ClaimDetail>();
const initialStatus = new Map(db.claims.map((c) => [c.id, c.status]));

/** POST /demo/reset: kembalikan status & draf klaim ke kondisi awal. */
export function mockClaimsReset() {
  details.clear();
  for (const c of db.claims) c.status = initialStatus.get(c.id) ?? c.status;
}

function detail(id: string): ClaimDetail {
  const existing = details.get(id);
  if (existing) return existing;
  const c = db.claims.find((x) => x.id === id);
  if (!c) throw new ApiError(404, "not_found", "Klaim tidak ditemukan");
  const s = db.shipments.find((x) => x.id === c.shipment_id)!;
  const d: ClaimDetail = {
    ...c,
    investigation_id: `inv-mock-${s.id}`,
    narrative: NARRATIVE,
    draft: {
      title: `Klaim paket hilang ${s.tracking_number}`,
      tracking_number: s.tracking_number,
      courier: s.courier,
      claim_type: "lost",
      chronology: s.tracking_events
        .map((e) => ({ at: e.occurred_at, event: `${e.status} · ${e.location}` }))
        .sort((a, b) => a.at.localeCompare(b.at)),
      attachments: ["evd-001"],
      requested_compensation: c.claim_value,
      policy_notes: ["Diajukan dalam batas 14 hari", "Video packing tersedia", "Nilai barang tidak melebihi batas ganti rugi"],
    },
    draft_issues: [],
    decision_reason: "Rekaman packing menunjukkan barang dikemas dan label resi cocok; pelacakan berhenti di hub transit lebih dari batas SLA.",
    item_name: s.item_name,
    item_value: s.item_value,
    updated_at: c.created_at,
    // Klaim seed yang sudah diputuskan diberi jejak pengiriman/penolakan yang masuk akal
    submitted_at: c.status === "submitted" ? new Date(new Date(c.created_at).getTime() + 3600e3).toISOString() : null,
    submitted_by: c.status === "submitted" ? "admin" : null,
    submission_ref: c.status === "submitted" ? `SIM-${c.courier.toUpperCase()}-${c.id.slice(-3)}001` : null,
    reject_reason: c.status === "rejected" ? "Bukti packing kurang jelas, perlu dicek manual" : null,
    evidence: [{ ...EVIDENCE, investigation_id: `inv-mock-${s.id}` }],
    courier_policy: db.policies.find((p) => p.courier === s.courier) ?? null,
  };
  details.set(id, d);
  return d;
}

function transition(id: string, patch: Partial<ClaimDetail>): ClaimDetail {
  const d = detail(id);
  if (d.status !== "pending_approval") throw new ApiError(409, "invalid_status", `Klaim sudah berstatus '${d.status}'`);
  Object.assign(d, patch, { updated_at: new Date().toISOString() });
  // Sinkronkan ringkasan agar antrian & KPI ikut berubah
  const summary = db.claims.find((c) => c.id === id);
  if (summary) summary.status = d.status;
  return { ...d };
}

export const mockClaimGet = (id: string) => ({ ...detail(id) });

export const mockClaimUpdate = (id: string, narrative: string) => {
  if (!narrative || narrative.trim().length < 20) throw new ApiError(422, "validation_error", "Narasi minimal 20 karakter");
  return transition(id, { narrative });
};

export const mockClaimApprove = (id: string) =>
  transition(id, {
    status: "submitted",
    submitted_at: new Date().toISOString(),
    submitted_by: "admin",
    submission_ref: `SIM-${detail(id).courier.toUpperCase()}-${Date.now().toString().slice(-6)}`,
  });

export const mockClaimReject = (id: string, reason: string) => transition(id, { status: "rejected", reject_reason: reason });
