import { CheckCircle2, Circle, Loader2, UserRound, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

import type { Step, StepState } from "./derive";

function StateIcon({ state, className }: { state: StepState; className?: string }) {
  const cls = cn("shrink-0", className);
  if (state === "done") return <CheckCircle2 className={cn(cls, "fill-primary text-card")} aria-label="selesai" />;
  if (state === "active") return <Loader2 className={cn(cls, "animate-spin text-primary")} aria-label="berjalan" />;
  if (state === "failed") return <XCircle className={cn(cls, "text-destructive")} aria-label="gagal" />;
  return <Circle className={cn(cls, "text-muted-foreground/50")} aria-label="menunggu" />;
}

export function AgentSteps({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const approval = s.key === "approve" && s.state === "active";
        return (
          <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span className="absolute top-6 bottom-0 left-[11px] w-px bg-border" aria-hidden />}
            {s.key === "approve" ? (
              <UserRound className={cn("size-6 shrink-0", approval ? "text-primary" : "text-muted-foreground/50")} aria-hidden />
            ) : (
              <StateIcon state={s.state} className="size-6" />
            )}
            <div
              className={cn(
                "min-w-0 flex-1",
                approval && "-mt-1 rounded-lg border border-primary/30 bg-accent p-3",
                s.state === "pending" && "text-muted-foreground",
              )}
            >
              <p className={cn("font-medium", (s.state === "active" || approval) && "text-primary")}>{s.title}</p>
              <p className="text-[13px] text-muted-foreground">{s.detail}</p>
              {s.tools && s.tools.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2.5 border-l-2 border-primary/30 pl-4">
                  {s.tools.map((t) => (
                    <li key={t.tool} className="flex items-start gap-2 text-sm">
                      <StateIcon state={t.state} className="mt-0.5 size-4" />
                      <div>
                        <p className={t.state === "active" ? "text-primary" : ""}>{t.tool}</p>
                        {t.durationMs != null && (
                          <p className="text-xs text-muted-foreground">
                            {(t.durationMs / 1000).toFixed(1)} dtk{t.source === "cache" ? " · cache" : ""}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
