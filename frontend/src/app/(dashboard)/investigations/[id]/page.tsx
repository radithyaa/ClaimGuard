"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, FileText, Loader2, ShieldCheck, Square, WifiOff, Zap } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AgentSteps } from "@/components/investigation/agent-steps";
import { BuyerRequestDialog } from "@/components/investigation/buyer-request-dialog";
import { deriveSteps, traceLine } from "@/components/investigation/derive";
import { EvidencePanel } from "@/components/investigation/evidence-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfidenceLabel } from "@/components/ui/confidence";
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { COURIER_LABEL } from "@/lib/format";
import { useInvestigationStream } from "@/lib/sse";
import { cn } from "@/lib/utils";
import type { CaseType, InvestigationEvent, InvestigationView } from "@/types/api";

const TITLE: Record<CaseType, string> = {
  lost: "Investigasi paket hilang",
  damaged: "Investigasi paket rusak",
  return_fraud: "Investigasi retur mencurigakan",
};
const TARGET_SEC = 30;
const time = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" });
// Event yang mengubah data ringkasan (bukti, keputusan, status) -> ambil ulang GET /investigations/{id}
const REFRESH_ON = new Set(["tool_end", "decision", "done", "error", "cancelled"]);

function useElapsed(startIso: string | undefined, endIso: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endIso]);
  if (!startIso) return 0;
  return Math.max(0, Math.round(((endIso ? new Date(endIso).getTime() : now) - new Date(startIso).getTime()) / 1000));
}

export default function InvestigationPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ["investigation", id], queryFn: () => api.investigations.get(id) });
  const { events, state } = useInvestigationStream(id);

  const last = events.at(-1);
  useEffect(() => {
    if (last && REFRESH_ON.has(last.type)) qc.invalidateQueries({ queryKey: ["investigation", id] });
  }, [last, id, qc]);

  const cancel = useMutation({
    mutationFn: () => api.investigations.cancel(id),
    onSuccess: () => toast.info("Menghentikan agen…"),
    onError: (e) => toast.error("Gagal menghentikan agen", { description: e.message }),
  });

  const v = view.data;
  const courier = v ? (COURIER_LABEL[v.courier] ?? v.courier) : "";
  const steps = useMemo(() => deriveSteps(events, v?.courier ?? ""), [events, v?.courier]);
  const terminal = events.find((e) => e.type === "done" || e.type === "error" || e.type === "cancelled");
  const elapsed = useElapsed(v?.started_at, terminal?.ts ?? v?.finished_at);

  if (view.isError) return <section className="rounded-xl border bg-card"><ErrorState message={view.error.message} onRetry={() => view.refetch()} /></section>;
  if (!v)
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton className="h-16 w-96" />
        <Skeleton className="h-2" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );

  const active = !terminal && v.is_active;
  const doneCount = steps.filter((s) => s.state === "done").length;
  const claimId = (terminal?.payload.claim_id as string | undefined) ?? v.claim_id;
  const analyzing = steps[1].state === "active";

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="-mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/shipments" className="hover:text-foreground">Resi</Link>/
        <Link href={`/shipments/${v.shipment_id}`} className="font-mono hover:text-foreground">{v.tracking_number}</Link>/
        <span className="text-primary">Investigasi</span>
      </nav>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[28px] leading-9 font-semibold">{TITLE[v.case_type]}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <StatusPill events={events} active={active} claimId={claimId} />
            <span className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[13px] text-muted-foreground">
              <Zap className="size-3.5" aria-hidden /> {events.some((e) => e.source === "cache") ? "Live + cache" : "Live"}
            </span>
            <SimulatedBadge />
            <span className="text-muted-foreground">
              Dimulai {time.format(new Date(v.started_at))} · {active ? "berjalan" : "selesai dalam"} {elapsed} dtk · target di bawah {TARGET_SEC} dtk
            </span>
          </div>
        </div>
        {active ? (
          <StopButton onConfirm={() => cancel.mutate()} pending={cancel.isPending} />
        ) : claimId ? (
          <Button asChild size="lg">
            <Link href={`/claims/${claimId}`}>Tinjau draf klaim <ArrowRight /></Link>
          </Button>
        ) : null}
      </header>

      {state === "reconnecting" && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-4 py-2 text-sm">
          <WifiOff className="size-4" aria-hidden /> Koneksi ke agen terputus. Menyambung ulang dan memutar ulang event yang terlewat…
        </p>
      )}

      <div>
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-muted-foreground">
            Progres agen · langkah {Math.min(doneCount + (active ? 1 : 0), steps.length)} dari {steps.length}
          </span>
          <span className="font-mono font-medium">{doneCount}/{steps.length}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="flex flex-col gap-6">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-center justify-between border-b pb-3">
              <h2 className="text-xl font-semibold">Langkah agen</h2>
              <span className="text-sm text-muted-foreground">{doneCount} selesai</span>
            </div>
            <AgentSteps steps={steps} />
          </section>
          <AgentTrace events={events} courier={v.courier} live={state !== "closed"} />
        </div>

        <div className="flex flex-col gap-6">
          <EvidencePanel evidence={v.evidence} analyzing={analyzing} />
          <DecisionCard v={v} events={events} claimId={claimId} />
          <PolicyCard v={v} courier={courier} />
        </div>
      </div>

      <p className="flex items-center justify-center gap-2 border-t pt-5 text-center text-sm text-muted-foreground">
        <ShieldCheck className="size-4" aria-hidden /> Agen tidak mengirim apa pun ke kurir. Draf akan menunggu persetujuan Anda.
      </p>
    </div>
  );
}

function StatusPill({ events, active, claimId }: { events: InvestigationEvent[]; active: boolean; claimId: string | null }) {
  const last = events.at(-1);
  const outcome = events.find((e) => e.type === "done")?.payload.outcome;
  const [label, cls] =
    last?.type === "error" ? ["Gagal", "bg-destructive/10 text-destructive border-destructive/30"]
    : last?.type === "cancelled" ? ["Dihentikan", "bg-muted text-muted-foreground"]
    : claimId ? ["Siap ditinjau", "bg-primary text-primary-foreground border-primary"]
    : outcome === "seller_error" ? ["Kesalahan di pihak penjual", "bg-warning/15 border-warning/50"]
    : outcome === "needs_evidence" ? ["Butuh bukti tambahan", "bg-warning/15 border-warning/50"]
    : outcome === "fraud_suspect" ? ["Ketidaksesuaian terdeteksi", "bg-warning/15 border-warning/50"]
    : last?.type === "done" ? ["Selesai", "bg-success/10 text-success border-success/30"]
    : active ? ["Mengumpulkan bukti", "bg-accent text-primary border-primary/30"]
    : ["Menghubungkan", "bg-muted text-muted-foreground"];
  return (
    <span className={cn("flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-[13px] font-medium", cls)}>
      {active && !claimId && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {label}
    </span>
  );
}

function StopButton({ onConfirm, pending }: { onConfirm: () => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={pending}>
        <Square className="size-3.5" aria-hidden /> {pending ? "Menghentikan…" : "Hentikan agen"}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hentikan agen?</DialogTitle>
          <DialogDescription>
            Investigasi yang sedang berjalan akan dibatalkan dan tidak ada draf klaim yang dibuat. Bukti yang sudah terkumpul tetap tersimpan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Lanjutkan investigasi</Button></DialogClose>
          <Button variant="destructive" onClick={() => { onConfirm(); setOpen(false); }}>Hentikan agen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentTrace({ events, courier, live }: { events: InvestigationEvent[]; courier: string; live: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const lines = events.map((e) => ({ e, line: traceLine(e, courier) })).filter((x) => x.line);
  // Gulir daftar saja, bukan seluruh halaman
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lines.length]);
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between border-b pb-3">
        <h2 className="text-xl font-semibold">Jejak agen</h2>
        <span className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-accent px-2.5 py-0.5 text-[13px] text-primary">
          <span className="size-1.5 rounded-full bg-primary" /> {live ? "Mengikuti terbaru" : `Selesai (${lines.length} log)`}
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Menunggu event pertama dari agen…</p>
      ) : (
        <ol ref={listRef} className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto text-sm" aria-live="polite">
          {lines.map(({ e, line }, i) => (
            <li
              key={e.seq}
              className={cn("grid grid-cols-[auto_1fr] gap-3", i === lines.length - 1 && "rounded-lg border border-primary/30 bg-accent p-3")}
            >
              <time dateTime={e.ts} className="font-mono text-xs text-muted-foreground">{time.format(new Date(e.ts))}</time>
              <p><span className="font-semibold">{line!.who}:</span> {line!.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function DecisionCard({ v, events, claimId }: { v: InvestigationView; events: InvestigationEvent[]; claimId: string | null }) {
  const d = events.find((e) => e.type === "decision")?.payload;
  const verdict = (d?.verdict as string | undefined) ?? v.verdict;
  if (!verdict) return null;
  const confidence = (d?.confidence as number | undefined) ?? v.confidence ?? 0;
  const reason = (d?.reason as string | undefined) ?? v.decision_reason;
  const missing = (d?.missing_evidence as string[] | undefined) ?? [];
  const decision = d?.decision as string | undefined;
  const title = claimId
    ? "Draf siap ditinjau"
    : decision === "seller_error"
      ? "Kesalahan di pihak penjual"
      : decision === "needs_evidence"
        ? "Butuh bukti tambahan"
        : "Keputusan agen";
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          {decision === "seller_error" ? (
            <AlertTriangle className="size-5 text-warning" aria-hidden />
          ) : (
            <FileText className="size-5 text-primary" aria-hidden />
          )}{" "}
          {title}
        </h2>
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">Keyakinan <ConfidenceLabel value={confidence} /></span>
      </div>
      <p className="font-semibold">{verdict}</p>
      {reason && <p className="mt-1 text-sm text-muted-foreground">{reason}</p>}
      {missing.length > 0 && (
        <p className="mt-3 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">Bukti kurang: {missing.join(", ")}</p>
      )}
      {decision === "seller_error" && (
        <p className="mt-3 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
          Klaim ke kurir tidak diajukan. Bukti menunjukkan kesalahan terjadi saat pengemasan, jadi retur pembeli sebaiknya ditindaklanjuti
          oleh toko.
        </p>
      )}
      {decision === "needs_evidence" && events.some((e) => e.type === "done") && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
          <span className="text-muted-foreground">Lengkapi bukti sebelum batas klaim habis.</span>
          <BuyerRequestDialog investigationId={v.id} />
        </div>
      )}
      {claimId && (
        <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">ID draf: {claimId.toUpperCase()}</span>
          <Link href={`/claims/${claimId}`} className="flex items-center gap-1 font-medium text-primary hover:underline">
            Buka draf lengkap <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}
    </section>
  );
}

function PolicyCard({ v, courier }: { v: InvestigationView; courier: string }) {
  const p = v.courier_policy;
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between border-b pb-3">
        <h2 className="text-xl font-semibold">Aturan klaim {courier}</h2>
        {p && <span className="text-[13px] text-muted-foreground">{p.source === "cache" ? "Dari cache" : p.source === "live" ? "Ekstraksi live" : "Versi manual"}</span>}
      </div>
      {p ? (
        <ul className="flex flex-col gap-3 text-sm">
          <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" /><span><span className="font-medium">Batas pengajuan</span><br />{p.claim_window_days} hari</span></li>
          <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" /><span><span className="font-medium">Ganti rugi</span><br />{p.max_compensation}</span></li>
          {p.required_docs.length > 0 && (
            <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" /><span><span className="font-medium">Bukti wajib</span><br />{p.required_docs.join(", ")}</span></li>
          )}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Aturan kurir belum tersedia.</p>
      )}
    </section>
  );
}
