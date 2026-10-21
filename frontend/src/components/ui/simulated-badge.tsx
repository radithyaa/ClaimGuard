import { FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Penanda FR-21: data mock / pengiriman klaim simulasi, tidak pernah tampil sebagai data nyata. */
export function SimulatedBadge({ label = "Data simulasi" }: { label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="gap-1 border-dashed text-muted-foreground" tabIndex={0}>
          <FlaskConical className="size-3" aria-hidden />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>Data ini dibuat untuk demo dan bukan transaksi nyata.</TooltipContent>
    </Tooltip>
  );
}
