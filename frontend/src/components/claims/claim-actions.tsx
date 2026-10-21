"use client";

import { Check, CircleCheck, Copy, Loader2, PencilLine, Send, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { COURIER_LABEL, formatDateTime, formatRupiah } from "@/lib/format";
import type { ClaimDetail } from "@/types/api";

const time = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

function confidenceLabel(c: number | null) {
  if (c === null) return "Belum dinilai";
  return c >= 0.8 ? "Tinggi" : c >= 0.6 ? "Sedang" : "Rendah";
}

/** Panel kanan review klaim: syarat bukti, keyakinan agen, dan aksi HITL. */
export function ClaimActions({
  claim: c,
  editing,
  busy,
  onEdit,
  onApprove,
  onReject,
}: {
  claim: ClaimDetail;
  editing: boolean;
  busy: "approve" | "reject" | null;
  onEdit: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const courier = COURIER_LABEL[c.courier] ?? c.courier;
  const docs = c.courier_policy?.required_docs ?? [];
  const pending = c.status === "pending_approval";

  if (c.status === "submitted") {
    return (
      <aside className="flex flex-col gap-5 rounded-xl border bg-card p-5">
        <h2 className="flex items-center justify-between text-xl font-semibold">
          Status pengajuan klaim <CircleCheck className="size-5 text-success" aria-hidden />
        </h2>
        <ol className="flex flex-col gap-4 text-sm">
          <li className="flex gap-3">
            <span className="mt-1 size-2.5 shrink-0 rounded-full bg-success" />
            <div>
              <p className="text-success">{c.submitted_at ? time.format(new Date(c.submitted_at)) : ""} WIB</p>
              <p>Disetujui oleh {c.submitted_by ?? "admin"}</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="mt-1 size-2.5 shrink-0 rounded-full bg-info" />
            <div>
              <p className="text-info">{c.submitted_at ? time.format(new Date(c.submitted_at)) : ""} WIB</p>
              <p>Terkirim ke {courier}{c.is_simulated ? " (simulasi)" : ""}</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="mt-1 size-2.5 shrink-0 rounded-full bg-muted-foreground/40" />
            <div>
              <p className="text-muted-foreground">Dalam antrian kurir</p>
              <p>Menunggu respons kurir</p>
            </div>
          </li>
        </ol>
        {c.submission_ref && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-3">
            <div>
              <p className="text-xs text-muted-foreground">ID tiket kurir</p>
              <p className="font-mono text-sm">{c.submission_ref}{c.is_simulated ? " (simulasi)" : ""}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Salin ID tiket"
              onClick={() => navigator.clipboard.writeText(c.submission_ref!).then(() => toast.success("ID tiket disalin"))}
            >
              <Copy />
            </Button>
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="flex flex-col gap-5 rounded-xl border bg-card p-5 lg:sticky lg:top-20">
      {c.status === "rejected" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-destructive"><XCircle className="size-4" aria-hidden /> Draf ditolak</p>
          {c.reject_reason && <p className="mt-1">{c.reject_reason}</p>}
        </div>
      )}

      <div>
        <p className="mb-3 flex justify-between text-sm">
          <span>Syarat bukti {courier}</span>
          <span className="text-muted-foreground">{docs.length} syarat</span>
        </p>
        {docs.length ? (
          <ul className="flex flex-col gap-2">
            {docs.map((d) => (
              <li key={d} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                <Check className="size-4 shrink-0 text-primary" aria-hidden /> {d}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Aturan kurir belum tersedia.</p>
        )}
      </div>

      <div className="rounded-lg bg-muted p-3 text-sm">
        <p className="flex justify-between font-medium">
          Tingkat keyakinan agen
          <span>{c.confidence != null ? `${Math.round(c.confidence * 100)}% · ` : ""}{confidenceLabel(c.confidence)}</span>
        </p>
        {c.decision_reason && <p className="mt-1 text-muted-foreground">{c.decision_reason}</p>}
      </div>

      {c.draft_issues.length > 0 && (
        <ul className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
          {c.draft_issues.map((i) => <li key={i}>⚠ {i}</li>)}
        </ul>
      )}

      {pending && (
        <div className="flex flex-col gap-2 border-t pt-5">
          <Button size="lg" onClick={() => setConfirm(true)} disabled={!!busy || editing}>
            {busy === "approve" ? <Loader2 className="animate-spin" /> : <Send />} Setujui &amp; kirim klaim
          </Button>
          <Button variant="outline" onClick={onEdit} disabled={!!busy || editing}>
            <PencilLine /> Edit draf klaim
          </Button>
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRejecting(true)} disabled={!!busy || editing}>
            Tolak draf
          </Button>
          <p className="mt-2 text-center text-[13px] text-muted-foreground">
            Tidak ada yang dikirim sebelum Anda menekan <span className="font-semibold text-foreground">Setujui</span>.
            {c.is_simulated && " Mode demo: pengiriman disimulasikan."}
          </p>
        </div>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kirim klaim ke {courier}?</DialogTitle>
            <DialogDescription>
              Klaim {formatRupiah(c.claim_value)} untuk resi {c.tracking_number} akan diajukan{c.is_simulated ? " (simulasi)" : ""}. Setelah dikirim, draf tidak dapat diubah.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Batal</Button></DialogClose>
            <Button onClick={() => { setConfirm(false); onApprove(); }}><Send /> Setujui &amp; kirim</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak draf klaim?</DialogTitle>
            <DialogDescription>Alasan penolakan dicatat di log audit dan anomali resi ditandai selesai.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            Alasan penolakan
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Mis. paket ternyata sudah diterima pembeli"
              className="rounded-md border bg-background p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Batal</Button></DialogClose>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3}
              onClick={() => { setRejecting(false); onReject(reason.trim()); }}
            >
              Tolak draf
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-center text-xs text-muted-foreground">Diperbarui {formatDateTime(c.updated_at)}</p>
    </aside>
  );
}
