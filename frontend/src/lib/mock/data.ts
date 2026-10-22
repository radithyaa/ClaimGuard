// Data mock frontend. Sumber kebenaran tetap backend/data/mock/shipments.json milik Backend B;
// bila berbeda, samakan berkas ini dengan milik backend (SRS 15.1 "Mock data milik Backend B").
//
// Resi skenario demo (A/B/C1/C2/D) memakai data yang sama dengan shipments.json dan tidak boleh
// diganti ID-nya: skrip investigasi live di investigation.ts mengunci keputusan per resi.
// Resi lainnya murni tambahan tampilan agar tabel, filter, antrian, laporan, dan log audit punya
// variasi yang realistis (status, kurir, jenis kasus, outcome, umur proses, dan sisa tenggat).
import type {
  Anomaly,
  AppSettings,
  AuditLog,
  ClaimDetail,
  ClaimSummary,
  CourierPolicy,
  Outcome,
  ShipmentDetail,
  TrackingEvent,
} from "@/types/api";

const d = (iso: string) => new Date(iso).toISOString();
const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const dateID = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", ...opts }).format(new Date(iso));

/** Jam WIB, untuk narasi klaim. */
const wib = (iso: string) => `${dateID(iso, { day: "numeric", month: "short", year: "numeric" })}, pukul ${dateID(iso, { hour: "2-digit", minute: "2-digit" })} WIB`;


// Bidang detail yang diisi belakangan; tiap resi menyebar objek ini sendiri agar tidak berbagi referensi
const base = {
  is_simulated: true,
  buyer_report: null,
  latest_investigation: null,
  latest_claim: null,
  claim_deadline: null,
  anomaly: null,
  active_anomaly: null,
};

function anomaly(
  id: string,
  shipment_id: string,
  a: Pick<Anomaly, "code" | "case_type" | "severity" | "reason_json"> & Partial<Pick<Anomaly, "detected_at" | "status">>,
): Anomaly {
  return { id, shipment_id, status: "open", detected_at: d("2026-10-21T03:00:00Z"), ...a };
}

/** Event tracking berurutan dengan id deterministic: `te-<resi><huruf>`. */
function ev(tag: string, rows: [string, string, string][]): TrackingEvent[] {
  return rows.map(([status, location, at], i) => ({
    id: `te-${tag}${String.fromCharCode(97 + i)}`,
    status,
    location,
    occurred_at: d(at),
  }));
}

const pair = (a: Anomaly, detected_at: string) => ({
  anomaly: { ...a, detected_at: d(detected_at) },
  active_anomaly: { id: a.id, code: a.code, case_type: a.case_type, severity: a.severity },
});

// ---------------------------------------------------------------------------------------------
// Resi skenario demo (sama dengan backend/data/mock/shipments.json)
// ---------------------------------------------------------------------------------------------

const SCENARIOS: ShipmentDetail[] = [
  {
    // A — paket hilang (SRS 6.1): draf klaim otomatis, butuh persetujuan admin
    ...base,
    id: "shp-001",
    tracking_number: "JNE0012345678",
    courier: "jne",
    status: "in_transit",
    origin: "Bandung",
    destination: "Surabaya",
    shipped_at: d("2026-10-17T03:00:00Z"),
    sla_deadline: d("2026-10-19T03:00:00Z"),
    item_name: "Kaos polos putih (2 pcs)",
    item_value: 149000,
    buyer_report: null,
    tracking_events: ev("001", [
      ["Paket dikemas", "Gudang Bandung", "2026-10-17T01:00:40Z"],
      ["Diserahkan ke kurir", "Bandung", "2026-10-17T03:00:00Z"],
      ["Tiba di hub transit", "Semarang", "2026-10-17T21:30:00Z"],
    ]),
    ...pair(
      anomaly("anm-001", "shp-001", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "medium",
        reason_json: { summary: "Melewati SLA 3 hari tanpa pergerakan sejak hub transit Semarang", days_late: 3 },
      }),
      "2026-10-21T03:00:00Z",
    ),
    latest_investigation: { id: "inv-A", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-21T03:00:10Z") },
    latest_claim: { id: "clm-001", status: "pending_approval" },
  },
  {
    // B — barang rusak: temuan visual + draf klaim, sudah disetujui admin
    ...base,
    id: "shp-002",
    tracking_number: "JT7788990011",
    courier: "jnt",
    status: "delivered",
    origin: "Bandung",
    destination: "Jakarta Selatan",
    shipped_at: d("2026-10-17T04:00:00Z"),
    sla_deadline: d("2026-10-19T04:00:00Z"),
    item_name: "Inhaler (alat bantu pernapasan)",
    item_value: 385000,
    buyer_report:
      "Inhaler retak dan tidak bisa dipakai. Kardus penyok di bagian sudut, bubble wrap-nya sobek. Saya rekam dari kotak masih tertutup.",
    tracking_events: ev("002", [
      ["Paket dikemas", "Gudang Bandung", "2026-10-17T01:01:35Z"],
      ["Diserahkan ke kurir", "Bandung", "2026-10-17T04:00:00Z"],
      ["Tiba di hub transit", "Jakarta", "2026-10-18T02:00:00Z"],
      ["Diterima pembeli", "Jakarta Selatan", "2026-10-18T10:15:00Z"],
    ]),
    ...pair(
      anomaly("anm-002", "shp-002", {
        code: "BUYER_REPORTED_DAMAGE",
        case_type: "damaged",
        severity: "medium",
        reason_json: { summary: "Pembeli melaporkan barang retak dengan video unboxing", matched_keyword: "retak" },
      }),
      "2026-10-19T05:00:00Z",
    ),
    latest_investigation: { id: "inv-B", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-19T05:02:00Z") },
    latest_claim: { id: "clm-002", status: "submitted" },
  },
  {
    // C1 — retur curang: agen menolak mengajukan klaim
    ...base,
    id: "shp-003",
    tracking_number: "SCP5566778899",
    courier: "sicepat",
    status: "returned",
    origin: "Bandung",
    destination: "Yogyakarta",
    shipped_at: d("2026-10-17T04:30:00Z"),
    sla_deadline: d("2026-10-19T04:30:00Z"),
    item_name: "Kaos polos putih, ukuran M",
    item_value: 89000,
    buyer_report: "Warna kaos berbeda dari pesanan; saya pesan putih tapi yang datang merah, minta retur dana.",
    tracking_events: ev("003", [
      ["Paket dikemas", "Gudang Bandung", "2026-10-17T01:02:30Z"],
      ["Diserahkan ke kurir", "Bandung", "2026-10-17T04:30:00Z"],
      ["Diterima pembeli", "Yogyakarta", "2026-10-18T08:00:00Z"],
      ["Retur diajukan", "Yogyakarta", "2026-10-19T02:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-003", "shp-003", {
        code: "RETURN_DISPUTE",
        case_type: "return_fraud",
        severity: "high",
        reason_json: { summary: "Klaim retur bertentangan dengan rekaman packing; segel paket terlihat lakban ganda" },
      }),
      "2026-10-20T09:30:00Z",
    ),
    latest_investigation: { id: "inv-C1", status: "completed", outcome: "fraud_suspect", started_at: d("2026-10-20T09:31:00Z") },
    latest_claim: { id: "clm-009", status: "rejected" },
  },
  {
    // D — resi tertahan tanpa rekaman CCTV, sengaja tidak punya pack scan (SRS 6.5)
    ...base,
    id: "shp-004",
    tracking_number: "JNE0099887766",
    courier: "jne",
    status: "in_transit",
    origin: "Bandung",
    destination: "Medan",
    shipped_at: d("2026-10-16T05:00:00Z"),
    sla_deadline: d("2026-10-20T05:00:00Z"),
    item_name: "Kaos polos 3 pcs",
    item_value: 150000,
    buyer_report: null,
    tracking_events: ev("004", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-16T05:00:00Z"],
      ["Tiba di hub transit", "Jakarta", "2026-10-17T02:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-004", "shp-004", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "medium",
        reason_json: { summary: "Tertahan di hub transit melewati batas SLA; rekaman packing tidak ditemukan" },
      }),
      "2026-10-21T03:00:00Z",
    ),
    latest_investigation: { id: "inv-mock-shp-004", status: "completed", outcome: "needs_evidence", started_at: d("2026-10-20T07:00:00Z") },
    latest_claim: null,
  },
  {
    // C2 — penjual salah kirim -> keputusan seller_error, tidak ada klaim ke kurir.
    // sla_deadline sengaja setelah tanggal demo agar aturan SLA tidak menang lebih dulu.
    ...base,
    id: "shp-011",
    tracking_number: "SCP8899770011",
    courier: "sicepat",
    status: "returned",
    origin: "Bandung",
    destination: "Surabaya",
    shipped_at: d("2026-10-18T03:30:00Z"),
    sla_deadline: d("2026-10-25T03:30:00Z"),
    item_name: "Kaos polos hitam, ukuran L",
    item_value: 95000,
    buyer_report:
      "Saya pesan kaos hitam ukuran L, tapi yang datang kaos merah ukuran M. Warnanya berbeda dari pesanan. Saya minta retur.",
    tracking_events: ev("011", [
      ["Paket dikemas", "Gudang Bandung", "2026-10-17T01:03:30Z"],
      ["Diserahkan ke kurir", "Bandung", "2026-10-18T03:30:00Z"],
      ["Diterima pembeli", "Surabaya", "2026-10-19T07:45:00Z"],
      ["Retur diajukan", "Surabaya", "2026-10-20T01:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-011", "shp-011", {
        code: "RETURN_DISPUTE",
        case_type: "return_fraud",
        severity: "high",
        reason_json: { summary: "Pembeli mengklaim isi paket tidak sesuai; perlu dicocokkan dengan bukti packing" },
      }),
      "2026-10-21T03:00:00Z",
    ),
    latest_investigation: { id: "inv-mock-shp-011", status: "completed", outcome: "seller_error", started_at: d("2026-10-21T04:00:00Z") },
    latest_claim: null,
  },
];

// ---------------------------------------------------------------------------------------------
// Resi sehat (tanpa anomali) — tidak ada yang boleh melewati SLA kurirnya
// ---------------------------------------------------------------------------------------------

const HEALTHY: ShipmentDetail[] = [
  // Belum dijemput, tanpa event tracking (uji empty state timeline)
  {
    ...base,
    id: "shp-010",
    tracking_number: "JNE0011223344",
    courier: "jne",
    status: "created",
    origin: "Bandung",
    destination: "Tangerang",
    shipped_at: d("2026-10-22T05:30:00Z"),
    sla_deadline: d("2026-10-27T05:30:00Z"),
    item_name: "Buku resep nusantara",
    item_value: 95000,
    buyer_report: null,
    tracking_events: [],
  },
  {
    ...base,
    id: "shp-007",
    tracking_number: "JNE0055443322",
    courier: "jne",
    status: "picked_up",
    origin: "Bandung",
    destination: "Malang",
    shipped_at: d("2026-10-21T08:00:00Z"),
    sla_deadline: d("2026-10-28T08:00:00Z"),
    item_name: "Jaket denim",
    item_value: 380000,
    buyer_report: null,
    tracking_events: ev("007", [
      ["Kurir menjemput paket", "Bandung", "2026-10-21T08:00:00Z"],
      ["Paket dibawa ke sortir", "Bandung", "2026-10-21T13:20:00Z"],
    ]),
  },
  {
    ...base,
    id: "shp-018",
    tracking_number: "JT5544332211",
    courier: "jnt",
    status: "created",
    origin: "Bandung",
    destination: "Bandung",
    shipped_at: d("2026-10-22T02:00:00Z"),
    sla_deadline: d("2026-10-24T02:00:00Z"),
    item_name: "Kotak bekal bambu",
    item_value: 72000,
    buyer_report: null,
    tracking_events: ev("018", [["Permintaan pickup diterima", "Bandung", "2026-10-22T02:00:00Z"]]),
  },
  {
    ...base,
    id: "shp-019",
    tracking_number: "SCP1122334455",
    courier: "sicepat",
    status: "picked_up",
    origin: "Bandung",
    destination: "Serang",
    shipped_at: d("2026-10-21T06:00:00Z"),
    sla_deadline: d("2026-10-28T06:00:00Z"),
    item_name: "Pupuk organik 2 kg",
    item_value: 65000,
    buyer_report: null,
    tracking_events: ev("019", [["Dijemput kurir", "Bandung", "2026-10-21T06:00:00Z"]]),
  },
  {
    ...base,
    id: "shp-005",
    tracking_number: "JT1122334455",
    courier: "jnt",
    status: "out_for_delivery",
    origin: "Bandung",
    destination: "Depok",
    shipped_at: d("2026-10-21T02:00:00Z"),
    sla_deadline: d("2026-10-27T02:00:00Z"),
    item_name: "Tas selempang",
    item_value: 320000,
    buyer_report: null,
    tracking_events: ev("005", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-21T02:00:00Z"],
      ["Tiba di hub tujuan", "Bekasi", "2026-10-21T19:00:00Z"],
      ["Kurir menuju alamat", "Depok", "2026-10-22T01:00:00Z"],
    ]),
  },
  {
    ...base,
    id: "shp-020",
    tracking_number: "JNE0066778899",
    courier: "jne",
    status: "out_for_delivery",
    origin: "Bandung",
    destination: "Bandar Lampung",
    shipped_at: d("2026-10-20T03:00:00Z"),
    sla_deadline: d("2026-10-27T03:00:00Z"),
    item_name: "Sepatu lari",
    item_value: 499000,
    buyer_report: null,
    tracking_events: ev("020", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-20T03:00:00Z"],
      ["Tiba di hub transit", "Jakarta", "2026-10-21T04:00:00Z"],
      ["Kurir menuju alamat", "Bandar Lampung", "2026-10-22T02:00:00Z"],
    ]),
  },
  {
    ...base,
    id: "shp-009",
    tracking_number: "SCP9988776655",
    courier: "sicepat",
    status: "in_transit",
    origin: "Bandung",
    destination: "Makassar",
    shipped_at: d("2026-10-21T03:00:00Z"),
    sla_deadline: d("2026-10-30T03:00:00Z"),
    item_name: "Jam tangan",
    item_value: 540000,
    // Kasus negatif: laporan netral (tidak memuat kata kunci rusak/sengketa)
    buyer_report: "Jam sudah diterima dalam kondisi mulus, terima kasih.",
    tracking_events: ev("009", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-21T03:00:00Z"],
      ["Tiba di hub transit", "Surabaya", "2026-10-22T06:15:00Z"],
    ]),
  },
  {
    ...base,
    id: "shp-012",
    tracking_number: "JT5544332212",
    courier: "jnt",
    status: "in_transit",
    origin: "Bandung",
    destination: "Semarang",
    shipped_at: d("2026-10-21T06:00:00Z"),
    sla_deadline: d("2026-10-27T06:00:00Z"),
    item_name: "Sprei katun",
    item_value: 260000,
    buyer_report: null,
    tracking_events: ev("012", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-21T06:00:00Z"],
      ["Tiba di hub transit", "Cirebon", "2026-10-21T21:40:00Z"],
    ]),
  },
  {
    ...base,
    id: "shp-006",
    tracking_number: "SCP1029384756",
    courier: "sicepat",
    status: "delivered",
    origin: "Bandung",
    destination: "Bekasi",
    shipped_at: d("2026-10-19T03:00:00Z"),
    sla_deadline: d("2026-10-21T03:00:00Z"),
    item_name: "Botol minum",
    item_value: 89000,
    buyer_report: "Barang sudah diterima, terima kasih.",
    tracking_events: ev("006", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-19T03:00:00Z"],
      ["Diterima pembeli", "Bekasi", "2026-10-20T06:00:00Z"],
    ]),
    latest_investigation: { id: "inv-006", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-19T04:00:00Z") },
    latest_claim: { id: "clm-004", status: "submitted" },
  },
  {
    ...base,
    id: "shp-008",
    tracking_number: "JT6677889900",
    courier: "jnt",
    status: "delivered",
    origin: "Bandung",
    destination: "Bogor",
    shipped_at: d("2026-10-18T05:00:00Z"),
    sla_deadline: d("2026-10-20T05:00:00Z"),
    item_name: "Lampu meja",
    item_value: 210000,
    buyer_report: null,
    tracking_events: ev("008", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-18T05:00:00Z"],
      ["Diterima pembeli", "Bogor", "2026-10-19T09:00:00Z"],
    ]),
    latest_investigation: { id: "inv-008", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-18T06:30:00Z") },
    latest_claim: { id: "clm-003", status: "submitted" },
  },
  {
    ...base,
    id: "shp-013",
    tracking_number: "SCP2233445566",
    courier: "sicepat",
    status: "delivered",
    origin: "Bandung",
    destination: "Cirebon",
    shipped_at: d("2026-10-19T02:00:00Z"),
    sla_deadline: d("2026-10-21T02:00:00Z"),
    item_name: "Mug custom",
    item_value: 175000,
    // Kasus negatif: "pecah" muncul dalam konteks aman
    buyer_report: "Mug sampai dalam keadaan baik, tidak ada yang pecah. Dikemas rapi.",
    tracking_events: ev("013", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-19T02:00:00Z"],
      ["Diterima pembeli", "Cirebon", "2026-10-20T04:00:00Z"],
    ]),
    latest_investigation: { id: "inv-013", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-19T03:10:00Z") },
    latest_claim: { id: "clm-008", status: "rejected" },
  },
  {
    ...base,
    id: "shp-021",
    tracking_number: "JNE0077889900",
    courier: "jne",
    status: "delivered",
    origin: "Bandung",
    destination: "Sukabumi",
    shipped_at: d("2026-10-19T02:00:00Z"),
    sla_deadline: d("2026-10-21T02:00:00Z"),
    item_name: "Kaos polos 2 pcs",
    item_value: 130000,
    buyer_report: "Barang sudah diterima, sesuai pesanan, terima kasih.",
    tracking_events: ev("021", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-19T02:00:00Z"],
      ["Diterima pembeli", "Sukabumi", "2026-10-20T06:00:00Z"],
    ]),
  },
  {
    ...base,
    id: "shp-022",
    tracking_number: "JT3322110099",
    courier: "jnt",
    status: "delivered",
    // Dikirim 15 Okt, sampai 21 Okt: tenggat J&T (7 hari) jatuh 28 Okt
    origin: "Bandung",
    destination: "Padang",
    shipped_at: d("2026-10-15T04:00:00Z"),
    sla_deadline: d("2026-10-22T04:00:00Z"),
    item_name: "Tas laptop 14 inci",
    item_value: 315000,
    buyer_report: null,
    tracking_events: ev("022", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-15T04:00:00Z"],
      ["Tiba di hub transit", "Jakarta", "2026-10-16T03:00:00Z"],
      ["Diterima pembeli", "Padang", "2026-10-21T07:30:00Z"],
    ]),
    latest_investigation: { id: "inv-022", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-17T08:00:00Z") },
    latest_claim: { id: "clm-010", status: "pending_approval" },
  },
  {
    ...base,
    id: "shp-023",
    tracking_number: "SCP7788001122",
    courier: "sicepat",
    status: "delivered",
    origin: "Bandung",
    destination: "Solo",
    shipped_at: d("2026-10-18T07:00:00Z"),
    sla_deadline: d("2026-10-20T07:00:00Z"),
    item_name: "Tumbler stainless",
    item_value: 135000,
    buyer_report: null,
    tracking_events: ev("023", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-18T07:00:00Z"],
      ["Diterima pembeli", "Solo", "2026-10-19T08:00:00Z"],
    ]),
  },
  {
    ...base,
    id: "shp-024",
    tracking_number: "JNE0044556677",
    courier: "jne",
    status: "delivered",
    origin: "Bandung",
    destination: "Balikpapan",
    shipped_at: d("2026-10-16T02:00:00Z"),
    sla_deadline: d("2026-10-22T02:00:00Z"),
    item_name: "Keyboard mekanis",
    item_value: 685000,
    // Kasus negatif: "rusak" muncul dalam konteks aman
    buyer_report: "Keyboard sampai selamat, tidak ada tombol yang rusak.",
    tracking_events: ev("024", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-16T02:00:00Z"],
      ["Tiba di hub transit", "Jakarta", "2026-10-16T16:30:00Z"],
      ["Diterima pembeli", "Balikpapan", "2026-10-20T05:00:00Z"],
    ]),
    latest_investigation: { id: "inv-024", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-17T02:00:00Z") },
    latest_claim: { id: "clm-013", status: "submitted" },
  },
  {
    ...base,
    id: "shp-025",
    tracking_number: "JT9988774455",
    courier: "jnt",
    status: "delivered",
    origin: "Bandung",
    destination: "Palembang",
    shipped_at: d("2026-10-18T06:00:00Z"),
    sla_deadline: d("2026-10-21T06:00:00Z"),
    item_name: "Kemeja flanel",
    item_value: 245000,
    buyer_report: null,
    tracking_events: ev("025", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-18T06:00:00Z"],
      ["Diterima pembeli", "Palembang", "2026-10-20T02:00:00Z"],
    ]),
  },
  {
    ...base,
    id: "shp-030",
    tracking_number: "JNE0088990011",
    courier: "jne",
    status: "in_transit",
    origin: "Bandung",
    destination: "Kupang",
    shipped_at: d("2026-10-19T03:00:00Z"),
    sla_deadline: d("2026-10-26T03:00:00Z"),
    item_name: "Dokumen kontrak (amplop cokelat)",
    item_value: 0,
    buyer_report: null,
    tracking_events: ev("030", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-19T03:00:00Z"],
      ["Tiba di hub transit", "Denpasar", "2026-10-21T11:00:00Z"],
    ]),
    latest_investigation: { id: "inv-030", status: "completed", outcome: "needs_evidence", started_at: d("2026-10-20T02:00:00Z") },
  },
  {
    // Lebih dari 10 hari kerja: tetap terbuka, tetapi tenggat klaimnya sudah lewat
    ...base,
    id: "shp-031",
    tracking_number: "SCP6677889911",
    courier: "sicepat",
    status: "in_transit",
    origin: "Bandung",
    destination: "Manado",
    shipped_at: d("2026-10-08T03:00:00Z"),
    sla_deadline: d("2026-10-15T03:00:00Z"),
    item_name: "Kamera aksi",
    item_value: 1450000,
    buyer_report: null,
    tracking_events: ev("031", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-08T03:00:00Z"],
      ["Tiba di hub transit", "Makassar", "2026-10-10T05:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-031", "shp-031", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "medium",
        reason_json: { summary: "Terhenti di hub Makassar lebih dari 10 hari", days_late: 10 },
      }),
      "2026-10-15T05:00:00Z",
    ),
    latest_investigation: { id: "inv-031", status: "failed", outcome: null, started_at: d("2026-10-15T06:00:00Z") },
  },
];

// ---------------------------------------------------------------------------------------------
// Resi beranomali — variasi kondisi, keputusan, dan status proses
// ---------------------------------------------------------------------------------------------

const ANOMALY_CASES: ShipmentDetail[] = [
  // Paket hilang bernilai tinggi: draf menunggu keputusan, direvisi admin (ada catatan draf)
  {
    ...base,
    id: "shp-014",
    tracking_number: "JNE0033445566",
    courier: "jne",
    status: "in_transit",
    origin: "Bandung",
    destination: "Pekanbaru",
    shipped_at: d("2026-10-14T04:00:00Z"),
    sla_deadline: d("2026-10-20T04:00:00Z"),
    item_name: "Laptop kantor 14 inci",
    item_value: 9500000,
    buyer_report: null,
    tracking_events: ev("014", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-14T04:00:00Z"],
      ["Tiba di hub transit", "Jakarta", "2026-10-15T05:20:00Z"],
      ["Diterima di hub tujuan", "Pekanbaru", "2026-10-17T09:45:00Z"],
      ["Dompet hilang setelah unload", "Pekanbaru", "2026-10-17T11:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-014", "shp-014", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "high",
        reason_json: { summary: "Berhenti diproses pasca-unload Pekanbaru; belum ada laporan pembeli" },
      }),
      "2026-10-20T06:00:00Z",
    ),
    latest_investigation: { id: "inv-014", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-20T06:10:00Z") },
    latest_claim: { id: "clm-015", status: "pending_approval" },
  },
  // Pembeli menuduh isi kurang, CCTV menunjukkan yang sebaliknya
  // Paket dikirim 19 Okt (belum dikemas) supaya CCTV mengungkap ketidaksesuaian isi.
  // Diterima 21 Okt 09:10 WIB; J&T 7 hari -> tenggat 28 Okt
  {
    ...base,
    id: "shp-015",
    tracking_number: "JT8833221100",
    courier: "jnt",
    status: "returned",
    origin: "Bandung",
    destination: "Pontianak",
    shipped_at: d("2026-10-19T02:00:00Z"),
    sla_deadline: d("2026-10-25T02:00:00Z"),
    item_name: "Kotak kosmetik 5 pcs",
    item_value: 365000,
    buyer_report: "Isi kotak hanya 2 dari 5 produk yang saya pesan, sisanya kosong. Mohon retur.",
    tracking_events: ev("015", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-19T02:00:00Z"],
      ["Diterima pembeli", "Pontianak", "2026-10-21T09:10:00Z"],
      ["Retur diajukan", "Pontianak", "2026-10-21T12:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-015", "shp-015", {
        code: "RETURN_DISPUTE",
        case_type: "return_fraud",
        severity: "medium",
        reason_json: { summary: "Laporan isi kurang; log packing mencatat 5 item saat dikemas" },
      }),
      "2026-10-21T12:05:00Z",
    ),
    latest_investigation: { id: "inv-015", status: "completed", outcome: "fraud_suspect", started_at: d("2026-10-21T12:10:00Z") },
    latest_claim: { id: "clm-016", status: "rejected" },
  },
  // Klaim isi kosong ditolak: rekaman packing menunjukkan barang dimasukkan
  {
    ...base,
    id: "shp-041",
    tracking_number: "JT5511229933",
    courier: "jnt",
    status: "returned",
    origin: "Bandung",
    destination: "Cilegon",
    shipped_at: d("2026-10-13T02:00:00Z"),
    sla_deadline: d("2026-10-19T02:00:00Z"),
    item_name: "Tempat pensil kanvas",
    item_value: 65000,
    buyer_report: "Hanya menerima isi kosong.",
    tracking_events: ev("041", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-13T02:00:00Z"],
      ["Diterima pembeli", "Cilegon", "2026-10-15T07:00:00Z"],
      ["Retur diajukan", "Cilegon", "2026-10-16T02:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-042", "shp-041", {
        code: "RETURN_DISPUTE",
        case_type: "return_fraud",
        severity: "low",
        reason_json: { summary: "Isi kosong; belum ada bukti segel utuh dari pembeli" },
      }),
      "2026-10-16T03:00:00Z",
    ),
    latest_investigation: { id: "inv-041", status: "completed", outcome: "fraud_suspect", started_at: d("2026-10-16T03:10:00Z") },
    latest_claim: { id: "clm-020", status: "rejected" },
  },
  // Isi kosong dengan nomor resi baru: inbox klaim tanpa laporan
  {
    ...base,
    id: "shp-042",
    tracking_number: "SCP0099887711",
    courier: "sicepat",
    status: "returned",
    origin: "Bandung",
    destination: "Ciamis",
    shipped_at: d("2026-10-18T02:00:00Z"),
    sla_deadline: d("2026-10-25T02:00:00Z"),
    item_name: "Peralatan timbang dapur",
    item_value: 165000,
    buyer_report: null,
    tracking_events: ev("042", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-18T02:00:00Z"],
      ["Diterima pembeli", "Ciamis", "2026-10-20T07:00:00Z"],
      ["Retur diajukan", "Ciamis", "2026-10-21T02:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-043", "shp-042", {
        code: "RETURN_DISPUTE",
        case_type: "return_fraud",
        severity: "low",
        reason_json: { summary: "Retur tanpa laporan pembeli; isi paket perlu dihitung ulang di gudang" },
      }),
      "2026-10-21T03:00:00Z",
    ),
  },
  // Botol pecah: temuan visual tingkat kritis, draf klaim siap ditinjau
  {
    ...base,
    id: "shp-016",
    tracking_number: "SCP3344556677",
    courier: "sicepat",
    status: "delivered",
    origin: "Bandung",
    destination: "Jambi",
    shipped_at: d("2026-10-16T03:00:00Z"),
    sla_deadline: d("2026-10-20T03:00:00Z"),
    item_name: "Botol parfum 100 ml",
    item_value: 780000,
    buyer_report: "Botol pecah dan isinya membasahi kardus. Ada rekaman dari kotak masih tersegel.",
    tracking_events: ev("016", [
      ["Paket dikemas", "Gudang Bandung", "2026-10-16T01:06:00Z"],
      ["Diserahkan ke kurir", "Bandung", "2026-10-16T03:00:00Z"],
      ["Diterima pembeli", "Jambi", "2026-10-18T14:20:00Z"],
    ]),
    ...pair(
      anomaly("anm-016", "shp-016", {
        code: "BUYER_REPORTED_DAMAGE",
        case_type: "damaged",
        severity: "high",
        reason_json: { summary: "Peti kayu pecah; kardus basah dan bercak cairan", matched_keyword: "pecah" },
      }),
      "2026-10-18T15:00:00Z",
    ),
    latest_investigation: { id: "inv-016", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-18T15:10:00Z") },
    latest_claim: { id: "clm-017", status: "pending_approval" },
  },
  // Klaim ditolak admin: rekaman packing sudah lewat masa simpan
  {
    ...base,
    id: "shp-017",
    tracking_number: "JNE0011229999",
    courier: "jne",
    status: "delivered",
    origin: "Bandung",
    destination: "Samarinda",
    shipped_at: d("2026-10-12T02:00:00Z"),
    sla_deadline: d("2026-10-18T02:00:00Z"),
    item_name: "Kaca film depan laptop 15 inci",
    item_value: 265000,
    buyer_report: null,
    tracking_events: ev("017", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-12T02:00:00Z"],
      ["Tiba di hub transit", "Surabaya", "2026-10-13T06:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-017", "shp-017", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "medium",
        reason_json: { summary: "Kemajuan berhenti setelah hub Surabaya; rekaman packing sudah dihapus", retention_note: "rekaman > 30 hari" },
      }),
      "2026-10-18T03:00:00Z",
    ),
    latest_investigation: { id: "inv-017", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-18T03:20:00Z") },
    latest_claim: { id: "clm-018", status: "rejected" },
  },
  // Laporan pembeli masuk sebelum SLA: aturan laporan menang atas SLA
  {
    ...base,
    id: "shp-029",
    tracking_number: "JT6677881122",
    courier: "jnt",
    status: "delivered",
    origin: "Bandung",
    destination: "Kediri",
    shipped_at: d("2026-10-20T03:00:00Z"),
    sla_deadline: d("2026-10-26T03:00:00Z"),
    item_name: "Layar monitor 24 inci",
    item_value: 1250000,
    buyer_report: "Layar pecah di sudut kanan. Kardus tidak ada foam tambahan.",
    tracking_events: ev("029", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-20T03:00:00Z"],
      ["Diterima pembeli", "Kediri", "2026-10-21T09:10:00Z"],
    ]),
    ...pair(
      anomaly("anm-029", "shp-029", {
        code: "BUYER_REPORTED_DAMAGE",
        case_type: "damaged",
        severity: "medium",
        reason_json: { summary: "Layar pecah dilaporkan; menunggu inspeksi visual CCTV", matched_keyword: "pecah" },
      }),
      "2026-10-21T09:15:00Z",
    ),
    latest_investigation: { id: "inv-029", status: "running", outcome: null, started_at: d("2026-10-21T09:20:00Z") },
  },
  // Butuh bukti tambahan: UNPAK hilang di hub, tidak ada rekaman
  {
    ...base,
    id: "shp-032",
    tracking_number: "JNE0055667799",
    courier: "jne",
    status: "in_transit",
    origin: "Bandung",
    destination: "Banda Aceh",
    shipped_at: d("2026-10-15T02:00:00Z"),
    sla_deadline: d("2026-10-23T02:00:00Z"),
    item_name: "Alat musik kalimba",
    item_value: 425000,
    buyer_report: null,
    tracking_events: ev("032", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-15T02:00:00Z"],
      ["Tiba di hub transit", "Medan", "2026-10-16T04:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-032", "shp-032", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "low",
        reason_json: { summary: "Letak tidak mendukung; hanya ada bukti serah terima kurir" },
      }),
      "2026-10-16T06:00:00Z",
    ),
    latest_investigation: { id: "inv-032", status: "completed", outcome: "needs_evidence", started_at: d("2026-10-16T06:30:00Z") },
  },
  // Gagal di tengah investigasi: tiket klaim harus bisa dibuka admin
  {
    ...base,
    id: "shp-033",
    tracking_number: "SCP5566771188",
    courier: "sicepat",
    status: "returned",
    origin: "Bandung",
    destination: "Madiun",
    shipped_at: d("2026-10-13T03:00:00Z"),
    sla_deadline: d("2026-10-20T03:00:00Z"),
    item_name: "Sepatu basket ukuran 43",
    item_value: 890000,
    buyer_report: "Saya minta retur karena ukuran tidak sesuai. Sudah kirim balik lewat kurir.",
    tracking_events: ev("033", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-13T03:00:00Z"],
      ["Tiba di hub transit", "Surabaya", "2026-10-14T08:00:00Z"],
      ["Diterima pembeli", "Madiun", "2026-10-16T11:00:00Z"],
      ["Retur dikirim", "Madiun", "2026-10-18T02:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-033", "shp-033", {
        code: "RETURN_DISPUTE",
        case_type: "return_fraud",
        severity: "high",
        reason_json: { summary: "Retur dikirim balik tanpa foto segel; perlu pemeriksaan fisik" },
      }),
      "2026-10-18T04:00:00Z",
    ),
    latest_investigation: { id: "inv-033", status: "failed", outcome: null, started_at: d("2026-10-18T04:05:00Z") },
  },
  // Belum ditangani sama sekali: kasus lama yang menunggu diproses
  {
    ...base,
    id: "shp-034",
    tracking_number: "JT7766554433",
    courier: "jnt",
    status: "in_transit",
    origin: "Bandung",
    destination: "Kendari",
    shipped_at: d("2026-10-10T03:00:00Z"),
    sla_deadline: d("2026-10-17T03:00:00Z"),
    item_name: "Blender tangan",
    item_value: 210000,
    buyer_report: null,
    tracking_events: ev("034", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-10T03:00:00Z"],
      ["Tiba di hub transit", "Makassar", "2026-10-12T09:30:00Z"],
    ]),
    ...pair(
      anomaly("anm-034", "shp-034", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "low",
        reason_json: { summary: "Tertahan 5 hari di Makassar tanpa update; prioritas rendah", days_late: 5 },
      }),
      "2026-10-19T02:00:00Z",
    ),
  },
  // Anomali sedang diperiksa: laporan rusak hari ini, investigasi masih berjalan
  {
    ...base,
    id: "shp-035",
    tracking_number: "JNE0099331122",
    courier: "jne",
    status: "delivered",
    origin: "Bandung",
    destination: "Klaten",
    shipped_at: d("2026-10-19T03:00:00Z"),
    sla_deadline: d("2026-10-25T03:00:00Z"),
    item_name: "Gitar akustik",
    item_value: 1890000,
    buyer_report: "Body gitar retak memanjang, suaranya sumbang. Ada video unboxing lengkap.",
    tracking_events: ev("035", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-19T03:00:00Z"],
      ["Diterima pembeli", "Klaten", "2026-10-21T01:30:00Z"],
    ]),
    ...pair(
      anomaly("anm-036", "shp-035", {
        code: "BUYER_REPORTED_DAMAGE",
        case_type: "damaged",
        severity: "high",
        reason_json: { summary: "Kemasan tanpa hard case; butuh konfirmasi packing", matched_keyword: "retak" },
        status: "investigating",
      }),
      "2026-10-21T01:40:00Z",
    ),
  },
  // Tepat di ambang: keterlambatan beberapa jam, masih dalam toleransi
  {
    ...base,
    id: "shp-036",
    tracking_number: "JT4400112233",
    courier: "jnt",
    status: "in_transit",
    origin: "Bandung",
    destination: "Banjarmasin",
    shipped_at: d("2026-10-17T05:00:00Z"),
    sla_deadline: d("2026-10-24T05:00:00Z"),
    item_name: "Jaket bulu (bulky)",
    item_value: 410000,
    buyer_report: null,
    tracking_events: ev("036", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-17T05:00:00Z"],
      ["Tiba di hub transit", "Surabaya", "2026-10-19T02:00:00Z"],
      ["Diterima di hub tujuan", "Banjarmasin", "2026-10-22T01:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-038", "shp-036", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "low",
        reason_json: { summary: "Tenggat 21 Okt 07:00 WIB, toleransi 2 jam dipending", hours_late: 2 },
        status: "resolved",
      }),
      "2026-10-22T01:10:00Z",
    ),
    latest_investigation: { id: "inv-036", status: "completed", outcome: "seller_error", started_at: d("2026-10-22T01:20:00Z") },
  },
  // Resi sudah dikembalikan ke penjual lewat retur sah setelah salah kirim
  {
    ...base,
    id: "shp-037",
    tracking_number: "SCP9900115544",
    courier: "sicepat",
    status: "returned",
    origin: "Bandung",
    destination: "Tegal",
    shipped_at: d("2026-10-17T01:00:00Z"),
    sla_deadline: d("2026-10-24T01:00:00Z"),
    item_name: "Kipas angin meja",
    item_value: 185000,
    buyer_report: null,
    tracking_events: ev("037", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-17T01:00:00Z"],
      ["Diterima pembeli", "Tegal", "2026-10-19T04:00:00Z"],
      ["Retur diterima gudang", "Bandung", "2026-10-21T05:00:00Z"],
    ]),
    latest_investigation: { id: "inv-037", status: "cancelled", outcome: null, started_at: d("2026-10-19T05:00:00Z") },
  },
  // Satu lagi retur dengan laporan hanya berupa selisih warna (kasus negatif)
  {
    ...base,
    id: "shp-038",
    tracking_number: "JNE0011778822",
    courier: "jne",
    status: "returned",
    origin: "Bandung",
    destination: "Purwokerto",
    shipped_at: d("2026-10-14T03:00:00Z"),
    sla_deadline: d("2026-10-20T03:00:00Z"),
    item_name: "Dompet kulit",
    item_value: 220000,
    buyer_report: "Warna dompet lebih gelap dari foto. Saya sudah pakai 2 hari.",
    tracking_events: ev("038", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-14T03:00:00Z"],
      ["Diterima pembeli", "Purwokerto", "2026-10-17T08:00:00Z"],
      ["Retur diajukan", "Purwokerto", "2026-10-18T09:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-039", "shp-038", {
        code: "RETURN_DISPUTE",
        case_type: "return_fraud",
        severity: "medium",
        reason_json: { summary: "Retur sudah dipakai 2 hari; cek kondisi sebelum restock" },
        status: "resolved",
      }),
      "2026-10-18T09:30:00Z",
    ),
    latest_investigation: { id: "inv-038", status: "completed", outcome: "seller_error", started_at: d("2026-10-18T09:40:00Z") },
  },
  // Pembeli berulang kali klaim isi kosong: pola akun
  {
    ...base,
    id: "shp-039",
    tracking_number: "JNE0088664422",
    courier: "jne",
    status: "returned",
    origin: "Bandung",
    destination: "Sidoarjo",
    shipped_at: d("2026-10-11T02:00:00Z"),
    sla_deadline: d("2026-10-16T02:00:00Z"),
    item_name: "Hard disk eksternal 2 TB",
    item_value: 1150000,
    buyer_report: "Kotak saya terima kosong, hanya bubble wrap. Ini sudah keempat kali terjadi.",
    tracking_events: ev("039", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-11T02:00:00Z"],
      ["Diterima pembeli", "Sidoarjo", "2026-10-13T03:00:00Z"],
      ["Retur diajukan", "Sidoarjo", "2026-10-14T01:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-040", "shp-039", {
        code: "RETURN_DISPUTE",
        case_type: "return_fraud",
        severity: "high",
        reason_json: { summary: "Pola klaim berulang; segel paket terlihat utuh di CCTV" },
      }),
      "2026-10-14T02:00:00Z",
    ),
    latest_investigation: { id: "inv-039", status: "completed", outcome: "fraud_suspect", started_at: d("2026-10-14T02:10:00Z") },
    latest_claim: { id: "clm-019", status: "rejected" },
  },
  // Nominal Rp0 dan tanpa rekaman: butuh bukti, bukan klaim
  {
    ...base,
    id: "shp-040",
    tracking_number: "JNE0044006688",
    courier: "jne",
    status: "delivered",
    origin: "Bandung",
    destination: "Singaraja",
    shipped_at: d("2026-10-18T01:00:00Z"),
    sla_deadline: d("2026-10-25T01:00:00Z"),
    item_name: "Sampel produk (tanpa nilai jual)",
    item_value: 0,
    buyer_report: null,
    tracking_events: ev("040", [
      ["Dibuat", "Bandung", "2026-10-18T02:00:00Z"],
      ["Diterima pembeli", "Singaraja", "2026-10-21T04:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-041", "shp-040", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "low",
        reason_json: {
          summary: "Paket sample tercatat di area unload tetapi tidak pernah di-scan terima",
          note: "lokasi fisik terakhir: tidak terpindai unload",
        },
      }),
      "2026-10-21T05:00:00Z",
    ),
    latest_investigation: { id: "inv-040", status: "completed", outcome: "needs_evidence", started_at: d("2026-10-21T05:10:00Z") },
  },
  // Anomali diperingatkan menjelang tenggat klaim (F2)
  {
  // Tenggat tinggal < 24 jam (urgensi "kritis"): harus muncul paling atas di antrian (F2)
  ...base,
  id: "shp-026",
  tracking_number: "SCP4455667788",
  courier: "sicepat",
  status: "delivered",
  origin: "Bandung",
  destination: "Lubuk Linggau",
  shipped_at: d("2026-10-14T04:00:00Z"),
  sla_deadline: d("2026-10-18T04:00:00Z"),
  item_name: "Kamera mirrorless bekas",
  item_value: 5200000,
  buyer_report: null,
  tracking_events: ev("026", [
    ["Diserahkan ke kurir", "Bandung", "2026-10-14T04:00:00Z"],
    ["Tiba di hub transit", "Jakarta", "2026-10-15T05:00:00Z"],
  ]),
  ...pair(
    anomaly("anm-026", "shp-026", {
      code: "SLA_EXCEEDED",
      case_type: "lost",
      severity: "high",
      // Terakhir terpindai 14 Okt: tenggat SiCepat (10 hari) jatuh 24 Okt, sengaja < 24 jam dari tanggal demo
      reason_json: { summary: "Tidak ada pergerakan 4 hari setelah hub transit Jakarta", days_late: 4 },
    }),
    "2026-10-18T06:00:00Z",
  ),
  latest_investigation: { id: "inv-026", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-18T06:30:00Z") },
  latest_claim: { id: "clm-011", status: "pending_approval" },
  },
  // Tenggat klaim tinggal < 72 jam (urgensi "segera")
  {
    ...base,
    id: "shp-043",
    tracking_number: "JT0099776611",
    courier: "jnt",
    status: "delivered",
    origin: "Bandung",
    destination: "Bengkulu",
    shipped_at: d("2026-10-13T02:00:00Z"),
    sla_deadline: d("2026-10-19T02:00:00Z"),
    item_name: "Lampu gantung rotan",
    item_value: 390000,
    buyer_report: null,
    tracking_events: ev("043", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-13T02:00:00Z"],
      ["Tiba di hub transit", "Jakarta", "2026-10-14T04:00:00Z"],
      ["Diterima pembeli", "Bengkulu", "2026-10-18T22:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-044", "shp-043", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "medium",
        reason_json: { summary: "Sampai ke tujuan setelah lewat SLA J&T; sudah ada tanda terima", days_late: 1 },
        status: "resolved",
      }),
      "2026-10-19T03:00:00Z",
    ),
    latest_investigation: { id: "inv-043", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-19T03:20:00Z") },
    latest_claim: { id: "clm-021", status: "pending_approval" },
  },
  // Tenggat klaim sudah lewat: draf lama yang belum sempat disetujui
  {
    ...base,
    id: "shp-027",
    tracking_number: "JT2255880099",
    courier: "jnt",
    status: "delivered",
    origin: "Bandung",
    destination: "Ambon",
    shipped_at: d("2026-10-14T02:00:00Z"),
    sla_deadline: d("2026-10-18T02:00:00Z"),
    item_name: "Kotak perhiasan kayu",
    item_value: 480000,
    buyer_report: null,
    tracking_events: ev("027", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-14T02:00:00Z"],
      ["Tiba di hub transit", "Surabaya", "2026-10-15T06:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-027", "shp-027", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "high",
        reason_json: { summary: "Paket macet di hub Surabaya melewati batas SLA J&T", days_late: 3 },
      }),
      "2026-10-18T03:00:00Z",
    ),
    latest_investigation: { id: "inv-027", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-18T03:15:00Z") },
    latest_claim: { id: "clm-012", status: "pending_approval" },
  },
  // Sudah pernah diputuskan: klaim lama ditolak admin karena bukti kurang
  {
    ...base,
    id: "shp-028",
    tracking_number: "JNE0022113344",
    courier: "jne",
    status: "delivered",
    origin: "Bandung",
    destination: "Mataram",
    shipped_at: d("2026-10-11T03:00:00Z"),
    sla_deadline: d("2026-10-15T03:00:00Z"),
    item_name: "Rak buku mini",
    item_value: 340000,
    buyer_report: null,
    tracking_events: ev("028", [
      ["Diserahkan ke kurir", "Bandung", "2026-10-11T03:00:00Z"],
      ["Tiba di hub transit", "Surabaya", "2026-10-12T09:00:00Z"],
    ]),
    ...pair(
      anomaly("anm-028", "shp-028", {
        code: "SLA_EXCEEDED",
        case_type: "lost",
        severity: "medium",
        reason_json: { summary: "Terhenti di hub Surabaya, rekaman packing tidak terbaca jelas" },
      }),
      "2026-10-15T09:00:00Z",
    ),
    latest_investigation: { id: "inv-028", status: "completed", outcome: "claim_drafted", started_at: d("2026-10-15T09:30:00Z") },
    latest_claim: { id: "clm-014", status: "rejected" },
  },
];

export const shipments: ShipmentDetail[] = [...SCENARIOS, ...HEALTHY, ...ANOMALY_CASES];

export const policies: CourierPolicy[] = [
  {
    courier: "jne",
    claim_window_days: 14,
    required_docs: ["Foto resi", "Video packing", "Bukti nilai barang"],
    max_compensation: "Maks. 10x ongkir atau nilai barang bila diasuransikan",
    extra: {},
    source: "manual",
    extracted_at: d("2026-10-21T02:00:00Z"),
  },
  {
    courier: "jnt",
    claim_window_days: 7,
    required_docs: ["Foto kemasan", "Video unboxing", "Invoice"],
    max_compensation: "Maks. Rp1.000.000 tanpa asuransi",
    extra: {},
    source: "manual",
    extracted_at: d("2026-10-21T02:00:00Z"),
  },
  {
    courier: "sicepat",
    claim_window_days: 10,
    required_docs: ["Foto resi", "Video unboxing", "Foto barang rusak"],
    max_compensation: "Maks. 10x ongkir",
    extra: {},
    source: "manual",
    extracted_at: d("2026-10-21T02:00:00Z"),
  },
];

// ---------------------------------------------------------------------------------------------
// Klaim: antrian keputusan, riwayat, dan klaim yang tenggatnya sudah lewat
// ---------------------------------------------------------------------------------------------

const claim = (
  id: string,
  shipment_id: string,
  status: ClaimSummary["status"],
  confidence: number | null,
  claim_value: number,
  created_at: string,
  case_type: ClaimSummary["case_type"],
): ClaimSummary => {
  const s = shipments.find((x) => x.id === shipment_id)!;
  return {
    id,
    shipment_id,
    tracking_number: s.tracking_number,
    courier: s.courier,
    status,
    confidence,
    claim_value,
    created_at: d(created_at),
    is_simulated: true,
    case_type,
    claim_deadline: null,
  };
};

export const claims: ClaimSummary[] = [
  claim("clm-001", "shp-001", "pending_approval", 0.86, 149000, "2026-10-21T03:05:00Z", "lost"),
  claim("clm-002", "shp-002", "submitted", 0.91, 385000, "2026-10-19T05:12:00Z", "damaged"),
  claim("clm-003", "shp-008", "submitted", 0.84, 210000, "2026-10-18T06:45:00Z", "lost"),
  claim("clm-004", "shp-006", "submitted", 0.8, 89000, "2026-10-19T04:10:00Z", "damaged"),
  claim("clm-005", "shp-024", "submitted", 0.77, 685000, "2026-10-17T02:15:00Z", "lost"),
  claim("clm-006", "shp-022", "submitted", 0.83, 315000, "2026-10-18T08:20:00Z", "lost"),
  claim("clm-007", "shp-013", "submitted", 0.72, 175000, "2026-10-19T03:20:00Z", "damaged"),
  claim("clm-008", "shp-013", "rejected", 0.58, 175000, "2026-10-19T03:20:00Z", "damaged"),
  claim("clm-009", "shp-003", "rejected", 0.55, 89000, "2026-10-20T09:35:00Z", "return_fraud"),
  claim("clm-010", "shp-022", "pending_approval", 0.62, 315000, "2026-10-21T02:40:00Z", "lost"),
  claim("clm-011", "shp-026", "pending_approval", 0.79, 5200000, "2026-10-18T07:10:00Z", "lost"),
  claim("clm-012", "shp-027", "pending_approval", 0.68, 480000, "2026-10-18T03:20:00Z", "lost"),
  claim("clm-013", "shp-024", "submitted", 0.88, 685000, "2026-10-17T02:15:00Z", "damaged"),
  claim("clm-014", "shp-028", "rejected", 0.49, 340000, "2026-10-18T09:40:00Z", "lost"),
  claim("clm-015", "shp-014", "pending_approval", 0.92, 9500000, "2026-10-20T07:05:00Z", "lost"),
  claim("clm-016", "shp-015", "rejected", 0.63, 365000, "2026-10-21T12:15:00Z", "return_fraud"),
  claim("clm-017", "shp-016", "pending_approval", 0.74, 780000, "2026-10-18T15:20:00Z", "damaged"),
  claim("clm-018", "shp-017", "rejected", 0.51, 265000, "2026-10-18T03:30:00Z", "lost"),
  claim("clm-019", "shp-039", "rejected", 0.58, 1150000, "2026-10-14T02:20:00Z", "return_fraud"),
  claim("clm-020", "shp-041", "rejected", 0.61, 65000, "2026-10-16T03:10:00Z", "return_fraud"),
  claim("clm-021", "shp-043", "pending_approval", 0.71, 390000, "2026-10-19T04:20:00Z", "lost"),

];

// ---------------------------------------------------------------------------------------------
// Log audit (terbaru dulu). Payload mengikuti katalog aksi di lib/audit.ts
// ---------------------------------------------------------------------------------------------

export const auditLogs: AuditLog[] = [
  { id: "al-021", actor: "agent:drafter", action: "claim_drafted", entity: "claim", entity_id: "clm-001", payload_json: { tracking_number: "JNE0012345678", issues: 0 }, created_at: d("2026-10-21T03:05:00Z") },
  { id: "al-020", actor: "agent:evaluator", action: "decision_made", entity: "investigation", entity_id: "inv-A", payload_json: { decision: "claim", confidence: 0.86, shipment_id: "shp-001" }, created_at: d("2026-10-21T03:04:40Z") },
  { id: "al-019", actor: "agent:investigator", action: "investigation_started", entity: "investigation", entity_id: "inv-A", payload_json: { case_type: "lost", shipment_id: "shp-001" }, created_at: d("2026-10-21T03:00:10Z") },
  { id: "al-018", actor: "system", action: "anomaly_flagged", entity: "anomaly", entity_id: "anm-001", payload_json: { code: "SLA_EXCEEDED", shipment_id: "shp-001" }, created_at: d("2026-10-21T03:00:00Z") },
  { id: "al-017", actor: "agent:monitor", action: "anomaly_flagged", entity: "anomaly", entity_id: "anm-035", payload_json: { code: "BUYER_REPORTED_DAMAGE", shipment_id: "shp-035" }, created_at: d("2026-10-21T01:40:00Z") },
  { id: "al-016", actor: "system", action: "anomaly_flagged", entity: "anomaly", entity_id: "anm-029", payload_json: { code: "BUYER_REPORTED_DAMAGE", shipment_id: "shp-029" }, created_at: d("2026-10-21T09:15:00Z") },
  { id: "al-015", actor: "agent:investigator", action: "investigation_started", entity: "investigation", entity_id: "inv-029", payload_json: { case_type: "damaged", shipment_id: "shp-029" }, created_at: d("2026-10-21T09:20:00Z") },
  { id: "al-014", actor: "user", action: "claim_rejected", entity: "claim", entity_id: "clm-009", payload_json: { reason: "Rekaman packing menunjukkan paket dikemas sesuai pesanan; segel terlihat utuh", submission_ref: null }, created_at: d("2026-10-20T10:30:00Z") },
  { id: "al-013", actor: "user", action: "claim_edited", entity: "claim", entity_id: "clm-011", payload_json: { length: 812 }, created_at: d("2026-10-20T04:12:00Z") },
  { id: "al-012", actor: "agent:drafter", action: "claim_drafted", entity: "claim", entity_id: "clm-015", payload_json: { tracking_number: "JNE0033445566", issues: 1 }, created_at: d("2026-10-20T07:05:00Z") },
  { id: "al-011", actor: "agent:evaluator", action: "decision_made", entity: "investigation", entity_id: "inv-015", payload_json: { decision: "fraud_suspect", confidence: 0.84, shipment_id: "shp-015" }, created_at: d("2026-10-21T12:18:00Z") },
  { id: "al-010", actor: "agent:drafter", action: "claim_drafted", entity: "claim", entity_id: "clm-017", payload_json: { tracking_number: "SCP3344556677", issues: 0 }, created_at: d("2026-10-18T15:20:00Z") },
  { id: "al-009", actor: "agent:investigator", action: "investigation_failed", entity: "investigation", entity_id: "inv-033", payload_json: { code: "clip_unavailable", message: "Rekaman CCTV meja packing 2 tidak tersedia" }, created_at: d("2026-10-18T04:07:00Z") },
  { id: "al-008", actor: "user", action: "settings_updated", entity: "settings", entity_id: "runtime", payload_json: { sla_grace_hours: 0, scan_interval_min: 5 }, created_at: d("2026-10-18T02:30:00Z") },
  { id: "al-007", actor: "agent:monitor", action: "anomaly_flagged", entity: "anomaly", entity_id: "anm-039", payload_json: { code: "RETURN_DISPUTE", shipment_id: "shp-038" }, created_at: d("2026-10-18T09:30:00Z") },
  { id: "al-006", actor: "user", action: "claim_rejected", entity: "claim", entity_id: "clm-018", payload_json: { reason: "Asuransi tidak aktif dan nilainya melebihi batas ganti rugi JNE", submission_ref: null }, created_at: d("2026-10-18T05:00:00Z") },
  { id: "al-005", actor: "user", action: "claim_approved", entity: "claim", entity_id: "clm-002", payload_json: { submission_ref: "SIM-JNT-CLM002001" }, created_at: d("2026-10-19T06:40:00Z") },
  { id: "al-004", actor: "agent:investigator", action: "investigation_cancelled", entity: "investigation", entity_id: "inv-037", payload_json: {}, created_at: d("2026-10-19T06:02:00Z") },
  { id: "al-003", actor: "user", action: "shipments_imported", entity: "shipment", entity_id: null, payload_json: { imported: 12, updated: 3, filename: "res export 18 okt 2026.csv" }, created_at: d("2026-10-18T01:05:00Z") },
  { id: "al-002", actor: "user", action: "courier_thresholds_updated", entity: "settings", entity_id: "runtime", payload_json: { couriers: ["jne", "jnt"] }, created_at: d("2026-10-17T03:20:00Z") },
  { id: "al-001", actor: "system", action: "investigation_purged", entity: "investigation", entity_id: null, payload_json: { deleted: 4, older_than_days: 30 }, created_at: d("2026-10-16T18:00:00Z") },
];

export const settings: AppSettings = {
  scan_interval_min: 5,
  sla_grace_hours: 0,
  min_confidence: 0.6,
  medium_confidence: 0.4,
  ai_mode: "auto",
  scheduler_enabled: false,
};

// Sama dengan backend app/services/deadlines.py: paket sampai/diretur -> event terakhir, selain itu batas SLA
const windowDays = Object.fromEntries(policies.map((p) => [p.courier, p.claim_window_days]));
function claimDeadline(s: ShipmentDetail): string | null {
  const days = windowDays[s.courier];
  if (days === undefined) return null;
  const arrived = s.status === "delivered" || s.status === "returned";
  const last = [...s.tracking_events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
  const ref = arrived && last ? last.occurred_at : s.sla_deadline;
  return new Date(new Date(ref).getTime() + days * 86400e3).toISOString();
}
for (const s of shipments) s.claim_deadline = claimDeadline(s);
for (const c of claims) {
  const s = shipments.find((x) => x.id === c.shipment_id);
  c.claim_deadline = s?.claim_deadline ?? null;
  c.case_type ??= s?.anomaly?.case_type ?? null;
}

// ---------------------------------------------------------------------------------------------
// Draf klaim awal. Kunci = id klaim; klaim tanpa entri memakai draf generik di claims.ts.
// Shape: ClaimDetail minus field turunan (tenggat, item, kurir, dsb. diambil dari resi).
// ---------------------------------------------------------------------------------------------

export type ClaimSeed = Pick<ClaimDetail, "narrative" | "draft" | "draft_issues" | "decision_reason"> &
  Partial<Pick<ClaimDetail, "submission_ref" | "reject_reason" | "submitted_by">> & {
    /** Waktu investigasi selesai; tanggal kirim = selesai + 1 jam. */
    detected_at: string;
  };

const draftSeed = (c: ClaimSummary, detected_at: string): ClaimSeed => {
  const s = shipments.find((x) => x.id === c.shipment_id)!;
  const policy = policies.find((p) => p.courier === s.courier)!;
  const courier = s.courier === "jne" ? "JNE" : s.courier === "jnt" ? "J&T" : "SiCepat";
  const decision =
    s.anomaly?.case_type === "damaged"
      ? "Video unboxing menunjukkan kerusakan yang sudah ada saat kardus dibuka; rekaman packing tidak menemukan benturan saat pengemasan."
      : "Rekaman packing menunjukkan barang dikemas dan label resi cocok; pelacakan berhenti setelah hub transit melewati batas SLA.";
  return {
    detected_at,
    narrative:
      `Dengan hormat, kami mengajukan klaim ${s.anomaly?.case_type === "damaged" ? "barang rusak" : "paket hilang"} untuk resi ${s.tracking_number}. ` +
      `Paket berisi ${s.item_name} senilai ${rupiah(c.claim_value)}, diserahkan ke ${courier} pada ${wib(s.tracking_events[0]?.occurred_at ?? s.shipped_at)}. ` +
      `${s.tracking_events.length ? `Pembaruan terakhir: ${s.tracking_events.at(-1)!.status.toLowerCase()} di ${s.tracking_events.at(-1)!.location}. ` : ""}` +
      `Rekaman packing dan riwayat resi terlampir sebagai bukti.`,
    draft: {
      title: `Klaim ${s.anomaly?.case_type === "damaged" ? "barang rusak" : "paket hilang"} ${s.tracking_number}`,
      tracking_number: s.tracking_number,
      courier: s.courier,
      claim_type: s.anomaly?.case_type === "damaged" ? "damaged" : "lost",
      chronology: s.tracking_events.map((e) => ({ at: e.occurred_at, event: `${e.status} · ${e.location}` })),
      attachments: [`evd-${c.id.slice(-3)}`],
      requested_compensation: c.claim_value,
      policy_notes: [
        `Diajukan dalam batas ${policy.claim_window_days} hari kebijakan ${courier}`,
        ...(s.tracking_events.some((e) => e.status === "Paket dikemas") ? ["Rekaman packing tersedia"] : []),
        `Nilai barang tidak melebihi batas: ${policy.max_compensation}`,
      ],
    },
    draft_issues: [],
    decision_reason: decision,
  };
};

export const claimSeeds: Record<string, ClaimSeed> = {
  "clm-001": {
    ...draftSeed(claims.find((c) => c.id === "clm-001")!, "2026-10-21T03:04:40Z"),
    narrative:
      "Dengan hormat, kami mengajukan klaim paket hilang untuk resi JNE0012345678. Paket berisi Kaos polos putih (2 pcs) senilai Rp149.000, " +
      "dikemas dan dipindai di meja packing pada 17 Okt 2026 pukul 08.00 WIB, lalu diserahkan ke kurir pukul 10.00 WIB. Sejak 18 Okt 2026 status paket " +
      "tidak bergerak di hub transit Semarang melewati batas SLA. Rekaman packing dan riwayat resi terlampir.",
  },
  "clm-002": {
    ...draftSeed(claims.find((c) => c.id === "clm-002")!, "2026-10-19T05:10:00Z"),
    submission_ref: "SIM-JNT-CLM002001",
    submitted_by: "admin",
  },
  "clm-003": {
    ...draftSeed(claims.find((c) => c.id === "clm-003")!, "2026-10-18T06:40:00Z"),
    submission_ref: "SIM-JNT-CLM003001",
    submitted_by: "admin",
  },
  "clm-004": {
    ...draftSeed(claims.find((c) => c.id === "clm-004")!, "2026-10-19T04:05:00Z"),
    submission_ref: "SIM-SICEPAT-CLM004001",
    submitted_by: "admin",
  },
  "clm-005": {
    ...draftSeed(claims.find((c) => c.id === "clm-005")!, "2026-10-17T02:10:00Z"),
    submission_ref: "SIM-JNE-CLM005001",
    submitted_by: "admin",
    draft_issues: ["Rekaman packing meja 1 tidak terbaca pada menit ke-2"],
  },
  "clm-006": {
    ...draftSeed(claims.find((c) => c.id === "clm-006")!, "2026-10-18T08:15:00Z"),
    submission_ref: "SIM-JNT-CLM006001",
    submitted_by: "admin",
  },
  "clm-007": {
    ...draftSeed(claims.find((c) => c.id === "clm-007")!, "2026-10-19T03:15:00Z"),
    submission_ref: "SIM-SICEPAT-CLM007001",
    submitted_by: "admin",
    decision_reason: "Mug dikemas tanpa kertas pembungkus tambahan; pembeli melaporkan sudut pecah tanpa rekaman unboxing.",
  },
  "clm-008": {
    ...draftSeed(claims.find((c) => c.id === "clm-008")!, "2026-10-19T03:15:00Z"),
    reject_reason: "Bukti unboxing tidak ada; kerusakan tidak bisa dibuktikan terjadi saat pengiriman",
  },
  "clm-009": {
    ...draftSeed(claims.find((c) => c.id === "clm-009")!, "2026-10-20T09:35:00Z"),
    reject_reason: "Rekaman packing menunjukkan paket dikemas sesuai pesanan; segel terlihat utuh",
  },
  "clm-010": {
    ...draftSeed(claims.find((c) => c.id === "clm-010")!, "2026-10-18T08:15:00Z"),
    draft_issues: ["Nomor resi tercatat dua kali pada klaim berbeda (clm-006)", "Bukti nilai barang belum dilampirkan"],
  },
  "clm-011": {
    ...draftSeed(claims.find((c) => c.id === "clm-011")!, "2026-10-18T07:10:00Z"),
    draft_issues: ["Nilai klaim Rp5.200.000 melebihi batas ganti rugi tanpa asuransi (maks. 10x ongkir)"],
  },
  "clm-021": {
    ...draftSeed(claims.find((c) => c.id === "clm-021")!, "2026-10-19T04:10:00Z"),
    narrative:
      "Dengan hormat, kami mengajukan klaim untuk resi JT0099776611. Paket berisi Lampu gantung rotan senilai Rp390.000 tiba di Bengkulu " +
      "setelah melewati SLA J&T. Meski sudah ada tanda terima, keterlambatan ini membuat pembeli membatalkan pesanan sehingga barang harus dikembalikan. " +
      "Rekaman packing terlampir.",
  },
  "clm-012": {
    ...draftSeed(claims.find((c) => c.id === "clm-012")!, "2026-10-18T03:20:00Z"),
    draft_issues: ["Tenggat klaim J&T sudah lewat saat draf disetujui"],
  },
  "clm-013": {
    ...draftSeed(claims.find((c) => c.id === "clm-013")!, "2026-10-17T02:10:00Z"),
    submission_ref: "SIM-JNE-CLM013001",
    submitted_by: "admin",
  },
  "clm-014": {
    ...draftSeed(claims.find((c) => c.id === "clm-014")!, "2026-10-18T09:40:00Z"),
    reject_reason: "Asuransi tidak aktif dan nilainya melebihi batas ganti rugi JNE",
  },
  "clm-015": {
    ...draftSeed(claims.find((c) => c.id === "clm-015")!, "2026-10-20T07:05:00Z"),
    draft_issues: ["Rekaman packing berakhir 12 detik setelah scan resi; isi paket terlihat sebagian"],
  },
  "clm-016": {
    ...draftSeed(claims.find((c) => c.id === "clm-016")!, "2026-10-21T12:10:00Z"),
    reject_reason: "Log packing mencatat 5 item; pembeli melapor 2 item tanpa video unboxing",
  },
  "clm-017": {
    ...draftSeed(claims.find((c) => c.id === "clm-017")!, "2026-10-18T15:20:00Z"),
  },
  "clm-018": {
    ...draftSeed(claims.find((c) => c.id === "clm-018")!, "2026-10-18T03:30:00Z"),
    reject_reason: "Rekaman packing sudah melewati masa simpan 30 hari sehingga tidak bisa diverifikasi",
  },
  "clm-019": {
    ...draftSeed(claims.find((c) => c.id === "clm-019")!, "2026-10-14T02:20:00Z"),
    reject_reason: "Pola klaim berulang dan segel paket utuh pada rekaman packing",
  },
  "clm-020": {
    ...draftSeed(claims.find((c) => c.id === "clm-020")!, "2026-10-16T03:10:00Z"),
    reject_reason: "Tidak ada bukti segel rusak; rekaman packing menunjukkan barang dimasukkan",
  },
};


/** Outcome per klaim untuk detail (backend menurunkan dari investigasi terakhir). */
export const CLAIM_OUTCOME: Record<string, Outcome> = {
  "clm-001": "claim_drafted",
  "clm-002": "claim_drafted",
  "clm-003": "claim_drafted",
  "clm-004": "claim_drafted",
  "clm-005": "claim_drafted",
  "clm-006": "claim_drafted",
  "clm-007": "claim_drafted",
  "clm-008": "claim_drafted",
  "clm-009": "fraud_suspect",
  "clm-010": "claim_drafted",
  "clm-011": "claim_drafted",
  "clm-012": "claim_drafted",
  "clm-013": "claim_drafted",
  "clm-014": "claim_drafted",
  "clm-015": "claim_drafted",
  "clm-016": "fraud_suspect",
  "clm-017": "claim_drafted",
  "clm-018": "claim_drafted",
  "clm-019": "fraud_suspect",
  "clm-020": "fraud_suspect",
  "clm-021": "claim_drafted",
};
