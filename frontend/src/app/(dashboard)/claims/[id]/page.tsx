"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CircleCheck, Clock, FileText, Paperclip, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CaseAuditLog } from "@/components/claims/case-audit-log";
import { ClaimActions } from "@/components/claims/claim-actions";
import { ClaimDeadline } from "@/components/claims/claim-deadline";
import { EvidencePanel } from "@/components/investigation/evidence-panel";
import { Button } from "@/components/ui/button";
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api-client";
import { COURIER_LABEL, formatDateTime, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClaimDetail, ClaimStatus } from "@/types/api";

const STATUS: Record<ClaimStatus, { label: string; cls: string }> = {
  pending_approval: { label: "Siap ditinjau", cls: "bg-primary text-primary-foreground" },
  submitted: { label: "Terkirim", cls: "bg-info/15 text-info" },
  rejected: { label: "Ditolak", cls: "bg-destructive/10 text-destructive" },
};
const MIN_NARRATIVE = 20;

/** Lama admin meninjau sejak halaman dibuka (metrik uji H5). */
function useReviewTimer(stopped: boolean) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (stopped) return;
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stopped]);
  return { sec, label: `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}` };
}

export default function ClaimReviewPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["claim", id], queryFn: () => api.claims.get(id) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const c = query.data;
  const review = useReviewTimer(!c || c.status !== "pending_approval");

  const onSettled = (data?: ClaimDetail) => {
    if (data) qc.setQueryData(["claim", id], data);
    // Antrian, KPI ringkasan, dan badge sidebar ikut berubah
    qc.invalidateQueries({ queryKey: ["claims"] });
    qc.invalidateQueries({ queryKey: ["metrics"] });
  };
  const onError = (e: Error) => {
    if (e instanceof ApiError && e.status === 409) {
      toast.warning("Klaim sudah diproses", { description: "Status klaim berubah di tab atau perangkat lain. Data dimuat ulang." });
      query.refetch();
    } else toast.error("Aksi gagal", { description: e.message });
  };

  const approve = useMutation({
    mutationFn: () => api.claims.approve(id, review.sec),
    onSuccess: (d) => { onSettled(d); toast.success(`Klaim ${id.toUpperCase()} terkirim`, { description: `Berhasil diajukan ke ${COURIER_LABEL[d.courier] ?? d.courier}${d.is_simulated ? " (simulasi)" : ""}.` }); },
    onError,
  });
  const reject = useMutation({
    mutationFn: (reason: string) => api.claims.reject(id, reason, review.sec),
    onSuccess: (d) => { onSettled(d); toast.info("Draf klaim ditolak"); },
    onError,
  });
  const save = useMutation({
    mutationFn: (narrative: string) => api.claims.update(id, narrative),
    onSuccess: (d) => { onSettled(d); setEditing(false); toast.success("Draf disimpan"); },
    onError,
  });

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <section className="flex flex-col items-center rounded-xl border bg-card pb-8">
        {notFound ? <EmptyState title="Klaim tidak ditemukan" /> : <ErrorState message={query.error.message} onRetry={() => query.refetch()} />}
        <Button asChild variant="outline"><Link href="/claims">Kembali ke antrian</Link></Button>
      </section>
    );
  }
  if (!c)
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton className="h-14 w-96" />
        <Skeleton className="h-28" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Skeleton className="h-[30rem]" />
          <Skeleton className="h-[30rem]" />
        </div>
      </div>
    );

  const courier = COURIER_LABEL[c.courier] ?? c.courier;
  const caseLabel = c.draft.claim_type === "damaged" ? "rusak" : "hilang";
  const policy = c.courier_policy;
  const pending = c.status === "pending_approval";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[28px] leading-9 font-semibold">
            Klaim paket {caseLabel} · <span className="font-mono">{c.tracking_number}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={cn("rounded-md px-2.5 py-0.5 text-[13px] font-medium", STATUS[c.status].cls)}>{STATUS[c.status].label}</span>
            {c.is_simulated && <SimulatedBadge />}
            <Link href={`/investigations/${c.investigation_id}`} className="text-[13px] text-primary hover:underline">Lihat investigasi</Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pending && (
            <span className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Sisa waktu klaim</span>
              <ClaimDeadline deadline={c.claim_deadline} />
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm">
          <Clock className="size-4" aria-hidden /> Waktu tinjau {review.label}{pending ? "" : " (selesai)"}
        </span>
        </div>
      </header>

      {c.status === "submitted" && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-success/30 bg-success/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 font-medium text-success">
              <CircleCheck className="size-5" aria-hidden />
              Klaim terkirim ke {courier}{c.is_simulated ? " (simulasi)" : ""}{c.submitted_at ? ` · ${formatDateTime(c.submitted_at)}` : ""}
            </p>
            <p className="text-sm text-muted-foreground">Draf telah diajukan dan tersimpan di log audit.</p>
          </div>
          <Button asChild variant="outline"><Link href="/claims">Kembali ke antrian</Link></Button>
        </div>
      )}

      <section className="grid divide-y rounded-xl border bg-card md:grid-cols-3 md:divide-x md:divide-y-0">
        <div className="p-5">
          <p className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground"><AlertTriangle className="size-4 text-warning" aria-hidden /> Apa yang terjadi</p>
          <p className="text-sm">{c.decision_reason ?? "—"}</p>
        </div>
        <div className="p-5">
          <p className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Scale className="size-4" aria-hidden /> Dasar aturan</p>
          <p className="text-sm">
            {policy ? `${courier}: ${policy.max_compensation}. Batas ${policy.claim_window_days} hari.` : "Aturan kurir belum tersedia."}
          </p>
          <Link href="/couriers" className="mt-1 inline-flex items-center gap-1 text-[13px] text-primary hover:underline">Lihat sumber ketentuan <ArrowRight className="size-3.5" /></Link>
        </div>
        <div className="p-5">
          <p className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground"><FileText className="size-4" aria-hidden /> Jumlah {c.status === "submitted" ? "diklaim" : "bisa diklaim"}</p>
          <p className="text-2xl font-semibold text-primary">{formatRupiah(c.claim_value)}</p>
          <p className="text-[13px] text-muted-foreground">Nilai barang {c.item_name}: {formatRupiah(c.item_value)}</p>
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <EvidencePanel evidence={c.evidence} analyzing={false} />

          <Tabs defaultValue="draft">
            <TabsList>
              <TabsTrigger value="draft">Draf klaim</TabsTrigger>
              <TabsTrigger value="chronology">Kronologi</TabsTrigger>
              <TabsTrigger value="audit">Log audit</TabsTrigger>
            </TabsList>
            <TabsContent value="draft">
              <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Kanal klaim</dt><dd>Formulir klaim {courier}{c.is_simulated ? " (simulasi)" : ""}</dd></div>
                  <div><dt className="text-muted-foreground">Judul</dt><dd>{c.draft.title ?? `Klaim ${c.tracking_number}`}</dd></div>
                </dl>

                {editing ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={9}
                      aria-label="Narasi klaim"
                      className="rounded-lg border bg-background p-3 leading-relaxed outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("text-xs", draft.trim().length < MIN_NARRATIVE ? "text-destructive" : "text-muted-foreground")}>
                        {draft.trim().length} karakter (min. {MIN_NARRATIVE})
                      </span>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setEditing(false)} disabled={save.isPending}>Batal</Button>
                        <Button onClick={() => save.mutate(draft.trim())} disabled={save.isPending || draft.trim().length < MIN_NARRATIVE}>
                          {save.isPending ? "Menyimpan…" : "Simpan draf"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[17px] leading-relaxed whitespace-pre-line">{c.narrative}</p>
                )}

                <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-[13px] text-muted-foreground italic">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Narasi hanya memakai fakta dari data resi dan rekaman CCTV. {pending ? "" : "Draf terkunci setelah diproses."}
                </p>

                {(c.draft.policy_notes?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium">Syarat kurir yang dipenuhi</p>
                    <ul className="flex flex-col gap-1 text-sm">
                      {c.draft.policy_notes!.map((n) => <li key={n} className="flex gap-2"><CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{n}</li>)}
                    </ul>
                  </div>
                )}

                <div>
                  <p className="mb-2 text-sm font-medium">Lampiran bukti ({c.evidence.length})</p>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {c.evidence.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                        <Paperclip className="size-4 text-muted-foreground" aria-hidden />
                        <span className="flex-1 truncate">{e.kind === "cctv_clip" ? "Klip packing" : e.kind === "unboxing" ? "Video unboxing" : "Foto"} · {e.id}</span>
                        {e.analysis_source && <span className="rounded border px-1.5 text-xs text-muted-foreground">{e.analysis_source === "cache" ? "Cache" : "Live"}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            </TabsContent>
            <TabsContent value="chronology">
              <section className="rounded-xl border bg-card p-5">
                {c.draft.chronology?.length ? (
                  <ol className="relative ml-1.5 border-l">
                    {c.draft.chronology.map((k, i) => (
                      <li key={i} className="mb-5 ml-5 last:mb-0">
                        <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-muted-foreground/40" aria-hidden />
                        <p>{k.event}</p>
                        <time dateTime={k.at} className="text-sm text-muted-foreground">{formatDateTime(k.at)}</time>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">Kronologi tidak tersedia.</p>
                )}
              </section>
            </TabsContent>
            <TabsContent value="audit">
              <CaseAuditLog ids={[c.id, c.investigation_id]} />
            </TabsContent>
          </Tabs>
        </div>

        <ClaimActions
          claim={c}
          editing={editing}
          busy={approve.isPending ? "approve" : reject.isPending ? "reject" : null}
          onEdit={() => { setDraft(c.narrative); setEditing(true); }}
          onApprove={() => approve.mutate()}
          onReject={(r) => reject.mutate(r)}
        />
      </div>
    </div>
  );
}
