# PROJECT STATUS — AI Testing Tool

Dokumen ini adalah pencatat status berjalan (living document) untuk pembangunan AI Testing Tool. Update tabel status setiap menyelesaikan/memulai satu step, dan tambahkan entri baru di Changelog setiap ada perubahan berarti (bukan cuma centang status, tapi juga keputusan/perubahan scope).

Referensi: `roadmap-ai-testing-tool.md`, `arsitektur-spesifikasi-teknis.md`, `execution-plan-ai-testing-tool.md`.

---

## Ringkasan

| | |
|---|---|
| Fase saat ini | Fase 1 |
| Step aktif | Step 10 |
| Progress Fase 1 | 9 / 15 step selesai |
| Progress Fase 2 | 0 / 8 step selesai |
| Progress Fase 3 | 0 / 4 step selesai |
| Progress Fase 4 | 0 / 3 step selesai |
| Progress Fase 5 | 0 / 4 step selesai |
| Terakhir diupdate | 2026-08-15 |

---

## Status Legend
- **Planning** — belum dikerjakan
- **Process** — sedang dikerjakan / sedang direview
- **Done** — selesai, sudah lolos acceptance criteria
- **Blocked** — tidak bisa lanjut, ada isu yang perlu diselesaikan dulu (tulis alasannya di kolom Catatan)

---

## Status per Step

### Fase 1 — Fondasi Eksekusi & Rekam

| # | Step | Status | Tanggal Mulai | Tanggal Selesai | Catatan |
|---|---|---|---|---|---|
| 0 | Inisialisasi Project & Tooling | Done | 2026-08-15 | 2026-08-15 | `playwright.config.ts` dibuat di Step 8 saat butuh jalankan Playwright Test |
| 1 | Setup Database Schema & Migration | Done | 2026-08-15 | 2026-08-15 | Migration idempotent, diverifikasi di PostgreSQL 16 |
| 2 | Konfigurasi Environment & Config Loader | Done | 2026-08-15 | 2026-08-15 | dotenv + Zod; konfigurasi DB dipisah per variable |
| 3 | Repository Layer (DB Access) | Done | 2026-08-15 | 2026-08-15 | Lima repository CRUD teruji end-to-end |
| 4 | API Server Skeleton (Fastify) | Done | 2026-08-15 | 2026-08-15 | Endpoint queue/artifact-storage/auth masih placeholder 501, sesuai rencana Step 5/7/9/11 |
| 5 | Autentikasi Personal | Done | 2026-08-15 | 2026-08-15 | JWT 7 hari, credential dari env (tanpa tabel user) |
| 6 | Test Case CRUD API | Done | 2026-08-15 | 2026-08-15 | Zod schema action 4.1; invalid body → 400 field-spesifik |
| 7 | In-Memory Job Queue | Done | 2026-08-15 | 2026-08-15 | `p-queue` (v6, CJS); handler masih placeholder console.log sampai Step 9/19 |
| 8 | Test Case Compiler (JSON → Playwright Actions) | Done | 2026-08-15 | 2026-08-15 | `executeSteps` fail-fast; 3 unit test Playwright Test lolos terhadap fixture HTML lokal |
| 9 | Test Runner Executor (Playwright) | Done | 2026-08-15 | 2026-08-15 | `executeTestRun` terhubung ke testRunQueue; video+trace tersimpan di temp dir; diuji end-to-end (passed/failed/not-found) |
| 10 | Custom Reporter & Artifact Collector | Planning | | | |
| 11 | Artifact Storage (Filesystem) | Planning | | | |
| 12 | Screencast Live View + WebSocket Gateway | Planning | | | |
| 13 | Dashboard Dasar (UI) | Planning | | | |
| 14 | Integrasi & Testing End-to-End Fase 1 | Planning | | | |

### Fase 2 — AI Analyzer (MVP Inti)

| # | Step | Status | Tanggal Mulai | Tanggal Selesai | Catatan |
|---|---|---|---|---|---|
| 15 | Trace Parser | Planning | | | |
| 16 | Provider Interface & Adapters (Multi-AI) | Planning | | | |
| 17 | Prompt Builder | Planning | | | |
| 18 | Analyzer Service (Provider Selection + Fallback) | Planning | | | |
| 19 | Integrasi Analyzer ke Queue | Planning | | | |
| 20 | Update Dashboard untuk Analysis Result | Planning | | | |
| 21 | Anomaly Detection Berbasis Histori | Planning | | | |
| 22 | Testing & Validasi Akurasi Klasifikasi | Planning | | | |

### Fase 3 — Test Generation dari AI

| # | Step | Status | Tanggal Mulai | Tanggal Selesai | Catatan |
|---|---|---|---|---|---|
| 23 | MCP Client Setup | Planning | | | |
| 24 | Prompt-based Test Generation | Planning | | | |
| 25 | URL-based Exploration Generation | Planning | | | |
| 26 | Draft Review UI | Planning | | | |

### Fase 4 — Self-Healing Selector

| # | Step | Status | Tanggal Mulai | Tanggal Selesai | Catatan |
|---|---|---|---|---|---|
| 27 | Selector Failure Detection | Planning | | | |
| 28 | Self-Healing via MCP | Planning | | | |
| 29 | Healing Approval Flow | Planning | | | |

### Fase 5 — Fixture Management & Feature Map

| # | Step | Status | Tanggal Mulai | Tanggal Selesai | Catatan |
|---|---|---|---|---|---|
| 30 | Fixture Upload & Management | Planning | | | |
| 31 | Fixture Matching di Test Execution | Planning | | | |
| 32 | PRD Parser & Feature Map Generation | Planning | | | |
| 33 | Feature Map Coverage UI | Planning | | | |

---

## Changelog

Format: `YYYY-MM-DD` — deskripsi perubahan (keputusan, scope, atau step yang selesai).

### 2026-08-15
- Step 9 selesai: `src/runner/executor.ts` (`executeTestRun(testRunId)`) — ambil test_run/test_case, set status `running`, launch Chromium, buka context (`recordVideo` + viewport 1280x720), mulai tracing (`screenshots`+`snapshots`), jalankan `executeSteps` (Step 8), simpan tiap hasil ke `test_step_result`, stop tracing → `trace.zip`, tutup context (finalize video), tutup browser, hitung status akhir murni dari keberhasilan step (`passed`/`failed`), lalu update `test_run` (status/finished_at/duration_ms). Video+trace disimpan di temp dir OS dulu (`os.tmpdir()/ai-testing-tool-runs/<runId>/`) — pemindahan ke `./storage/artifacts/<run_id>/` + insert row `artifact` tetap scope Step 10/11. `testRunQueue` (Step 7) sekarang memanggil `executeTestRun` sungguhan (bukan placeholder lagi). Try-catch-finally menyeluruh: error tak terduga → status `error`, browser/context selalu ditutup di `finally`, `executeTestRun` tidak pernah throw ke worker queue.
- Katalog model provider dibuat dinamis: endpoint internal `POST /ai/models`
  mengambil model langsung dari endpoint resmi Claude/OpenAI/DeepSeek/Kimi/
  OpenCode Zen, cache 5 menit, dengan `*_MODELS` sebagai fallback saja. API key
  tetap server-side. OpenCode ditetapkan sebagai OpenCode Zen
  (`https://opencode.ai/zen/v1`); katalog langsung terverifikasi berisi 62 model
  saat implementasi. Adapter inference OpenCode tetap scope Step 16.
- Step 8 selesai: `src/runner/types.ts` (tipe `Step`/`StepExecutionResult`, selaras kolom tabel `test_step_result`) dan `src/runner/testcase-compiler.ts` (`executeSteps(page, steps)` — jalankan step berurutan, fail-fast begitu satu step gagal, tidak pernah throw). `playwright.config.ts` dibuat (belum ada sejak Step 0) dengan `actionTimeout: 3000ms` agar test skenario gagal cepat. Fixture `src/runner/__tests__/fixtures/sample.html` + 3 unit test (`testcase-compiler.spec.ts`) memverifikasi tiap action type sukses, fail-fast saat selector tidak ada, dan `waitFor` gagal saat elemen tidak pernah muncul — jalan lewat `npm test` (`playwright test`). Browser Chromium Playwright diinstall lokal (tanpa `--with-deps` karena butuh sudo).
- Step 7 selesai: in-memory queue (`p-queue@6`, versi CJS karena v7+ ESM-only dan project ini `type: commonjs`) — `testRunQueue` (concurrency default 2) dan `analysisQueue` (concurrency default 3), keduanya dikonfigurasi via env `TEST_RUN_QUEUE_CONCURRENCY`/`ANALYSIS_QUEUE_CONCURRENCY`. Tipe job (`TestRunJob`, `AnalysisJob`) di `src/queue/types.ts`; `enqueueTestRun`/`enqueueAnalysis` fire-and-forget; handler masih placeholder console.log (eksekusi sungguhan Step 9/19). `getQueueStats()` untuk cek job running/waiting. `POST /test-cases/:id/run` diupdate dari 501 jadi implementasi penuh: insert `test_run` (status=queued) lalu push ke queue, balikan `202 { runId, status }` sesuai sequence 6.1. Startup server sekarang menjalankan `recoverStaleRunningTestRuns()` — `test_run` status `running` dari sesi sebelumnya di-mark `error` (sesuai spesifikasi bagian 7 "Persistensi job").
- Step 6 selesai: Zod schema test case sesuai kontrak 4.1 (action enum + field wajib per action); POST/GET/PATCH test case full; request invalid ditolak 400 dengan path field spesifik; steps/expected tersimpan sebagai JSONB dan terbaca kembali sama.
- Step 5 selesai: autentikasi personal/single-user (JWT, credential dari env, tanpa tabel user) diterapkan sebagai global preHandler hook (kecuali `/health` dan `/auth/login`). Env provider AI diperluas: sekarang tiap provider (Claude/OpenAI/DeepSeek/Kimi/opencode) juga punya pilihan `*_MODEL` (default) dan `*_MODELS` (daftar model, CSV), bukan cuma API key.
- Step 4 selesai: seluruh endpoint REST di spesifikasi bagian 5 terdaftar sebagai Fastify route (per-resource: project/testcase/testrun/auth), endpoint yang komponennya belum ada (queue, artifact-storage, auth) balikan 501 dengan pesan step tujuan. Global error handler + not-found handler menghasilkan format konsisten `{ error, statusCode }`.
- Step 1–3 selesai: migration PostgreSQL, config loader tervalidasi, dan repository layer untuk lima entity.
- Konfigurasi koneksi database diubah dari `DATABASE_URL` menjadi `DB_HOST`, `DB_NAME`, `DB_PORT`, `DB_USER`, `DB_PASS`; database lokal bernama `pointesting`.
- Repository layer memakai parameterized query dan sudah diuji create/find/filter/update terhadap PostgreSQL 16 sementara.
- Roadmap 5 fase disusun (`roadmap-ai-testing-tool.md`), CI/CD gate diputuskan untuk tidak dikerjakan dulu.
- Fitur live embedded browser view (screencast) ditambahkan ke Fase 1.
- Ditetapkan: full Node.js (bukan Go), job queue in-memory (tanpa Redis), file storage filesystem lokal (tanpa object storage), AI Analyzer multi-provider (Claude, OpenAI, DeepSeek, Kimi, opencode), realtime via WebSocket, autentikasi personal/single-user saja.
- Dokumen arsitektur & spesifikasi teknis lengkap disusun (`arsitektur-spesifikasi-teknis.md`) — mencakup diagram arsitektur, struktur folder, skema database, kontrak data internal, spesifikasi API, sequence diagram, dan non-functional requirements.
- Execution plan step-by-step disusun (`execution-plan-ai-testing-tool.md`) — 23 step (Step 0–22) mencakup Fase 1 & 2, masing-masing dengan prompt siap pakai untuk AI IDE.
- File status project ini dibuat untuk mulai tracking progress implementasi.
- Ditambahkan spesifikasi teknis lengkap untuk Fase 3 (Test Generation), Fase 4 (Self-Healing), dan Fase 5 (Fixture & Feature Map) ke `arsitektur-spesifikasi-teknis.md` (section 9-11) — sebelumnya baru sebatas skema DB dasar, sekarang lengkap dengan komponen, API, dan sequence flow.
- Ditambahkan Step 23-33 ke `execution-plan-ai-testing-tool.md` untuk Fase 3-5, dengan format dan gaya prompt yang sama seperti Fase 1-2.
- Tabel status Fase 3-5 ditambahkan ke file status project ini.
- Review konsistensi menyeluruh terhadap 3 dokumen acuan, ditemukan & diperbaiki: header hilang dan salah hitung jumlah tabel di `execution-plan-ai-testing-tool.md`; enum action test case, field `AnalyzerInput` (historicalContext/healingEvents), kontrak event WebSocket Fase 3-5, autentikasi WebSocket, dan lapisan provider generik (`LLMClient`) yang dipakai bersama Fase 2/3/5 ditambahkan ke `arsitektur-spesifikasi-teknis.md`; Step 12, 16, 24, 32 di execution plan diselaraskan mengikuti perbaikan ini.

---

## Cara Update Dokumen Ini

1. Saat mulai mengerjakan satu step: ubah Status jadi `Process`, isi Tanggal Mulai.
2. Saat step selesai dan lolos acceptance criteria di `execution-plan-ai-testing-tool.md`: ubah Status jadi `Done`, isi Tanggal Selesai, update angka Progress di bagian Ringkasan.
3. Kalau ada step yang macet/butuh keputusan lebih dulu: ubah Status jadi `Blocked`, tulis alasannya di kolom Catatan.
4. Tambahkan entri baru di Changelog untuk setiap keputusan atau perubahan scope — bukan cuma saat step selesai, tapi juga saat ada perubahan arah (seperti histori keputusan sebelumnya: ganti Go ke Node.js, hapus CI/CD gate dari roadmap, dsb).
