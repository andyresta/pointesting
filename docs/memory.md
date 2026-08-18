# Memory — AI Testing Tool

Dokumen ini menyimpan **konteks percakapan lintas sesi**. Dibaca di awal setiap sesi chat, dan diperbarui setiap ada perubahan penting (keputusan, progress, preferensi, blocker).

**Bukan pengganti** dokumen teknis lain:
- Aturan kerja AI (semua IDE selain Cursor) → `docs/instruction.md`
- Status step resmi → `docs/PROJECT_STATUS.md`
- Spesifikasi → `docs/arsitektur-spesifikasi-teknis.md`
- Urutan kerja → `docs/execution-plan-ai-testing-tool.md`
- Roadmap → `docs/roadmap-ai-testing-tool.md`

---

## Cara pakai (untuk AI & manusia)

1. **Awal sesi:** baca file ini dulu sebelum mengerjakan apa pun.
2. **Saat kerja:** catat di sini bila ada keputusan, preferensi user, blocker, atau progress berarti.
3. **Jangan** menyalin ulang seluruh spesifikasi — cukup ringkas + pointer ke dokumen yang relevan.
4. **Jangan** simpan data sensitif (password, API key, NIK, kredensial production).

---

## Snapshot proyek (saat ini)

| Item | Nilai |
|---|---|
| Nama project | `ai-testing-tool` (di repo `pointesting`) |
| Root kode | sejajar dengan `docs/` (bukan subfolder `ai-testing-tool/`) |
| Stack | Node.js + TypeScript (strict), Fastify, `ws`, `pg`, `dotenv`, `zod`, `@playwright/test`, EJS + HTMX, `yauzl` |
| Package manager | npm |
| Fase roadmap | Fase 2 (AI Analyzer) |
| Progress scaffolding | Step 1–20 selesai; Fase 1 sudah lulus E2E |

---

## Keputusan yang sudah disepakati

- Struktur folder mengikuti **persis** bagian "2. Struktur Proyek" di `arsitektur-spesifikasi-teknis.md`.
- Kode project diletakkan **satu level dengan `docs/`** (bukan di dalam folder `ai-testing-tool/`).
- Scaffolding awal murni: jangan implementasi logic di luar yang diminta per step.
- Semua call API/AJAX memakai **POST** (preferensi user — berlaku untuk implementasi API ke depan; health check GET `/health` tetap sesuai instruksi scaffolding).
- Balasan chat AI memakai **bahasa Indonesia**.
- Setiap fungsi baru wajib punya **Keterangan** (komentar singkat).
- Migration memakai SQL bernomor urut di `src/db/migrations/`; tracking lewat tabel `_migrations`.
- DDL 8 tabel diambil **persis** dari dokumen teknis (jangan ubah nama kolom/tipe).
- PK UUID memakai `gen_random_uuid()` (+ `CREATE EXTENSION IF NOT EXISTS pgcrypto`).
- Config env lewat `src/config/env.ts` (dotenv + Zod); server wajib pakai `config`, bukan `process.env` langsung.
- Koneksi DB tidak memakai connection string: `DB_HOST`, `DB_NAME`, `DB_PORT`, `DB_USER`, `DB_PASS`.
- Database lokal bernama `pointesting`; `DB_PORT` default 5432.
- Env wajib: `DB_HOST`, `DB_NAME`, `DB_USER`, `AUTH_SECRET`; `PORT` default 3000. API key provider opsional (boleh kosong).
- Validasi env gagal → pesan jelas + `process.exit(1)`.
- Route API mengikuti method persis tabel spesifikasi bagian 5 (GET/POST/PATCH campur) — bukan semua-POST, karena instruksi eksplisit user untuk step ini adalah "daftarkan sesuai tabel spesifikasi".
- Endpoint yang komponennya belum ada (queue, artifact-storage, auth) di-throw `ApiError(501, ...)` dengan pesan yang menyebut step mana yang akan mengimplementasikannya.
- Semua error API (terkontrol maupun tak terduga) dan 404 route memakai format konsisten `{ error: string, statusCode: number }` lewat global error handler.
- Autentikasi personal/single-user: credential (`AUTH_USERNAME` + `AUTH_PASSWORD_HASH` bcrypt) dari env, TANPA tabel user di database.
- Login berhasil → JWT signed `AUTH_SECRET`, masa berlaku 7 hari. Dikirim via
  header `Authorization: Bearer <token>`; login dashboard juga menyetel cookie
  HttpOnly SameSite=Strict agar route halaman/video dapat diautentikasi browser.
- Semua route data wajib JWT. Public: `GET /`, `GET /health`, `POST /auth/login`,
  `GET /dashboard/login`, serta asset statis dashboard. `GET /` me-redirect:
  JWT valid (cookie/Bearer) → `/dashboard`; selain itu → `/dashboard/login`.
- `bcrypt` (native, pakai prebuilt binary — tidak perlu compile) dan `jsonwebtoken` dipakai untuk hashing & JWT.
- Tiap provider AI di env sekarang juga punya `*_MODEL` (default aktif) dan `*_MODELS` (daftar pilihan, CSV) selain `*_API_KEY` — di-expose sebagai `config.providers.<nama>` yang sudah dirapikan (apiKey/defaultModel/availableModels).
- In-memory queue pakai `p-queue@6.6.2` (BUKAN versi terbaru) — p-queue v7+ ESM-only, sedangkan project ini `"type": "commonjs"`. Kalau mau upgrade p-queue nanti, harus pindah project ke ESM dulu atau pakai dynamic import.
- Dua named queue: `testRunQueue` (concurrency env `TEST_RUN_QUEUE_CONCURRENCY`, default 2) dan `analysisQueue` (`ANALYSIS_QUEUE_CONCURRENCY`, default 3).
- `POST /test-cases/:id/run` sudah full: insert `test_run` status `queued` →
  `enqueueTestRun` → balikan `202 { runId, status }`; queue worker menjalankan
  `executeTestRun` sungguhan.
- Server startup memanggil `recoverStaleRunningTestRuns()` (di `src/queue/queue.ts`) sebelum `app.listen` — test_run status `running` dari sesi sebelumnya di-mark `error` + `finishedAt` terisi.
- `src/runner/testcase-compiler.ts` (`executeSteps`) fail-fast: error step
  Playwright dikembalikan sebagai hasil failed (bukan throw). Callback opsional
  Step 12 dipanggil segera per step; error infrastruktur dari callback boleh
  diteruskan ke executor agar run menjadi `error`.
- Unit test compiler pakai `@playwright/test` sungguhan (bukan mock) terhadap fixture HTML lokal via `file://` URL — tidak perlu web server. `playwright.config.ts` set `actionTimeout: 3000ms` supaya skenario gagal (selector tidak ada) tidak nunggu default 30s.
- Browser Playwright (Chromium) diinstall via `npx playwright install chromium` (TANPA `--with-deps`, karena install system deps butuh sudo yang tidak tersedia di mesin ini). Kalau pindah mesin/CI, install ulang browser dulu sebelum `npm test`.
- `npm test` sekarang menjalankan `playwright test` (sebelumnya placeholder error).
- Pilihan model UI tidak lagi bergantung pada hardcoded `*_MODELS`: backend
  menyediakan `POST /ai/models` dan mengambil katalog dinamis dari endpoint
  resmi Claude/OpenAI/DeepSeek/Kimi/OpenCode Zen (cache 5 menit). `*_MODELS`
  tetap dipertahankan hanya sebagai fallback bila endpoint gagal/API key kosong.
- `OPENCODE_API_KEY` berarti API key OpenCode Zen; base katalog/runtime Zen
  adalah `https://opencode.ai/zen/v1`. Katalog `/models` saat ini publik, tetapi
  API key tetap diperlukan ketika model benar-benar dipanggil untuk inference
  pada implementasi provider adapter Step 16.
- OpenCode Go (`https://opencode.ai/zen/go/v1`, subscription $10/bulan, katalog
  curated) adalah produk TERPISAH dari OpenCode Zen (pay-as-you-go, katalog
  lengkap). Satu `OPENCODE_API_KEY` env masih cadangan terakhir; sumber utama
  sekarang tabel `project_provider` (API key diisi saat create/edit project).
  Pilih per project: `opencode` = Zen, `opencode-go` = Go.
- `src/runner/executor.ts` (`executeTestRun`) dan `src/generator/page-explorer.ts`
  (generate test case) memanggil `chromium.launch()` di luar unit test;
  video via `context` option
  `recordVideo: { dir }`, trace via `context.tracing.start/stop({ path })`.
  Video baru final setelah `context.close()`; browser SELALU ditutup di
  `finally` (guard `context`/`browser` bisa `undefined` agar tidak double-close).
- Temp video/trace disimpan di `os.tmpdir()/ai-testing-tool-runs/<runId>/`
  (BUKAN langsung di `./storage/artifacts/`) — sengaja, supaya jelas
  batasannya dengan Step 10 (`collectArtifacts`, pindah ke lokasi final +
  insert row `artifact`) dan Step 11 (`artifact-storage.ts`).
- Status akhir `test_run` di Step 9 murni dari keberhasilan step Playwright
  (`passed` kalau semua step passed, `failed` kalau ada yang gagal) — TIDAK
  mengecek field `expected` sama sekali; itu scope AI Analyzer Fase 2.
- `handleTestRunJob` di `queue.ts` sekarang memanggil `executeTestRun` asli
  (bukan console.log placeholder lagi); `executeTestRun` didesain tidak pernah
  throw (try-catch-finally berlapis) supaya satu job gagal tidak mematikan
  worker/queue.
- PENTING: `playwright.config.ts` (`actionTimeout: 3000ms`) HANYA berlaku
  untuk `npm test` (`playwright test`). `executor.ts` memanggil
  `chromium.launch()` langsung (bukan lewat test runner), jadi timeout
  default Playwright (30s per action) yang berlaku di sana, bukan 3000ms.
- Artifact final disimpan melalui `src/storage/artifact-storage.ts` ke
  `storage/artifacts/<runId>/`; path DB selalu relatif project. Source path
  dipindahkan dengan copy+unlink agar aman lintas filesystem (`/tmp` → repo).
- `src/runner/reporter.ts` mengubah nama video dinamis Playwright menjadi
  `video.webm`, memindahkan trace/log, lalu insert row artifact + size file.
- `GET /test-runs/:id/artifacts/:artifactId` sudah streaming file dengan
  Content-Type: video/webm, application/zip, application/json, atau image/png.
- Gateway WS berada di `/ws`; handshake wajib query `?token=<JWT>`. Token
  invalid/tidak ada ditutup code 4001 sebelum listener subscribe dipasang.
  Subscriber disimpan per runId dan dibersihkan saat unsubscribe/socket close.
- Playwright 1.62 belum mengekspos `page.screencast` di API publik/types, jadi
  live view memakai CDP `Page.startScreencast`: JPEG quality 50, maksimum
  640x360, setiap frame di-ack dan dibroadcast sebagai `run:frame`.
- Dashboard Step 13 memakai EJS + HTMX dari Fastify (`@fastify/view` dan
  `@fastify/static`), dengan halaman login serta `/dashboard`. JWT disimpan di
  `sessionStorage` untuk Authorization fetch dan query handshake WS; cookie
  HttpOnly tetap dipakai untuk navigasi dan media artifact.
- Executor memakai `project.baseUrl` sebagai Playwright `baseURL` supaya step
  `goto` relatif (`/login`) sesuai kontrak spesifikasi 4.1.
- Dashboard live view melakukan resync REST + polling 2 detik setelah subscribe
  agar status terminal tidak hilang bila event WS sudah lewat; unduhan artifact
  memakai fetch Bearer + blob URL (video/trace/console/network).
- Recovery startup menandai `running` dan `queued` lama sebagai `error` karena
  job in-memory hilang saat restart.
- E2E Fase 1 dibuat repeatable lewat `npm run test:e2e:phase1`: server aplikasi
  dan target web memakai port acak, JWT dibuat internal tanpa dicetak, lalu
  project/test case/run/artifact uji selalu dibersihkan.
- Trace parser memakai `yauzl` dengan lazy entry streaming. Hanya entry
  `.trace` diproses; `trace.network`, resources, dan snapshot HTML tidak masuk
  ringkasan karena network log sudah menjadi artifact terpisah.
- `TraceSummary` dibatasi maksimal 20 action; nama/error dipotong dan event
  sangat besar dilewati agar JSON tetap sekitar <2000 token. Event before/after
  dipasangkan melalui `callId`; timing berasal dari startTime/endTime trace.
- Provider layer memiliki dua kontrak: `LLMClient.complete()` generik untuk
  Fase 2/3/5 dan `AnalyzerProvider.analyze()` khusus klasifikasi Fase 2.
- Dukungan image: Claude/OpenAI/Kimi `true`; DeepSeek `false`; OpenCode Zen
  konservatif `false` karena kemampuan vision berbeda antar-model. Screenshot
  selalu diabaikan aman oleh provider text-only.
- OpenCode Zen dirutekan berdasarkan keluarga model: Claude → `/messages`,
  GPT/Grok → `/responses`, Gemini → `generateContent`, model lain →
  `/chat/completions`. Ini menjaga pilihan model dinamis tidak dipaksa ke satu
  protokol yang salah.
- Semua kegagalan network, HTTP/rate-limit, config kosong, dan output invalid
  dinormalkan sebagai `ProviderError` dengan provider/status/retryable untuk
  fallback Step 18.
- `STATUS_DEFINITIONS` hanya ada di `prompt-builder.ts`; semua adapter memakai
  definisi success/fail/bug/anomaly dan schema output yang sama.
- Prompt builder hanya memasukkan console error/warning dan network status
  0/>=400 atau response >3000ms; duplikat dihitung, query/hash URL dihapus,
  item/text dibatasi, trace diparse, screenshot opsional maksimal dua.
- Analyzer service mencoba `project.default_provider` lebih dulu, lalu provider
  lain yang API key-nya tersedia dalam urutan deterministik. Hanya
  `ProviderError` yang memicu fallback; error internal diteruskan agar tidak
  tertutup sebagai kegagalan vendor.
- Adapter melakukan maksimal dua attempt (satu retry backoff) untuk network,
  HTTP 429, dan 5xx sebelum analyzer service berpindah provider.
- `analysis_result.raw_response` menyimpan output asli model sebagai JSONB
  (atau hasil normalized untuk provider mock/custom), sedangkan event WS hanya
  mengirim hasil normalized + provider agar payload tetap ringkas.
- Executor enqueue analysis hanya setelah artifact dan status terminal
  (`passed`/`failed`/`error`) berhasil dipersist. Queue handler menangkap error
  analysis sehingga kegagalan AI tidak menjatuhkan proses/job lain.
- Dashboard tidak menutup WS saat status test terminal; subscription + polling
  dipertahankan sampai `run:analysis` tampil atau batas 30 polling/±60 detik.
  Ini mencegah event analysis hilang setelah artifact selesai lebih dulu.
- Kesimpulan AI hanya dirender setelah video atau trace siap pada run panel yang
  sama. Event analysis yang datang lebih cepat disimpan sementara; jika bukti
  gagal dimuat, kesimpulan disembunyikan.
- List test case memperoleh `latestAnalysisResult` lewat satu `LEFT JOIN
  LATERAL` per project (bukan N+1), tanpa `raw_response`; badge latest diperbarui
  realtime dan juga muncul pada initial render dashboard.
- Dashboard sampai Step 20 dapat dipakai tanpa setup via curl/API manual: project
  dibuat dari dialog dengan status provider/model runtime, sedangkan test case
  dibuat/diedit lewat step builder action-aware (goto/fill/click/check/select/
  waitFor), pengurutan step, validasi, dan spinner submit.

---

## Preferensi & aturan kerja user

- Komunikasi: langsung, ringkas, bahasa Indonesia.
- Jangan commit kecuali diminta.
- Jangan tambah scope di luar instruksi step yang sedang dikerjakan.
- Sensitive data tidak boleh masuk prompt/chat.
- Privacy Mode wajib (aturan workspace team).
- UI + AJAX: wajib spinner loading — di button untuk aksi tombol proses;
  di tengah halaman untuk muat/refresh halaman. Detail di `docs/instruction.md` §9.
---

## Yang sudah dikerjakan (ringkas)

### Scaffolding (Step 0 — sebagian)
- Folder: `src/api`, `src/ws`, `src/queue`, `src/runner`, `src/analyzer`, `src/storage`, `src/db`, `src/config`, `storage/artifacts`, `storage/fixtures`
- `package.json` scripts: `dev`, `build`, `start`, `migrate`
- `tsconfig.json` strict mode (`module`/`moduleResolution`: `nodenext` — TypeScript 7 tidak lagi mendukung `moduleResolution: node`)
- `.env` aktif (di-ignore git) dan `.env.example` memakai variable DB terpisah, PORT, AUTH_SECRET, key provider LLM
- `src/api/server.ts` — Fastify kosong + `GET /health` → `{ status: "ok" }` (PORT dari `config`)
- Node.js di mesin ini diinstall lewat **nvm** (v24 LTS) karena npm sistem belum ada / sudo butuh password

### Config loader (Step 2)
- `src/config/env.ts` — dotenv + Zod → export `config` strongly-typed
- Refactor `server.ts` memakai `config.PORT`
- `src/db/client.ts` memakai field koneksi terpisah dari `config`

### Database migration (Step 1)
- `src/db/migrations/001_init.sql` — 8 tabel: project, test_case, test_run, artifact, analysis_result, test_step_result, fixture, feature_map
- `src/db/client.ts` — Pool `pg` dari `DB_HOST/DB_NAME/DB_PORT/DB_USER/DB_PASS`
- `src/db/migrate.ts` — runner + tabel `_migrations`, idempotent
- Script: `npm run migrate`
- Sudah diverifikasi end-to-end terhadap PostgreSQL 16 (cluster sementara di `/tmp`, lalu dihapus)

### Repository layer (Step 3)
- Repository: project, test-case, test-run, artifact, test-step-result
- Masing-masing punya `create`, `findById`, `findAll(filter?)`, `update`
- Query nilai memakai parameter PostgreSQL; nama kolom update dibatasi whitelist
- Tipe entity/input ada di `src/db/repositories/types.ts`
- CRUD + filter sudah diuji end-to-end terhadap PostgreSQL 16 sementara

### API server skeleton (Step 4)
- `src/api/errors.ts` — `ApiError` (statusCode + message) untuk error terkontrol
- `src/api/error-handler.ts` — global error handler + not-found handler, format `{ error, statusCode }`
- `src/api/routes/project.routes.ts` — `POST /projects`, `GET /projects/:id` (full, pakai repository)
- `src/api/routes/testcase.routes.ts` — `POST/GET /projects/:id/test-cases`, `PATCH /test-cases/:id` (full); `POST /test-cases/:id/run` (501, tunggu Step 7/9); `GET /test-cases/:id/runs` (full)
- `src/api/routes/testrun.routes.ts` — `GET /test-runs/:id` awalnya artifact +
  analysis null; sejak Step 18 sudah mengembalikan analysis terbaru.
- `src/api/routes/auth.routes.ts` — `POST /auth/login` (501, tunggu Step 5)
- Semua route didaftarkan di `server.ts` bareng error handler
- Sudah diuji end-to-end (sukses, 400, 404, 501, 404-not-found-handler) terhadap database `pointesting`

### Autentikasi personal (Step 5)
- `src/config/env.ts` — tambah `AUTH_USERNAME`, `AUTH_PASSWORD_HASH` (wajib); tambah `*_MODEL`/`*_MODELS` per provider AI + `config.providers`
- `scripts/hash-password.ts` — utilitas CLI generate bcrypt hash, jalankan via `npm run hash-password -- "password"`
- `src/api/auth.middleware.ts` — `signAuthToken()`, `authMiddleware` (preHandler global, skip `/health` & `/auth/login`), augment `FastifyRequest.authUser`
- `src/api/routes/auth.routes.ts` — implementasi penuh `POST /auth/login` (cek username + `bcrypt.compare`, pesan error sama untuk username/password salah biar tidak bocorkan info)
- `server.ts` — daftarkan `authMiddleware` sebagai global preHandler hook
- Sudah diuji end-to-end: akses tanpa token (401), token salah format/invalid (401), login gagal (401/400), login sukses + akses protected route dengan token (sukses), `/health` & `/auth/login` tetap publik

### Test Case CRUD + Zod schema (Step 6)
- `src/api/schemas/testcase.schema.ts` — enum action resmi 4.1 (`goto/fill/click/check/select/waitFor`) dengan field wajib per action; `steps` ≥1, `expected` array string ≥1
- Route create/list/patch memakai schema; invalid → 400 dengan path field spesifik (`steps.0.url: ...`)
- Steps/expected tersimpan & terbaca kembali sebagai JSONB persis format dokumen

### Test Runner Executor (Step 9)
- `src/runner/executor.ts` — `executeTestRun(testRunId)`: ambil test_run+test_case, status `running`, launch Chromium, context (recordVideo + viewport 1280x720), tracing start (screenshots+snapshots), jalankan `executeSteps`, simpan `test_step_result` per step, tracing stop → `trace.zip`, close context (finalize video) → close browser, hitung status akhir (passed/failed murni dari step), update test_run (status/finishedAt/durationMs)
- Video+trace awalnya dibuat di temp dir OS, lalu dikumpulkan ke storage final
  oleh reporter Step 10–11.
- `queue.ts` — `handleTestRunJob` panggil `executeTestRun` asli (bukan placeholder)
- Try-catch-finally berlapis: error tak terduga → status `error`; browser/context selalu ditutup; `executeTestRun` tidak pernah throw

### Reporter + Artifact Storage (Step 10–11)
- `executor.ts` — capture console `{type,text,timestamp}` dan network
  `{url,method,status,responseTimeMs,timestamp}`; request gagal memakai status 0
- `src/runner/reporter.ts` — `collectArtifacts()` pindahkan video/trace/log ke
  final storage via storage layer, lalu insert metadata/size ke DB
- `src/storage/artifact-storage.ts` — `getArtifactDir`, `saveArtifact`,
  `getArtifactStream`; path traversal ditolak
- Route artifact tidak lagi 501: validasi run+artifact, lalu stream dengan
  Content-Type yang sesuai
- Unit test storage: Buffer, source path, ReadStream, dan path traversal

### Live View + Dashboard (Step 12–13)
- `src/ws/events.ts` — kontrak event run status/frame/step/analysis dan
  subscribe/unsubscribe.
- `src/ws/gateway.ts` — JWT handshake, Map subscriber per runId,
  `broadcastToRun`, cleanup subscription.
- `src/runner/screencast.ts` — CDP screencast controller; executor broadcast
  status dan hasil step serta selalu stop screencast sebelum context ditutup.
- `src/ui/` + `dashboard.routes.ts` — EJS + HTMX, login, daftar test case,
  tombol Run dengan spinner, live frame/status/step, video dan trace final.
- Verifikasi: handshake invalid → 4001; event run-a tidak bocor ke subscriber
  run-b; frame Chromium nyata diterima; build OK; `npm test` 8/8.

### Integrasi Fase 1 + Trace Parser (Step 14–15)
- `scripts/e2e-phase1.ts` — acceptance repeatable melalui dashboard: live frame,
  status passed, video player, trace link, empat artifact dapat diunduh dan
  isinya valid (WebM, ZIP, console event, network response).
- `src/analyzer/types.ts` — `TraceSummary` dan `TraceActionSummary`.
- `src/analyzer/trace-parser.ts` — parser ZIP streaming bounded tanpa extract
  resources/snapshot ke filesystem.
- Test parser memakai trace Playwright nyata, termasuk action gagal/error.
- Verifikasi akhir: build OK, `npm test` 10/10, E2E Fase 1 bersih.

### Provider Adapters + Prompt Builder (Step 16–17)
- `provider.interface.ts` dan `llm-client.interface.ts` menjadi kontrak tunggal
  Analyzer/LLM lintas fase.
- Lima adapter ada di `src/analyzer/providers/`; request vendor diuji dengan
  fetch mock tanpa memakai API key/call berbayar.
- `ProviderError` membawa provider, status HTTP, dan retryable.
- `buildAnalyzerInput(testRunId)` membaca expected + artifact, membuat ringkasan
  bounded, parse trace, dan screenshot Buffer opsional.
- Verifikasi: build OK, `npm test` 18/18; E2E artifact nyata menghasilkan
  AnalyzerInput dengan warning console, status network 503, expected, dan trace.

### Analyzer Service + Queue Integration (Step 18–19)
- `analysis-result.repository.ts` menyediakan CRUD/filter dan lookup hasil
  terbaru per run; route detail run tidak lagi selalu mengembalikan null.
- `analyzer.service.ts` mengorkestrasi lookup run→test case→project, prompt,
  fallback, persistensi provider/raw response, dan broadcast `run:analysis`.
- Executor otomatis memanggil `enqueueAnalysis`; import executor dari queue
  dibuat dinamis untuk menghindari circular dependency CommonJS.
- Verifikasi: 23 test lulus; E2E provider lokal membuktikan run terminal
  otomatis dianalisis, tersimpan, dan terbaca kembali melalui API.

### Dashboard Analysis Result (Step 20)
- `GET /projects/:id/test-cases` dan render EJS memuat analysis terbaru per test
  case; pemilihan latest memakai `created_at DESC, id DESC`.
- Dashboard menangani `run:analysis`, resync REST, spinner menunggu AI, badge
  empat warna, reason success, detail+solution untuk status lain.
- Lifecycle panel dipisah antara artifact-ready dan analysis-ready; rerun test
  case membangun ulang elemen live view agar tidak memakai DOM video lama.
- Verifikasi: 27 test lulus (browser nyata untuk empat status); E2E realtime,
  latest API dengan row lama pembanding, initial render setelah reload, dan
  page-error collector semuanya lulus.

### Test Case Compiler (Step 8)
- `src/runner/types.ts` — `Step` (union goto/fill/click/check/select/waitFor), `StepExecutionResult` (index/action/status/errorMessage/durationMs)
- `src/runner/testcase-compiler.ts` — `executeSteps(page, steps, onStepComplete?)`:
  jalankan berurutan, fail-fast, error Playwright menjadi result failed
- `playwright.config.ts` (root, baru dibuat) — `testDir: ./src`, `testMatch **/__tests__/**/*.spec.ts`, `actionTimeout: 3000`
- `src/runner/__tests__/fixtures/sample.html` + `testcase-compiler.spec.ts` — 3 test: semua action sukses, fail-fast selector tidak ada, waitFor timeout
- `package.json` script `test` → `playwright test`; `.gitignore` tambah `test-results/`, `playwright-report/`

### In-Memory Job Queue (Step 7)
- `src/queue/types.ts` — `TestRunJob`, `AnalysisJob`, union `QueueJob`
- `src/queue/queue.ts` — `testRunQueue`/`analysisQueue` (`p-queue@6`),
  `enqueueTestRun`/`enqueueAnalysis` (fire-and-forget), testRun handler aktif,
  analysis handler awalnya placeholder dan aktif sejak Step 19,
  `getQueueStats()`, recovery stale run
- `src/config/env.ts` — tambah `TEST_RUN_QUEUE_CONCURRENCY` (default 2), `ANALYSIS_QUEUE_CONCURRENCY` (default 3)
- `server.ts` — panggil `recoverStaleRunningTestRuns()` sebelum `app.listen`
- `testcase.routes.ts` — `POST /test-cases/:id/run` diimplementasikan penuh (bukan 501 lagi): insert test_run + enqueue, balikan 202

---

## Belum dikerjakan / catatan terbuka

- `.env` lokal sudah dibuat, tetapi nilai `DB_PASS`/`AUTH_SECRET` tetap harus diganti user sesuai environment nyata.
- Role/user PostgreSQL sistem (`andyresta`) belum dibuat — akses peer auth ke cluster sistem belum tersedia tanpa sudo.
- `.env` lokal berisi contoh password (`admin123`, hash bcrypt) dan contoh nama model per provider (`claude-sonnet-4-5`, `gpt-5`, dst.) — hanya untuk dev lokal, WAJIB diganti user sesuai kredensial & model yang benar-benar tersedia di akunnya sebelum dipakai nyata.
- Validasi Zod body test case sudah ada (Step 6); validasi Zod untuk resource lain (project, auth) masih manual dasar.
- Belum ada endpoint HTTP untuk expose `getQueueStats()` — fungsinya sudah ada di `queue.ts`, tapi belum diminta jadi route API.

---

## Log sesi (append-only, terbaru di atas)

### 2026-08-18 — Layout generate dibuat scrollable + header ringkas
- Bug: halaman generate tidak bisa discroll (viewport dipaksa `height:100vh;
  overflow:hidden`) dan header (eyebrow+title+url) terlalu tinggi.
- Fix: `.generate-layout-page`/`.generate-shell` sekarang `min-height:100vh`
  (boleh scroll natural bila konten lebih tinggi dari viewport). Toolbar
  eyebrow dihapus (redundan dengan nav-link aktif), title+url jadi 1 baris
  (`generate-toolbar-heading`, align-items:baseline), padding dipepetkan.
  Panel tetap kartu bermargin (dari task sebelumnya), sekarang `min-height:70vh`
  (bukan height:100% kaku).

### 2026-08-18 — Eksplorasi multi-halaman sebelum generate (comprehensive)
- Keputusan (eksplisit user, override keputusan sebelumnya yang menolak ini):
  AI sekarang menjelajahi menu navigasi utama (bukan hanya halaman
  pasca-login) sebelum generate test case, supaya cakupan lebih komprehensif.
- Scope disepakati via pertanyaan terstruktur: (1) ikuti item menu navigasi
  atas saja, max **6 halaman** (bukan crawl tanpa batas/manual list); (2)
  snapshot halaman tambahan **ringkas saja** (judul+heading+label tombol,
  TANPA id/selector/letak) supaya prompt tidak membengkak (payload besar
  sudah jadi penyebab timeout sebelumnya); (3) tetap **1x panggilan LLM
  final** (bukan 1 panggilan per halaman) yang menerima konteks gabungan.
- Implementasi murni Playwright (tanpa LLM call tambahan) di
  `page-explorer.ts`: `extractTopNavLinks` (kandidat `<a href>` di y≤140px,
  exclude hash/javascript/mailto, logout/hapus/delete, beda origin, URL
  sama), `crawlAdditionalPages` (goto tiap kandidat, timeout 10s per halaman,
  skip yang gagal, balik ke URL semula di akhir), `summarizePageForPrompt`,
  `formatPageSummariesForPrompt`.
- `generator.service.ts`: `LiveExplorationContext.crawlAdditionalPages`
  dipanggil sekali setelah instruction (baik ada langkah maupun tidak),
  hasil disiarkan ke panel log (`AI sedang menjelajahi halaman "..."`).
  `additionalPages` masuk ke prompt final via `buildGenerationUserPrompt`.
- System prompt generate: boleh bikin test case navigasi (goto+waitFor) ke
  halaman ringkasan itu, TAPI dilarang fill/click di sana (tidak ada
  selector-nya) — mencegah LLM mengarang selector untuk halaman yang cuma
  diringkas.
- Constants: `MAX_ADDITIONAL_PAGES = 6` di `generator.service.ts`.
- Test baru: `page-explorer.spec.ts` (extractTopNavLinks/summarize/format),
  `prompt-generation.spec.ts` (crawl terpanggil, ringkasan masuk prompt).

### 2026-08-18 — Resiliency panggilan provider AI (timeout/jaringan)
- Blocker ditemukan: generate berhenti total setelah login karena panggilan
  LLM kedua (`generate test case`) timeout ke `opencode-go` — koneksi ke
  `opencode.ai` dari server ini terukur tidak stabil (0,9s–12,6s untuk
  request ringan yang sama). Karena project hanya punya 1 provider
  terkonfigurasi, tidak ada fallback saat itu gagal.
- Keputusan (eksplisit user): perbaiki resiliency saja, TIDAK menambah
  eksplorasi multi-halaman setelah login (itu di luar scope saat ini).
- `provider-utils.ts` (`postProviderJson`, dipakai semua provider):
  timeout 30s→45s, max attempt 2→3, backoff 250ms→800ms per attempt.
  Pesan error kini beda antara timeout (`Request timeout setelah 45 detik…`)
  dan koneksi putus (`Request jaringan gagal`).
- Catatan: desain generate tetap 1 siklus (analisis awal → jalankan
  instruction sekali → snapshot ulang sekali → generate) — TIDAK crawl
  menu/halaman lain setelah login. Kalau user mau itu nanti, perlu task baru.

### 2026-08-18 — Generate Test Script di halaman full-width
- Keputusan (eksplisit user): panel generate tidak lagi di dalam kartu
  project (terbatas `.container` 1280px). Tombol **Generate Test Script**
  membuka halaman baru `GET /dashboard/projects/:id/generate`.
- Halaman full viewport: navbar lebar, kiri log, kanan Playwright.
  Instruction kosong → alert di dashboard / redirect server ke `/dashboard`.
- Job auto-start saat halaman dimuat (`POST /projects/:id/generate/prompt`
  body `{}`). Selesai → kembali ke dashboard. ExtraData tidak di-render HTML.

### 2026-08-18 — Instruction hanya simpan; generate di kartu project
- Keputusan (eksplisit user): modal Instruction hanya menyimpan teks
  (prompt + extraData) ke project. Tombol **Generate Test Script** ada di
  panel kartu project, memakai instruction tersimpan.
- `POST /projects/:id/instruction`; generate body prompt opsional (fallback
  kolom `project.instruction` / `extra_data`, migration 004).

### 2026-08-18 — Result provider AI ke console server
- Keputusan (eksplisit user): setiap response LLM (generate + analyzer)
  ditulis ke stdout terminal (`[ai] <provider> model=...` + isi result).
- Prompt, API key, dan extraData tidak dilog. Error provider ke stderr
  dengan prefix yang sama. Wrapper di `createLLMClient`.

### 2026-08-18 — Generate live: isi instruction + panel light full width
- Keputusan (eksplisit user): panel generate tidak gelap; menyesuaikan tema
  light dashboard, dan lebar mengikuti container. Playwright tidak boleh diam
  di halaman login — harus mengisi form sesuai instruction/data tambahan.
- Alur live: buka halaman → analisis → LLM langkah singkat → `executeSteps`
  (fill/click terlihat di screencast) → analisis ulang → generate test case.
- Screencast generate 1280x720. Nilai isian tidak ditulis di log panel.

### 2026-08-18 — Live panel generate (kiri log, kanan Playwright)
- Keputusan (eksplisit user): saat Instruction/generate, dashboard menampilkan
  panel split — kiri progres AI (“sedang menganalisis…”, “sedang generate…”),
  kanan tampilan Playwright (screencast JPEG, sama seperti live run).
- `POST /projects/:id/generate/prompt` sekarang 202 `{ generateId, status }`
  lalu job di `testRunQueue`. WS reuse `subscribe:run` + `run:frame`; event
  baru `generate:status` / `generate:done` / `generate:error`.
- Browser tetap terbuka selama LLM. Test case hasil generate wajib punya
  `description` (keterangan 1–2 kalimat), kolom baru di `test_case`
  (migration 003). Kartu dashboard menampilkan keterangan itu.
- File: `page-explorer.ts`, `generator.service.ts`, `queue.ts`, `events.ts`,
  dashboard EJS/JS/CSS.

### 2026-08-18 — Generate AI wajib analisis tampilan halaman
- Keputusan (eksplisit user): test case hasil Instruction tidak boleh
  mengarang selector. Playwright membuka Base URL project, memetakan
  tombol/input (id, name, data-testid, teks, letak x/y), lalu LLM wajib
  memakai selector dari snapshot itu.
- Base URL kosong → 400. Halaman gagal dibuka → 502, generate dibatalkan
  (tidak fallback ke tebakan). MCP Step 23 masih belum; pakai Chromium
  yang sudah ada di runner.
- File: `src/generator/page-explorer.ts`.

### 2026-08-18 — Instruction mengganti Tambah Test Case (generate via AI)
- Keputusan (eksplisit user): tombol "Tambah Test Case" diganti **Instruction**.
  Default test case disusun AI dari prompt (+ data tambahan opsional).
  User tetap bisa edit hasilnya, atau "Buat manual" dari dialog yang sama.
- `POST /projects/:id/generate/prompt` memakai LLMClient project (fallback
  provider sama seperti analyzer). MCP explore (Step 23) dan tabel draft
  belum dipakai — hasil langsung insert `test_case` `source=ai_prompt`.
- File: `src/generator/prompt-generation.ts`, `generator.service.ts`,
  `src/api/routes/generator.routes.ts`.

### 2026-08-18 — Default provider via checklist + ikon edit/hapus
- Keputusan (eksplisit user): dropdown "Default AI provider" dihapus karena
  ambigu. Default dipilih lewat checkbox di baris API key provider (satu
  yang boleh aktif). `defaultProvider` tetap dikirim ke API dari baris
  yang dicentang.
- Kartu project: Edit dan Hapus memakai ikon (bukan teks). Hapus lewat
  `POST /projects/:id/delete` setelah konfirmasi; CASCADE di schema
  menghapus data terkait.

### 2026-08-18 — Dropdown model dari katalog provider (tanpa hardcode)
- Keputusan: daftar model di form project diambil live dari API provider
  lewat `POST /ai/models` (bukan input teks / daftar hardcoded di UI).
  `*_MODELS` env tetap fallback bila endpoint gagal atau key kosong.
- `POST /ai/models` menerima `provider` + `apiKey` (key baru di form) atau
  `projectId` (pakai key terenkripsi di `project_provider`).
- UI: `<select name="defaultModel">` per baris provider; spinner kecil saat
  fetch. Model tersimpan yang belum ada di katalog tetap ditampilkan.

### 2026-08-18 — API key per project (tabel terpisah + fallback)
- Keputusan (eksplisit user): API key tidak lagi hanya dari `.env`. User
  mengisi key saat create/edit project. Tabel baru `project_provider`
  (satu project, banyak provider). Default provider dicoba dulu, baris lain
  jadi fallback; `.env` tetap cadangan terakhir jika project belum punya key.
- Keamanan: key di-encrypt AES-256-GCM (`AUTH_SECRET`) di `api_key_cipher`.
  API/UI hanya mengembalikan mask (`••••abcd`), tidak pernah plaintext.
  Fastify logger meredact `req.body.providers[*].apiKey`.
- Dikerjakan: migration `002_project_provider.sql`, repository, factory
  analyzer per-key, form multi-baris "Tambah cadangan", PATCH/POST project
  menerima `providers[]`.

### 2026-08-18 — Header compact, edit project, OpenCode Zen vs Go
- UI: hapus eyebrow "Pointesting" di toolbar; judul "Project & Test Case"
  diperkecil (`.page-title` 1.15rem). Kartu project menampilkan provider aktif
  dan tombol **Edit Project**.
- API: `PATCH /projects/:id` (edit name/baseUrl/defaultProvider); validasi
  defaultProvider terhadap `PROVIDER_NAMES`.
- Keputusan OpenCode (eksplisit user): **satu API key** (`OPENCODE_API_KEY`)
  untuk Zen dan Go; produk dipilih sendiri di form project (`opencode` vs
  `opencode-go`). Go butuh subscription; katalog/runtime base URL berbeda.
- Dikerjakan: provider `opencode-go` di env/katalog/analyzer/adapter; env
  opsional `OPENCODE_GO_MODEL`/`OPENCODE_GO_MODELS`. `.env.example` dikosongkan
  dari nilai API key nyata (jangan simpan rahasia di example).

### 2026-08-18 — Fix: klik link navbar bikin dashboard stuck loading
- Bug: `<body hx-boost="true">` (dashboard.ejs & login.ejs) bikin htmx
  intercept klik `<a>` navbar jadi AJAX swap body, lalu `dashboard.js`
  (script classic, top-level `const`/`let`) tereksekusi ulang setelah swap →
  `SyntaxError: Identifier ... already declared`; `initializeDashboard()`
  gagal jalan lagi → `#page-loading` nyangkut selamanya ("memuat terus").
- Keputusan: hapus `hx-boost="true"` dari `<body>` — app ini tidak pakai
  fitur htmx lain (tidak ada `hx-get`/`hx-post`), form dialog malah sudah
  eksplisit `hx-boost="false"` sebelumnya (antisipasi masalah serupa untuk
  submit form). Navigasi jadi full page load standar.
- Verifikasi: build OK; 30/30 test tetap lulus.

### 2026-08-18 — Remake UI dashboard: navbar horizontal + responsive
- Keputusan (dari AskQuestion user): navbar isi Dashboard, menu user
  (username+Logout), placeholder Fase 3–5 ("Segera hadir", non-klik), dan
  search project/test case. Mobile: navbar tetap horizontal scrollable
  (bukan hamburger).
- Dikerjakan: navbar sticky (`.navbar`) dengan CSS grid area brand/nav/search/
  user; toolbar halaman terpisah dari navbar (`.page-toolbar`); daftar project
  dibungkus `.project-list` jadi grid 2 kolom di layar ≥900px; search client-side
  (filter `.project-card`/`.test-case` by nama, tanpa API baru) dengan debounce
  120ms; dropdown user menu (klik luar/Escape menutup); `renderUserIdentity`
  decode payload JWT (base64, tanpa verifikasi signature — hanya tampilan,
  bukan keputusan auth) untuk tampilkan username.
- Endpoint baru: `POST /auth/logout` (publik di middleware, supaya tetap bisa
  clear cookie walau token sudah kedaluwarsa) — set cookie `auth_token`
  Max-Age=0. Client hapus `sessionStorage` lalu redirect `/dashboard/login`.
- Semua id/class yang dipakai `dashboard.js` dan test Playwright (dashboard-crud,
  dashboard-analysis) dipertahankan persis; hanya menambah pembungkus baru.
- Verifikasi: build OK; 30/30 test (setelah `npx playwright install chromium`
  karena browser belum terpasang di mesin ini — sudah terpasang sekarang).

### 2026-08-18 — Gerbang `/` redirect login/dashboard
- Keputusan: `GET /` publik; JWT valid → `/dashboard`, tidak ada/invalid →
  `/dashboard/login` (bukan 401 JSON).
- Dikerjakan: `getValidAuthUser` di auth middleware + route redirect di
  dashboard.routes.

### 2026-08-18 — Set docs/memory.md sebagai Cursor memory
- Keputusan: `docs/memory.md` adalah memory lintas sesi (bukan status step,
  bukan instruction). Rule Cursor `.cursor/rules/memory.mdc` always apply
  menunjuk file ini + snapshot ringkas; detail keputusan/log tetap di sini.
- Dikerjakan: perkuat `memory.mdc` dan pointer di `AGENTS.md`.

### 2026-08-18 — Set docs/instruction.md sebagai Cursor rules
- Dikerjakan: `docs/instruction.md` di-set ke `.cursor/rules/` —
  `instruction.mdc` (always apply), `code.mdc` (`*.ts/js/sql`),
  `ui-ajax.mdc` (`src/ui/**`). `memory.mdc` tetap always apply, fokus memory.
- `AGENTS.md` menunjuk ke file instruction + rules Cursor.

### 2026-08-17 — CRUD UI Lengkap sampai Step 20
- Dikerjakan: dialog create project, indikator konfigurasi provider/model,
  create/edit test case, dynamic step builder, expected-result editor,
  validasi, responsive layout, error state, dan spinner anti-double-submit.
- Verifikasi: build OK, 30/30 test; E2E sekarang membuat project dan test case
  melalui UI sebelum Run, lalu membuktikan live frame, artifact, analysis queue,
  badge terbaru, dan tidak ada page error.

### 2026-08-17 — Dashboard Analysis Result (Step 20)
- Keputusan: hasil AI tidak boleh tampil sebelum video/trace siap; event analysis
  cepat ditahan, sedangkan event terlewat dipulihkan lewat polling bounded.
- Dikerjakan: latest-analysis query tanpa N+1, response API/list badge, panel
  realtime, empat warna status, reason/detail/solution, spinner, dan rerun-safe
  DOM lifecycle.
- Verifikasi: build OK, 27/27 test; E2E realtime + reload + latest row ordering
  lulus dan tidak menemukan page error. Provider tetap mock lokal.

### 2026-08-17 — Analyzer Service + Queue Integration (Step 18–19)
- Keputusan: fallback hanya untuk `ProviderError`; default provider tetap dicoba
  dulu walau key kosong agar kegagalan config tercatat, provider fallback hanya
  yang memiliki API key.
- Dikerjakan: repository analysis_result, retry adapter, orchestration fallback,
  raw response JSONB, broadcast typed, auto-enqueue terminal, queue boundary,
  dan response analysis terbaru pada detail run.
- Verifikasi: build OK, 23/23 test; E2E executor→queue→provider deterministik
  lokal→DB→API lulus tanpa mengirim API key atau melakukan call AI berbayar.

### 2026-08-16 — Provider Adapters + Prompt Builder (Step 16–17)
- Keputusan: DeepSeek text-only; Kimi vision aktif berdasarkan docs resmi;
  OpenCode Zen memakai routing protokol per keluarga model dan text-only
  konservatif pada level provider.
- Dikerjakan: interface LLM/analyzer, ProviderError, lima adapter,
  STATUS_DEFINITIONS, filter/dedup/sanitasi log, trace+screenshot assembly.
- Verifikasi: 18 test lulus dengan mock semua protokol dan rate-limit; E2E
  membuktikan `buildAnalyzerInput` dari artifact run nyata. Tidak ada API key
  dicetak atau provider berbayar yang dipanggil.

### 2026-08-16 — E2E Fase 1 + Trace Parser (Step 14–15)
- Review: kolom repository selaras migration; event WS selaras kontrak 4.3;
  `process.env` hanya ada di `src/config/env.ts`. Audit menemukan blocker
  `base_url`, late-subscribe WS, recovery `queued`, dan unduhan log UI —
  semua sudah diperbaiki sebelum penutupan step.
- Dikerjakan: script E2E repeatable, `TraceSummary`, parser `yauzl` streaming,
  test trace nyata sukses+gagal, export `buildServer`, serta hardening
  executor/dashboard/queue dari temuan audit.
- Verifikasi: skenario `goto /login` relatif + live frame + status passed +
  video/trace/console/network dapat diunduh; trace summary 5 action; build OK
  dan `npm test` 10/10. Data/file E2E dibersihkan otomatis.

### 2026-08-15 — Screencast Live View + Dashboard (Step 12–13)
- Dikerjakan: WS gateway terautentikasi dan terisolasi per runId, event contract,
  CDP screencast, broadcast status/step, dashboard EJS+HTMX dan asset UI.
- Keputusan: pakai CDP fallback karena Playwright terpasang belum punya API
  publik `page.screencast`; cookie JWT HttpOnly untuk navigasi/media dan
  sessionStorage untuk Bearer fetch serta query WS.
- Verifikasi: build OK; `npm test` 8/8; invalid JWT close 4001; isolasi runId
  lolos; frame JPEG Chromium nyata diterima melalui gateway.

### 2026-08-15 — Reporter + Artifact Storage (Step 10–11)
- Dikerjakan: listener console/network di executor, JSON log, reporter,
  filesystem storage layer, metadata artifact DB, endpoint stream/download.
- Keputusan: network timing dipasangkan berdasarkan object Request (lebih aman
  daripada URL saja untuk request paralel ke URL sama); request gagal status 0.
- Verifikasi: build OK; `npm test` 6/6; E2E DB terisolasi menghasilkan status
  passed, empat artifact (`video/trace/console_log/network_log`) dengan path
  final valid; console/network JSON terstruktur; keempat endpoint download 200
  dengan Content-Type dan body non-kosong. DB dan file verifikasi dibersihkan.

### 2026-08-15 — README.md proyek
- Dikerjakan: `README.md` root — deskripsi alat automate testing web + AI,
  status WIP, yang sudah/belum, setup cepat, pointer ke docs.

### 2026-08-15 — Preferensi UI: spinner loading wajib
- Keputusan: setiap UI + AJAX wajib spinner — di button (aksi proses) atau
  di tengah halaman (muat halaman). Tercatat di `docs/instruction.md` §9,
  `.cursor/rules/memory.mdc`, dan preferensi di memory ini.

### 2026-08-15 — docs/instruction.md untuk AI IDE selain Cursor
- Dikerjakan: `docs/instruction.md` — aturan kerja portable (bahasa, Keterangan,
  scope, memory, git, keamanan, arsitektur singkat, checklist, template prompt
  awal) agar bisa di-set sebagai project instructions / AGENTS.md / system
  prompt di Windsurf, Copilot, Continue, Cline, Aider, Claude Code, dsb.
- Catatan: di Cursor tetap pakai `.cursor/rules/`; file ini untuk IDE lain.

### 2026-08-15 — Test Runner Executor (Step 9)
- Keputusan: video/trace disimpan ke temp dir OS dulu (`os.tmpdir()`), BUKAN langsung ke `./storage/artifacts/<run_id>/` — menjaga batas scope dengan Step 10 (collect+relocate+insert artifact row) dan Step 11 (abstraksi storage), sesuai urutan prompt di execution plan.
- Keputusan: status akhir test_run murni dari keberhasilan step (tidak cek `expected`) — sesuai instruksi eksplisit user, expected jadi tugas AI Analyzer Fase 2.
- Dikerjakan: `src/runner/executor.ts` (`executeTestRun`), wire `queue.ts` (`handleTestRunJob` panggil executor asli, bukan placeholder).
- Verifikasi end-to-end via PostgreSQL 16 sementara: run dengan steps valid → status `passed`, semua test_step_result `passed`, file `.webm`+`trace.zip` ada di temp dir; run dengan selector tidak ada → status `failed` setelah timeout Playwright 30s, error message tersimpan; testRunId tidak ada di DB → `executeTestRun` tidak throw, hanya log; tidak ada proses chromium menggantung setelah run selesai (dicek `ps aux`).
- Follow-up: console/network log listener (Step 10) belum dipasang; artifact belum dipindah ke storage final + belum ada row `artifact` (Step 10/11).

### 2026-08-15 — Katalog model provider dinamis + OpenCode Zen
- Keputusan: `*_MODELS` bukan sumber utama pilihan UI lagi; hanya fallback.
- Dikerjakan: `src/analyzer/model-catalog.ts` (discovery kelima provider,
  timeout 10 detik, cache 5 menit, fallback env), `POST /ai/models`, registrasi
  route di server, koreksi default/fallback OpenCode menjadi model Zen valid.
- Keamanan: API key hanya dipakai backend dalam header request provider dan
  tidak pernah dikirim ke UI.
- Verifikasi: build/lint OK; katalog publik OpenCode Zen terambil langsung
  dengan `source=provider` dan 62 model pada saat pengujian.
- Follow-up: pemanggilan inference OpenCode/adapter analyzer tetap Step 16;
  saat ini endpoint ini menyiapkan pilihan model dinamis untuk UI.

### 2026-08-15 — Test Case Compiler (Step 8)
- Keputusan: `playwright.config.ts` akhirnya dibuat sekarang (bukan di Step 0) karena baru butuh nyata untuk menjalankan unit test Playwright Test yang diminta step ini.
- Dikerjakan: `src/runner/types.ts`, `src/runner/testcase-compiler.ts` (`executeSteps`, fail-fast, tidak throw), fixture HTML lokal, 3 unit test, update `package.json` script `test`, `.gitignore`.
- Verifikasi: build OK; install browser Chromium lokal (tanpa `--with-deps`, tidak ada akses sudo); `npm test` → 3/3 test lolos (semua action sukses berurutan, fail-fast selector tidak ada, waitFor timeout gagal dengan benar).
- Follow-up: `executeSteps` belum dipanggil dari executor sungguhan — itu scope Step 9.

### 2026-08-15 — In-Memory Job Queue (Step 7)
- Keputusan: pakai `p-queue@6.6.2` (bukan versi terbaru v7-9) karena versi terbaru ESM-only, project ini masih CommonJS.
- Keputusan: `POST /test-cases/:id/run` sekalian diimplementasikan penuh (insert test_run + enqueue + balikan 202/runId) — bukan cuma bikin fungsi queue tanpa dipakai, karena acceptance criteria Step 7 minta "fire and forget dengan id balikan" dan sequence 6.1 sudah jelas menyebut bagian ini di level API.
- Dikerjakan: `src/queue/types.ts`, `src/queue/queue.ts` (dua named queue + enqueue functions + placeholder handler + `getQueueStats` + `recoverStaleRunningTestRuns`), tambah env concurrency, wire ke `server.ts` startup dan route run.
- Verifikasi: build OK; end-to-end via PostgreSQL 16 sementara — trigger run balikan 202+runId instan, log placeholder muncul; test manual concurrency=2 dengan 5 job simulasi (slow task) — 2 jalan bersamaan, 3 nunggu, `getQueueStats` akurat; simulasi restart server dengan test_run status `running` → otomatis jadi `error` + `finishedAt` terisi saat startup berikutnya.

### 2026-08-15 — Test Case CRUD + Zod schema (Step 6)
- Dikerjakan: `testcase.schema.ts` (discriminatedUnion per action 4.1), refactor create/list/patch routes.
- Verifikasi: create format dokumen OK; invalid action/field → 400 path spesifik; GET mengembalikan struktur sama; PATCH valid/invalid OK.

### 2026-08-15 — Autentikasi personal (JWT) + model per provider di env
- Keputusan: kredensial personal dari env (`AUTH_USERNAME` + `AUTH_PASSWORD_HASH`), tanpa tabel user; JWT 7 hari; global preHandler hook kecuali `/health` & `/auth/login`.
- Keputusan: env provider AI diperluas dari sekadar `*_API_KEY` jadi juga `*_MODEL` (default) + `*_MODELS` (daftar pilihan CSV), diekspos rapi lewat `config.providers`.
- Dikerjakan: `auth.middleware.ts`, implementasi `POST /auth/login`, `scripts/hash-password.ts`, update `env.ts`/`.env`/`.env.example`.
- Verifikasi: build OK; login sukses/gagal, akses protected route dengan/tanpa/token-salah semua sesuai ekspektasi (401/200/201).

### 2026-08-15 — API server skeleton (routes + error handler)
- Dikerjakan: `project.routes.ts`, `testcase.routes.ts`, `testrun.routes.ts`, `auth.routes.ts`, `errors.ts`, `error-handler.ts`; didaftarkan di `server.ts`.
- Keputusan: endpoint yang komponennya belum ada di-throw `ApiError(501, ...)` (bukan silently sukses), agar jelas mana yang masih placeholder.
- Verifikasi: build OK; seluruh endpoint diuji manual (sukses/400/404/501/404-not-found) terhadap database `pointesting`, lalu data uji dibersihkan.

### 2026-08-15 — Repository layer + konfigurasi DB terpisah
- Keputusan: connection string `DATABASE_URL` diganti field `DB_HOST/DB_NAME/DB_PORT/DB_USER/DB_PASS`; DB bernama `pointesting`.
- Dikerjakan: lima repository CRUD/filter + tipe entity + helper parameterized update.
- Verifikasi: build/lint OK dan CRUD repository lulus terhadap PostgreSQL 16 sementara.

### 2026-08-15 — Config env (Zod) + refactor server
- Dikerjakan: `src/config/env.ts`, refactor `server.ts` pakai `config.PORT`.
- Verifikasi: build OK; missing `AUTH_SECRET` → exit 1 + pesan jelas; PORT default 3000; `/health` OK.

### 2026-08-15 — Scaffolding + migration + memory
- User minta scaffolding sesuai arsitektur; awalnya dibuat di subfolder `ai-testing-tool/`, lalu diminta dipindah ke root sejajar `docs/`.
- User minta sistem migration SQL + client + migrate runner.
- User minta `docs/memory.md` + instruction agar setiap sesi baca & update memory.

---

## Template entri log (salin saat menambah)

```
### YYYY-MM-DD — judul singkat
- Keputusan:
- Dikerjakan:
- Blocker / follow-up:
```
