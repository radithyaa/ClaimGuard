"use client";

import { EyeOff, Mail, Play } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import { safeNext, saveSession } from "@/lib/auth";

/**
 * Login satu akun demo (FR-19). Sistem belum punya tabel pengguna, sehingga email hanya
 * dipakai sebagai identitas tampilan: backend memverifikasi KATA SANDI saja. Ini dinyatakan
 * apa adanya di UI agar tidak terkesan autentikasi per-pengguna yang tidak ada.
 */
const ADMIN_EMAIL = "admin@claimguard.demo";

export function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState<"form" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  async function signIn(passwordValue: string, mode: "form" | "demo") {
    setPending(mode);
    setError(null);
    try {
      const { token, expires_in } = await api.auth.login(passwordValue);
      saveSession(token, expires_in, remember);
      // URUTAN PENTING: refresh() dulu agar server component membaca ulang cookie sesi,
      // baru pindah halaman. Bila `replace` lebih dulu, Next.js dapat memakai hasil RSC
      // lama (masih "belum login") dan layout mengalihkan balik ke /login.
      router.refresh();
      router.replace(next);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Kata sandi salah. Coba lagi."
          : err instanceof Error
            ? err.message
            : "Gagal masuk.",
      );
      setPending(null);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return setError("Masukkan kata sandi tim.");
    void signIn(password, "form");
  }

  /**
   * Tombol juri: backend memakai satu kata sandi demo. Nilainya diisi lewat env publik
   * `NEXT_PUBLIC_DEMO_PASSWORD`; bila tidak diisi, tombol disembunyikan daripada menebak.
   */
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
  const canDemo = !process.env.NEXT_PUBLIC_HIDE_DEMO_LOGIN && Boolean(demoPassword);

  return (
    <>
      <form onSubmit={onSubmit} className="w-full max-w-[400px]" noValidate>
        <h2 className="pb-1.5 text-[26px] leading-8 font-semibold">Masuk</h2>
        <p className="pb-4 text-sm text-[#4a5968]">Gunakan akun tim untuk mode demo.</p>

        <div className="flex items-center gap-2 pb-6 text-[13px] font-medium text-[#4a5968]">
          <span className="flex h-[22px] items-center gap-1.5 rounded-md border border-[#d5dce3] bg-white px-2">
            <Image src="/login/icon-flask.svg" alt="" width={10} height={10} />
            Data simulasi
          </span>
          <span className="flex h-[22px] items-center gap-1 rounded-md border border-[#d5dce3] bg-[#eef2f5] px-2">
            <span className="size-1.5 rounded-full bg-primary" />
            Mode demo
          </span>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="font-medium">
              Email
            </Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#8a96a3]"
                aria-hidden
              />
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (e.target.value.trim().toLowerCase() === ADMIN_EMAIL) setEmailNotice(null);
                }}
                onBlur={() => {
                  if (email.trim().toLowerCase() !== ADMIN_EMAIL) {
                    setEmailNotice("Versi demo hanya memiliki satu akun: admin@claimguard.demo.");
                  }
                }}
                disabled={pending !== null}
                className="h-10 rounded-lg border-[#d5dce3] bg-white pl-9 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            {emailNotice && (
              <p role="status" className="text-[13px] text-[#4a5968]">
                {emailNotice}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="font-medium">
                Kata sandi tim
              </Label>
              <button
                type="button"
                onClick={() => setForgot(true)}
                className="text-[13px] font-medium text-primary hover:underline"
              >
                Lupa kata sandi?
              </button>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? "password-error" : undefined}
                disabled={pending !== null}
                className="h-10 rounded-lg border-[#d5dce3] bg-white pr-10 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-lg text-[#4a5968] hover:bg-muted"
              >
                {show ? <EyeOff className="size-[18px]" /> : <Image src="/login/icon-eye.svg" alt="" width={18} height={12} />}
              </button>
            </div>
            {error && (
              <p id="password-error" role="alert" className="text-[13px] text-destructive">
                {error}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2.5 pt-0.5 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 rounded-[2.5px] accent-primary"
            />
            Ingat perangkat ini selama 12 jam
          </label>

          <Button
            type="submit"
            disabled={pending !== null}
            className="h-11 w-full rounded-lg text-sm font-semibold"
          >
            {pending === "form" ? "Memeriksa…" : "Masuk"}
            {pending !== "form" && <Image src="/login/icon-arrow.svg" alt="" width={11} height={11} />}
          </Button>

          {canDemo && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void signIn(demoPassword!, "demo")}
              disabled={pending !== null}
              className="h-11 w-full rounded-lg border-[#d5dce3] bg-white text-sm font-semibold text-[#1e2a36]"
            >
              <Play className="size-3.5" aria-hidden />
              {pending === "demo" ? "Menyiapkan demo…" : "Coba sebagai juri (tanpa mengetik)"}
            </Button>
          )}

          <p className="pt-1 text-center text-[13px] text-[#4a5968]">
            Belum punya akses?{" "}
            <button
              type="button"
              onClick={() => setForgot(true)}
              className="font-medium text-primary hover:underline"
            >
              Hubungi PIC teknis tim
            </button>
            .
          </p>
        </div>
      </form>

      <ConfirmDialog
        open={forgot}
        title="Pemulihan kata sandi"
        description={
          <div className="flex flex-col gap-2">
            <p>
              ClaimGuard versi demo memakai satu kata sandi tim yang disimpan sebagai secret
              (<code>DEMO_PASSWORD</code>), bukan akun per pengguna. Karena itu tidak ada
              tautan reset lewat email.
            </p>
            <p>
              Minta kata sandi kepada PIC teknis tim. Untuk menggantinya, perbarui secret
              tersebut lalu deploy ulang backend.
            </p>
          </div>
        }
        confirmLabel="Mengerti"
        onConfirm={() => setForgot(false)}
        onCancel={() => setForgot(false)}
      />
    </>
  );
}
