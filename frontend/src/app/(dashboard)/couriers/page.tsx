"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleCheck, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import { COURIER_LABEL, formatDateTime, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CourierPolicy } from "@/types/api";

const VERIFIED_KEY = "cg_policies_verified";
const SOURCE = {
  live: { label: "Live", cls: "border-primary/30 bg-accent text-primary" },
  cache: { label: "Cache", cls: "border-border bg-muted text-muted-foreground" },
  manual: { label: "Manual", cls: "border-border bg-muted text-muted-foreground" },
} as const;

const parseRp = (s: string | undefined) => {
  const m = s?.match(/Rp\s?([\d.]+)/);
  return m ? Number(m[1].replace(/\./g, "")) : null;
};
const digits = (s: string) => Number(s.replace(/\D/g, "")) || 0;

/**
 * Perkiraan dari teks `max_compensation` hasil ekstraksi: bagian sebelum ";" = tanpa asuransi,
 * sesudahnya = berasuransi. "10x ongkir" dipakai bila disebut; selalu dibatasi nilai barang & plafon Rp.
 */
function estimate(p: CourierPolicy, shipping: number, value: number, insured: boolean) {
  const [plain, withIns] = p.max_compensation.split(";");
  if (insured) {
    const cap = parseRp(withIns);
    const amount = cap ? Math.min(value, cap) : value;
    return { amount, note: `Nilai barang${cap ? `, maks ${formatRupiah(cap)}` : ""}` };
  }
  const tenX = /10\s?x\s?ongkir/i.test(plain);
  const cap = parseRp(plain);
  const parts = [tenX ? 10 * shipping : value, value, cap ?? Infinity];
  const amount = Math.min(...parts);
  const basis = tenX ? `10 × ongkir = ${formatRupiah(10 * shipping)}` : "Nilai barang";
  return { amount, note: `${basis}, dibatasi nilai barang${cap ? ` dan plafon ${formatRupiah(cap)}` : ""}` };
}

export default function CourierPoliciesPage() {
  const query = useQuery({ queryKey: ["courier-policies"], queryFn: api.couriers.policies });
  const policies = query.data ?? [];
  const [selected, setSelected] = useState<CourierPolicy | null>(null);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    try {
      setVerified(localStorage.getItem(VERIFIED_KEY) === "1");
    } catch {
      /* storage tidak tersedia */
    }
  }, []);
  const markVerified = () => {
    setVerified(true);
    try {
      localStorage.setItem(VERIFIED_KEY, "1");
    } catch {
      /* storage tidak tersedia */
    }
  };

  const lastExtracted = policies.reduce<string | null>((max, p) => (!max || p.extracted_at > max ? p.extracted_at : max), null);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[26px] leading-8 font-semibold">Kebijakan kurir</h1>
            <SimulatedBadge />
          </div>
          <p className="text-sm text-muted-foreground">Aturan klaim yang dipakai agen, diekstrak dari dokumen kebijakan kurir.</p>
        </div>
        {lastExtracted && <p className="text-sm text-muted-foreground">Terakhir diekstrak {formatDateTime(lastExtracted)}</p>}
      </header>

      {!verified && (
        <div role="note" className="flex flex-col gap-3 rounded-xl border border-warning/60 bg-warning/15 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex gap-3 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <span>
              Aturan diekstrak otomatis oleh AI dari dokumen kebijakan.
              <br />
              Verifikasi ulang sebelum dipakai untuk klaim nyata.
            </span>
          </p>
          <Button variant="ghost" className="text-primary" onClick={markVerified}>Tandai sudah diverifikasi</Button>
        </div>
      )}

      {query.isError ? (
        <section className="rounded-xl border bg-card"><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></section>
      ) : query.isPending ? (
        <>
          <Skeleton className="h-56" />
          <Skeleton className="h-72" />
        </>
      ) : policies.length === 0 ? (
        <section className="rounded-xl border bg-card">
          <EmptyState title="Belum ada dokumen kebijakan" description="Tambahkan dokumen kebijakan kurir di backend, lalu jalankan ekstraksi." />
        </section>
      ) : (
        <>
          <Calculator policies={policies} />
          <PolicyMatrix policies={policies} onSelect={setSelected} />
        </>
      )}

      <PolicyDrawer policy={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Calculator({ policies }: { policies: CourierPolicy[] }) {
  const [courier, setCourier] = useState(policies[0].courier);
  const [shipping, setShipping] = useState("15000");
  const [value, setValue] = useState("180000");
  const [insured, setInsured] = useState(false);
  const policy = policies.find((p) => p.courier === courier) ?? policies[0];
  const result = useMemo(() => estimate(policy, digits(shipping), digits(value), insured), [policy, shipping, value, insured]);

  const money = (v: string, set: (s: string) => void, label: string) => (
    <label className="flex flex-col gap-1.5 text-sm">
      {label}
      <input
        inputMode="numeric"
        value={digits(v) ? formatRupiah(digits(v)) : ""}
        onChange={(e) => set(e.target.value)}
        placeholder="Rp0"
        className="h-10 rounded-lg border bg-background px-3 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
      />
    </label>
  );

  return (
    <section className="rounded-xl border bg-card p-6">
      <h2 className="text-xl font-semibold">Hitung perkiraan ganti rugi</h2>
      <p className="mb-5 text-sm text-muted-foreground">Simulasi santunan klaim berdasarkan aturan masing-masing kurir.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto]">
        <label className="flex flex-col gap-1.5 text-sm">
          Kurir
          <Select value={courier} onValueChange={(v) => setCourier(v as CourierPolicy["courier"])}>
            <SelectTrigger className="h-10! w-full rounded-lg"><SelectValue /></SelectTrigger>
            <SelectContent>
              {policies.map((p) => <SelectItem key={p.courier} value={p.courier}>{COURIER_LABEL[p.courier] ?? p.courier}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        {money(shipping, setShipping, "Ongkir")}
        {money(value, setValue, "Nilai barang")}
        <label className="flex flex-col gap-1.5 text-sm">
          Diasuransikan
          <span className="flex h-10 items-center gap-2">
            <Switch checked={insured} onCheckedChange={setInsured} /> {insured ? "Ya" : "Tidak"}
          </span>
        </label>
      </div>
      <div className="mt-5 rounded-lg border border-primary/20 bg-accent/60 p-4" aria-live="polite">
        <p className="text-sm text-primary">Perkiraan santunan</p>
        <p className="text-3xl font-semibold text-primary tabular-nums">{formatRupiah(result.amount)}</p>
        <p className="text-sm text-muted-foreground">{result.note}. Aturan: {policy.max_compensation}.</p>
      </div>
    </section>
  );
}

function PolicyMatrix({ policies, onSelect }: { policies: CourierPolicy[]; onSelect: (p: CourierPolicy) => void }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
        <h2 className="font-semibold">
          Matriks kebijakan kurir <span className="text-sm font-normal text-muted-foreground">({policies.length} kurir)</span>
        </h2>
        <p className="text-[13px] text-muted-foreground">Klik baris untuk melihat detail</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-[13px] text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Kurir</th>
              <th className="px-5 py-3 font-medium">Batas pengajuan</th>
              <th className="px-5 py-3 font-medium">Ganti rugi</th>
              <th className="px-5 py-3 font-medium">Bukti wajib</th>
              <th className="px-5 py-3 font-medium">Sumber</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {policies.map((p) => (
              <tr
                key={p.courier}
                tabIndex={0}
                onClick={() => onSelect(p)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(p))}
                className="cursor-pointer hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
              >
                <td className="px-5 py-4 font-medium whitespace-nowrap">
                  <span className="mr-2 inline-block size-2 rounded-full bg-primary" aria-hidden />
                  {COURIER_LABEL[p.courier] ?? p.courier}
                </td>
                <td className="px-5 py-4 whitespace-nowrap">{p.claim_window_days} hari</td>
                <td className="max-w-72 px-5 py-4">{p.max_compensation}</td>
                <td className="px-5 py-4 text-muted-foreground">{p.required_docs.length} dokumen</td>
                <td className="px-5 py-4">
                  <span className={cn("rounded-md border px-2 py-0.5 text-xs", SOURCE[p.source].cls)}>{SOURCE[p.source].label}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t bg-muted/50 px-5 py-3 text-[13px] text-muted-foreground">
        Menampilkan {policies.length} kurir. Aturan diperbarui saat dokumen kebijakan diekstrak ulang.
      </p>
    </section>
  );
}

function PolicyDrawer({ policy: p, onClose }: { policy: CourierPolicy | null; onClose: () => void }) {
  const exclusions = (p?.extra.exclusions as string[] | undefined) ?? [];
  const insuranceNote = p?.extra.insurance_note as string | undefined;
  return (
    <Sheet open={!!p} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {p && (
          <>
            <SheetHeader className="border-b">
              <span className={cn("flex w-fit items-center gap-1 rounded-md border px-2 py-0.5 text-xs", SOURCE[p.source].cls)}>
                {p.source === "live" && <Zap className="size-3" aria-hidden />} {SOURCE[p.source].label}
              </span>
              <SheetTitle className="text-xl">{COURIER_LABEL[p.courier] ?? p.courier}</SheetTitle>
              <SheetDescription>Diekstrak {formatDateTime(p.extracted_at)}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-6 p-4">
              <section>
                <h3 className="mb-2 text-[13px] font-medium tracking-[0.65px] text-muted-foreground uppercase">Ringkasan aturan</h3>
                <dl className="flex flex-col gap-2 rounded-xl bg-muted p-3 text-sm">
                  <div className="rounded-lg bg-card p-3">
                    <dt className="text-muted-foreground">Batas pengajuan</dt>
                    <dd>{p.claim_window_days} hari</dd>
                  </div>
                  <div className="rounded-lg bg-card p-3">
                    <dt className="text-muted-foreground">Ganti rugi</dt>
                    <dd>{p.max_compensation}</dd>
                  </div>
                  {insuranceNote && (
                    <div className="rounded-lg bg-card p-3">
                      <dt className="text-muted-foreground">Asuransi</dt>
                      <dd>{insuranceNote}</dd>
                    </div>
                  )}
                </dl>
              </section>
              <section>
                <h3 className="mb-2 text-[13px] font-medium tracking-[0.65px] text-muted-foreground uppercase">Bukti wajib</h3>
                <ul className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
                  {p.required_docs.map((d) => (
                    <li key={d} className="flex gap-2"><CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{d}</li>
                  ))}
                </ul>
              </section>
              {exclusions.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[13px] font-medium tracking-[0.65px] text-muted-foreground uppercase">Pengecualian</h3>
                  <ul className="flex flex-col gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
                    {exclusions.map((x) => <li key={x} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />{x}</li>)}
                  </ul>
                </section>
              )}
              <p className="flex gap-2 text-[13px] text-muted-foreground">
                <Check className="size-4 shrink-0" aria-hidden /> Agen membaca aturan ini saat menyusun draf klaim untuk {COURIER_LABEL[p.courier] ?? p.courier}.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
