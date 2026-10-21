"use client";

import { useEffect, useState } from "react";

import { PageHeader, StatusPill, type SaveStatus } from "@/components/settings/page-header";
import { SectionCard } from "@/components/settings/section-card";
import { SettingsNav } from "@/components/settings/settings-nav";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { SimulatedBadge } from "@/components/ui/simulated-badge";
import { useLogout } from "@/hooks/use-logout";
import { api, USE_MOCK } from "@/lib/api-client";

type Health = { status: string; db: string; ai_mode: string; storage: string };

/**
 * Halaman Akun (FR-19). Sistem demo memakai SATU kata sandi tim, sehingga tidak ada
 * profil per pengguna, ubah kata sandi, atau pemisahan peran. Halaman ini menampilkan
 * status sesi yang sebenarnya dan status layanan dari `/health`, bukan data palsu.
 *
 * Sesi berupa cookie httpOnly sehingga tidak dapat dibaca JavaScript; statusnya diambil
 * dari `GET /auth/session` (backend memvalidasi tanda tangan token).
 */
export function AccountForm() {
  const logout = useLogout();
  const [health, setHealth] = useState<Health | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [session, setSession] = useState<{ authenticated: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.auth
      .session()
      .then((s) => {
        if (!cancelled) setSession({ authenticated: s.authenticated });
      })
      .catch(() => {
        if (!cancelled) setSession({ authenticated: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (USE_MOCK) {
      setHealth({ status: "ok", db: "mock", ai_mode: "cache", storage: "mock" });
      return;
    }
    let cancelled = false;
    api
      .health()
      .then((result) => {
        if (!cancelled) setHealth(result);
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "error", message: "Backend tidak dapat dihubungi." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function signOut() {
    setConfirmLogout(false);
    void logout();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pengaturan"
        description="Konfigurasi pemantauan resi, ambang batas deteksi AI, dan notifikasi sistem."
        aside={<StatusPill status={status} />}
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <SettingsNav />

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {/* 1. Profil demo */}
          <SectionCard
            title="Profil operator"
            description="Akun tunggal untuk mode demo; semua anggota tim memakai kredensial yang sama"
          >
            <div className="flex items-start gap-4">
              <span
                aria-hidden
                className="grid size-12 shrink-0 place-items-center rounded-full bg-brand text-on-brand"
              >
                <Icon src="icon-akun.svg" className="size-5" tone="invert" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-semibold leading-7 text-ink">Admin gudang</p>
                  <span className="rounded border border-line bg-neutral-soft px-2 py-0.5 text-[11px] leading-[16.5px] text-ink-muted">
                    Admin
                  </span>
                  <SimulatedBadge label="Akun demo" />
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  <div>
                    <dt className="eyebrow">Penyedia masuk</dt>
                    <dd className="text-[13px] leading-[21px] text-ink-muted">
                      Kata sandi tim (bukan akun Google/SSO)
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Hak akses</dt>
                    <dd className="text-[13px] leading-[21px] text-ink-muted">
                      Penuh: memindai, menjalankan agen, menyetujui, dan menolak klaim
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Kejujuran desain: jangan menampilkan tombol yang tidak berfungsi. */}
            <div className="flex items-start gap-2 rounded-lg border border-line bg-subtle p-3">
              <Icon src="icon-info.svg" className="mt-0.5 size-3.5" />
              <p className="text-[13px] leading-[18px] text-ink-muted">
                Ubah kata sandi dan peran pengguna belum tersedia pada versi demo: satu
                kredensial dipakai bersama dan semua orang berperan sebagai admin. Untuk
                mengganti kata sandi, perbarui secret <code>DEMO_PASSWORD</code> lalu
                deploy ulang.
              </p>
            </div>
          </SectionCard>

          {/* 2. Sesi perangkat */}
          <SectionCard
            title="Sesi perangkat ini"
            description="Masa berlaku login demo dan cara keluar dengan aman"
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="field-label">Status sesi</p>
                  <p className="mt-1 text-[13px] leading-[21px] text-ink-muted">
                    {session === null
                      ? "Memeriksa sesi…"
                      : session.authenticated
                        ? "Aktif — cookie sesi httpOnly di perangkat ini; tidak terbaca oleh JavaScript."
                        : "Sesi tidak ditemukan. Anda tetap dapat membaca data, tetapi aksi tulis akan meminta login."}
                  </p>
                </div>
                <span
                  className={[
                    "shrink-0 rounded-full border px-3 py-1 text-[13px] font-medium",
                    session?.authenticated
                      ? "border-line bg-subtle text-ink-muted"
                      : "border-danger/30 bg-danger/5 text-danger",
                  ].join(" ")}
                >
                  {session === null ? "—" : session.authenticated ? "Masuk" : "Tidak ada sesi"}
                </span>
              </div>

              <dl className="mt-1 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                <div>
                  <dt className="eyebrow">Penyimpanan</dt>
                  <dd className="text-[13px] leading-[21px] text-ink">
                    Cookie httpOnly (first-party)
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Masa berlaku</dt>
                  <dd className="text-[13px] leading-[21px] text-ink">
                    {/* Masa berlaku ditentukan permintaan login; server yang memutuskan. */}
                    Mengikuti pengaturan saat masuk
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setConfirmLogout(true)}
                className="focus-ring inline-flex items-center gap-2 rounded-lg border border-danger bg-surface px-3 py-2 text-base text-danger hover:bg-danger/5"
              >
                <Icon src="icon-close.svg" className="size-3" />
                Keluar
              </button>
              <span className="hint">
                Keluar menghapus token dari perangkat ini dan membuka halaman login.
              </span>
            </div>
          </SectionCard>

          {/* 3. Status layanan */}
          <SectionCard
            title="Status layanan"
            description="Kondisi backend yang sedang melayani aplikasi ini"
          >
            {health ? (
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <HealthItem label="Layanan" value={health.status === "ok" ? "Normal" : health.status} />
                <HealthItem label="Basis data" value={health.db === "ok" ? "Terhubung" : health.db} />
                <HealthItem label="Mode AI" value={AI_MODE_LABEL[health.ai_mode] ?? health.ai_mode} />
                <HealthItem
                  label="Penyimpanan"
                  value={health.storage === "gcs" ? "Cloud Storage" : "Lokal"}
                />
              </dl>
            ) : status.kind === "error" ? (
              <p className="text-[13px] leading-[21px] text-ink-muted">
                Status layanan tidak dapat diambil. Periksa koneksi ke backend.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <span className="h-3 w-16 animate-pulse rounded bg-field" />
                    <span className="h-4 w-24 animate-pulse rounded bg-field" />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <div className="pb-8" />
        </div>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title="Keluar dari ClaimGuard?"
        description="Token sesi dihapus dari perangkat ini. Anda perlu memasukkan kata sandi tim lagi untuk menyetujui klaim."
        confirmLabel="Ya, keluar"
        tone="danger"
        onConfirm={signOut}
        onCancel={() => setConfirmLogout(false)}
      />
    </div>
  );
}

const AI_MODE_LABEL: Record<string, string> = {
  live: "Live (Gemini)",
  auto: "Otomatis (Gemini + cadangan)",
  cache: "Cadangan (cache)",
};

function HealthItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 text-sm font-medium text-ink">
        <span className="size-1.5 rounded-full bg-success" aria-hidden />
        {value}
      </dd>
    </div>
  );
}
