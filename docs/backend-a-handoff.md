# Backend A: Status & Kontrak untuk Backend B

Pembaca: Backend B (runner, API, deploy) dan PIC GCP. Acuan: [SRS.md](SRS.md) v2.4.

## Status (Rabu 21 Okt)

| Area | Berkas | Status |
| --- | --- | --- |
| Model data (semua tabel SRS 8) | `app/models/__init__.py` | Selesai |
| Session DB (SQLite WAL lokal / Postgres) | `app/db/session.py` | Selesai |
| Repository | `app/repositories/{shipments,investigations,policies}.py` | Selesai |
| Storage lokal + GCS (signed URL) | `app/services/storage_service.py` | Selesai; GCS belum diuji di cloud |
| FFmpeg clip (H.264, bisa dibatalkan) | `app/services/video_service.py` | Selesai + test |
| Tools: `get_case_context`, `clip_cctv_video`, `analyze_media`, `get_courier_policy` | `app/agents/tools/` | Selesai + test |
| Agen ADK Investigator → Evaluator → Drafter | `app/agents/agent.py`, `callbacks.py`, `prompts/` | Selesai, diuji dengan LLM skrip |
| Rekam-putar cache + fallback `auto` | `app/agents/callbacks.py`, `app/services/ai_cache.py` | Selesai + test |
| Penjaga confidence, skip Drafter, validasi draf | `app/agents/callbacks.py` | Selesai + test |
| Ekstraksi kebijakan kurir | `app/services/policy_extractor.py` | Selesai; menunggu dokumen `data/mock/courier_policies/*.md` |
| Panggilan Gemini live | `app/services/gemini_client.py` | **Menunggu billing** |

`core/config.py` dan `pyproject.toml` saya buat sebagai bootstrap. Pemiliknya tetap Backend B, silakan diambil alih.

Menjalankan test (tidak butuh billing, ffmpeg memakai `imageio-ffmpeg`):

```
cd backend
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
.venv\Scripts\python -m pytest -q
```

## Kontrak untuk `investigation_runner` (Backend B)

```python
from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from app.agents.agent import APP_NAME, START_MESSAGE, build_root_agent, initial_state
from app.agents.outcome import persist_outcome, OutcomeError

ss = InMemorySessionService()
runner = Runner(app_name=APP_NAME, agent=build_root_agent(), session_service=ss)
state = initial_state(investigation_id=..., shipment_id=..., tracking_number=...,
                      courier=..., case_type=..., item_value=...)
session = await ss.create_session(app_name=APP_NAME, user_id="system", state=state)
abort = asyncio.Event()                      # FR-20: abort.set() saat /cancel
async for event in runner.run_async(user_id="system", session_id=session.id,
                                    new_message=START_MESSAGE,
                                    run_config=RunConfig(max_llm_calls=20),
                                    abort_signal=abort):
    ...  # petakan ke investigation_events / SSE (tabel di SRS 3.6)
final = await ss.get_session(app_name=APP_NAME, user_id="system", session_id=session.id)
outcome = persist_outcome(final.state)       # InvestigationOutcome
```

Pemetaan event:
- `event.author`: `investigator` / `evaluator` / `drafter`, menjadi field `agent` di SSE.
- `event.get_function_calls()` menjadi `tool_start`; `event.get_function_responses()` menjadi `tool_end`. Hasil `analyze_media` membawa `source` (`live`/`cache`).
- Event teks model membawa `event.custom_metadata["source"]` (`live`/`cache`) untuk label FR-21.
- `final.state["evaluation"]` menjadi event `decision`.

Menyimpan hasil:
- `outcome.outcome` adalah salah satu dari `claim_drafted`, `needs_evidence`, `fraud_suspect`. Nilai ini ditulis ke `investigations.outcome`. Kolom `verdict`, `confidence`, dan `decision_reason` diambil dari `outcome.evaluation`.
- Bila `claim_drafted`: buat `claims` berstatus `pending_approval`, dengan `narrative = outcome.draft.narrative` dan `draft_json = outcome.draft.model_dump()`. Bila `outcome.draft_issues` tidak kosong, tampilkan sebagai "perlu ditinjau".
- `OutcomeError` (Evaluator tidak menghasilkan keputusan) membuat investigasi berstatus `failed`.
- Untuk FR-20, cukup `abort.set()`. Bila ingin pembatalan langsung, pakai juga `task.cancel()`: subprocess FFmpeg ikut dimatikan (`video_service._run`).

Agen **tidak punya** tool kirim klaim. `submit_claim` sepenuhnya milik `claim_service` (SRS 3.4).

## Mode AI dan cache (SRS 13)

- `AI_MODE` (env, sementara): `live` / `auto` / `cache`. `ai_cache.current_mode()` punya TODO agar membaca tabel `settings` (milik Backend B).
- Run live otomatis merekam respons ke `backend/data/cache/{agent,vision,policy}/`. ID dinamis disimpan sebagai alias (`@SHIPMENT`, `@EVIDENCE_1`, `@MEDIA_1`), sehingga rekaman tetap berlaku setelah `/demo/reset` membuat UUID baru. Ini sudah diuji.
- Kunci rekaman agen: (agen, **nomor resi**, giliran, versi prompt). Konsekuensinya: **nomor resi skenario demo harus tetap** di `shipments.json`, dan setiap perubahan prompt (ganti `version` di header `.md`) mengharuskan rekam ulang.
- `backend/data/cache/` **di-commit**. Rekam ketiga skenario dalam mode `live` sebelum dry run.

## Butuh dari Backend B

1. `data/mock/shipments.json` dengan `media_assets` CCTV, berisi `recorded_start` (UTC) dan `duration_sec` yang cocok dengan overlay jam video. Isi juga `pack_scan_logs.scanned_at` di dalam rentang rekaman. Kalau tidak, tool akan mengembalikan `scan_outside_recording`.
2. `data/mock/courier_policies/{jne,jnt,sicepat}.md` untuk `policy_extractor.extract_all()`, yang dipanggil dari `seed.py`.
3. Mode lokal: `main.py` me-mount `StaticFiles` di `/media` ke `STORAGE_LOCAL_ROOT` (dipakai `LocalStorage.public_url`).

## Butuh dari PIC GCP

- Service account Cloud Run butuh `roles/iam.serviceAccountTokenCreator` **pada dirinya sendiri**. Tanpa role ini, signed URL GCS gagal di Cloud Run karena kredensialnya tidak punya private key dan penandatanganan dilakukan lewat IAM signBlob.
- Setelah billing aktif: isi `GCP_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `GEMINI_MODEL` (verifikasi nama model dan region di Vertex), lalu jalankan satu skenario dalam mode `live`.

## Catatan teknis

- ADK 2.11 menandai `SequentialAgent` sebagai deprecated (diganti `Workflow`), tetapi masih berfungsi dan `Workflow` belum bisa dipakai di semua kasus. Versi di-pin `google-adk==2.11.0`, jadi tidak ada risiko perubahan selama hackathon.
- ADK 2.11 sudah mendukung `output_schema` bersama tools. Pemisahan Investigator/Evaluator tetap dipertahankan agar titik keputusan (FR-22) terlihat jelas di trace.
- Instruksi agen memakai placeholder `$nama` (bukan `{nama}`) dan hanya diisi fakta tepercaya dari state. Teks pembeli sampai ke agen sebagai hasil tool dengan field `buyer_report_untrusted`.

## Status Backend B (Rabu 21 Okt, sore)

Sudah ada di repo. Cara jalan dan deploy: [backend/README.md](../backend/README.md).

- `investigation_runner` mengikuti kontrak di atas: SSE dengan replay `Last-Event-ID`, cancel (FR-20), 409 bila investigasi ganda.
- Monitoring deterministik, klaim dan HITL (approve/reject atomik, 409), audit log, metrik, settings runtime (mode AI dan ambang confidence dibaca agen), login demo, reset dan skenario demo.
- Mock data 15 resi + 3 kebijakan kurir; `openapi.json` sudah diekspor.
- 42 test (unit, pipeline ADK, API end-to-end) lulus tanpa Gemini.
- **Belum diuji:** build Docker dan deploy Cloud Run, karena GCP belum siap dan Docker tidak terpasang di laptop pengembang.
