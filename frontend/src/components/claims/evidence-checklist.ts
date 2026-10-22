import type { CaseType, Evidence } from "@/types/api";

export type DocStatus = "met" | "missing" | "manual" | "na";

/**
 * Cocokkan syarat bukti kurir (teks bebas hasil ekstraksi) dengan bukti yang dikumpulkan agen (F4/F8).
 * Aturan sengaja sederhana dan jujur: yang tidak bisa dibuktikan sistem ditandai "manual", bukan dicentang.
 */
export function checkDoc(doc: string, evidence: Evidence[], caseType: CaseType | null): { status: DocStatus; note: string } {
  const d = doc.toLowerCase();
  const has = (kind: Evidence["kind"]) => evidence.some((e) => e.kind === kind);
  if (/rusak|kerusakan/.test(d) && caseType && caseType !== "damaged") {
    return { status: "na", note: "Tidak berlaku untuk kasus ini" };
  }
  if (/resi/.test(d)) return { status: "met", note: "Data resi dan riwayat pelacakan" };
  if (/packing|pengemasan|dikemas/.test(d)) {
    return has("cctv_clip") ? { status: "met", note: "Klip CCTV meja packing" } : { status: "missing", note: "Klip packing belum ada" };
  }
  if (/unboxing|diterima|rusak|kemasan|barang/.test(d) && !/nilai/.test(d)) {
    return has("unboxing") || has("photo")
      ? { status: "met", note: "Media dari pembeli" }
      : { status: "missing", note: "Minta ke pembeli" };
  }
  if (/invoice|nilai|pembelian|faktur/.test(d)) return { status: "manual", note: "Lampirkan dari data pesanan" };
  return { status: "manual", note: "Periksa manual" };
}
