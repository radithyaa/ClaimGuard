"use client";

import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COURIER_LABEL } from "@/lib/format";

export interface ShipmentFilters {
  q: string;
  status: string;
  courier: string;
}

const ALL = "all";

/** Status dipilih lewat tab di halaman; bar ini hanya pencarian & kurir. */
export function FilterBar({ value, onChange }: { value: ShipmentFilters; onChange: (v: Partial<ShipmentFilters>) => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative sm:w-80">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          placeholder="Cari nomor resi atau kota tujuan"
          aria-label="Cari resi"
          className="h-10 rounded-lg bg-card pl-9"
          value={value.q}
          onChange={(e) => onChange({ q: e.target.value })}
        />
      </div>
      <Select value={value.courier || ALL} onValueChange={(v) => onChange({ courier: v === ALL ? "" : v })}>
        <SelectTrigger className="h-10! rounded-lg bg-card sm:w-40" aria-label="Filter kurir">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Semua kurir</SelectItem>
          {Object.entries(COURIER_LABEL).map(([v, label]) => (
            <SelectItem key={v} value={v}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
