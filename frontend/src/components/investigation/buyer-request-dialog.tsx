"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, MessageSquareText, Send } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

const MIN_MESSAGE = 10;

/**
 * F6: draf pesan permintaan bukti ke pembeli. ClaimGuard tidak mengirim apa pun;
 * admin menyalin pesan ke chat marketplace lalu menandainya terkirim (tercatat di log audit).
 */
export function BuyerRequestDialog({ investigationId }: { investigationId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const draft = useQuery({
    queryKey: ["buyer-request", investigationId],
    queryFn: () => api.investigations.buyerRequest(investigationId),
    enabled: open,
  });
  useEffect(() => {
    if (draft.data) setMessage(draft.data.message);
  }, [draft.data]);

  const sent = useMutation({
    mutationFn: () => api.investigations.markBuyerRequestSent(investigationId, message.trim()),
    onSuccess: () => {
      toast.success("Permintaan bukti dicatat", { description: "Tercatat di log audit. Klaim tetap belum diajukan." });
      setOpen(false);
    },
    onError: (e) => toast.error("Gagal mencatat", { description: e.message }),
  });

  function copy() {
    navigator.clipboard.writeText(message).then(
      () => toast.success("Pesan disalin", { description: "Tempel ke chat pembeli di marketplace." }),
      () => toast.error("Gagal menyalin"),
    );
  }

  const tooShort = message.trim().length < MIN_MESSAGE;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MessageSquareText /> Minta bukti pembeli
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Minta bukti ke pembeli</DialogTitle>
          <DialogDescription>
            Draf disusun dari bukti yang kurang dan batas klaim kurir. ClaimGuard tidak mengirim pesan ini; salin lalu kirim lewat chat
            marketplace.
          </DialogDescription>
        </DialogHeader>
        {draft.isError ? (
          <p className="text-sm text-destructive">{draft.error.message}</p>
        ) : !draft.data ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="flex flex-col gap-3">
            {draft.data.deadline && (
              <p className="text-sm">
                Batas klaim: <span className="font-medium">{formatDate(draft.data.deadline)}</span>
              </p>
            )}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={12}
              aria-label="Pesan untuk pembeli"
              className="rounded-lg border bg-background p-3 text-sm leading-relaxed outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <DialogClose asChild>
            <Button variant="ghost">Batal</Button>
          </DialogClose>
          <div className="flex gap-2">
            <Button variant="outline" onClick={copy} disabled={!draft.data || tooShort}>
              <Copy /> Salin pesan
            </Button>
            <Button onClick={() => sent.mutate()} disabled={!draft.data || tooShort || sent.isPending}>
              <Send /> Tandai sudah dikirim
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
