import { COURIER_LABEL } from "@/lib/format";
import type { InvestigationEvent } from "@/types/api";

export const AGENT_LABEL: Record<string, string> = {
  investigator: "Investigation Agent",
  evaluator: "Evaluator",
  drafter: "Action Agent",
  vision: "Vision Agent",
};

export function toolLabel(tool: string, courier: string) {
  if (tool.startsWith("clip_cctv")) return "Memotong klip CCTV";
  if (tool.startsWith("analyze_media")) return "Analisis visual rekaman";
  if (tool === "get_courier_policy") return `Membaca aturan ${COURIER_LABEL[courier] ?? courier}`;
  if (tool === "get_case_context") return "Membaca konteks kasus";
  return tool;
}

export type StepState = "done" | "active" | "pending" | "failed";

export interface ToolRun {
  tool: string;
  state: StepState;
  durationMs: number | null;
  source: string | null;
}

export interface Step {
  key: string;
  title: string;
  detail: string;
  state: StepState;
  tools?: ToolRun[];
}

/** Menurunkan langkah agen (FR-11) dari urutan event SSE. */
export function deriveSteps(events: InvestigationEvent[], courier: string): Step[] {
  const tools = new Map<string, ToolRun>();
  for (const e of events) {
    const tool = e.payload.tool as string | undefined;
    if (!tool) continue;
    if (e.type === "tool_start") tools.set(tool, { tool, state: "active", durationMs: null, source: null });
    if (e.type === "tool_end")
      tools.set(tool, {
        tool,
        state: e.payload.status === "error" ? "failed" : "done",
        durationMs: (e.payload.duration_ms as number) ?? null,
        source: e.source,
      });
  }
  const decision = events.find((e) => e.type === "decision");
  const done = events.find((e) => e.type === "done");
  const drafting = events.some((e) => e.agent === "drafter");
  const terminal = events.find((e) => e.type === "error" || e.type === "cancelled");
  const toolList = [...tools.values()];
  const claimId = done?.payload.claim_id as string | undefined;

  const steps: Step[] = [
    { key: "scan", title: "Memindai resi", detail: "Monitoring Agent menandai anomali", state: "done" },
    {
      key: "investigate",
      title: "Investigasi",
      detail: toolList.length ? `${toolList.filter((t) => t.state === "done").length} dari ${toolList.length} alat selesai` : "Menyiapkan alat",
      state: decision ? "done" : toolList.length ? "active" : "pending",
      tools: toolList.map((t) => ({ ...t, tool: toolLabel(t.tool, courier) })),
    },
    {
      key: "evaluate",
      title: "Menilai kekuatan bukti",
      detail: decision ? `Keyakinan ${Math.round(((decision.payload.confidence as number) ?? 0) * 100)}%` : "Menunggu hasil analisis",
      state: decision ? "done" : "pending",
    },
    {
      key: "draft",
      title: "Menyusun draf klaim",
      detail: claimId ? `Action Agent · draf ${claimId.toUpperCase()}` : done ? "Tidak ada draf (lihat keputusan)" : "Estimasi pemulihan dana",
      state: done ? "done" : drafting ? "active" : "pending",
    },
    {
      key: "approve",
      title: "Menunggu persetujuan Anda",
      detail: "Tinjau keputusan akhir",
      state: claimId ? "active" : "pending",
    },
  ];

  // Tanpa event apa pun langkah pertama yang belum selesai dianggap berjalan
  if (!terminal && !done && !steps.some((s) => s.state === "active")) {
    const next = steps.find((s) => s.state === "pending");
    if (next) next.state = "active";
  }
  if (terminal) {
    const current = steps.find((s) => s.state === "active") ?? steps.find((s) => s.state === "pending");
    if (current) current.state = "failed";
  }
  return steps;
}

/** Kalimat jejak agen untuk satu event; null = tidak ditampilkan. */
export function traceLine(e: InvestigationEvent, courier: string): { who: string; text: string } | null {
  const who = e.agent ? (AGENT_LABEL[e.agent] ?? e.agent) : "Sistem";
  const p = e.payload;
  switch (e.type) {
    case "status":
      return { who: "Orkestrator", text: "Investigasi dimulai." };
    case "tool_start":
      return { who, text: `${toolLabel(p.tool as string, courier)}…` };
    case "tool_end": {
      const dur = p.duration_ms ? ` (${((p.duration_ms as number) / 1000).toFixed(1)} dtk)` : "";
      const src = e.source === "cache" ? " · dari cache" : "";
      return { who: p.tool as string, text: `${p.status === "error" ? "Gagal" : "Selesai"}${dur}${src}.` };
    }
    case "thought":
      return { who, text: p.text as string };
    case "decision":
      return { who: "Evaluator", text: `${p.verdict as string}. ${p.reason as string}` };
    case "done":
      return { who: "Orkestrator", text: p.claim_id ? `Draf klaim ${(p.claim_id as string).toUpperCase()} siap. Menunggu persetujuan admin.` : "Investigasi selesai." };
    case "error":
      return { who: "Sistem", text: (p.message as string) ?? "Terjadi kesalahan." };
    case "cancelled":
      return { who: "Sistem", text: (p.message as string) ?? "Investigasi dihentikan." };
  }
}
