# PROJECT STATUS — AI Testing Tool

Dokumen ini adalah pencatat status berjalan (living document) untuk pembangunan AI Testing Tool. Update tabel status setiap menyelesaikan/memulai satu step, dan tambahkan entri baru di Changelog setiap ada perubahan berarti (bukan cuma centang status, tapi juga keputusan/perubahan scope).

Referensi: `roadmap-ai-testing-tool.md`, `arsitektur-spesifikasi-teknis.md`, `execution-plan-ai-testing-tool.md`.

---

## Ringkasan

| | |
|---|---|
| Fase saat ini | Fase 2 (Fase 3 sudah berjalan sebagian via arsitektur alternatif) |
| Step aktif | Step 21 |
| Progress Fase 1 | 15 / 15 step selesai |
| Progress Fase 2 | 6 / 8 step selesai |
| Progress Fase 3 | 2 / 4 step selesai (via arsitektur alternatif, bukan MCP — lihat catatan tabel) |
| Progress Fase 4 | 0 / 3 step selesai |
| Progress Fase 5 | 0 / 4 step selesai |
| Terakhir diupdate | 2026-08-19 |

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
| 7 | In-Memory Job Queue | Done | 2026-08-15 | 2026-08-15 | `p-queue` (v6, CJS); testRun handler aktif, analysis placeholder sampai Step 19 |
| 8 | Test Case Compiler (JSON → Playwright Actions) | Done | 2026-08-15 | 2026-08-15 | `executeSteps` fail-fast; 3 unit test Playwright Test lolos terhadap fixture HTML lokal |
| 9 | Test Runner Executor (Playwright) | Done | 2026-08-15 | 2026-08-15 | `executeTestRun` terhubung ke testRunQueue; artifact diproses reporter ke storage final |
| 10 | Custom Reporter & Artifact Collector | Done | 2026-08-15 | 2026-08-15 | Console/network log JSON + video/trace dikumpulkan; empat row artifact tersimpan |
| 11 | Artifact Storage (Filesystem) | Done | 2026-08-15 | 2026-08-15 | Storage layer aman + streaming artifact dengan Content-Type sesuai |
| 12 | Screencast Live View + WebSocket Gateway | Done | 2026-08-15 | 2026-08-15 | JWT handshake code 4001; pub/sub terisolasi per runId; Chromium CDP screencast JPEG 640x360 quality 50 |
| 13 | Dashboard Dasar (UI) | Done | 2026-08-15 | 2026-08-15 | EJS + HTMX; login, Run + spinner, live frame/status/step, video dan trace setelah selesai |
| 14 | Integrasi & Testing End-to-End Fase 1 | Done | 2026-08-16 | 2026-08-16 | Dashboard → live frame → passed → video/trace/log; `base_url` + resync WS + recovery queued; isi empat artifact tervalidasi |

### Fase 2 — AI Analyzer (MVP Inti)

| # | Step | Status | Tanggal Mulai | Tanggal Selesai | Catatan |
|---|---|---|---|---|---|
| 15 | Trace Parser | Done | 2026-08-16 | 2026-08-16 | ZIP streaming; action/timing/error bounded ≤20 action tanpa snapshot/network mentah |
| 16 | Provider Interface & Adapters (Multi-AI) | Done | 2026-08-16 | 2026-08-16 | LLMClient + AnalyzerProvider untuk Claude/OpenAI/DeepSeek/Kimi/OpenCode; ProviderError + output konsisten |
| 17 | Prompt Builder | Done | 2026-08-16 | 2026-08-16 | Filter/dedup console+network, sanitasi URL, trace + screenshot opsional; E2E AnalyzerInput valid |
| 18 | Analyzer Service (Provider Selection + Fallback) | Done | 2026-08-17 | 2026-08-17 | Default provider + fallback terkonfigurasi; hasil/provider/raw response tersimpan dan broadcast |
| 19 | Integrasi Analyzer ke Queue | Done | 2026-08-17 | 2026-08-17 | Semua status terminal auto-enqueue; failure boundary mencegah error analysis menjatuhkan worker |
| 20 | Update Dashboard untuk Analysis Result | Done | 2026-08-17 | 2026-08-17 | CRUD project/test case via UI + step builder; realtime analysis, evidence-gated, latest badge/API tanpa N+1 |
| 21 | Anomaly Detection Berbasis Histori | Planning | | | |
| 22 | Testing & Validasi Akurasi Klasifikasi | Planning | | | |

### Fase 3 — Test Generation dari AI

**PENTING:** implementasi nyata Fase 3 **menyimpang dari desain asli** di
`arsitektur-spesifikasi-teknis.md` bagian 9 (MCP + tabel `test_case_draft`) —
riwayatnya DUA TAHAP, bukan sekali putus. (1) 2026-08-18: MCP ditinggalkan
total, diganti kontrol Chromium langsung (`chromium.launch()`), karena pola
"LLM memutuskan navigasi sendiri" gagal di app nyata. (2) 2026-08-19: MCP
(`@playwright/mcp`) **dipasang kembali** via `src/generator/mcp-client.ts`,
tapi HANYA sebagai lapisan "colokan" browser (`McpBrowserSession`/
`McpExplorationDriver`/`McpPageDriver`) — logika crawl BFS + heuristik
(nav/sidebar/hamburger/backdrop/dropdown, `page-explorer.ts`) TETAP sama,
LLM tetap TIDAK diberi kendali navigasi. Ini sekarang satu-satunya jalur
produksi untuk generate/eksplorasi; eksekusi test case tersimpan (bukan
generate) tetap Playwright asli, tidak tersentuh. Tidak ada tabel
`test_case_draft` — hasil generate **langsung insert ke `test_case`**, tidak
ada alur draft/approval terpisah. Riwayat lengkap: `docs/memory.md`, rentetan
entri 2026-08-18 s.d. 2026-08-19 ("Rewrite generate test script: Map-then-
Author" s.d. "Integrasi MCP Playwright"). Status di bawah menilai KAPABILITAS,
bukan kesesuaian literal ke desain MCP asli (endpoint terpisah, agent
otonom, tabel draft, dsb. tetap tidak ada).

| # | Step | Status | Tanggal Mulai | Tanggal Selesai | Catatan |
|---|---|---|---|---|---|
| 23 | MCP Client Setup | Done | 2026-08-19 | 2026-08-19 | `src/generator/mcp-client.ts` — koneksi in-process ke `@playwright/mcp` (`createConnection()` + `InMemoryTransport`, TANPA child process/stdio). Beda dari desain asli: MCP dipakai sebagai plumbing browser murni (goto/evaluate/click/screenshot), BUKAN agent yang menerima instruksi bahasa natural dan memutuskan eksplorasi sendiri |
| 24 | Prompt-based Test Generation | Done | 2026-08-18 | 2026-08-19 | Kapabilitas jalan penuh via arsitektur Map-then-Author (lihat catatan di atas), sejak 2026-08-19 browser-control-nya lewat MCP. Ditambah di luar desain asli: assertion action nyata (Prioritas 1), negative/boundary testing berbasis field constraint (Prioritas 3), Suite/Cross-Feature Analysis (kapabilitas baru, lihat arsitektur bagian 12) |
| 25 | URL-based Exploration Generation | Done | 2026-08-18 | 2026-08-19 | Menyatu dengan Step 24 (satu endpoint `/generate/prompt` + `baseUrl` project, bukan endpoint `/generate/url` terpisah); crawl multi-halaman otomatis (`discoverSite`, `MAX_SITE_PAGES=20`) sinkron dalam job async yang sama, browser-control lewat MCP |
| 26 | Draft Review UI | Planning | | | Tidak ada alur draft/approve/reject terpisah — hasil generate langsung jadi `test_case` resmi (opsional `replaceExisting`), lalu diedit lewat step builder CRUD biasa (Step 20). Tidak ada jejak audit "ini hasil AI belum direview" seperti desain asli |

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

### 2026-08-19
- **Audit & perbaikan dokumen status** — ditemukan drift signifikan: tabel
  Fase 3 menampilkan "0/4 Planning" padahal kapabilitas generate test case
  sudah matang sejak 2026-08-18 (hanya beda arsitektur dari desain MCP
  asli). Diperbaiki: Step 24-25 ditandai Done dengan catatan penyimpangan
  arsitektur; Step 23 (MCP) dan 26 (Draft Review UI) tetap Planning karena
  memang tidak pernah dibangun. Detail lengkap tetap di `docs/memory.md`
  (dokumen ini sengaja ringkas, cukup status + pointer).
- Tiga peningkatan mekanisme generate test case (di luar penomoran Step
  resmi, hasil audit QA-perspective terhadap mekanisme yang ada):
  1. **Assertion action nyata** — `steps` test case sekarang punya 7 action
     checkpoint baru (`assertVisible/Hidden/Checked/Text/Value/Count/Url`)
     yang benar-benar diverifikasi compiler saat run, bukan cuma teks
     `expected` yang tidak pernah dicek mesin. Prompt authoring AI wajib
     membuktikan tiap klaim `expected` lewat step assertion nyata.
  2. **Suite/Cross-Feature Analysis** — kapabilitas baru (di luar Fase 2
     Step 21/22 dan di luar roadmap 5 fase awal): setelah "Jalankan Semua"
     selesai, AI menganalisis SEMUA test case sekaligus mencari
     inkonsistensi lintas fitur, coverage gap, dan pola kegagalan sistemik
     — bukan cuma per test case terisolasi. Tabel baru `suite_analysis_result`
     (migration 005, belum tercatat di `arsitektur-spesifikasi-teknis.md`
     bagian 3 sampai perbaikan dokumen ini).
  3. **Negative/boundary testing berbasis field constraint** — snapshot
     elemen form sekarang menangkap `required`/`maxlength`/`pattern`/
     `min`/`max`, dan prompt authoring wajib membuat skenario negatif nyata
     berdasarkan constraint itu (bukan improvisasi bebas LLM).
  Detail teknis penuh: `docs/memory.md` entri 2026-08-19 (3 entri terpisah).
- **Belum dikerjakan** dari audit ini (dicatat eksplisit, bukan diabaikan
  diam-diam): dry-run validasi steps sebelum simpan, CRUD round-trip
  eksplisit, prioritisasi risk-based urutan crawl, laporan halaman/interaksi
  yang terlewat karena kuota, dan persist `SiteModel` sebagai feature map
  lintas-generate (terkait tabel `feature_map` Fase 5 yang masih 0% dipakai).

### 2026-08-17
- Step 20 selesai: dashboard menunggu `run:analysis` setelah status terminal,
  menampilkan spinner analysis, lalu merender reason atau detail+solution di
  panel yang sama dengan video/trace. Kesimpulan ditahan bila bukti belum siap;
  polling REST menangani event WS terlewat dan berhenti terukur bila provider
  gagal. Badge latest analysis diperbarui realtime dan tersedia pada render
  awal/API list melalui satu query `LEFT JOIN LATERAL`.
- Warna status tervalidasi: success hijau, fail merah, bug oranye, anomaly
  kuning. Build lolos, 27 test lulus, serta E2E membuktikan realtime tanpa
  reload, hasil latest yang benar saat ada row lama, render setelah reload,
  dan tidak ada exception JavaScript dashboard.
- Step 18–19 selesai: `analyzeTestRun` mengambil provider default project,
  mencoba fallback berurutan hanya saat `ProviderError`, menyimpan
  `analysis_result` beserta provider dan raw response JSONB, lalu broadcast
  `run:analysis`. Adapter melakukan satu retry backoff untuk network/429/5xx.
  Executor otomatis enqueue analysis setelah status terminal dan artifact
  tersimpan; handler queue menangkap seluruh error agar worker tetap hidup.
  `GET /test-runs/:id` kini mengembalikan analysis result terbaru.
- Verifikasi: build lolos, 23 test lulus (fallback, semua provider gagal,
  non-provider error, retry, queue isolation), dan E2E membuktikan alur
  executor → analysisQueue → provider mock → DB → API tanpa call AI berbayar.

### 2026-08-16
- Step 16–17 selesai: kontrak `LLMClient`, `AnalyzerProvider`,
  `AnalyzerInput`, `AnalysisResult`, histori/healing, dan `ProviderError`
  diimplementasikan. Lima adapter memakai API resmi: Claude Messages, OpenAI
  Chat Completions, DeepSeek text-only, Kimi vision, serta OpenCode Zen
  multi-protocol berdasarkan keluarga model (Messages/Responses/Gemini/Chat).
  `STATUS_DEFINITIONS` terpusat dan output semua adapter dinormalisasi.
  `buildAnalyzerInput` memfilter/dedup console error-warning, network status
  error/response >3 detik, menghapus query URL, memparse trace, dan mengambil
  screenshot opsional. Build lolos, 18 test lulus, dan E2E membuktikan input
  analyzer terbentuk dari artifact nyata tanpa call provider berbayar.
- Step 14 selesai: review Fase 1 memastikan nama tabel/kolom repository selaras
  migration, payload WS sesuai kontrak, dan raw `process.env` hanya ada di
  config loader. Temuan audit diperbaiki: `project.base_url` dipakai sebagai
  Playwright `baseURL` untuk `goto` relatif, dashboard melakukan resync/polling
  status bila event WS terlewat, recovery startup juga menutup `queued`, serta
  panel final menyediakan unduhan video/trace/console/network via Bearer+blob.
  Ditambahkan `npm run test:e2e:phase1` yang menjalankan skenario `/login`
  relatif, live frame, passed, dan validasi isi empat artifact; data uji
  dibersihkan otomatis.
- Step 15 selesai: `parseTrace(traceZipPath)` membaca entry `.trace` langsung
  dari ZIP secara streaming, memasangkan event before/after berdasarkan
  callId, dan menghasilkan action/timing/error ringkas tanpa snapshot HTML
  atau network mentah. Output dibatasi 20 action dan teks dipotong agar tetap
  sekitar <2000 token. Build lolos dan seluruh 10 test lulus.

### 2026-08-15
- Step 12–13 selesai: gateway WebSocket `/ws` mewajibkan JWT query token,
  menolak token invalid dengan close code 4001, dan mengisolasi subscriber per
  runId. Screencast memakai CDP fallback Playwright dengan frame JPEG 640x360
  quality 50. Dashboard EJS + HTMX menyediakan login, daftar project/test case,
  Run tanpa reload, live frame/status/step, lalu video player dan link trace.
  Build lolos; 8 test lolos; verifikasi frame screencast nyata dan isolasi WS
  berhasil.
- Step 10–11 selesai: executor menangkap console/network event sebagai JSON
  terstruktur, reporter memindahkan video/trace/log ke
  `storage/artifacts/<runId>/` dan menyimpan metadata/size ke DB. Storage layer
  mendukung Buffer/source path, proteksi path traversal, serta ReadStream.
  Endpoint artifact sekarang streaming file dengan Content-Type sesuai.
  Verifikasi E2E menghasilkan empat artifact valid dan seluruh download 200.
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
