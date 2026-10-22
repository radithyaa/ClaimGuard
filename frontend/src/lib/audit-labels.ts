// Label log audit untuk pemilik toko (Ringkasan dan Review klaim)
export const ACTOR_LABEL: Record<string, string> = {
  "agent:monitor": "Monitoring Agent",
  "agent:investigator": "Investigation Agent",
  "agent:vision": "Investigation Agent",
  "agent:evaluator": "Investigation Agent",
  "agent:drafter": "Action Agent",
  system: "Sistem",
  user: "Admin",
};

export const ACTION_LABEL: Record<string, string> = {
  anomaly_flagged: "menandai anomali",
  investigation_started: "memulai investigasi",
  decision_made: "memutuskan hasil investigasi",
  claim_drafted: "menyusun draf klaim",
  claim_edited: "mengubah narasi draf",
  claim_approved: "menyetujui dan mengirim klaim",
  claim_submitted: "mengirim klaim",
  claim_rejected: "menolak draf klaim",
  buyer_evidence_requested: "meminta bukti ke pembeli",
  settings_updated: "mengubah pengaturan",
};

export const actorLabel = (actor: string) => ACTOR_LABEL[actor] ?? (actor.startsWith("agent:") ? actor : "Admin");
export const actionLabel = (action: string) => ACTION_LABEL[action] ?? action.replaceAll("_", " ");
