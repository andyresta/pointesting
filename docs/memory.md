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
- ~~`docs/arsitektur-spesifikasi-teknis.md` §9 kontradiktif soal MCP~~ —
  **selesai** 2026-08-19 (lihat entri "Menutup gap test McpExplorationDriver").
- ~~`docs/PROJECT_STATUS.md` stale soal Fase 3/MCP~~ — **selesai** 2026-08-19,
  Step 23 diubah Planning→Done dengan catatan perbedaan dari desain asli.
- ~~Test `McpExplorationDriver` end-to-end untuk crawl kompleks~~ —
  **selesai** 2026-08-19, `page-explorer-mcp.spec.ts` (backdrop/hamburger/
  dropdown, 3/3 lolos, perlu `test.setTimeout(45_000)` karena overhead
  round-trip MCP lebih besar dari Playwright langsung — bukan bug).
- **[2026-08-19, Integrasi MCP Playwright, BUTUH INPUT USER]** Belum ada E2E
  terhadap app nyata (bukan fixture lokal) untuk memastikan mesin eksplorasi
  berbasis MCP benar-benar berperilaku sama seperti Playwright langsung di
  kondisi produksi nyata (login sungguhan, app dengan JS berat, dst.) — perlu
  URL app nyata dari user, tidak bisa ditebak/diasumsikan AI.
- ~~Prioritas 4 (CRUD round-trip eksplisit)~~ — **selesai** 2026-08-19, lihat
  entri "Prioritas 4: CRUD round-trip eksplisit".
- ~~Prioritas 5 (risk-based crawl prioritization + laporan cakupan terlewat)~~
  — **selesai** 2026-08-19, lihat entri "Prioritas 5: prioritisasi risk-based
  crawl + laporan cakupan yang terlewat". **Semua 6 item audit QA generate
  test script (Prioritas 1–6) sudah tuntas** kecuali Prioritas 6 lama
  (persist SiteModel sebagai feature map — belum pernah diminta eksplisit).
- Item TERAKHIR yang masih terbuka dari seluruh rangkaian sesi ini: E2E
  terhadap app nyata (lihat item MCP Playwright di atas — butuh URL dari
  user, tidak bisa ditebak AI).

---

### 2026-08-19 — Fix live Playwright preview terpotong (generate + test case)

- User: sidebar kiri sudah scroll OK; panel kanan live frame terpotong — seluruh
  halaman web harus muat di container.
- **Root cause:** placeholder dan `.live-frame` sebagai sibling grid default
  ditumpuk vertikal (2 baris), bukan overlap; rule global `max-height: 480px`
  ikut membatasi frame di layout lain.
- **Fix CSS:** `.generate-view` grid 1 sel (`grid-area: 1/1`) untuk placeholder
  + frame; `object-fit: contain` + `width/height: 100%`; mode replay (`:has(.artifact-links)`)
  flex column; rule 480px di-scope ke `.run-content` saja.
- File: `src/ui/public/styles.css`.

### 2026-08-19 — Test case order DB default + preview Playwright langsung

- User: pada halaman `test-cases`, daftar test case cukup mengikuti
  `SELECT * FROM test_case WHERE project_id = ?` (tidak pakai `ORDER BY`).
- User: Playwright preview harus tampil langsung sesuai `baseUrl` begitu halaman
  dibuka (tidak menunggu tombol `Run`), dan tetap memakai **1 session** untuk
  seluruh test case di halaman ini.
- Dikerjakan:
  - `src/db/repositories/test-case.repository.ts`: tambah
    `findAllWithLatestAnalysisUnordered()` (hapus `ORDER BY` outer query).
  - `src/api/routes/testcase.routes.ts`: `GET /projects/:id/test-cases` pakai
    metode unordered.
  - `src/runner/run-session.ts`: `createRunSession()` kini membuka page + mulai
    screencast untuk `runId=sessionId`, lalu navigasi `baseUrl` best-effort.

### 2026-08-19 — Prioritas 5: prioritisasi risk-based crawl + laporan cakupan yang terlewat (item TERAKHIR dari audit QA)

- Menutup item terakhir dari daftar audit QA generate test script (6 item
  awal semuanya sudah selesai kecuali E2E app nyata yang masih menunggu
  input user). Dua sub-bagian: (A) urutan crawl antar-halaman berbasis
  nilai fitur, (B) laporan eksplisit saat kuota `MAX_SITE_PAGES`/
  `MAX_INTERACTIONS_PER_PAGE` bikin sebagian halaman/interaksi tidak
  sempat dijelajahi.
- **(A) Prioritisasi risk-based** — sebelumnya antrian crawl BFS
  (`generator.service.ts` `discoverSite`) murni FIFO (`queue.push`/
  `queue.shift`), urutan sesuai DOM/urutan ditemukan, BUKAN nilai fitur.
  `scoreNavLinkCandidate()` (baru, exported untuk testability) menilai teks
  link: `HIGH_VALUE_LINK_PATTERN` (transaksi/pelanggan/produk/tambah/edit/
  laporan/dst, skor +5) vs `LOW_VALUE_LINK_PATTERN` (bantuan/FAQ/tentang/
  privasi/tampilan, skor -3) vs netral (skor 0). Setiap kali kandidat baru
  ditambah ke queue, SELURUH queue di-sort ulang descending by score
  (array kecil, dibatasi MAX_SITE_PAGES=20, sort ulang murah) — supaya
  kalau kuota habis di tengah jalan, yang TERLEWAT adalah halaman
  bernilai rendah, bukan giliran acak. Catatan: scoring interaksi PER
  HALAMAN (`scoreInteractionCandidate` di page-explorer.ts) SUDAH ada
  sejak sesi sebelumnya — gap yang ditutup di sini spesifik untuk urutan
  ANTAR-HALAMAN (nav link queue) yang belum pernah diprioritaskan.
- **(B) Laporan cakupan yang terlewat** — 3 titik silent-cap ditemukan dan
  diberi status eksplisit (`ctx.emit`/`handlers.emit` phase `'coverage'`,
  broadcast lewat WS `generate:status` sama seperti status lain, muncul di
  log live generate):
  1. `discoverSite`: kalau while-loop berhenti karena `MAX_SITE_PAGES`
     tercapai padahal `queue` masih ada isi, emit daftar judul halaman yang
     BELUM dijelajahi + tambahkan hitungan ke pesan `map-done` final.
  2. `explorePageInteractions`: kalau `countInteractionCandidates(snapshot)`
     (fungsi baru, page-explorer.ts) lebih besar dari hasil
     `collectInteractionCandidates(snapshot, maxInteractions)`, emit jumlah
     kandidat yang terpotong SEBELUM loop klik dimulai.
  3. `explorePageInteractions`: kalau `handlers.canRegisterMorePages()`
     jadi false DI TENGAH loop klik (kuota `MAX_SITE_PAGES` global tercapai,
     bukan kuota per-halaman), emit sisa kandidat yang tidak sempat dicoba
     — ada di DUA titik break dalam fungsi ini (sebelum klik, dan setelah
     form terdeteksi tapi sebelum dicatat ke SiteModel).
  - Refactor pendukung (non-breaking): `collectInteractionCandidates`
    dipecah — logika scoring penuh dipindah ke `scoreAllInteractionCandidates`
    (private), `collectInteractionCandidates` tinggal slice hasilnya (perilaku
    identik), dan `countInteractionCandidates` (baru, exported) memakai
    fungsi yang sama tanpa slice untuk tahu total sebelum kuota.
- **Test baru**: `scoreNavLinkCandidate` (pure, prompt-generation.spec.ts),
  `countInteractionCandidates` vs `collectInteractionCandidates` dengan
  fixture baru `interaction-quota-app.html` (4 tombol, page-explorer.spec.ts),
  `interaction-explorer.spec.ts` (BARU, belum pernah ada file test khusus
  untuk `explorePageInteractions` sebelumnya) — 2 test membuktikan status
  `'coverage'` benar-benar ter-emit untuk kedua kasus (kuota per-halaman,
  kuota total halaman).
- Verifikasi: `npm run build` lolos; subset relevan 43/43 lolos, lalu FULL
  SUITE **107/107 lolos** (`--workers=3`), zero regresi.
- **Dengan ini, SEMUA 6 item audit QA generate test script (Prioritas 1–6,
  dimulai sesi paling awal) sudah selesai KECUALI**: E2E terhadap app nyata
  (masih butuh URL dari user) dan Prioritas 6 lama (persist SiteModel
  sebagai feature map lintas-generate — disebut di entri Suite Analysis,
  belum pernah masuk giliran dikerjakan eksplisit oleh user).

---

### 2026-08-19 — Prioritas 4: CRUD round-trip eksplisit (create→verify→edit/hapus→verify dalam satu test case)

- User minta lanjutkan salah satu dari 2 item terakhir audit QA (Prioritas
  4/5); dipilih Prioritas 4 karena paling langsung menyambung ke kritik awal
  soal "esensi" testing.
- **Root cause struktural ditemukan lebih dulu** (bukan langsung nulis
  prompt): `groupPagesForAuthoring` (site-model.ts) SELALU memisahkan
  halaman `list_crud` dari modal/form turunannya sendiri (mis. "Tambah
  Pelanggan" hasil klik dari halaman list "Pelanggan") ke batch LLM yang
  BERBEDA (`page.interactionContext` → selalu `batches.push([page])`
  sendiri). Akibatnya LLM yang menulis test case untuk halaman list TIDAK
  PERNAH melihat selector field form "Tambah", dan sebaliknya — round-trip
  CRUD (isi form → verifikasi muncul di list) secara STRUKTURAL tidak
  mungkin ditulis sebelum perbaikan ini, terlepas sebagus apa pun instruksi
  prompt-nya.
- **Fix arsitektur** (bukan cuma prompt):
  - `SitePage` (site-model.ts) tambah field `interactionParentUrl?: string`
    — URL halaman tempat interaksi (klik "Tambah X") dipicu. Diisi di
    `interaction-explorer.ts` saat push `SitePage` baru hasil deteksi modal
    (`interactionParentUrl: pageSnapshot.url`).
  - `groupPagesForAuthoring` ditulis ulang: untuk tiap halaman `list_crud`,
    cari form/modal lain di SiteModel yang `interactionParentUrl`-nya
    (dinormalisasi `normalizeUrlForZone`) match ke URL list itu sendiri —
    gabung jadi SATU batch (`[listPage, ...matchedChildren]`, dibatasi
    `MAX_CRUD_CHILDREN_PER_BATCH=2` supaya prompt tidak membengkak). Form
    yang induknya BUKAN list ini (atau tidak ketemu) tetap batch sendiri
    seperti perilaku lama — backward compatible, test lama tidak berubah.
  - `prompt-generation.ts`: `isCrudRoundTripBatch()` mendeteksi pola ini
    (elemen pertama batch `list_crud`, sisanya `interactionParentUrl` cocok),
    lalu `buildAuthoringUserPrompt` menambahkan penanda eksplisit "GRUP CRUD
    ROUND-TRIP" ke prompt (menggantikan blok "FOKUS WAJIB" yang cuma berlaku
    untuk batch 1 halaman). System prompt (`buildAuthoringSystemPrompt`)
    ditambah aturan "WAJIB CRUD ROUND-TRIP": create dengan nilai TEKS UNIK
    (bukan nilai generik "Test") → submit → **wajib** assertText/assertVisible
    di tabel list membuktikan nilai itu muncul (bukan asumsi sukses) → kalau
    ada aksi edit/hapus yang selectornya ada di snapshot, lanjutkan verifikasi
    ubah/hilang. Carve-out eksplisit ditambahkan ke aturan lama "satu batch =
    satu halaman, jangan gabung" supaya tidak kontradiksi untuk kasus ini.
- **Test baru** (`prompt-generation.spec.ts`): `groupPagesForAuthoring`
  menggabungkan list_crud dengan form turunan yang `interactionParentUrl`
  cocok, TAPI TIDAK menggabungkan form dari halaman lain (`interactionParentUrl`
  beda) — dan `buildAuthoringUserPrompt` menandai "GRUP CRUD ROUND-TRIP"
  (bukan "FOKUS WAJIB") untuk batch semacam ini.
- Verifikasi: `npm run build` lolos; `npm test` (`prompt-generation.spec.ts`)
  20/20 lolos (17 lama + 3 baru, tanpa regresi ke test `groupPagesForAuthoring`
  lama).
- **Catatan batasan yang disadari**: ini menaikkan PELUANG LLM menulis
  round-trip yang benar (selector kedua halaman kini terlihat bersama), tapi
  TIDAK ada dry-run/eksekusi nyata yang membuktikan test case round-trip
  hasil generate benar-benar lolos dijalankan sebelum disimpan (itu domain
  Prioritas 2 lama, dry-run validasi — masih belum dikerjakan). Kualitas
  akhir tetap bergantung LLM mematuhi instruksi.

---

### 2026-08-19 — Menutup gap test McpExplorationDriver untuk crawl kompleks + perbaikan 2 catatan dokumen yang kontradiktif

- Menutup 2 dari 6 item "belum dikerjakan" yang baru dicatat sesi sebelumnya
  (user minta lanjutkan item Stage 2 yang "belum dikerjakan sama sekali").
- **Test baru** `src/generator/__tests__/page-explorer-mcp.spec.ts` — 3 test
  yang KHUSUS membuktikan fungsi crawl KOMPLEKS jalan benar di atas
  `McpExplorationDriver` sungguhan (bukan `PlaywrightExplorationDriver` yang
  sudah diverifikasi page-explorer.spec.ts, dan bukan cuma plumbing dasar
  `McpBrowserSession`/`McpPageDriver` di mcp-client.spec.ts):
  1. `crawlAdditionalPages` menghilangkan backdrop (`backdrop-app` fixture)
  2. `crawlAdditionalPages` membuka nav di balik hamburger toggle (`nav-app`)
  3. `collectNavLinkCandidates` menemukan link di dalam dropdown (`dropdown-app`)
  Fixture multi-halaman ini disajikan lewat `startFixtureServer` yang sama
  (http, bukan file:// — tetap kena blokir MCP kalau file://).
- **Temuan bukan-bug**: test hamburger sempat timeout 15s di percobaan
  pertama — BUKAN bug logika (assertion tidak pernah gagal), murni overhead
  round-trip MCP lebih besar dari Playwright langsung (tiap goto/evaluate/
  click = satu panggilan tool JSON-RPC in-process, sedangkan Playwright
  langsung memanggil API browser tanpa lapisan protokol tambahan). Setelah
  `test.setTimeout(45_000)` (pola sama seperti test `no-id-login` yang sudah
  ada sebelumnya untuk alasan serupa — 2x proses browser), lolos bersih di
  16.6s. Dicatat sebagai karakteristik MCP yang harus diantisipasi kalau
  menambah test/langkah berat lain di atasnya nanti, bukan sesuatu yang
  "diperbaiki".
- **Dokumen diperbaiki** (2 item "belum dikerjakan" lainnya): catatan di
  `docs/arsitektur-spesifikasi-teknis.md` §9 dan `docs/PROJECT_STATUS.md`
  Fase 3 SEBELUMNYA bilang "MCP tidak diimplementasikan" — sekarang
  diperbaiki jadi kronologi 2 tahap yang akurat: (1) 2026-08-18 MCP
  ditinggalkan total, (2) 2026-08-19 MCP dipasang kembali TAPI cuma sebagai
  plumbing browser (bukan agent otonom seperti rencana asli). Step 23 "MCP
  Client Setup" di `PROJECT_STATUS.md` diubah dari Planning → **Done**
  dengan catatan bedanya dari desain asli.
- Verifikasi: `npm run build` lolos; `npm test --workers=3` — full suite
  (lihat hasil di entri berikutnya kalau ada regresi ditemukan setelahnya).
- **Belum dikerjakan** (sisa dari 6 item sebelumnya, TIDAK dikerjakan sesi
  ini karena butuh input di luar kemampuan AI menebak): E2E terhadap app
  nyata (butuh URL app nyata dari user — belum diberikan); Prioritas 4 (CRUD
  round-trip eksplisit) dan Prioritas 5 (risk-based crawl prioritization +
  laporan cakupan terlewat) dari audit QA awal — keduanya di luar scope
  "Stage 2" (integrasi MCP), belum disentuh sama sekali.

---

### 2026-08-19 — Integrasi MCP Playwright: mengganti mesin eksplorasi/generate dari Playwright langsung ke @playwright/mcp

- User eksplisit minta ganti seluruh eksplorasi/generate ke MCP Playwright
  (bukan cuma self-healing Fase 4) setelah tahu MCP belum pernah
  diimplementasikan. **Peringatan diberikan lebih dulu**: pola "LLM
  memutuskan navigasi sendiri turn-by-turn" (yang mirip cara kerja MCP kalau
  dipakai agentic) sudah dicoba 2x di project ini dan gagal (lihat entri
  2026-08-18 "Revert total loop agentic"). User pilih opsi aman: **MCP
  cuma jadi "colokan" browser** — logika BFS/heuristik yang sudah terbukti
  tetap dipakai apa adanya, LLM tidak diberi kendali navigasi.
- **Riset & POC empiris SEBELUM implementasi** (bukan asumsi dari dokumentasi
  saja) — ditemukan beberapa fakta krusial yang mengubah desain:
  - `browser_click`/`browser_type`/`browser_evaluate` MCP menerima `target`
    berupa **CSS selector langsung** (diteruskan ke `page.locator()`
    Playwright asli) — bukan cuma ref hasil snapshot. Cocok dengan arsitektur
    selector-first project ini.
  - `browser_type` **replace** value (bukan append) — setara `.fill()`.
  - Dialog (`confirm`/`alert`/`prompt`) MEMBLOKIR semua tool lain dengan
    error eksplisit "does not handle the modal state" sampai
    `browser_handle_dialog` dipanggil — bisa dideteksi & di-auto-handle.
  - MCP **memblokir protokol `file:`** demi keamanan (hardcoded, tidak bisa
    dikonfigurasi) — SEMUA test yang sebelumnya pakai fixture `file://` dan
    lewat `explorePage()`/`withExploredPage()` HARUS pindah ke http (fixture
    server lokal port acak).
  - `@playwright/mcp` bisa dipakai in-process via `createConnection()` +
    `InMemoryTransport` dari `@modelcontextprotocol/sdk` — TIDAK perlu spawn
    child process/stdio terpisah.
  - `browser: {isolated: true}` WAJIB di `createConnection()` — tanpa ini,
    profil browser persisten di disk bikin sesi kedua gagal "Browser is
    already in use" (ditemukan lewat test nyata, bukan dokumentasi).
  - `page.evaluate(fnString)` Playwright memperlakukan string sebagai
    ekspresi mentah (hasilnya function value, BUKAN dipanggil) — beda total
    dengan `browser_evaluate` MCP yang otomatis memanggil fungsinya. Bug
    nyata ditemukan lewat test (`TypeError: reading 'title' of undefined`),
    diperbaiki dengan IIFE wrapping `(${fn})()` di `PlaywrightExplorationDriver`.
- **Arsitektur abstraksi berlapis** (2 layer, dikerjakan bertahap):
  1. **`PageDriver`** (`src/runner/page-driver.ts`) — untuk `testcase-compiler.ts`.
     `PlaywrightPageDriver` (passthrough, dipakai eksekusi test case
     SUNGGUHAN — TIDAK BERUBAH, tetap Playwright asli) vs `McpPageDriver`
     (`src/generator/mcp-client.ts`, dipakai `executeInstructionOnPage` saat
     generate untuk jalankan langkah login).
  2. **`ExplorationDriver`** (`src/generator/exploration-driver.ts`) — untuk
     seluruh mesin crawl/eksplorasi (`page-explorer.ts`,
     `interaction-explorer.ts`). `PlaywrightExplorationDriver` dipakai semua
     test lama (zero rewrite logika heuristik) vs `McpExplorationDriver`
     (dipakai `withExploredPage` — SATU-SATUNYA jalur produksi sekarang,
     tidak ada lagi `chromium.launch()` langsung untuk generate).
     `asPageDriver()` menjembatani kedua driver ini kembali ke `PageDriver`
     tanpa duplikasi logika step-execution.
- **`page-explorer.ts` ditulis ulang total** (goto/collectPageSnapshot/
  findBlockingOverlay/dismissBlockingOverlay/navigateForExploration/
  expandDropdownMenusForCrawl/extractNavLinksFromDom/navigateToNavLink/
  ensureNavVisible/dismissOpenModal/crawlAdditionalPages/withExploredPage) —
  SEMUA fungsi murni-heuristik (`extractTopNavLinks`, `collectInteractionCandidates`,
  `isChromeInteractionElement`, `findHamburgerToggle`, `snapshotShowsFormOverlay`,
  dll.) **TIDAK DIUBAH SAMA SEKALI** (tetap operasi Node biasa di atas hasil
  snapshot, driver-agnostic by design). `collectPageSnapshot` sekarang SATU
  `evaluate()` call (bukan loop locator per-elemen) — lebih sedikit round-trip,
  output tetap identik. Teknik "tandai elemen via atribut sementara lalu klik
  via driver" dipakai untuk kasus "klik elemen hasil pencarian JS kompleks"
  (backdrop, dropdown toggle, tombol Batal by-text) karena MCP `target` butuh
  selector, bukan reference locator Playwright.
- **`interaction-explorer.ts`**: `attachDialogDismissHandler` (listener
  per-klik) DIHAPUS — dialog auto-dismiss sekarang tanggung jawab driver itu
  sendiri (`McpBrowserSession.callTool` auto-retry, `PlaywrightExplorationDriver`
  pasang listener SEKALI di constructor, bukan per-interaksi).
- **`generator.service.ts`**: `LiveExplorationContext.page: Page` →
  `driver: ExplorationDriver`; `discoverSite`/`handleAuthAtPage`/
  `executeInstructionOnPage`/`navigateToLink` semua generic terhadap driver.
  **Live-view diganti total**: CDP screencast (push, khusus Playwright, TIDAK
  ADA di balik MCP) → polling `driver.screenshot()` tiap 400ms, dibroadcast
  sebagai `run:frame` yang sama (kontrak WS/dashboard tidak berubah).
- **Test**: `startFixtureServer` helper (dibuat sesi sebelumnya untuk
  `mcp-client.spec.ts`) dipakai ulang di `page-explorer.spec.ts` untuk 4 test
  yang manggil `explorePage()` (sekarang lewat MCP, butuh http bukan file://).
  Test lain (pakai `chromium.launch()` + `PlaywrightExplorationDriver`
  langsung, bypass MCP) TIDAK perlu fixture server, tetap file://.
- **Temuan operasional**: full suite dengan worker count default kadang
  flaky (timeout, bukan gagal logika) karena kontensi resource — banyak
  instance Chromium (Playwright asli + MCP) jalan bersamaan. Dengan
  `--workers=3` semua lolos bersih. Belum diubah `playwright.config.ts`
  (dicatat sebagai temuan, bukan diperbaiki paksa — user bisa sesuaikan
  worker count kalau flaky di lingkungannya).
- Verifikasi akhir: `npm run build` lolos; `npm test --workers=3` **98/98
  lolos** (95 lama + relevan + tanpa regresi ke eksekusi test case
  sungguhan sama sekali — `PlaywrightPageDriver`/`executor.ts`/`run-session.ts`
  tidak disentuh).
- **Belum dikerjakan** (di luar scope permintaan "kerjakan poin ini dulu"):
  update catatan di `arsitektur-spesifikasi-teknis.md` section 9 (masih
  bilang "MCP tidak diimplementasikan" — sekarang salah, perlu direvisi),
  E2E terhadap app nyata (baru diverifikasi via fixture lokal), test baru
  khusus memverifikasi `McpExplorationDriver` pada fungsi crawl kompleks
  (baru diverifikasi via `PlaywrightExplorationDriver` + `McpPageDriver`/
  `McpBrowserSession` dasar, belum ada test crawl end-to-end murni MCP).

---

### 2026-08-19 — Negative/boundary testing berbasis field constraint (Prioritas 3 dari audit mekanisme generate)

- Lanjutan urutan prioritas dari audit QA sebelumnya: field validasi
  (`required`/`maxlength`/`pattern`/`min`/`max`) tidak pernah ditangkap dari
  DOM, jadi skenario negatif/boundary sepenuhnya titip ke improvisasi bebas
  LLM — tidak konsisten muncul.
- **`PageElementSnapshot`** (`src/generator/page-explorer.ts`) tambah 6 field:
  `required: boolean`, `maxLength`/`minLength: number | null`,
  `pattern: string | null`, `min`/`max: string | null` (string, bukan number
  — `min`/`max` juga dipakai input type=date yang bukan numerik).
  `collectPageSnapshot` membaca via `getAttribute` (`required` cocok atribut
  boolean HTML ATAU `aria-required="true"`); `min`/`max` diambil mentah
  sebagai string, tidak dipaksa parse angka.
- **`formatExplorationForPrompt`** menambahkan constraint ini ke baris tiap
  elemen (`required`, `maxlength=N`, `minlength=N`, `pattern=...`, `min=...`,
  `max=...`) — hanya tampil kalau ada, tidak menambah noise untuk elemen
  tanpa constraint.
- **Prompt authoring** (`buildAuthoringSystemPrompt`,
  `src/generator/prompt-generation.ts`) WAJIB negative/boundary testing
  berbasis constraint yang BENAR-BENAR tertulis di snapshot (bukan
  mengarang): required→submit field kosong (assert TETAP di halaman
  sama/muncul error, bukan assert redirect sukses), maxlength→isi melebihi N
  karakter (assertValue cek nilai aktual), pattern/email/number/tel/url→isi
  format tidak cocok, min/max→nilai di luar batas. Kalau field di batch itu
  tidak punya constraint tsb, aturan dilewati untuk field itu (tidak
  dipaksakan). Target jumlah test case per halaman list_crud/form dinaikkan
  jadi boleh sampai 7 (dari 5) khusus form dengan banyak constraint, TAPI
  validasi field sejenis boleh digabung satu test case (bukan wajib 1
  test case per field per constraint) — supaya tidak meledak jumlahnya untuk
  form dengan banyak field.
- **Fixture test baru** `fixtures/form-constraints.html` (username
  required+minlength+maxlength, email required+pattern, age min/max tanpa
  required, nickname tanpa constraint apa pun — untuk membuktikan default
  aman false/null saat constraint tidak ada). Test baru: `explorePage
  menangkap constraint validasi form dan menuliskannya di prompt`. Sengaja
  fixture BARU (bukan `sample-ui.html` yang dipakai test lain) supaya tidak
  mengubah snapshot exact-match test yang sudah ada.
- Fixture test lain yang membangun `PageElementSnapshot` manual disesuaikan
  field baru: `buildElement()` default di `page-explorer.spec.ts` (1 tempat,
  dipakai semua `buildElement(overrides)` lain otomatis ikut), dan 4 literal
  objek di `prompt-generation.spec.ts` (`PAGE_SNAPSHOT` ×3, `DASHBOARD_SNAPSHOT`
  ×1) — pola sama seperti waktu field `value` ditambahkan sebelumnya.
- Verifikasi: `npm run build` lolos; `npm test` **93/93 lolos** (92 lama + 1
  test baru constraint).
- **Belum dikerjakan** (Prioritas 4–5 lama, di luar scope sesi ini): CRUD
  round-trip eksplisit (create→verify di list→edit→verify→delete→verify),
  prioritisasi risk-based urutan crawl/interaksi, laporan eksplisit halaman/
  interaksi yang terlewat karena kuota `MAX_SITE_PAGES`/`MAX_INTERACTIONS_PER_PAGE`.

---

### 2026-08-19 — Suite/Cross-Feature Analysis: analisis AI lintas-fitur setelah semua test case dalam suite selesai

- User luruskan gap yang sebelumnya cuma dicatat sebagai temuan (bukan
  langsung disuruh kerjakan): mekanisme sekarang berhenti di "jalankan semua
  fitur lalu simpulkan per test case" — tidak ada langkah "lihat SEMUA hasil
  sekaligus, cari inkonsistensi/gap/pola sistemik antar fitur" seperti yang
  dilakukan tester sungguhan setelah full-suite run. User minta ini dikerjakan
  sekaligus dengan Prioritas 2 (nomor urut prioritas lama dianggap fleksibel,
  fokus ke instruksi eksplisit).
- **Desain kunci — countdown-latch, BUKAN polling**: awalnya didesain Suite
  Analysis menunggu (polling) semua `analysis_result` individual siap. Diganti
  ke countdown-latch in-memory (`src/queue/queue.ts`) karena polling akan
  memakan slot `analysisQueue` (concurrency terbatas) selama menunggu —
  mengurangi throughput analisis individual yang justru sedang ditunggu.
  Latch: `beginSuiteAnalysisTracking`/`addSuiteAnalysisTestRun` (progresif,
  dipanggil executor per test_run dibuat) → `sealSuiteAnalysisTracking`
  (dipanggil executor setelah suite loop selesai, menandai tidak ada id baru
  lagi) → `markSuiteAnalysisTestRunDone` (dipanggil `handleAnalysisJob` per
  test run selesai dianalisis, sukses ATAU gagal) → final tepat saat sealed
  DAN semua id sudah completed, lalu `enqueueSuiteAnalysis` otomatis dipanggil
  — tanpa timeout/polling sama sekali. Suite yang di-abort paksa user
  langsung `discardSuiteAnalysisTracking` (tidak akan pernah lengkap).
- **Migration** `005_suite_analysis_result.sql`: tabel `suite_analysis_result`
  (project_id, suite_run_id [TEXT, BUKAN FK — suite bukan entity tabel],
  test_run_ids JSONB, status, summary, findings JSONB, provider, raw_response).
  Sudah dijalankan & diverifikasi di DB lokal.
- **Service baru** `src/analyzer/suite-analysis.service.ts` (`analyzeSuiteRun`):
  memakai `LLMClient.complete()` generik (pola sama seperti
  `generator.service.ts`, BUKAN `AnalyzerProvider.analyze()` Fase 2 — bentuk
  output beda: `{summary, findings[]}` vs `{status,reason,detail,solution}`).
  Findings punya `category`: `inconsistency` (fitur seharusnya terhubung tapi
  tidak ada test case yang menghubungkan/hasil bertentangan), `coverage_gap`
  (indikasi alur belum tercover, HANYA dari judul/deskripsi test case yang
  ada — dilarang menebak fitur yang sama sekali tidak disinggung),
  `systemic_failure` (pola gagal sama berulang di banyak test case),
  `other`. System prompt eksplisit melarang finding yang cuma mengulang
  detail satu test case (harus melibatkan ≥2 test case atau pola lintas
  banyak test case) — supaya tidak redundan dengan AI Analyzer Fase 2 yang
  sudah ada per test case (assertion Prioritas 1 sebelumnya).
  Fallback provider pakai pola sama seperti `runBatch` di generator.service
  (coba tiap provider di `providerOrder`, lanjut provider lain kalau
  `ProviderError`/parse gagal). Status `incomplete` kalau ada test run yang
  tidak punya `analysis_result` (analisis individualnya gagal duluan) — tetap
  jalan dengan data yang ada, transparan lewat catatan di `summary`, bukan
  diam-diam dianggap lengkap.
- **Trigger**: `src/runner/executor.ts` (`executeTestRunSuite`) — TIDAK ada
  endpoint/tombol terpisah, otomatis jalan setelah "Jalankan Semua (1
  Session)" selesai, sesuai alur yang digambarkan user (explore→generate→
  run all→analisis holistik). Tidak berjalan sama sekali untuk run test case
  satu-satu (tidak ada suite), sesuai definisi.
- **WS event baru** (`src/ws/events.ts`): `suite:analysis` (hasil lengkap),
  `suite:analysis-error` (semua provider gagal). Broadcast ke `suiteRunId`
  yang sama dengan live view suite.
- **UI fix penting**: `run:suite-done` SEBELUMNYA langsung menutup socket
  (`finishRunWatch`) begitu suite selesai — tapi Suite Analysis baru selesai
  BELAKANGAN (setelah semua analisis individual via queue, bisa puluhan
  detik). Diubah: socket TETAP terbuka setelah `run:suite-done`, tampilkan
  spinner "Menunggu analisis lintas fitur…", baru `finishRunWatch` dipanggil
  saat `suite:analysis`/`suite:analysis-error` tiba ATAU timeout client-side
  180 detik (`SUITE_ANALYSIS_WAIT_MS`) sebagai jaring pengaman kalau event
  hilang.
- **UI**: panel baru `#suite-analysis-panel` di `testcases.ejs` (dalam
  `.run-view-column`, di bawah `.analysis-panel` per test case) — badge
  status (`consistent`/`issues_found`/`incomplete`), summary, daftar finding
  dengan kategori + test case terkait. Resync REST saat page load
  (`GET /projects/:id/suite-analysis/latest`, dipanggil `loadLatestSuiteAnalysis`)
  supaya hasil sebelumnya tetap terlihat setelah reload. Panel di-reset
  (disembunyikan) tiap kali suite run baru dimulai.
- **API baru**: `GET /projects/:id/suite-analysis/latest` (testcase.routes.ts).
- Verifikasi: `npm run build` lolos; `npm test` **92/92 lolos** (80 lama + 6
  test countdown-latch di `queue.spec.ts` + 6 test parsing di
  `suite-analysis.spec.ts`; 1 test hamburger lama sempat gagal karena timeout
  parallel worker — lolos bersih saat di-retry `--workers=1`, bukan regresi).
  Smoke test browser: server dev jalan bersih tanpa error (`preview_logs`),
  `node --check dashboard.js` valid; tidak sempat login manual di browser
  (password lokal sudah bukan `admin123` seperti dicatat sesi lama, TIDAK
  ditebak-tebak) — kepercayaan diambil dari `dashboard-crud.spec.ts` yang
  sudah memuat halaman test case yang sama lewat token JWT internal dan tetap
  92/92 lolos.
- `.claude/launch.json` dibuat (baru, belum ada sebelumnya) untuk keperluan
  `preview_start` — konfigurasi `npm run dev` di port 3000.
- **Belum dikerjakan** (di luar scope sesi ini): Prioritas 3–5 lama (negative
  testing berbasis field constraint, CRUD round-trip eksplisit, prioritisasi
  risk-based); persist `SiteModel` sebagai feature map lintas-generate
  (Prioritas 6 lama) — saat ini Suite Analysis hanya melihat test case yang
  ADA di DB, belum tahu fitur apa yang sama sekali belum digenerate jadi test
  case (`feature_map` table di schema Fase 5 masih belum dipakai).

---

### 2026-08-19 — Assertion action nyata (Prioritas 1 dari audit mekanisme generate): expected tidak lagi cuma teks bebas

- User minta analisis mendalam mekanisme "generate test script pakai AI" dari
  sudut pandang QA/Tester profesional. Temuan utama: `expected` di test case
  cuma array string bebas, TIDAK PERNAH diverifikasi terhadap DOM — compiler
  cuma punya action `goto/fill/click/check/select/waitFor` (tanpa
  `assert`/`expect`), jadi status `passed`/`failed` test run murni dari
  "step Playwright tidak error", bukan dari "hasil sesuai ekspektasi". User
  juga menunjuk gap lebih besar: sistem tidak punya fase "analisis hasil
  lintas-fitur setelah semua test dijalankan" (dicatat sebagai temuan,
  BELUM dikerjakan — user pilih kerjakan Prioritas 1 dulu: assertion layer).
- **Kontrak resmi diupdate lebih dulu** (`docs/arsitektur-spesifikasi-teknis.md`
  bagian 4.1, sesuai aturan "tambah di tabel dulu sebelum diimplementasikan"):
  7 action checkpoint baru — `assertVisible`, `assertHidden`, `assertChecked`
  (selector saja), `assertText`, `assertValue`, `assertCount` (selector+value),
  `assertUrl` (value saja, tanpa selector). Assertion TIDAK mengubah state,
  cuma memverifikasi kondisi saat ini; gagal (timeout) → step `failed` seperti
  action lain (fail-fast, ditangkap `executeSteps` seperti biasa).
- **Implementasi**: `TEST_CASE_ACTIONS` + `testCaseStepSchema`
  (`src/api/schemas/testcase.schema.ts`), `Step`/`StepAction` union
  (`src/runner/types.ts`), `runStep` (`src/runner/testcase-compiler.ts`) —
  assertVisible/assertHidden pakai `page.waitForSelector(state:visible/hidden)`
  native; assertChecked/assertText/assertValue/assertCount/assertUrl pakai
  helper polling baru `pollUntil()` (timeout `ASSERTION_TIMEOUT_MS=5000ms`,
  interval 150ms) yang membaca kondisi berulang lalu throw error berisi
  **nilai aktual terakhir** kalau gagal (supaya kegagalan mudah didiagnosis).
  **Sengaja TIDAK memakai `expect` dari `@playwright/test`** — terikat konteks
  test runner, sedangkan compiler ini juga jalan standalone di
  `executor.ts`/`run-session.ts` (chromium.launch() langsung, di luar
  `playwright test`); pakai API `Page`/`Locator` native saja supaya konsisten
  di kedua konteks.
- **Prompt authoring** (`buildAuthoringSystemPrompt` di
  `src/generator/prompt-generation.ts`) diupdate: LLM wajib menaruh minimal
  satu step assertion di `steps` untuk tiap klaim di `expected` (bukan cuma
  menulis klaim tanpa bukti), assertion wajib pakai selector yang ada di
  snapshot batch (sama seperti aksi lain — dilarang mengarang selector
  notifikasi/toast dinamis yang belum terlihat), `assertUrl` ditawarkan
  sebagai alternatif aman untuk verifikasi redirect karena tidak butuh selector.
- **UI step builder manual** (`src/ui/public/dashboard.js`): `STEP_ACTIONS`,
  `renderStepFields` (assertUrl→field value tanpa selector; assertText/
  assertValue/assertCount→selector+value; assertVisible/assertHidden/
  assertChecked→selector saja, masuk default branch), `collectSteps`
  disesuaikan supaya user juga bisa menambah/edit step assertion manual
  tanpa menulis JSON.
- **Belum dikerjakan** (di luar scope Prioritas 1, dicatat untuk sesi lanjutan
  sesuai urutan prioritas yang sudah disepakati user): dry-run validasi
  steps hasil generate sebelum disimpan (Prioritas 2), field constraint-aware
  negative testing dari atribut required/maxlength/pattern (Prioritas 3),
  CRUD round-trip eksplisit (Prioritas 4), prioritisasi risk-based + laporan
  cakupan yang terlewati karena kuota (Prioritas 5), fase baru "Suite/
  Cross-Feature Analysis" setelah semua test case dijalankan + persist
  SiteModel sebagai feature map (gap besar yang ditunjuk user, terkait Fase 5
  roadmap `feature_map` yang skema tabelnya sudah ada tapi belum dipakai).
- Verifikasi: `npm run build` lolos, `npm test` **80/80 lolos** (78 lama + 2
  baru: assertion actions sukses mencakup ketujuh action baru, dan assertText
  gagal fail-fast dengan errorMessage berisi nilai aktual).

### 2026-08-18 — Rewrite generate test script: Map-then-Author + multi-zona auth (field dinamis)

- User minta **hapus mekanisme auth-wall lama** (`[Auth - Unverified]` lalu stop)
  dan tulis ulang orkestrasi generate dari awal — plan disetujui: arsitektur
  **Map-then-Author** dengan crawl rekursif multi-zona auth, field form dinamis
  (bukan hardcoded username/password), pause interaktif tanpa timeout.
- **Fase A — Mapping** (`discoverSite` di `generator.service.ts`): BFS crawl
  semua halaman; tiap halaman baru → heuristik cepat + LLM auth assessment
  (`parseAuthAssessment`) → `AuthZone` dengan `fields[]` dinamis + `submit`;
  kalau `values` zona belum lengkap → pause WS `generate:need-input` (form
  dinamis di UI) atau user **Lewati zona** (`status: skipped`); kalau lengkap →
  `buildAuthStepsFromZone` + Playwright login → lanjut crawl. Second login =
  zona baru dengan field berbeda (mis. hanya PIN).
- **Fase B — Authoring** (`authorFromSiteModel`): batch per `PageKind`
  (`classifyPageKind` di `site-model.ts`), ToC global (`buildSiteMapToc`) selalu
  disertakan ke prompt LLM; prefix auth steps dinamis per zona authenticated
  (`applyAuthPrefixesToTestCase`); dedup judul (`dedupeGeneratedTestCases`).
- **File baru**: `src/generator/site-model.ts`, `src/generator/auth-input-prompt.ts`
  (registry pause/resume per `generateId`+`zoneId`, tanpa timeout).
- **Ditulis ulang**: `generator.service.ts`, `prompt-generation.ts`,
  `prompt-generation.spec.ts`. **Tetap**: `page-explorer.ts`.
- **Kontrak API/UI**:
  - `POST /generate/prompt` terima `authPrefill: { values: Record<string,string> }`
    (prefill zona pertama); legacy `credentials: { username, password }` dinormalisasi.
  - `POST /projects/:id/generate/:generateId/auth-input` body
    `{ zoneId, values }` atau `{ zoneId, skip: true }`.
  - WS event **`generate:need-input`** (menggantikan konsep
    `generate:need-credentials`) dengan array `fields[]` dinamis.
  - UI `generate.ejs` + `dashboard.js`: form auth dinamis, spinner, disable,
    tombol Lewati zona.
- **Queue**: `GenerateJob.authPrefill` menggantikan `credentials` (memory-only,
  tidak ke DB/log; field `secret` tidak di-log).
- Mekanisme lama dihapus: split primary vs additional pages khusus, stop di
  `[Auth - Unverified]`, asumsi 3-step login tetap username/password.
- Verifikasi: `npm run build` OK; `npm test` **69/69** lolos. Test
  `page-explorer.spec.ts` selector tanpa id dinaikkan timeout ke 45s (launch
  browser 2x, flaky di parallel workers).

### 2026-08-18 — Modal auth input + authoring lebih mendalam per halaman/menu

- User feedback: form input auth harus **modal backdrop center/focus** (bukan
  inline di panel); test case hasil generate terlalu dangkal (cuma navigasi
  menu, tidak uji fitur di dalam halaman).
- **UI**: form `generate:need-input` dipindah ke `<dialog id="generate-auth-dialog">`
  dengan backdrop `.app-dialog::backdrop`, autofocus field pertama, backdrop
  click tidak menutup (harus submit atau "Lewati zona").
- **Authoring**: `AUTHORING_BATCH_SIZE=1`; `groupPagesForAuthoring` — halaman
  `list_crud`/`form` selalu **satu halaman per batch** LLM; system prompt
  wajibkan 2–5 test case mendalam per halaman (CRUD, filter, aksi baris, form
  submit/validasi) — bukan hanya "buka menu X"; user prompt sertakan jenis
  halaman (`list_crud`/`form`/…) per batch.
- Verifikasi: `npm run build` OK; `npm test` **70/70** lolos.

### 2026-08-18 — Eksplorasi interaktif (klik tombol, form auth vs umum, dismiss konfirmasi)

- User minta generate tidak hanya crawl href/navigasi — perlu **klik tombol**,
  **abaikan dialog konfirmasi** (observasi saja), bedakan **form auth vs form
  umum**: auth → modal input user; form umum → catat snapshot untuk test case
  lalu tutup modal tanpa submit destruktif.
- **File baru** `src/generator/interaction-explorer.ts`:
  `explorePageInteractions()` — max 6 tombol/halaman (`MAX_INTERACTIONS_PER_PAGE`);
  handler auto-dismiss `confirm()`/`alert()`/`prompt()`; klik kandidat non-destruktif
  (`collectInteractionCandidates` di `page-explorer.ts`); deteksi overlay form
  (`snapshotShowsFormOverlay`); LLM auth assessment → pause `generate:need-input`
  bila auth wall; form umum → entry SiteModel dengan `interactionContext`
  (mis. `"Dashboard › Tambah Pelanggan"`) + `dismissOpenModal`.
- **Login terpisah**: `buildStandaloneLoginTestCase()` — satu test case
  `"Login dengan kredensial valid"`; test fitur **tanpa** step login di awal
  (prefix `[Auth]` di judul dihapus).
- **Authoring**: `groupPagesForAuthoring` + `interactionContext` disertakan ke
  prompt batch; hapus dead code `findPageKindForSnapshot` (fix build).
- Verifikasi: `npm run build` OK; `npm test` **75/75** lolos.

### 2026-08-19 — UI dashboard/test case: footer kartu, header, scroll, replace generate

- Hapus tombol **Manual Test Case** dari footer kartu project (+ tombol "Buat manual" di dialog Instruction).
- **Ai Test Script** → modal konfirmasi jika project sudah punya test case; generate kirim
  `replaceExisting: true` → hapus semua test case project sebelum simpan hasil AI.
- Halaman test case: navbar sama dashboard (search + menu lengkap); sidebar kanan/kiri scroll
  independen; tombol Edit/Putar Ulang/Run lebih compact.
- Compact layout: search tidak boleh jatuh ke baris sendiri (grid 4 kolom); navbar/toolbar/kartu
  test case dipadatkan (judul 1 baris, deskripsi clamp 1 baris) supaya live run naik.
- **Stop paksa:** tombol Stop di toolbar halaman test case; abort menutup page Playwright yang
  sedang jalan (sesi cookie tetap; suite skip sisa case). API
  `POST …/session/:sessionId/abort` dan `POST …/suite/:suiteRunId/abort`.
- Fix selesai run: halaman test case tidak punya `.analysis-panel` → throw `hidden` pada null;
  replay gagal karena `isActiveRunForPanel` membandingkan sessionId. Badge status kartu
  `align-self: flex-start`. Search test case di sidebar (`#test-case-search`).
- Urutan daftar test case mengikuti urutan insert ke tabel (yang masuk duluan
  tampil pertama). Insert memakai `clock_timestamp()` agar batch generate tidak
  se-timestamp; tie-break `ctid`.

### 2026-08-19 — Run per test case pakai 1 session Playwright (halaman test case)

- User minta di `/dashboard/projects/:id/test-cases` run **satu-satu** tetap
  memakai **satu sesi browser** agar login/cookie tidak hilang antar test case.
- **Backend:** `src/runner/run-session.ts` + queue `test_session_run`; API
  `POST /projects/:id/test-runs/session`, `…/session/:sessionId/run`,
  `…/session/:sessionId/stop`.
- **UI:** `dashboard.js` — `ensureRunSession` saat halaman load; `startRun`
  pakai session API; WS persisten ke `sessionId`; suite run / leave page stop sesi.
- Verifikasi: `npm run build` OK.

### 2026-08-19 — Halaman Test Case terpisah + suite run 1 session Playwright

- User minta test case **tidak lagi di bawah kartu project** — halaman full-width
  seperti generate: **kiri daftar test case**, **kanan live Playwright**; plus
  **jalankan semua dalam 1 session** (cookie shared) dan **Putar Ulang**
  rekaman run terakhir.
- **UI:** `GET /dashboard/projects/:id/test-cases` → `testcases.ejs`; dashboard
  hanya link "Test Case (N)" + ringkasan; dialog builder dipindah ke halaman ini.
- **Backend:** `POST /projects/:id/test-cases/run-suite` → `suiteRunId` +
  `enqueueTestSuiteRun`; `executeTestRunSuite()` — satu browser context, tiap test
  case `newPage()` (video/trace per run), WS `run:suite-case` / `run:suite-done`.
- **Run tunggal (halaman test case):** saat load halaman → `POST
  /projects/:id/test-runs/session`; tiap klik Run → `POST …/session/:sessionId/run`
  (queue `test_session_run`, `run-session.ts`) — **satu browser context** shared
  antar run; live view WS subscribe `sessionId` + `testRunId` per case.
- **Run tunggal (legacy inline):** `POST /test-cases/:id/run` tetap browser terpisah
  bila tidak di halaman `#testcases-workspace`.
- **Suite:** `run-suite` menutup sesi persisten dulu, lalu browser suite sendiri.
- Verifikasi: `npm run build` OK; test UI CRUD + halaman test case lolos.

### 2026-08-19 — Fix eksplorasi interaktif: stop ulang dropdown navbar tiap halaman

- User generate Self Auto V1.2: log penuh `AI mencoba tombol "Pelanggan/Sparepart/…"`
  di **setiap** halaman (Dashboard, Penjualan, Teknisi, …) — minim eksplorasi
  fitur karena slot interaksi habis untuk dropdown menu.
- **Root cause:** `collectInteractionCandidates` tidak memfilter chrome
  navigasi (header/topbar, dropdown-toggle, zona sidebar/atas) — tombol menu
  ikut diklik ulang per URL.
- **Fix:** `isChromeInteractionElement()` + skor prioritas aksi konten
  (`Tambah`, `Filter`, `Export`, …); perluas `NAV_LANDMARK_SELECTOR` (+header,
  topbar); `MAX_INTERACTIONS_PER_PAGE` 6→10.
- Verifikasi: `npm run build` OK; `npm test` **76/76** lolos.

### 2026-08-18 — Fix crawl PHP `index.php?page=` + dropdown menu (akar test cuma dashboard)

- User generate ulang app bengkel: masih **5 test case semua dashboard**
  (navigasi dropdown/filter), tidak ada test per halaman menu (Pelanggan,
  Sparepart, dll.).
- **Root cause #1 (kritis):** `normalizeUrlForZone()` hanya memakai
  `origin+pathname` — semua URL `index.php?page=login|dashboard|customers`
  dianggap **satu halaman** → crawl BFS berhenti setelah dashboard, halaman
  menu tidak pernah diregister ke SiteModel → authoring cuma 1 batch dashboard.
- **Root cause #2:** link di dalam Bootstrap dropdown tersembunyi (`display:none`)
  tidak masuk snapshot visible → antre crawl tidak menemukan submenu Pelanggan,
  Sparepart, Laporan, dll.
- **Fix:**
  - `normalizeUrlForZone` kini sertakan query string terurut (hash diabaikan).
  - `collectNavLinkCandidates()` — buka dropdown (`expandDropdownMenusForCrawl`),
    gabung `extractTopNavLinks` + `extractNavLinksFromDom`, dedup pola href.
  - `navigateToNavLink()` — prioritas `goto(href)` untuk URL nyata (PHP legacy).
  - `discoverSite` pakai `collectNavLinkCandidates` (bukan snapshot-only).
  - Prompt authoring: 1 batch = 1 halaman, larangan test mega-navigasi multi-menu.
- Test baru: `normalizeUrlForZone` query `page=`, fixture dropdown-app +
  `collectNavLinkCandidates`. `npm test` **72/72** lolos.

---

### 2026-08-18 — Deteksi authentication wall + kredensial login terstruktur di `/generate/prompt` (adaptasi, bukan Step 23-25 asli)

- User minta revisi `generateFromUrl()`/endpoint `/generate/url`/tabel
  `test_case_draft` sesuai `arsitektur-spesifikasi-teknis.md` 9.1/9.3/9.4 dan
  `execution-plan` Step 23-25 (MCP client). **Temuan dilaporkan ke user dulu**:
  `src/generator/mcp-client.ts`, `generateFromUrl()`, endpoint `/generate/url`,
  dan tabel `test_case_draft` **tidak pernah ada** di kode — sudah dicatat
  eksplisit sebagai keputusan lama ("MCP explore Step 23 dan tabel draft belum
  dipakai — hasil langsung insert test_case"). Step 23-25 di execution-plan
  masih status "Planning", tidak pernah diimplementasikan sesuai desain MCP
  aslinya; yang jalan adalah arsitektur pengganti (Chromium langsung via
  `page-explorer.ts`, insert langsung ke `test_case`, endpoint yang ada cuma
  `/generate/prompt`). User pilih: **adaptasi ke arsitektur yang sudah ada**
  (bukan bangun ulang MCP+draft table, karena itu juga butuh migration baru
  yang dilarang user sendiri).
- Implementasi: `POST /projects/:id/generate/prompt` sekarang terima field
  opsional `credentials: { username, password, usernameSelectorHint?,
  passwordSelectorHint? }`. Di `generateTestCasesFromPrompt` (live/generateId
  path saja): sebelum eksplorasi instruction bebas, panggil LLM
  (`buildAuthAssessmentSystemPrompt`/`parseAuthAssessment`, via
  `LLMClient.complete()`) untuk menilai `isAuthWall` + selector
  username/password/submit dari snapshot yang sudah terbuka (bukan MCP
  `explore()` terpisah — cukup pakai snapshot Playwright yang sudah ada).
  - `isAuthWall=false` → alur SAMA seperti sebelumnya (backward compatible,
    credentials diabaikan kalau ada).
  - `isAuthWall=true` + tanpa credentials (atau selector login tidak lengkap)
    → insert SATU test case `title="[Auth - Unverified] "+baseUrl`,
    `steps=[goto baseUrl]`, `source='ai_url_exploration'`, generate berhenti
    di situ (tidak lanjut crawl/generate batch).
  - `isAuthWall=true` + credentials lengkap → login dieksekusi via
    `context.followInstruction` (bukan lewat free-text prompt), lanjut crawl
    + generate seperti biasa dari snapshot pasca-login. Semua test case hasil
    (primary + batch) di-post-process: title prefix `"[Auth] "`, `goto` awal
    (yang menuju URL pasca-login, tidak valid untuk sesi baru) dibuang lalu
    diganti `[goto(loginUrl), fill(username), fill(password), click(submit)]`
    (4 langkah, bukan literal "3 steps" dari instruksi user — sengaja
    ditambah 1 `goto` ke halaman login supaya test case valid dijalankan dari
    kondisi belum login), plus 1 item `expected` di awal ("Redirect keluar
    dari halaman login...").
  - Assessment gagal (semua provider gagal / output invalid) → dianggap
    "bukan auth wall", lanjut alur normal (tidak memblokir generate).
- Password **tidak pernah** di-log/disimpan — hanya lewat in-memory job
  (`queue/types.ts` `GenerateJob.credentials`) selama proses generate.
- File: `src/generator/prompt-generation.ts` (+`buildAuthAssessment*`,
  `parseAuthAssessment`, `AuthAssessmentResult`), `src/generator/generator.service.ts`
  (+`GenerateCredentials`, `buildLoginStepsFromAssessment`,
  `applyAuthLoginPrefix`, `persistUnverifiedAuthCase`, `runAuthAssessment`),
  `src/queue/types.ts`, `src/queue/queue.ts`, `src/api/routes/generator.routes.ts`.
  Tidak menyentuh `testcase-compiler.ts`/`executor.ts`/skema DB sama sekali.
  8 test baru + 2 test lama disesuaikan (mock auth-assessment call) di
  `src/generator/__tests__/prompt-generation.spec.ts`; full suite 76 passed.
- UI (dashboard) belum dikabelkan untuk mengirim `credentials` — di luar
  scope task ini (hanya backend/kontrak endpoint).

---

### 2026-08-18 — Fix akar masalah: selector tag polos ("button") untuk tombol tanpa id membuat klik login diam-diam gagal → 0 halaman ter-crawl

- User lampirkan log terminal nyata (`npm run dev`, app bengkel devpoin.com,
  provider OpenCode Go/DeepSeek-V4-Flash): AI eksplorasi login membalas
  `{"steps":[{"action":"fill","selector":"#username",...},{"action":"fill",
  "selector":"#password",...},{"action":"click","selector":"button"}]}` —
  lalu generate langsung jalan dengan HANYA 4 test case, semuanya soal
  login/username-kosong/password-kosong/lupa-password. Tidak ada satu pun
  halaman/menu lain yang ter-explore padahal instruction eksplisit minta
  login lalu jelajahi aplikasi. Verdict user: **"masih banyak
  ketidaksesuaian... fokus ke generate test script, jadi eksplorasi semua
  halaman dulu, sesuaikan instruksi yang ada"**.
- **Analisis akar masalah** (bukan masalah backdrop — tidak ada indikasi
  overlay di log ini): selector klik login yang dipakai AI adalah `"button"`
  — tag polos, BUKAN selector unik. `preferSelector` (`page-explorer.ts`)
  sebelumnya hanya punya fallback id → data-testid → name → aria-label; kalau
  elemen (mis. `<button>Login</button>` tanpa id, umum di app PHP lawas
  seperti aplikasi bengkel ini) tidak punya satupun atribut itu, selector
  jatuh ke tag polos. Kalau di halaman login ada >1 elemen `<button>` (mis.
  tombol show/hide password + tombol submit Login), `page.click("button")`
  di Playwright (strict-mode default) **throw error "resolved to N
  elements"** — step dicatat `failed` oleh `executeSteps` (fail-fast, tapi
  errornya DITELAN, tidak dilempar ke caller) — halaman tidak pernah pindah
  dari form login. `pageSnapshot` yang dipakai untuk `crawlAdditionalPages`
  dan generate "halaman utama" jadi tetap snapshot LOGIN, bukan dashboard —
  makanya crawl menemukan 0 halaman tambahan (login page tidak punya
  menu/nav) dan generate hanya menghasilkan test case seputar login.
- **Fix** (`page-explorer.ts`, `preferSelector` + `collectPageSnapshot`):
  tambah 3 fallback baru SEBELUM jatuh ke tag polos, urutannya:
  id → data-testid → name → aria-label → **placeholder** (attr selector,
  mis. `input[placeholder="..."]`) → **teks via `:has-text()`** (ekstensi
  selector Playwright, mis. `button[type="submit"]:has-text("Login")`) →
  **`value` attribute** (mis. `input[type="submit"][value="Kirim"]`, untuk
  elemen seperti `<input type="submit">` yang tidak punya innerText) → tag
  polos (benar-benar last resort).
  - Field baru `value: string | null` ditambahkan ke `PageElementSnapshot`,
    diambil dari `getAttribute('value')`, dan diikutkan ke noise-filter
    (elemen `<input type="submit" value="Kirim">` tanpa id/name/testid/
    label/text/placeholder TIDAK lagi ikut terbuang — sebelumnya gap ini
    bikin tombol submit bergaya lama hilang total dari snapshot).
    `formatExplorationForPrompt` juga menampilkan `value=...` kalau ada.
- **Test baru** (`page-explorer.spec.ts`, fixture `no-id-login.html` dengan
  2 `<button>` tanpa id + `<input type="submit" value="Kirim">` tanpa id):
  `explorePage memberi selector spesifik (bukan tag polos) untuk tombol
  tanpa id yang cuma punya teks/value` — verifikasi selector BUKAN tag
  polos, mengandung `:has-text(`/`[value=`, DAN benar-benar resolve ke
  **1 elemen saja** (`page.locator(selector).count() === 1`) di halaman
  nyata walau ada tombol lain dengan tag sama.
- Verifikasi: `npm run build` lolos, `npm test` **69/69 lolos** (68 + 1 test
  baru). Beberapa fixture/literal `PageElementSnapshot` di test lain
  (`page-explorer.spec.ts` `buildElement`, 4 tempat di
  `prompt-generation.spec.ts`) disesuaikan menambah field `value: null`
  supaya tetap cocok tipe.
- Catatan risiko yang disadari: `:has-text()` melakukan substring match
  (case-insensitive) pada textContent, bisa ambigu kalau ada 2 elemen
  dengan teks yang saling mengandung (mis. "Simpan" vs "Simpan Draft") atau
  parent/child yang teksnya tumpang tindih — belum ada laporan kasus ini,
  dicatat sebagai risiko yang disadari, bukan diabaikan.

### 2026-08-18 — Revert total loop agentic (eksplorasi ala-manusia); balik ke crawl deterministik + deteksi & hilangkan backdrop yang menutupi menu

- User uji lagi di app bengkel (devpoin.com) dengan loop agentic yang baru
  diperbaiki: hasil generate hanya 3 test case, SEMUA soal login/lupa
  password (halaman lain tetap tidak pernah tersentuh). Verdict user:
  **"masih tidak sesuai.. tolong generative seperti manusia hilangkan saja
  mekanisme ini, jadi tidak efektive"** — eksplorasi ala-manusia dianggap
  gagal secara praktik walau sudah diberi beberapa kali perbaikan
  (hasSnapshotChanged, toleransi no-progress, fallback stuck-page).
  Instruksi eksplisit user: **"gunakan crawling link atau seperti
  sebelumnya saja, yang bisa crawling semua halaman/link dan menu-menu,
  tapi deteksi juga apakah ada sebuah backdrop yang menutupi aksi klik...
  backdrop ini perlu di hilangkan agar link/menu bisa di akses"**.
- **Loop agentic dihapus total** (bukan cuma dimatikan/fallback) —
  `generateFromContext` di `generator.service.ts` sekarang balik ke alur
  lama: instruction (login) → `context.crawlAdditionalPages(pageSnapshot)`
  langsung (tanpa lagi lewat giliran LLM "SEPERTI MANUSIA" memutuskan aksi
  satu-satu). Dihapus: `runAgenticExploration`, `decideNextExplorationTurn`,
  `filterSafeExplorationSteps`, `stepsSignature`, konstanta
  `AGENTIC_EXPLORATION_MAX_TURNS`/`AGENTIC_EXPLORATION_WALL_CLOCK_MS`/
  `MAX_NO_PROGRESS_STREAK`. `hasSnapshotChanged` **dipertahankan** — masih
  dipakai untuk warning "halaman tidak berubah setelah instruction login"
  yang independen dari mekanisme agentic.
- `prompt-generation.ts`: dihapus `buildAgenticExplorationSystemPrompt`,
  `buildAgenticExplorationUserPrompt`, `parseAgenticDecision`/
  `AgenticDecision`, `describeExplorationSteps`, `buildExplorationNarrative`/
  `AgenticExplorationTraceEntry`, dan field `explorationNarrative` di
  `GenerationPromptInput`. `page-explorer.ts`: `DESTRUCTIVE_OR_LOGOUT_PATTERN`
  dikembalikan jadi non-export (hanya dipakai internal `extractTopNavLinks`
  lagi, tidak ada lagi konsumer di service layer).
- **Fitur baru sesuai permintaan user — deteksi & hilangkan backdrop**
  (`page-explorer.ts`): banyak app (modal promo, offcanvas/drawer, cookie
  consent) menaruh div overlay full-screen yang mencegat klik ke menu/link
  di baliknya. Ditambahkan:
  - `BLOCKING_OVERLAY_SELECTOR` — pola generik (bukan spesifik satu app):
    `.modal-backdrop`, `.offcanvas-backdrop`, `[class*="backdrop"]`,
    `[class*="overlay"]` (kecuali `nav`/`aside`), `[class*="scrim"]`,
    `[class*="dimmer"]`.
  - `findBlockingOverlay(page)` — hanya dianggap "menghalangi" kalau elemen
    kandidat benar-benar visible DAN ukurannya menutupi ≥50% lebar & tinggi
    viewport (bukan sekadar badge/tooltip kecil yang class-nya kebetulan
    mengandung kata overlay).
  - `dismissBlockingOverlay(page)` — dicoba berurutan: klik backdrop-nya
    sendiri (umum menutup modal/drawer sungguhan), lalu tombol Escape, lalu
    kalau masih ada dipaksa `display:none` lewat DOM (khusus kebutuhan
    crawl/eksplorasi, BUKAN saat eksekusi test case tersimpan — testcase
    compiler/executeSteps tidak disentuh, supaya hasil run test case tetap
    merepresentasikan interaksi asli).
  - Dipanggil di titik-titik yang benar-benar mengklik saat crawl:
    `navigateForExploration` (setelah page pertama terbuka), `ensureNavVisible`
    (sebelum & sesudah klik tombol hamburger/drawer), `navigateToCandidate`
    (sebelum klik kandidat menu), dan sekali lagi setelah pindah ke tiap
    halaman baru di `crawlAdditionalPages` (sebelum snapshot diambil).
- **Test baru** (`page-explorer.spec.ts`): fixture
  `fixtures/backdrop-app/` (main.html dengan div `.modal-backdrop`
  full-viewport z-index tinggi menutupi 2 link menu, hilang saat diklik) +
  test `crawlAdditionalPages menghilangkan backdrop yang menutupi menu
  sebelum mengklik` — verifikasi backdrop benar-benar visible dulu, lalu
  crawl tetap berhasil membuka kedua halaman menu di baliknya.
- Test lama yang mock system prompt `'SEPERTI MANUSIA'` (2 test batch/multi
  halaman) dan seluruh 4 test integrasi khusus loop agentic (multi-turn
  sukses, guard destruktif/beda-origin, berhenti kalau mengulang aksi,
  fallback stuck-page) **dihapus** karena jalur kode yang diuji sudah tidak
  ada. `parseAgenticDecision`/`buildExplorationNarrative` unit test juga
  dihapus.
- Verifikasi: `npm run build` lolos, `npm test` **68/68 lolos** (turun dari
  73 karena 5 test khusus agentic dihapus, ditambah 1 test baru backdrop —
  bersih, tidak ada regresi).
- Keputusan ke depan: mekanisme eksplorasi multi-halaman project ini
  **kembali murni deterministik** (posisi/landmark/hamburger + backdrop
  dismissal) — TIDAK ada lagi loop LLM yang memutuskan aksi per giliran.
  Kalau user minta "generative seperti manusia" lagi di masa depan, rujuk
  entri ini dulu (sudah dicoba 2x, gagal secara praktik di app nyata).

### 2026-08-18 — Fix: loop agentic berhenti prematur (stuck di halaman login) sebelum sempat eksplorasi menu lain

- User laporkan (lampiran log terminal nyata di app bengkel/devpoin.com):
  hasil generate cuma 6 test case, SEMUANYA soal login/lupa password saja
  (2 batch nyaris identik) — "eksplorasinya terlalu premature, belum
  selesai eksplorer tapi test script sudah di generate".
- Analisis log: instruction login jalan → AI di giliran eksplorasi
  berikutnya malah mengusulkan ULANG persis aksi fill username/password/klik
  yang sama (kemungkinan snapshot pasca-login masih terlihat seperti
  halaman login — login belum sungguh pindah halaman saat di-snapshot).
  Loop-detection lama (berhenti di pengulangan pertama) membuat loop
  berhenti setelah cuma 1 giliran "sukses" (yang sebenarnya sia-sia, cuma
  mengulang login), dan karena `explorationTrace.length` sudah >0, fallback
  crawl deterministik TIDAK ikut dicoba — hasilnya generate jalan dengan
  bahan yang isinya cuma variasi halaman login, tanpa menu lain sama sekali.
- Fix (`generator.service.ts`):
  - `hasSnapshotChanged(before, after)` — bandingkan url/title/headings dua
    snapshot untuk tahu apakah suatu aksi benar-benar berefek/pindah
    tampilan atau tidak.
  - Loop tidak langsung `break` begitu ketemu 1x pengulangan/aksi tidak
    aman — sekarang toleransi hingga `MAX_NO_PROGRESS_STREAK = 3` giliran
    "tidak berefek" berturut-turut dulu (pakai `continue`, tetap potong
    budget 20 giliran) sebelum benar-benar menyerah — beri AI kesempatan
    lebih untuk mencoba pendekatan lain memakai feedback riwayat.
  - Riwayat eksplorasi (`historyLines`) sekarang menandai giliran yang
    hasilnya identik dengan sebelum aksi dijalankan: `"... (TIDAK BERUBAH
    dari sebelumnya, aksi ini tampaknya tidak berefek — jangan diulang,
    coba hal lain)"` — sinyal eksplisit ke LLM giliran berikutnya.
  - Setelah loop selesai: kalau SEPANJANG trace tidak pernah benar-benar
    meninggalkan halaman awal (`everLeftStartingPage` — dibandingkan ke
    snapshot SEBELUM loop dimulai, bukan cuma antar-giliran), seluruh trace
    dianggap gagal (`return []`) — supaya kode di `generateFromContext`
    otomatis jatuh ke fallback `context.crawlAdditionalPages` (mekanisme
    lama), bukan generate dengan bahan yang cuma mengulang halaman awal.
  - Tambahan visibilitas: setelah instruction login dieksekusi, kalau
    snapshot sebelum/sesudah identik (`hasSnapshotChanged` false), emit
    pesan status "Halaman terlihat sama seperti sebelum instruction
    dijalankan; kemungkinan instruction (misal login) belum sepenuhnya
    berhasil." — supaya user langsung dapat sinyal di panel log, bukan
    baru sadar setelah test case aneh muncul.
- **Test baru**: `generate live membuang hasil eksplorasi ala-manusia yang
  tidak pernah meninggalkan halaman awal, lalu fallback ke crawl
  deterministik` — simulasi aksi yang "berhasil" tapi snapshot-nya identik
  dengan awal, verifikasi fallback crawl dipanggil dan hasil generate pakai
  halaman dari crawl, bukan halaman awal yang diulang-ulang. Test loop lama
  (`... berhenti kalau AI mengulang aksi yang sama persis`) tetap lolos
  tanpa perubahan assertion (perilaku akhir — hanya 1x eksekusi — tetap
  sama, cuma butuh beberapa giliran "sia-sia" lagi sebelum berhenti).
  `npm run build` + `npm test` (73 test) lolos semua.
- Catatan: ini masih heuristik generik (bukan spesifik app bengkel) —
  kalau app benar-benar SPA yang mengubah tampilan tanpa mengubah
  url/title/heading sama sekali, `hasSnapshotChanged` bisa false-negative;
  belum ada laporan kasus itu, dicatat sebagai risiko yang disadari.

### 2026-08-18 — Eksplorasi ala-manusia (agentic loop) sebagai pengganti utama crawl deterministik

- User: setelah crawl deterministik (posisi/landmark/hamburger) diperbaiki,
  masih minta lebih jauh — "bisa tidak berfikir seperti layaknya manusia,
  melihat halamanya dulu, lalu melihat menu atau apapun yang bisa di tes...
  proses test script ini dapat generative seperti pola fikir manusia".
- Sempat coba tawarkan Plan mode lagi untuk diskusi arsitektur, user tolak
  (sesuai catatan sesi sebelumnya) → dipakai `AskQuestion` untuk 3 keputusan
  scope sebelum implementasi (semua dicatat di sini, bukan diasumsikan):
  1. **Budget langkah**: maksimal **20 giliran** (turn) loop eksplorasi per
     generate job — satu giliran = satu keputusan LLM, boleh berisi
     beberapa step aksi sekaligus (misal isi 3 field + submit = 1 giliran).
     Dipilih karena user pakai OpenCode Go berbayar dengan kuota terbatas
     ($12/5jam dst.), lebih murah dari opsi 40 giliran.
  2. **Crawl deterministik lama** (posisi/landmark/hamburger,
     `crawlAdditionalPages` di `page-explorer.ts`) **dipertahankan sebagai
     fallback**, bukan dihapus — dipakai HANYA kalau loop agentic gagal
     total (provider error terus-menerus) atau langsung memutuskan "done"
     tanpa aksi apa pun di giliran pertama.
  3. **Tanpa vision/screenshot** — cukup snapshot teks elemen (sudah ada),
     supaya tetap kompatibel dengan model apa pun (tidak semua model
     OpenCode Go/Zen mendukung vision) dan lebih murah.

**Arsitektur baru (`src/generator/generator.service.ts` +
`src/generator/prompt-generation.ts`):**
- Setelah instruction login selesai, dijalankan `runAgenticExploration`:
  loop hingga 20 giliran (atau hard cap waktu 10 menit via
  `AGENTIC_EXPLORATION_WALL_CLOCK_MS`) — tiap giliran memanggil LLM dengan
  `buildAgenticExplorationSystemPrompt`/`buildAgenticExplorationUserPrompt`
  (system prompt baru, terpisah dari system prompt instruction login),
  membawa snapshot halaman SAAT INI (bukan halaman awal) + "Riwayat
  eksplorasi" (daftar aksi yang sudah dicoba, supaya AI tidak mengulang).
  LLM membalas `{"done":true}` (anggap eksplorasi cukup) atau
  `{"steps":[...]}` (satu rangkaian aksi berikutnya, action sama seperti
  instruction: goto/fill/click/check/select/waitFor).
- `parseAgenticDecision` (di `prompt-generation.ts`) menormalkan balasan
  itu; output yang gagal diparse dianggap `done:true` (berhenti aman,
  bukan crash loop) — reuse `parseExplorationSteps` yang sudah resilien
  terhadap step invalid campuran.
- Guard keamanan sebelum eksekusi (`filterSafeExplorationSteps` di
  `generator.service.ts`): buang `goto` ke origin lain, dan buang aksi yang
  selector ATAU teks/label/href elemen aslinya di snapshot cocok
  `DESTRUCTIVE_OR_LOGOUT_PATTERN` (logout/keluar/hapus/delete/nonaktifkan/
  remove) — pattern ini sekarang diexport dari `page-explorer.ts` supaya
  dipakai ulang, bukan cuma di crawl deterministik.
- Deteksi stuck: kalau signature step (JSON stringify) satu giliran identik
  dengan giliran sebelumnya, loop langsung berhenti (anggap AI mengulang
  dirinya sendiri).
- Setiap giliran yang benar-benar dieksekusi (via `context.followInstruction`
  yang sama dipakai instruction login — tidak ada primitive baru di context)
  dicatat sebagai `AgenticExplorationTraceEntry {steps, snapshot}`.
- Hasil trace dipetakan ke `additionalPages` (sama seperti sebelumnya, dipakai
  batch generate `GENERATE_PAGE_BATCH_SIZE=2`), DAN dibangun
  `explorationNarrative` per batch via `buildExplorationNarrative` — daftar
  "AI klik X → hasil: halaman Y" yang disisipkan ke prompt generate final
  supaya LLM penyusun test case memakai alur yang TERKONFIRMASI benar-benar
  jalan (bukan menebak dari nama menu). Entri dari fallback deterministik
  (steps kosong) otomatis tidak muncul di narrative.
- **Fallback**: kalau `explorationTrace.length === 0` setelah loop (giliran
  pertama langsung "done"/semua provider gagal), baru dipanggil
  `context.crawlAdditionalPages` (mekanisme lama) — konsisten dengan
  keputusan user di atas.
- Snapshot halaman utama (`pageSnapshot`, dipakai untuk batch generate
  "halaman utama") TIDAK ikut berubah oleh loop agentic — loop punya
  `currentSnapshot` lokal sendiri, jadi urutan giliran/navigasi loop tidak
  merusak referensi halaman awal pasca-login.
- Total pemanggilan LLM per job generate jadi lebih banyak dari sebelumnya
  (1 login + hingga 20 giliran decide + 1 primary + N batch generate) —
  disadari & disetujui user lewat pilihan budget 20 giliran di atas.

**Test:** unit `parseAgenticDecision` (done/steps/invalid→done),
`buildExplorationNarrative` (skip entri tanpa steps nyata); integrasi di
`prompt-generation.spec.ts` — sukses multi-giliran tanpa memanggil crawl
fallback, guard membuang goto beda-origin + selector logout (hanya aksi
aman yang dieksekusi), loop berhenti kalau AI mengulang aksi identik. 2 test
lama (`generate live menjelajahi halaman lain...`, `generate live memecah
menu tambahan...`) disesuaikan mock-nya (system prompt loop agentic kini
dibalas `{"done":true}` langsung supaya jatuh ke fallback deterministik
seperti skenario asli test tersebut). `npm run build` + `npm test` (72 test)
lolos semua.

### 2026-08-18 — Generalisasi deteksi menu navigasi supaya tidak khusus satu app (sidebar-fix sebelumnya masih spesifik)
- User: "saya ingin mekanisme ini bisa di terapkan di aplikasi web apapun,
  bukan hanya case web ini saja" — setelah fix sidebar-only sesi sebelumnya,
  minta pendekatan lebih general. Sempat coba tawarkan Plan mode untuk
  diskusi arsitektur dulu, user tolak → lanjut di Agent mode.
- 4 generalisasi ditambahkan di `page-explorer.ts` (di atas fix sidebar
  sebelumnya, bukan gantikan):
  1. **Threshold sidebar relatif viewport** (bukan angka mati 260px):
     `NAV_LINK_SIDEBAR_X_THRESHOLD = viewport.width * 0.22`, plus tambahan
     `NAV_LINK_SIDEBAR_RIGHT_X_THRESHOLD` untuk sidebar di sisi KANAN (bukan
     cuma kiri).
  2. **Dedup link berpola sama (id beda)** — `normalizeHrefPattern()`
     mengganti segmen path angka/hex-id dan value query param angka dengan
     placeholder `:id`, lalu hanya representatif PERTAMA per pola yang
     diambil. Ini mencegah link aksi per-baris data (mis. "Detail transaksi"
     x50 baris tabel dengan id berbeda) menghabiskan kuota crawl
     (`MAX_ADDITIONAL_PAGES`) dan menutupi menu asli — pola yang HAMPIR PASTI
     ada di semua app CRUD/listing, jadi generalisasi penting.
  3. **Hash-router SPA vs anchor sesama halaman**: `href="#"` / `href="#foo"`
     tetap diabaikan (anchor), tapi `href="#/laporan"` (pola hash-router
     Angular/Vue lama) sekarang dianggap kandidat menu.
  4. **Tombol hamburger/drawer**: kalau 0 kandidat menu ditemukan dari
     snapshot awal, `crawlAdditionalPages` sekarang cari tombol toggle
     (heuristik id/data-testid/class/aria-label/text cocok pola
     `HAMBURGER_TOGGLE_PATTERN`), klik sekali untuk membuka nav yang
     tersembunyi (`display:none`/drawer), lalu re-extract kandidat dari
     snapshot yang baru.
  5. **Navigasi berbasis klik (bukan cuma `page.goto(href)`)**: tiap kandidat
     kini dicoba diklik dulu lewat selector asli elemennya (mendukung
     SPA/JS routing yang mencegat klik), fallback ke `page.goto(href)`
     langsung kalau klik gagal/tidak berpindah URL. Antar kandidat, page
     kembali ke `originalUrl` dulu (+ re-klik toggle hamburger kalau perlu)
     supaya selector elemen kandidat berikutnya masih valid.
- `NavLinkCandidate` sekarang bawa `selector` juga (dulu cuma text+href).
  `PageElementSnapshot` tambah field `classAttr` (dipakai untuk heuristik
  toggle hamburger).
- Test baru: fixture live `fixtures/nav-app/{main,page-a,page-b}.html` untuk
  test `crawlAdditionalPages` end-to-end (nav tersembunyi di balik hamburger
  → klik → temukan 2 halaman); unit test dedup pola id + hash-router vs
  anchor. Semua 67 test + build lolos.
- Batasan yang disadari, belum diimplementasi (didokumentasikan, bukan
  di-skip diam-diam): drawer nav yang butuh animasi lama (>250ms) sebelum
  interaktif; menu bertingkat (submenu yang perlu hover/klik tambahan);
  proteksi anti-bot/captcha saat crawl halaman lain. Kalau user temui app
  dengan pola ini, perlu sesi lanjutan.

### 2026-08-18 — Bug besar: crawl menu tambahan gagal total di app sidebar (bengkel/devpoin.com) — AI menebak selector menu yang belum dijelajahi
- User tes ke app nyata (bengkel, `app.devpoin.com/self-automotive-v1.2`, provider
  OpenCode Go): generate langsung selesai dengan 8 test case mencakup SEMUA
  menu (Kendaraan, Pelanggan, Transaksi, Suku Cadang, Laporan, Pengaturan,
  Logout) tapi user curiga "AI belum sempat analisis semua halaman, tapi
  tau-tau sudah generate script".
- Cek log server (`terminals/2.txt`): cuma **2 panggilan AI** total (exploration
  isi form login + 1 panggilan generate). Tidak ada panggilan batch tambahan
  sama sekali → fitur crawl menu tambahan (`crawlAdditionalPages`) TIDAK
  pernah menghasilkan halaman (additionalPages.length === 0), padahal
  fiturnya sudah dibangun sesi sebelumnya.
- **Root cause**: `extractTopNavLinks` (`page-explorer.ts`) cuma menerima
  link dengan `y <= NAV_LINK_Y_THRESHOLD (140px)` — asumsi navbar horizontal
  di atas. App bengkel ini pakai **sidebar menu vertikal** (umum di admin
  panel PHP), jadi semua link menu posisinya jauh di bawah 140px → semua
  terfilter habis → 0 kandidat → crawl langsung skip. AI tetap melihat teks
  menu (elemen `<a>` sidebar tetap masuk snapshot HALAMAN UTAMA, hanya tidak
  dipakai untuk crawl) dan MENEBAK selector dari fragmen href
  (`a[href*='kendaraan']`, dst.) meski belum pernah menganalisis halaman
  tujuannya — makanya terlihat cepat/dangkal dan test case-nya generik
  (rata-rata 6 langkah, cuma klik menu tanpa isi form sungguhan).
- **Fix**:
  1. Tambah field `inNavLandmark: boolean` di `PageElementSnapshot`
     (`collectPageSnapshot` cek `closest('nav, aside, [role=navigation],
     [class*=sidebar i], [class*=navbar i], ...')` per elemen).
  2. `extractTopNavLinks` kini terima link kalau `y<=140` (navbar atas) ATAU
     `inNavLandmark` (landmark semantik) ATAU `x<=260` (fallback kolom
     sempit kiri untuk sidebar tanpa markup semantik).
  3. System prompt generate (`buildGenerationSystemPrompt`) ditambah larangan
     eksplisit: kalau menu/link di halaman utama TIDAK punya snapshot detail
     di prompt (tidak ada di "Halaman tambahan"), JANGAN buat test case
     fill/click ke sana, JANGAN menebak selector dari potongan href.
- Test baru: `extractTopNavLinks mendeteksi menu sidebar lewat landmark`,
  fixture `SIDEBAR_SNAPSHOT`. Semua 65 test + `npm run build` lolos.
- Catatan: ini murni bug logika (bukan soal timeout/model provider) — jadi
  independen dari topik OpenCode Go sesi sebelumnya, walau ditemukan tepat
  setelah user tes generate lagi.

### 2026-08-18 — Fix: protokol OpenCode Zen/Go salah untuk MiniMax/Qwen + max_tokens Messages kekecilan
- User klarifikasi: `opencode-go` yang dipakai **berbayar** ($10/bulan), bukan
  free tier — jadi asumsi sesi sebelumnya (lambat karena free tier) keliru.
  Latensi model reasoning (`mimo-v2.5`, dst.) tidak dijamin cepat walau paid;
  paid = kuota/akses, bukan garansi latensi.
- User minta: kalau pakai OpenCode Go, pastikan call API-nya benar-benar
  sesuai spesifikasi resmi OpenCode Go (bukan cuma di-generalisasi dari Zen).
- Riset dokumentasi resmi (`opencode.ai/docs/zen`, `opencode.ai/docs/go`)
  menemukan 2 bug nyata di `opencode.provider.ts`:
  1. **Routing protokol salah**: `getOpenCodeProtocol` cuma cek prefix model
     (`claude-`→messages, `gpt-`/`grok-`→responses, `gemini-`→gemini, sisanya
     chat) dan tidak tahu bedanya produk Zen vs Go. Padahal:
     - Model `qwen*` selalu Messages (Anthropic) di Zen **dan** Go.
     - Model `minimax-*` Messages **hanya di Go**; di Zen tetap Chat
       Completions biasa.
     - Perbaikan: `getOpenCodeProtocol(model, providerName)` sekarang terima
       `providerName` ('opencode' | 'opencode-go') untuk membedakan aturan
       MiniMax.
  2. **`max_tokens: 1000` di-hardcode** untuk protokol Messages (dipakai
     Claude langsung di `claude.provider.ts`, dan OpenCode saat model
     claude-family/minimax(Go)/qwen). `LLMClient` dipakai bersama analyzer
     (output singkat, aman) dan generator (JSON banyak step, 1000 token
     gampang terpotong → parse gagal, terlihat seperti "generate berhenti").
     Dinaikkan ke `8_192` di kedua file (`CLAUDE_MAX_TOKENS`,
     `MESSAGES_PROTOCOL_MAX_TOKENS`).
- Model yang dipakai user (`mimo-v2.5`, `deepseek-v4-flash`) sebenarnya sudah
  benar pakai Chat Completions sesuai dokumentasi — bug ini tidak menjelaskan
  timeout spesifik user, tapi tetap bug nyata yang bisa kena provider lain
  di rotasi fallback (termasuk Claude langsung).
- Test baru di `provider-adapters.spec.ts`: routing MiniMax/Qwen per
  produk (Zen vs Go). Semua 64 test (`npx playwright test`) + `npm run build`
  lolos.
- User pilih opsi ini dibanding menaikkan timeout lagi (opsi lain yang
  ditawarkan: naikkan `PROVIDER_TIMEOUT_MS` ke 60–90s, atau ganti default
  model ke non-reasoning). Timeout/heartbeat tetap di nilai sesi sebelumnya
  (45s × 3 attempt) — belum diubah sesi ini.

### 2026-08-18 — Heartbeat status selama menunggu respons AI lama (bukan bug hang, tapi terlihat "berhenti")
- Laporan lanjutan: setelah fix noise-elemen sesi sebelumnya, masih "berhenti"
  di "AI sedang generate test case untuk halaman utama…" (kali ini
  `opencode-go` model `mimo-v2.5`, model gratis lain yang lambat).
- Analisis: `postProviderJson` (`provider-utils.ts`) sudah dibatasi
  `AbortSignal.timeout(45s)` per percobaan, 3x percobaan → TIDAK mungkin hang
  selamanya, maksimal ±2-3 menit sebelum error/fallback provider lain. Tapi
  selama menunggu itu, panel log diam total (satu pesan status lalu senyap)
  — user mengira macet padahal backend masih retry/menunggu di belakang
  layar. Root cause-nya bukan bug hang, tapi kurang visibilitas progress.
- Fix (`generator.service.ts`): tambah `withHeartbeat()` helper — membungkus
  `client.complete()` (baik untuk exploration/login maupun generate
  primary/batch) dengan `setInterval` yang emit status "AI (provider) masih
  memproses …, mohon tunggu…" tiap 20 detik selama promise belum selesai,
  di-clear begitu selesai (sukses/gagal). Murni tambahan visibilitas, TIDAK
  mengubah timeout/retry/logika fallback yang sudah ada.
- Tidak diubah: `PROVIDER_TIMEOUT_MS`/`PROVIDER_MAX_ATTEMPTS` tetap 45s/3x.
  Kalau model gratis/lambat (opencode-go, opencode Zen free tier) tetap
  sering timeout meski prompt sudah ramping, itu masalah kecepatan provider
  itu sendiri — solusi jangka panjang: pakai model/provider berbayar yang
  lebih cepat sebagai default, bukan cuma andalkan free tier.
- Semua 63 test lolos (tidak ada test baru — heartbeat pakai real timer 20s,
  mock test selesai jauh lebih cepat dari itu jadi timer tidak pernah
  ter-trigger di test).

### 2026-08-18 — Fix: generate "berhenti"/tidak konsisten di app nyata (noise elemen + silent provider fallback)
- Laporan user (log real): setelah login+crawl 4 menu sukses, proses "berhenti"
  di step "AI sedang generate test case untuk halaman utama…" — provider
  `opencode-go` timeout 45 detik x3, lalu diam (tidak ada log lanjutan di
  panel), user sampai mengulang login manual. "Masih tidak konsisten."
- Root cause #1 — ukuran prompt tidak stabil: `collectPageSnapshot` memasukkan
  SEMUA elemen interaktif visible ke snapshot (sampai `MAX_ELEMENTS=80`),
  termasuk elemen tanpa id/name/testid/label/text/placeholder (ikon/wrapper
  kosong yang banyak di app admin nyata) — elemen begini selector-nya toh
  jatuh ke nama tag polos (tidak unik, tidak berguna utk LLM), tapi tetap
  memakan baris di prompt. Di app dengan tabel data dinamis, jumlah elemen
  begini naik-turun tiap load → prompt generate kadang kecil (sukses) kadang
  besar (timeout) → "tidak konsisten".
- Root cause #2 — silent fallback: catch `ProviderError` di loop login
  maupun `runGenerateBatch` (generate final) di `generator.service.ts`
  langsung `continue` ke provider berikutnya TANPA emit apa pun ke panel —
  persis pola silent-failure yang sudah diperbaiki di 2 sesi sebelumnya,
  tapi di titik lain (provider-level error, bukan parse error). User cuma
  liat log diam bermenit-menit padahal backend masih retry/fallback di
  belakang layar.
- Fix #1 (`page-explorer.ts`, `collectPageSnapshot`): elemen tanpa
  id/nameAttr/testId/label/text/placeholder SAMA SEKALI dilewati (tidak
  dihitung ke `MAX_ELEMENTS`, tidak masuk snapshot) — mengurangi & menstabilkan
  ukuran prompt, sekaligus membuang selector yang toh tidak unik/berguna.
  Test baru: fixture HTML ditambah 1 elemen `<a href="#">` tanpa identitas,
  dipastikan tidak ikut ke snapshot.
- Fix #2 (`generator.service.ts`): tambah `describeProviderError()` helper
  (strip prefix "[provider]" dari message) + emit status saat `ProviderError`
  terjadi di loop login (`emit('act', 'Provider X gagal (...), mencoba
  provider lain untuk langkah instruction…')`) dan di `runGenerateBatch`
  (`emit('generate', 'Provider X gagal (...) untuk <batchLabel>, mencoba
  provider lain…')`) — sebelumnya keduanya silent `continue`.
- Belum diubah (di luar scope kali ini): timeout/retry provider (`45s`/`3x`)
  tetap seperti sebelumnya; kalau app nyata masih sering timeout walau
  prompt sudah lebih ramping, pertimbangkan naikkan timeout lagi atau
  turunkan `MAX_ELEMENTS`/`GENERATE_PAGE_BATCH_SIZE` lebih jauh.
- Semua 63 test proyek lolos (+1 test baru), build lolos.

### 2026-08-18 — Crawl menu tambahan pakai detail penuh (selector) untuk test case lintas halaman
- Konteks: user minta generate test case lebih komprehensif & berkesinambungan
  antar fitur/halaman (bukan cuma isolated per halaman). Ditanya 3 opsi
  (peta situs ringan, crawl detail penuh, atau review akhir) — user pilih
  **crawl detail penuh**.
- Sebelumnya: `crawlAdditionalPages` meringkas tiap halaman jadi `PageSummary`
  (judul, heading, label tombol saja, TANPA selector) — sistem prompt
  eksplisit melarang AI fill/click di halaman tambahan karena tidak ada
  selector.
- Sekarang: `crawlAdditionalPages` (`page-explorer.ts`) mengembalikan
  `PageExplorationResult[]` (snapshot detail penuh, sama seperti halaman
  utama: heading + elemen dengan selector/letak) — tidak lagi diringkas jadi
  `PageSummary`. Fungsi lama `summarizePageForPrompt`/
  `formatPageSummariesForPrompt`/type `PageSummary` DIBIARKAN (tidak dipakai
  flow utama lagi, tapi tidak dihapus — tetap valid & test-nya tetap lolos).
- `formatAdditionalPagesForPrompt()` baru (page-explorer.ts) menyusun detail
  tiap halaman tambahan (pakai `formatExplorationForPrompt` per halaman)
  jadi teks prompt "Halaman tambahan N: ...".
- System prompt generate (`buildGenerationSystemPrompt`) diubah: dari
  "JANGAN fill/click di halaman itu" jadi instruksi analisis kesinambungan —
  boleh susun test case aksi (fill/click) lintas halaman kalau ada fitur yang
  terkait (misal ubah data di satu halaman, verifikasi di halaman lain),
  tetap wajib pakai selector yang ada.
- `GENERATE_PAGE_BATCH_SIZE` diturunkan dari 4 → **2** (di
  `generator.service.ts`) karena tiap halaman kini berisi detail penuh
  (bukan ringkasan kecil) — supaya prompt per panggilan LLM tetap terkendali
  walau isinya lebih kaya. `MAX_ADDITIONAL_PAGES` tetap 20.
- Test lama yang pakai fixture `PageSummary` (actionLabels dsb.) diupdate ke
  fixture `PageExplorationResult` (elements+selector); assertion prompt
  disesuaikan ke format `formatExplorationForPrompt` (bukan lagi
  "Judul (url)" gabungan). Semua 62 test proyek lolos, build lolos.

### 2026-08-18 — Generate final dipecah jadi batch per kelompok menu (hindari prompt raksasa)
- Konteks: user tanya cara crawl lebih banyak menu tanpa gampang timeout.
  Root cause risiko timeout bukan di crawl (tiap halaman sudah punya timeout
  10s sendiri, gagal di-skip), tapi di SATU prompt generate final yang
  membengkak linear sesuai jumlah `additionalPages` — makin banyak menu,
  makin besar peluang provider lambat/timeout.
- Keputusan (dipilih user dari 3 opsi: budget-prompt-dinamis, batching
  multi-call, atau kombinasi + crawl paralel): **opsi B — pecah generate
  final jadi beberapa panggilan LLM kecil**, satu per kelompok menu.
- Implementasi di `generator.service.ts`:
  - `MAX_ADDITIONAL_PAGES` naik dari 6 → 20 (crawl-nya sendiri sudah resilient
    per halaman, generate job jalan di background queue tanpa batas waktu
    HTTP — jadi aman dinaikkan).
  - `GENERATE_PAGE_BATCH_SIZE = 4` — halaman tambahan dikelompokkan per 4,
    tiap kelompok dapat panggilan LLM generate sendiri (prompt kecil, fokus).
  - Login/exploration & crawl tetap 1x per job (tidak berubah — itu bukan
    sumber risiko timeout, crawl murni scraping tanpa AI).
  - Generate final: 1x panggilan "halaman utama" (pakai `pageSnapshot`
    detail, TANPA `additionalPages`) + N panggilan batch (pakai
    `additionalPages` chunk, TANPA `pageSnapshot`) — tiap panggilan punya
    fallback provider sendiri (`runGenerateBatch` helper, reuse `attempted`).
  - Kalau panggilan "halaman utama" gagal di semua provider → job gagal
    (`AllProvidersFailedError`), sama seperti sebelumnya (kritis).
  - Kalau satu BATCH menu gagal di semua provider → **tidak** menggagalkan
    job; batch itu di-skip + emit log, batch lain & hasil primary tetap
    disimpan (resilient, konsisten dengan pola gagal-sebagian yang sudah ada
    di crawl/exploration).
  - `existingTitles` diakumulasi lintas batch (existing DB + primary +
    batch-batch sebelumnya) supaya AI tidak duplikasi judul antar batch.
- Test baru (`prompt-generation.spec.ts`): batch splitting (5 menu → primary
  + 2 batch: 4+1), dan resiliensi (1 batch gagal parse tapi primary + batch
  lain tetap tersimpan). Semua 62 test proyek lolos, build lolos.

### 2026-08-18 — Bug: step `goto` pakai field `value` (bukan `url`) gagal silent di generate final
- Root cause dari log: `opencode-go` sukses generate test case, tapi salah satu
  step `{"action":"goto","value":"https://..."}` — field yang benar `url`
  (schema wajib `url` untuk action `goto`). `parseGeneratedTestCases` gagal
  parse seluruh response → catch di `generator.service.ts` (loop generate
  final, bukan exploration) `continue` tanpa emit log (silent, pola sama
  dengan bug exploration sebelumnya tapi di titik lain). Provider fallback
  `opencode` kena HTTP 429 (rate limit) → semua provider attempted gagal →
  job gagal total ("Analisis gagal pada seluruh provider: opencode-go,
  opencode").
- Fix: `normalizeGotoStepValue()` baru di `prompt-generation.ts` — menyisir
  payload AI secara rekursif sebelum divalidasi zod, kalau ada step
  `action:"goto"` tanpa `url` tapi ada `value` (string), `value` disalin ke
  `url`. Dipakai di `parseGeneratedTestCases` dan `parseExplorationSteps`.
- `generator.service.ts`: catch parse test case final (di loop provider)
  sekarang `emit('generate', 'Output test case dari <provider> tidak sesuai
  format, mencoba provider lain…')` — tidak lagi silent `continue`.
- System prompt generate (`buildGenerationSystemPrompt`) ditegaskan: "goto
  wajib field \"url\" (bukan \"value\")".
- Rate limit HTTP 429 pada provider fallback bukan bug — sudah retry sesuai
  `PROVIDER_MAX_ATTEMPTS`, tapi kalau semua provider configured kena
  limit/invalid, job tetap gagal. Belum ada fix untuk ini (di luar scope),
  hanya dicatat sebagai kondisi yang mungkin terulang.

### 2026-08-18 — Bug: 1 step invalid dari AI membuang semua step instruction
- Root cause: AI kirim exploration steps `[fill, fill, click, waitFor]` tapi
  `waitFor` tanpa `selector` (wajib per spesifikasi/schema). Zod memvalidasi
  seluruh array sekaligus → 1 item invalid membuat SEMUA step (termasuk
  fill/click login yang valid) ditolak. Catch block di `generator.service.ts`
  menelan error itu tanpa emit log → login tidak pernah dijalankan, tapi user
  tidak tahu kenapa (silent failure).
- Fix: `parseExplorationSteps` (`prompt-generation.ts`) sekarang fallback
  parse per-item kalau parse array penuh gagal — step invalid dibuang
  SENDIRIAN, step valid lain tetap dipakai. Hanya throw kalau tidak ada satu
  pun step valid.
- `generator.service.ts`: catch parsing error non-ProviderError sekarang
  `emit('act', 'Langkah instruction dari AI tidak valid, melanjutkan tanpa
  mengisi form otomatis.')` — tidak lagi silent.
- System prompt eksplorasi (`buildExplorationSystemPrompt`) ditambah
  penegasan: `waitFor` WAJIB `selector`; kalau tidak yakin, jangan sertakan
  step waitFor sama sekali.
- Test baru: `parseExplorationSteps` filter partial-invalid, tetap gagal
  kalau semua invalid; integrasi `generator.service` tetap followInstruction
  dengan step valid walau ada 1 step waitFor rusak.

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
