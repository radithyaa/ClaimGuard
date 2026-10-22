"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CircleCheck, Circle, Info, ListChecks, Loader2, Play, RotateCcw, Timer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, USE_MOCK, type DemoScenario } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const SCENARIOS: { key: DemoScenario; letter: string; title: string; tag: string; desc: string; expected: string }[] = [
  {
    key: "lost",
    letter: "A",
    title: "Paket hilang",
    tag: "Alur utama",
    desc: "Resi tidak bergerak melewati batas SLA kurir.",
    expected: "Klip packing terpotong, aturan kurir terbaca, draf klaim siap disetujui.",
  },
  {
    key: "damaged",
    letter: "B",
    title: "Paket rusak",
    tag: "Analisis visual",
    desc: "Pembeli melaporkan barang rusak; video unboxing tersedia.",
    expected: "Temuan kerusakan dengan stempel waktu dan aturan kurir terlampir.",
  },
  {
    key: "return_fraud",
    letter: "C",
    title: "Sengketa retur",
    tag: "Ketidaksesuaian CCTV",
    desc: "Pembeli mengaku isi paket kurang, video packing berkata lain.",
    expected: "Ketidaksesuaian ditandai; agen tidak mengajukan klaim tanpa bukti kuat.",
  },
  {
    key: "wrong_item_seller",
    letter: "D",
    title: "Penjual salah kirim",
    tag: "Kasus kontrol",
    desc: "Pembeli menerima kaos biru doubel, padahal memesan kaos biru tua (navy).",
    expected: "Agen mengenali kesalahan di gudang dan tidak mengajukan klaim ke kurir.",
  },
];

const AGENDA = [
  { t: "0:00", title: "Adegan masalah", desc: "Seller kehilangan margin akibat paket macet dan klaim manual yang telat." },
  { t: "0:30", title: "Data masalah", desc: "Batas klaim kurir pendek; bukti packing sering tidak siap saat dibutuhkan." },
  { t: "1:00", title: "Demo skenario A sampai persetujuan", desc: "Antrian klaim → verifikasi video CCTV → 1 klik terbit draf klaim.", key: true },
  { t: "2:00", title: "Mengapa agentic dan aman", desc: "Human-in-the-loop, narasi hanya dari fakta, data pribadi dilindungi." },
  { t: "2:30", title: "Pasar dan model bisnis", desc: "Success fee dari dana yang berhasil dipulihkan." },
];

export default function DemoPanelPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [confirmReset, setConfirmReset] = useState(false);
  const [running, setRunning] = useState<DemoScenario | null>(null);

  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const shipments = useQuery({ queryKey: ["shipments", "count", ""], queryFn: () => api.shipments.list({ limit: 1 }) });
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.metrics.summary });

  const reset = useMutation({
    mutationFn: api.demo.reset,
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast.success("Data demo direset", {
        description: `${r.shipments} resi dimuat ulang${r.missing_media.length ? ` · ${r.missing_media.length} media tidak ditemukan` : ""}.`,
      });
    },
    onError: (e) => toast.error("Reset gagal", { description: e.message }),
  });

  const scenario = useMutation({
    mutationFn: (name: DemoScenario) => api.demo.scenario(name),
    onMutate: (name) => setRunning(name),
    onSuccess: ({ investigation_id }) => {
      qc.invalidateQueries();
      router.push(`/investigations/${investigation_id}`);
    },
    onError: (e) => {
      setRunning(null);
      const notSeeded = e instanceof ApiError && e.code === "demo_not_seeded";
      toast.error("Skenario gagal dijalankan", { description: notSeeded ? "Data demo belum ada. Tekan Reset data demo dulu." : e.message });
    },
  });

  // Mock-only: hentikan skrip tepat setelah Evaluator mengeluarkan keputusan, untuk menunjukkan
  // bagaimana kesimpulan agentic sudah tertulis pada resi sebelum admin meninjau klaim.
  // `seconds` = waktu event `decision` pada skrip mock (shp-003 11,5 dtk; skrip lain 12–12,4 dtk).
  const verdictPreview = useMutation({
    mutationFn: async ({ shipmentId, seconds }: { shipmentId: string; seconds: number }) => {
      const { investigation_id } = await api.investigations.start(shipmentId);
      await api.demo.pause(shipmentId, seconds);
      return investigation_id;
    },
    onSuccess: (investigation_id) => {
      qc.invalidateQueries();
      toast.info("Kesimpulan agen sedang disiapkan", {
        description: "Skrip dihentikan setelah keputusan agar Anda bisa melihat kesimpulan yang tertulis pada resi.",
      });
      router.push(`/investigations/${investigation_id}`);
    },
    onError: (e) => toast.error("Pratinjau kesimpulan gagal", { description: e.message }),
  });

  const checks = [
    {
      label: "Backend terhubung",
      ok: health.isSuccess && health.data.status === "ok",
      pending: health.isPending,
      detail: health.data ? `Database ${health.data.db} · storage ${health.data.storage}` : health.isError ? "Tidak dapat menghubungi server" : "",
    },
    {
      label: "Hasil analisis AI dari cache",
      ok: settings.data ? settings.data.ai_mode !== "live" : false,
      pending: settings.isPending,
      warn: settings.data?.ai_mode === "live",
      detail: settings.data ? `Mode AI: ${settings.data.ai_mode}${settings.data.ai_mode === "live" ? " (rawan lambat/gagal saat tampil)" : ""}` : "",
    },
    {
      label: "Penjadwal scan dimatikan",
      ok: settings.data ? !settings.data.scheduler_enabled : false,
      pending: settings.isPending,
      warn: settings.data?.scheduler_enabled,
      detail: settings.data?.scheduler_enabled ? "Penjadwal bisa menyela skenario; matikan di Pengaturan" : "Skenario tidak akan disela scan otomatis",
    },
  ];
  const ready = checks.every((c) => c.ok);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[26px] leading-8 font-semibold">Panel demo</h1>
            <SimulatedBadge />
          </div>
          <p className="text-sm text-muted-foreground">Jalankan skenario tetap untuk presentasi. Semua data di halaman ini simulasi.</p>
        </div>
        <Button variant="outline" onClick={() => setConfirmReset(true)} disabled={reset.isPending}>
          {reset.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reset data demo
        </Button>
      </header>

      <div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Data demo: {shipments.data?.total ?? "…"} resi · {metrics.data?.pending_claims ?? "…"} kasus menunggu · {metrics.data?.active_anomalies ?? "…"} anomali aktif
        </p>
        <span className={cn("flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px]", ready ? "border-success/30 bg-success/10 text-success" : "border-warning/50 bg-warning/15")}>
          <span className={cn("size-1.5 rounded-full", ready ? "bg-success" : "bg-warning")} /> {ready ? "Sistem siap tampil" : "Periksa kesiapan"}
        </span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="rounded-xl border bg-card p-5">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">Skenario</h2>
              <p className="text-sm text-muted-foreground">Memicu alur penuh: monitoring menandai anomali, lalu agen langsung menginvestigasi.</p>
            </div>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium tracking-wide whitespace-nowrap">{SCENARIOS.length} KASUS</span>
          </div>
          <ul className="divide-y">
            {SCENARIOS.map((s) => (
              <li key={s.key} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start">
                <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted font-medium">{s.letter}</span>
                <div className="flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {s.title}
                    <span className="rounded border border-warning/50 bg-warning/10 px-1.5 text-xs font-normal">{s.tag}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                  <p className="mt-2 flex gap-2 text-sm">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <span><span className="text-muted-foreground">Hasil yang diharapkan:</span> <span className="font-medium">{s.expected}</span></span>
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => scenario.mutate(s.key)} disabled={scenario.isPending || reset.isPending}>
                  {running === s.key ? <Loader2 className="animate-spin" /> : <Play />} Jalankan
                </Button>
              </li>
            ))}
          </ul>
          {USE_MOCK && (
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Pratinjau kesimpulan resi</p>
                <p className="text-sm text-muted-foreground">
                  Skrip dihentikan tepat setelah Evaluator memutuskan, sehingga kesimpulan (penjual, pembeli, atau
                  kurir) sudah tertulis pada resi padahal agen belum selesai.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => verdictPreview.mutate({ shipmentId: "shp-011", seconds: 12 })} disabled={verdictPreview.isPending}>
                  <Play /> Penjual salah kirim
                </Button>
                <Button variant="outline" size="sm" onClick={() => verdictPreview.mutate({ shipmentId: "shp-003", seconds: 11.5 })} disabled={verdictPreview.isPending}>
                  <Play /> Retur curang
                </Button>
              </div>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">Urutan presentasi 3 menit</h2>
                <p className="text-sm text-muted-foreground">Panduan waktu penjurian (180 detik)</p>
              </div>
              <Timer className="size-5 text-muted-foreground" aria-hidden />
            </div>
            <ol className="relative ml-1.5 border-l">
              {AGENDA.map((a) => (
                <li key={a.t} className="mb-4 ml-5 last:mb-0">
                  <span className={cn("absolute -left-[5px] mt-1.5 size-2.5 rounded-full", a.key ? "bg-primary ring-4 ring-primary/20" : "bg-muted-foreground/40")} aria-hidden />
                  <div className={cn(a.key && "rounded-lg border border-primary/30 bg-accent p-3")}>
                    <p className="text-sm"><span className="mr-2 font-mono text-muted-foreground">{a.t}</span><span className="font-medium">{a.title}</span></p>
                    {a.key && <span className="mt-1 inline-block rounded bg-primary px-1.5 text-xs text-primary-foreground">Kunci demo</span>}
                    <p className="text-[13px] text-muted-foreground">{a.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">Pemeriksaan sebelum tampil</h2>
                <p className="text-sm text-muted-foreground">Status kesiapan lingkungan presentasi</p>
              </div>
              <ListChecks className="size-5 text-muted-foreground" aria-hidden />
            </div>
            <ul className="flex flex-col divide-y">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-3 py-3">
                  {c.pending ? (
                    <Skeleton className="size-5 rounded-full" />
                  ) : c.ok ? (
                    <CircleCheck className="size-5 shrink-0 fill-success text-card" aria-hidden />
                  ) : c.warn ? (
                    <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
                  ) : (
                    <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="flex-1">
                    <p className="text-sm">{c.label}</p>
                    {c.detail && <p className={cn("text-[13px]", c.ok ? "text-muted-foreground" : "text-warning-foreground dark:text-warning")}>{c.detail}</p>}
                  </div>
                  {!c.pending && (
                    <span className={cn("rounded px-1.5 text-xs", c.ok ? "bg-success/10 text-success" : "bg-warning/20")}>{c.ok ? "OK" : "Peringatan"}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t pt-3 text-sm">
              <Link href="/settings" className="text-muted-foreground hover:text-foreground">Buka pengaturan</Link>
              <Link href="/claims" className="flex items-center gap-1 text-primary hover:underline">Buka antrian klaim <ArrowRight className="size-3.5" /></Link>
            </div>
          </section>
        </div>
      </div>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-warning" aria-hidden /> Reset data demo?</DialogTitle>
            <DialogDescription>
              Semua resi, kasus, dan log audit simulasi kembali ke kondisi awal. Investigasi yang sedang berjalan dihentikan. Pengaturan tidak berubah.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Batal</Button></DialogClose>
            <Button onClick={() => { setConfirmReset(false); reset.mutate(); }}><RotateCcw /> Reset data</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
