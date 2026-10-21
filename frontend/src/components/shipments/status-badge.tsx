import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CaseType, Severity, ShipmentStatus } from "@/types/api";

const STATUS: Record<ShipmentStatus, { label: string; className: string }> = {
  created: { label: "Dibuat", className: "bg-muted text-muted-foreground" },
  picked_up: { label: "Dijemput kurir", className: "bg-info/15 text-info" },
  in_transit: { label: "Dalam perjalanan", className: "bg-info/15 text-info" },
  out_for_delivery: { label: "Diantar", className: "bg-info/15 text-info" },
  delivered: { label: "Terkirim", className: "bg-success/15 text-success" },
  returned: { label: "Diretur", className: "bg-warning/20 text-warning-foreground dark:text-warning" },
};

export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, { label }]) => ({ value, label }));

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  const s = STATUS[status] ?? { label: status, className: "bg-muted" };
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", s.className)}>
      {s.label}
    </Badge>
  );
}

export const CASE_LABEL: Record<CaseType, string> = {
  lost: "Tertahan / hilang",
  damaged: "Rusak",
  return_fraud: "Retur mencurigakan",
};

const SEVERITY_CLASS: Record<Severity, string> = {
  high: "bg-destructive text-destructive-foreground",
  medium: "bg-warning text-warning-foreground",
  low: "bg-secondary text-secondary-foreground",
};

export function AnomalyBadge({ caseType, severity }: { caseType: CaseType; severity: Severity }) {
  return (
    <Badge className={cn("gap-1 border-transparent", SEVERITY_CLASS[severity])}>
      <span aria-hidden>⚠</span>
      {CASE_LABEL[caseType]}
      <span className="sr-only">, tingkat {severity}</span>
    </Badge>
  );
}
