"use client";

import { EyeOff } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import { hasSession, safeNext, saveSession } from "@/lib/auth";

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sudah masuk: langsung ke tujuan
  useEffect(() => {
    if (hasSession()) router.replace(safeNext(next));
  }, [router, next]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return setError("Masukkan kata sandi tim.");
    setPending(true);
    setError(null);
    try {
      const { token, expires_in } = await api.auth.login(password);
      saveSession(token, expires_in, remember);
      router.replace(safeNext(next));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Kata sandi salah. Coba lagi."
          : err instanceof Error
            ? err.message
            : "Gagal masuk.",
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-[400px]" noValidate>
      <h2 className="pb-1.5 text-[26px] leading-8 font-semibold">Masuk</h2>
      <p className="pb-4 text-sm text-[#4a5968]">Gunakan kata sandi tim untuk mode demo.</p>

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
        {/* Akun demo tunggal; field ini membantu password manager & aksesibilitas */}
        <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password" className="font-medium">
            Kata sandi tim
          </Label>
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
              disabled={pending}
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

        <Button type="submit" disabled={pending} className="h-11 w-full rounded-lg text-sm font-semibold">
          {pending ? "Memeriksa…" : "Masuk"}
          {!pending && <Image src="/login/icon-arrow.svg" alt="" width={11} height={11} />}
        </Button>

        <p className="pt-1 text-center text-[13px] text-[#4a5968]">
          Lupa kata sandi? <span className="font-medium text-primary">Hubungi PIC teknis tim</span>.
        </p>
      </div>
    </form>
  );
}
