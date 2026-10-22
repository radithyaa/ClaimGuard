import type { Outcome, ShipmentResolution } from "@/types/api";

/** Label pihak yang dianggap bersalah setelah investigasi (maks. satu baris). */
export const RESOLUTION: Record<ShipmentResolution, { short: string; long: string; cls: string }> = {
  courier: {
    short: "Kurir",
    long: "Kesalahan di pihak kurir",
    cls: "bg-info/15 text-info",
  },
  seller: {
    short: "Penjual",
    long: "Kesalahan di pihak penjual",
    cls: "bg-warning/20 text-warning-foreground dark:text-warning",
  },
  buyer: {
    short: "Pembeli",
    long: "Ketidaksesuaian dari pembeli",
    cls: "bg-destructive/10 text-destructive",
  },
};

/**
 * Kesimpulan yang *seharusnya* ada pada resi untuk sebuah outcome. `null` = resi tidak boleh
 * diubah (mis. `needs_evidence`) atau belum ada kesimpulan.
 * `claim_drafted` diperlakukan sebagai kurir karena di produksi klaim hanya lahir dari bukti yang
 * membuktikan barang dikemas dengan benar.
 */
export function resolutionOf(outcome: Outcome | null | undefined): ShipmentResolution | null {
  if (outcome === "seller_error") return "seller";
  if (outcome === "fraud_suspect") return "buyer";
  if (outcome === "claim_drafted") return "courier";
  return null;
}
