import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { getServerSession } from "@/lib/server-session";

export const metadata: Metadata = { title: "Masuk" };
// Tanggal hari ini harus dihitung per request, bukan saat build
export const dynamic = "force-dynamic";

const STEPS = ["Deteksi", "Kumpulkan bukti", "Susun draf", "Anda setujui"];

export default async function LoginPage() {
  // Sudah punya sesi: jangan tampilkan formulir login lagi.
  const session = await getServerSession();
  if (session.authenticated) redirect("/dashboard");

  const today = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" })
    .format(new Date())
    .replace(/\./g, "");

  return (
    <div className="flex min-h-screen bg-white font-[family-name:var(--font-jakarta)] text-[#1e2a36]">
      {/* Panel kiri: pesan produk */}
      <section className="hidden flex-1 flex-col border-r border-[#d5dce3] bg-[#f0fdfa] p-16 lg:flex">
        <Image src="/login/claimguard-logo.png" alt="ClaimGuard" width={196} height={36} priority />

        <div className="flex max-w-[560px] flex-1 flex-col justify-center gap-5 py-6">
          <h1 className="text-[42px] leading-[52px] font-bold tracking-[-1.05px]">
            Klaim paket bermasalah, siap ditinjau dalam hitungan detik.
          </h1>
          <p className="max-w-[520px] text-base text-[#4a5968]">
            Agen memantau resi, memotong rekaman meja packing pada jam scan, mencocokkan aturan kurir, lalu menyusun
            draf klaim. Anda yang memutuskan.
          </p>

          <div className="flex max-w-[520px] flex-col gap-5 pt-7">
            <p className="text-[13px] font-semibold tracking-[0.65px] text-[#4a5968] uppercase">
              Alur kerja otomatis &amp; keputusan
            </p>
            <ol className="relative flex items-center justify-between">
              <span aria-hidden className="absolute inset-x-1 top-1 h-0.5 bg-[#e6ebf0]" />
              {STEPS.map((step, i) => {
                const last = i === STEPS.length - 1;
                const align = i === 0 ? "items-start" : last ? "items-end" : "items-center";
                return (
                  <li key={step} className={`relative flex flex-col gap-3 ${align}`}>
                    <span
                      className={`size-2.5 rounded-full shadow-[0_0_0_4px_#f0fdfa] ${last ? "bg-primary" : "bg-[#8a96a3]"}`}
                    />
                    <span className={`text-sm ${last ? "font-semibold text-primary" : "font-medium text-[#4a5968]"}`}>
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <p className="flex items-center gap-2 border-t border-[#d5dce3]/60 pt-6 text-[13px] text-[#4a5968]">
          <Image src="/login/icon-shield.svg" alt="" width={12} height={15} />
          Tidak ada klaim yang dikirim tanpa persetujuan manusia.
        </p>
      </section>

      {/* Panel kanan: formulir */}
      <section className="flex w-full flex-col px-6 py-12 sm:px-16 lg:w-[580px] lg:shrink-0">
        <p className="text-right text-[13px] text-[#4a5968]">{today}</p>

        <div className="flex flex-1 items-center justify-center py-12">
          {/* LoginForm membaca ?next= lewat useSearchParams */}
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <footer className="flex items-center justify-between border-t border-[#e6ebf0] pt-4 text-[13px] text-[#4a5968]">
          <span>ClaimGuard v1.0</span>
          <span>Hackathon 21 sampai 22 Okt 2026</span>
        </footer>
      </section>
    </div>
  );
}
