"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { AuditDrawer } from "@/components/settings/audit-drawer";
import { PageHeader } from "@/components/settings/page-header";
import { Select } from "@/components/settings/select";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SettingsBody } from "@/components/settings/settings-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import {
  ENTITY_OPTIONS,
  actionMeta,
  actorKind,
  actorName,
  humanize,
  shortId,
  type AuditCategory,
} from "@/lib/audit";
import { ApiError, fetchAuditLogs, login, type AuditLog } from "@/lib/api";

const LIMIT_OPTIONS = [
  { value: "20", label: "20 catatan terakhir" },
  { value: "50", label: "50 catatan terakhir" },
  { value: "100", label: "100 catatan terakhir" },
];

const FILTERS: Array<"semua" | AuditCategory> = [
  "semua",
  "pelanggaran",
  "keputusan",
  "konfigurasi",
  "data",
  "sistem",
];

const CATEGORY_LABEL: Record<string, string> = {
  semua: "Semua",
  pelanggaran: "Pelanggaran",
  keputusan: "Keputusan",
  konfigurasi: "Konfigurasi",
  data: "Data",
  sistem: "Sistem",
};

type LoadState = "loading" | "ready" | "unauthorized" | "error";

export function AuditLogView() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [detail, setDetail] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  // Pengganti animasi spinner saat memuat: state awal memang "loading" sebelum efek berjalan.
  const [pending, setPending] = useState(false);

  const [category, setCategory] = useState<string>("semua");
  const [entity, setEntity] = useState<string>("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState("50");
  const [loginOpen, setLoginOpen] = useState(false);

  /** `silent` = pemuatan awal: spinner tidak ditampilkan. Dipakai juga oleh tombol Muat ulang. */
  const load = useCallback(
    ({ silent = false }: { silent?: boolean } = {}) => {
      // Sematan state hanya terjadi di callback (bukan sinkron di badan efek).
      function apply(data: AuditLog[]) {
        setLogs(data);
        setState("ready");
        setRefreshedAt(new Date());
      }
      function fail(error: unknown) {
        setState(error instanceof ApiError && error.status === 401 ? "unauthorized" : "error");
      }

      if (!silent) setPending(true);
      // Belum ada paginasi di kontrak API (GET /audit-logs {limit, entity}), filter
      // jenis kejadian & pencarian dilakukan di klien atas halaman terakhir itu.
      return fetchAuditLogs({ limit: Number(limit), entity: entity || undefined })
        .then(apply)
        .catch(fail)
        .finally(() => setPending(false));
    },
    [entity, limit],
  );

  // Pemuatan awal di dalam callback; loader tidak menyentuh state langsung, tetapi kompilator
  // tidak dapat membuktikannya sehingga diagnostik tetap muncul di baris pemanggilan.
  useEffect(() => {
    void load({ silent: true });
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs.filter((log) => {
      const meta = actionMeta(log.action);
      if (category !== "semua" && meta.category !== category) return false;
      if (!needle) return true;
      const haystack = [
        meta.label,
        log.action,
        log.actor,
        log.entity,
        log.entity_id ?? "",
        meta.summarize(log),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [category, logs, query]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of logs) {
      const key = actionMeta(log.action).category;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [logs]);

  const selected = logs.find((log) => log.id === detail) ?? null;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Log audit"
        description="Jejak tindakan agen dan operator: deteksi anomali, keputusan, persetujuan, dan perubahan konfigurasi."
      />

      <div className="flex flex-1 flex-col gap-6 md:flex-row">
        <SettingsNav />

        <SettingsBody>
          <section className="card p-0">
            {/* Filter bar */}
            <div className="flex flex-col gap-3 border-b border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-0 flex-1 sm:max-w-xs">
                  <span className="sr-only">Cari catatan audit</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Cari aksi, pelaku, atau ID"
                    className="field h-9 pl-9 text-sm"
                  />
                  <Icon
                    src="icon-search.svg"
                    className="pointer-events-none absolute left-3 top-2.5 size-3.5"
                  />
                </label>

                <Select
                  label="Kurir/entitas"
                  value={entity || "all"}
                  options={[
                    { value: "all", label: "Semua entitas" },
                    ...ENTITY_OPTIONS.map((item) => ({ value: item, label: humanize(item) })),
                  ]}
                  onChange={(next) => setEntity(next === "all" ? "" : next)}
                  className="w-44"
                />

                <Select
                  label="Jumlah catatan"
                  value={limit}
                  options={LIMIT_OPTIONS}
                  onChange={setLimit}
                  className="w-52"
                />

                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={pending}
                  className="focus-ring ml-auto inline-flex items-center gap-2 rounded-lg border border-field bg-surface px-3 py-2 text-sm font-semibold text-ink transition hover:bg-subtle disabled:cursor-not-allowed disabled:text-ink-faint"
                >
                  <Icon
                    src="icon-scan.svg"
                    className={`size-3.5 ${pending ? "animate-spin" : ""}`}
                  />
                  {pending ? "Memuat…" : "Muat ulang"}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Jenis kejadian">
                {FILTERS.map((key) => {
                  const active = category === key;
                  const count = key === "semua" ? logs.length : (counts.get(key) ?? 0);
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setCategory(key)}
                      className={[
                        "focus-ring rounded-full px-3 py-1 text-[13px] font-medium transition",
                        active
                          ? "bg-brand text-on-brand"
                          : "bg-subtle text-ink-muted hover:text-ink",
                      ].join(" ")}
                    >
                      {CATEGORY_LABEL[key]}
                      <span className={active ? "ml-1.5 text-on-brand/70" : "ml-1.5 text-ink-faint"}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Isi */}
            {state === "unauthorized" ? (
              <EmptyState
                title="Perlu masuk sebagai admin"
                description="Log audit hanya bisa dibaca operator yang sudah masuk. Gunakan password mode demo."
                action={
                  <button
                    type="button"
                    onClick={() => setLoginOpen(true)}
                    className="focus-ring rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-deep"
                  >
                    Masuk sebagai admin
                  </button>
                }
              />
            ) : state === "error" ? (
              <EmptyState
                title="Log audit tidak dapat dimuat"
                description="Server belum merespons. Periksa koneksi lalu coba lagi."
                action={
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="focus-ring rounded-lg border border-field px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle"
                  >
                    Coba lagi
                  </button>
                }
              />
            ) : logs.length === 0 && (state === "loading" || pending) ? (
              <AuditSkeleton />
            ) : filtered.length === 0 ? (
              <EmptyState
                title={logs.length === 0 ? "Belum ada aktivitas" : "Tidak ada yang cocok"}
                description={
                  logs.length === 0
                    ? "Jalankan “Scan Sekarang” atau skenario demo untuk mulai merekam jejak agen."
                    : "Ubah kata kunci, entitas, atau jenis kejadian untuk melihat catatan lain."
                }
                action={
                  logs.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCategory("semua");
                        setEntity("");
                        setQuery("");
                      }}
                      className="focus-ring rounded-lg border border-field px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle"
                    >
                      Hapus filter
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <AuditTable logs={filtered} onOpen={(log) => setDetail(log.id)} />
            )}
          </section>

          <p className="text-[13px] text-ink-muted">
            Menampilkan {filtered.length} dari {logs.length} catatan
            {refreshedAt && ` · diperbarui ${formatClock(refreshedAt)} WIB`}. Catatan
            audit bersifat tambah-saja.
          </p>
        </SettingsBody>
      </div>

      {selected && (
        <AuditDrawer
          log={selected}
          onClose={() => setDetail(null)}
          entityHref={
            selected.entity === "investigation" && selected.entity_id
              ? `/investigations/${selected.entity_id}`
              : null
          }
        />
      )}

      <LoginPrompt
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onDone={() => {
          setLoginOpen(false);
          void load();
        }}
      />
    </div>
  );
}

function AuditTable({
  logs,
  onOpen,
}: {
  logs: AuditLog[];
  onOpen: (log: AuditLog) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[840px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-subtle text-[13px] leading-[18px] text-ink-muted">
            <th scope="col" className="px-4 py-3 font-bold">Waktu</th>
            <th scope="col" className="px-4 py-3 font-bold">Kejadian</th>
            <th scope="col" className="px-4 py-3 font-bold">Pelaku</th>
            <th scope="col" className="px-4 py-3 font-bold">Entitas</th>
            <th scope="col" className="px-4 py-3 font-bold">Ringkasan</th>
            <th scope="col" className="px-4 py-3 text-right font-bold">
              <span className="sr-only">Detail</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => {
            const meta = actionMeta(log.action);
            const kind = actorKind(log.actor);
            return (
              <tr
                key={log.id}
                onClick={() => onOpen(log)}
                className="group cursor-pointer border-b border-line transition last:border-b-0 hover:bg-subtle/70 focus-within:bg-subtle/70"
              >
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  <span className="block text-sm font-medium text-ink">
                    {formatDate(log.created_at)}
                  </span>
                  <span className="block text-[13px] text-ink-muted">
                    {formatClock(new Date(log.created_at))} WIB
                  </span>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-subtle">
                      <Icon src={meta.icon} className="size-3" />
                    </span>
                    <div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(log);
                        }}
                        className="focus-ring rounded text-left text-sm font-semibold text-ink hover:text-brand hover:underline"
                      >
                        {meta.label}
                      </button>
                      <code className="mt-0.5 block text-[11px] leading-[16.5px] text-ink-faint">
                        {log.action}
                      </code>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="inline-flex items-center gap-1.5 text-sm text-ink">
                    {kind === "agen" && (
                      <span className="size-1.5 shrink-0 rounded-full bg-brand" />
                    )}
                    {kind === "agen" ? `Agen · ${actorName(log.actor)}` : actorName(log.actor)}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-[16.5px] text-ink-faint">
                    {log.actor}
                  </span>
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="block text-sm text-ink">{humanize(log.entity)}</span>
                  {log.entity_id && (
                    <span className="mt-0.5 block font-mono text-[11px] leading-[16.5px] text-ink-faint">
                      {shortId(log.entity_id)}
                    </span>
                  )}
                </td>
                <td className="max-w-[280px] px-4 py-3 align-top">
                  <p className="truncate text-[13px] leading-[18px] text-ink-muted" title={meta.summarize(log)}>
                    {meta.summarize(log)}
                  </p>
                </td>
                <td className="px-4 py-3 text-right align-top">
                  <Icon
                    src="icon-arrow-right.svg"
                    className="ml-auto size-2.5 opacity-40 transition group-hover:opacity-100"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-subtle">
        <Icon src="icon-audit.svg" className="size-5" />
      </span>
      <div>
        <p className="text-base font-semibold text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-[21px] text-ink-muted">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function AuditSkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-b-0">
          <span className="h-8 w-24 rounded bg-subtle" />
          <span className="h-4 flex-1 rounded bg-subtle" />
          <span className="h-4 w-32 rounded bg-subtle" />
          <span className="hidden h-4 w-40 rounded bg-subtle sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Mode demo memakai satu password (FR-19); UI meminta ulang saat sesi kedaluwarsa. */
function LoginPrompt({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await login(password);
      setPassword("");
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "invalid_credentials"
          ? "Password salah."
          : "Tidak dapat masuk. Coba lagi.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title="Masuk sebagai admin"
      confirmLabel={pending ? "Memeriksa…" : "Masuk"}
      pending={pending}
      onCancel={onClose}
      onConfirm={() => void submit()}
      description={
        <div className="flex flex-col gap-2">
          <label htmlFor="audit-login" className="field-label">
            Password mode demo
          </label>
          <input
            id="audit-login"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && password) void submit();
            }}
            className="field"
          />
          {error && <p className="text-danger">{error}</p>}
        </div>
      }
    />
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}
