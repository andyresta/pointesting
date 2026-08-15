# Execution Plan — AI Testing Tool (Step by Step untuk AI IDE)

Dokumen ini adalah panduan eksekusi step-by-step untuk dituangkan ke AI IDE (Claude Code, Cursor, Windsurf, dll). Setiap step punya prompt siap pakai — copy-paste prompt-nya ke AI IDE, biarkan AI IDE membaca `roadmap-ai-testing-tool.md` dan `arsitektur-spesifikasi-teknis.md` sebagai referensi.

**Cara pakai:**

1. Taruh `roadmap-ai-testing-tool.md` dan `arsitektur-spesifikasi-teknis.md` di root project (misal folder `docs/`), supaya AI IDE bisa baca sebagai konteks.
2. Kerjakan step **berurutan** — jangan loncat, karena step belakang bergantung pada step sebelumnya.
3. Update kolom **Status** manual setiap selesai satu step: `Planning` → `Process` → `Done`.
4. Setiap prompt sudah dirancang supaya hasilnya **konsisten dengan skema DB, interface, dan struktur folder** di `arsitektur-spesifikasi-teknis.md` — jangan biarkan AI IDE improvisasi struktur baru di luar itu.

---



## Status Legend

- **Planning** — belum dikerjakan
- **Process** — sedang dikerjakan / sedang direview
- **Done** — selesai, sudah lolos acceptance criteria

---



## Ringkasan Progress


| #   | Step                                             | Fase   | Status   |
| --- | ------------------------------------------------ | ------ | -------- |
| 0   | Inisialisasi Project & Tooling                   | Setup  | Planning |
| 1   | Setup Database Schema & Migration                | Fase 1 | Planning |
| 2   | Konfigurasi Environment & Config Loader          | Fase 1 | Planning |
| 3   | Repository Layer (DB Access)                     | Fase 1 | Planning |
| 4   | API Server Skeleton (Fastify)                    | Fase 1 | Planning |
| 5   | Autentikasi Personal                             | Fase 1 | Planning |
| 6   | Test Case CRUD API                               | Fase 1 | Planning |
| 7   | In-Memory Job Queue                              | Fase 1 | Planning |
| 8   | Test Case Compiler (JSON → Playwright Actions)   | Fase 1 | Planning |
| 9   | Test Runner Executor (Playwright)                | Fase 1 | Planning |
| 10  | Custom Reporter & Artifact Collector             | Fase 1 | Planning |
| 11  | Artifact Storage (Filesystem)                    | Fase 1 | Planning |
| 12  | Screencast Live View + WebSocket Gateway         | Fase 1 | Planning |
| 13  | Dashboard Dasar (UI)                             | Fase 1 | Planning |
| 14  | Integrasi & Testing End-to-End Fase 1            | Fase 1 | Planning |
| 15  | Trace Parser                                     | Fase 2 | Planning |
| 16  | Provider Interface & Adapters (Multi-AI)         | Fase 2 | Planning |
| 17  | Prompt Builder                                   | Fase 2 | Planning |
| 18  | Analyzer Service (Provider Selection + Fallback) | Fase 2 | Planning |
| 19  | Integrasi Analyzer ke Queue                      | Fase 2 | Planning |
| 20  | Update Dashboard untuk Analysis Result           | Fase 2 | Planning |
| 21  | Anomaly Detection Berbasis Histori               | Fase 2 | Planning |
| 22  | Testing & Validasi Akurasi Klasifikasi           | Fase 2 | Planning |
| 23  | MCP Client Setup                                 | Fase 3 | Planning |
| 24  | Prompt-based Test Generation                     | Fase 3 | Planning |
| 25  | URL-based Exploration Generation                 | Fase 3 | Planning |
| 26  | Draft Review UI                                  | Fase 3 | Planning |
| 27  | Selector Failure Detection                       | Fase 4 | Planning |
| 28  | Self-Healing via MCP                             | Fase 4 | Planning |
| 29  | Healing Approval Flow                            | Fase 4 | Planning |
| 30  | Fixture Upload & Management                      | Fase 5 | Planning |
| 31  | Fixture Matching di Test Execution               | Fase 5 | Planning |
| 32  | PRD Parser & Feature Map Generation              | Fase 5 | Planning |
| 33  | Feature Map Coverage UI                          | Fase 5 | Planning |


---



## STEP 0 — Inisialisasi Project & Tooling

**Fase:** Setup | **Status:** Planning | **Dependency:** —

**Tujuan:** Project Node.js + TypeScript siap, semua dependency inti terpasang, struktur folder sesuai spesifikasi.

**Acceptance criteria:**

- `npm run dev` berhasil menjalankan server kosong tanpa error
- Struktur folder persis seperti di `arsitektur-spesifikasi-teknis.md` bagian 2
- TypeScript strict mode aktif

**Prompt untuk AI IDE:**

```
Baca file docs/arsitektur-spesifikasi-teknis.md bagian "2. Struktur Proyek".
Inisialisasi project Node.js + TypeScript baru bernama ai-testing-tool dengan struktur folder
PERSIS seperti yang tercantum di dokumen tersebut (src/api, src/ws, src/queue, src/runner,
src/analyzer, src/storage, src/db, src/config, storage/artifacts, storage/fixtures).

Setup:
- TypeScript dengan strict mode aktif (tsconfig.json)
- Package manager: npm
- Dependencies inti: fastify, ws, pg, dotenv, zod (untuk validasi schema), @playwright/test
- Dev dependencies: typescript, tsx (untuk dev run), @types/node, @types/ws
- Script package.json: "dev" (jalankan src/api/server.ts pakai tsx watch), "build", "start"
- File .env.example berisi placeholder: DATABASE_URL, PORT, AUTH_SECRET, CLAUDE_API_KEY,
  OPENAI_API_KEY, DEEPSEEK_API_KEY, KIMI_API_KEY, OPENCODE_API_KEY
- src/api/server.ts: Fastify server kosong yang listen di PORT dari env, dengan satu endpoint
  GET /health yang balikan { status: "ok" }

Jangan implementasi logic lain dulu di luar ini — step ini murni scaffolding.
```

---



## STEP 1 — Setup Database Schema & Migration

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 0

**Tujuan:** Semua tabel dari spesifikasi arsitektur (bagian 3) sudah ada di PostgreSQL, dengan sistem migration yang bisa dijalankan ulang.

**Acceptance criteria:**

- Migration bisa dijalankan via `npm run migrate`
- Semua tabel (project, test_case, test_run, artifact, analysis_result, test_step_result, fixture, feature_map) ada persis sesuai DDL di dokumen arsitektur
- Migration idempotent (aman dijalankan berkali-kali)

**Prompt untuk AI IDE:**

```
Baca file docs/arsitektur-spesifikasi-teknis.md bagian "3. Skema Database (PostgreSQL)".
Buat sistem migration sederhana di src/db/migrations/ menggunakan SQL file bernomor urut
(misal 001_init.sql) berisi PERSIS DDL yang ada di dokumen tersebut (semua 8 tabel:
project, test_case, test_run, artifact, analysis_result, test_step_result, fixture,
feature_map) — jangan ubah nama kolom atau tipe data.

Buat juga:
- src/db/client.ts — koneksi pool ke PostgreSQL pakai `pg`, baca DATABASE_URL dari env
- src/db/migrate.ts — script yang baca semua file di migrations/ urut nomor, jalankan yang
  belum pernah dijalankan (buat tabel _migrations untuk tracking migration mana yang sudah jalan)
- Tambahkan script "migrate" di package.json yang menjalankan src/db/migrate.ts

Pastikan menggunakan gen_random_uuid() (extension pgcrypto atau pgcrypto built-in di PG 13+)
untuk semua primary key UUID.
```

---



## STEP 2 — Konfigurasi Environment & Config Loader

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 1

**Tujuan:** Semua konfigurasi (DB, port, API key provider, auth secret) dibaca dari satu tempat terpusat dan tervalidasi saat startup.

**Acceptance criteria:**

- Server gagal start dengan pesan jelas kalau env wajib (DATABASE_URL, AUTH_SECRET) tidak ada
- Semua modul lain import config dari satu file, tidak ada `process.env` tersebar di banyak file

**Prompt untuk AI IDE:**

```
Buat src/config/env.ts yang membaca environment variable pakai dotenv, lalu validasi
menggunakan zod schema. Variable wajib: DATABASE_URL, PORT (default 3000), AUTH_SECRET.
Variable opsional (boleh kosong, dicek nanti per-provider saat dipakai):
CLAUDE_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, KIMI_API_KEY, OPENCODE_API_KEY.

Export sebagai satu object `config` yang sudah tervalidasi dan strongly-typed.
Kalau validasi gagal saat startup, throw error dengan pesan jelas menyebutkan variable
mana yang hilang, lalu proses exit(1) — jangan biarkan server jalan dengan config tidak lengkap.

Refactor src/api/server.ts dari Step 0 untuk pakai config ini (PORT dari config, bukan
process.env langsung).
```

---



## STEP 3 — Repository Layer (DB Access)

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 2

**Tujuan:** Semua akses database lewat repository layer yang terpisah dari logic bisnis, satu file per entity.

**Acceptance criteria:**

- Ada repository untuk project, test_case, test_run, artifact, test_step_result
- Setiap repository punya minimal: create, findById, findAll (dengan filter dasar), update
- Tidak ada raw SQL query di luar folder src/db/repositories/

**Prompt untuk AI IDE:**

```
Baca skema tabel di docs/arsitektur-spesifikasi-teknis.md bagian 3.
Buat repository layer di src/db/repositories/, satu file per entity, menggunakan
src/db/client.ts dari Step 1. Buat untuk entity: project, test-case, test-run, artifact,
test-step-result.

Setiap repository minimal punya method:
- create(data): insert row baru, balikan row yang baru dibuat
- findById(id): balikan satu row atau null
- findAll(filter?): balikan array, terima filter opsional (misal test-run.findAll({testCaseId}))
- update(id, data): partial update

Gunakan parameterized query (bukan string concatenation) untuk mencegah SQL injection.
Tulis semua dengan TypeScript, tipe kembalian sesuai kolom di tabel (misal TestCase,
TestRun sebagai interface terpisah di src/db/repositories/types.ts).
```

---



## STEP 4 — API Server Skeleton (Fastify)

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 3

**Tujuan:** Struktur routing REST API sesuai spesifikasi bagian 5, walau sebagian handler masih placeholder.

**Acceptance criteria:**

- Semua endpoint di tabel spesifikasi bagian 5 terdaftar dan bisa dipanggil (boleh return placeholder response dulu untuk yang belum ada logic-nya)
- Response error konsisten (format JSON: `{ error: string }`)

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "5. Spesifikasi API (REST)".
Di src/api/routes/, buat file routing terpisah per resource: project.routes.ts,
testcase.routes.ts, testrun.routes.ts, auth.routes.ts — daftarkan semua endpoint yang
ada di tabel spesifikasi tersebut sebagai Fastify route.

Untuk endpoint yang datanya sudah bisa diambil dari repository Step 3 (misal GET
/projects/:id, GET /projects/:id/test-cases), implementasikan penuh pakai repository.
Untuk endpoint yang butuh komponen yang belum dibuat (POST /test-cases/:id/run, karena
queue belum ada) — buat sebagai placeholder yang return 501 Not Implemented dengan
pesan jelas "akan diimplementasikan di Step 7/9".

Tambahkan global error handler Fastify yang mengembalikan format error konsisten:
{ error: string, statusCode: number }. Daftarkan semua routes di src/api/server.ts.
```

---



## STEP 5 — Autentikasi Personal

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 4

**Tujuan:** Semua endpoint (kecuali /health dan /auth/login) terlindungi, sesuai keputusan "personal/single-user, tanpa role".

**Acceptance criteria:**

- Request tanpa token/session valid ke endpoint terlindungi balikan 401
- Login berhasil dengan credential yang benar (dari env, bukan tabel user) menghasilkan session/token valid

**Prompt untuk AI IDE:**

```
Implementasikan autentikasi personal/single-user sesuai docs/arsitektur-spesifikasi-teknis.md
bagian 5 dan 7 (baris "Autentikasi": personal/single-user, tanpa tabel user/role).
Pendekatan: satu credential (username+password ATAU API key tunggal) disimpan di
environment variable (tambahkan AUTH_USERNAME, AUTH_PASSWORD_HASH ke src/config/env.ts
dari Step 2). POST /auth/login menerima username+password, verifikasi terhadap env
(gunakan bcrypt untuk hash password), jika valid keluarkan JWT signed dengan AUTH_SECRET,
masa berlaku 7 hari.

Buat Fastify preHandler hook/plugin di src/api/auth.middleware.ts yang memvalidasi
JWT dari header Authorization: Bearer <token> untuk semua route KECUALI /health dan
/auth/login. Terapkan middleware ini secara global di server.ts.

Jangan buat tabel user di database — cukup satu credential dari env, sesuai keputusan
di spesifikasi.
```

---



## STEP 6 — Test Case CRUD API

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 5

**Tujuan:** Endpoint untuk membuat, melihat, dan mengedit test case terstruktur berfungsi penuh, termasuk validasi schema.

**Acceptance criteria:**

- POST test case dengan steps/expected format salah ditolak dengan pesan error jelas
- Test case tersimpan dan bisa diambil kembali persis sama strukturnya

**Prompt untuk AI IDE:**

```
Baca format test case di docs/arsitektur-spesifikasi-teknis.md bagian "4.1 Test Case".
Lengkapi implementasi endpoint POST /projects/:id/test-cases, GET /projects/:id/test-cases,
PATCH /test-cases/:id (dari Step 4) memakai repository Step 3.

Buat zod schema di src/api/schemas/testcase.schema.ts untuk validasi body request:
- steps: array minimal 1 item, tiap item punya "action" (enum: goto, fill, click, check,
  select, waitFor — boleh tambah sesuai kebutuhan Playwright umum), field lain (selector,
  value, url) opsional tergantung action
- expected: array of string, minimal 1 item

Tolak request dengan 400 dan pesan error spesifik (field mana yang salah) kalau tidak
sesuai schema. Simpan steps dan expected sebagai JSONB persis seperti format di dokumen.
```

---



## STEP 7 — In-Memory Job Queue

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 6

**Tujuan:** Queue sederhana di dalam proses Node untuk menjalankan test run secara async, dengan concurrency terbatas.

**Acceptance criteria:**

- Job yang di-push tidak memblokir response API (fire and forget dengan id balikan)
- Concurrency bisa dikonfigurasi (default 2), job kelima+ menunggu slot kosong
- Ada mekanisme untuk cek berapa job pending/running saat ini

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "7. Non-Functional & Operasional"
baris "Konkurensi eksekusi" dan bagian 6.1/6.2 untuk alur job.

Implementasikan in-memory queue di src/queue/queue.ts menggunakan library `p-queue`.
Buat dua named queue terpisah: testRunQueue (untuk job eksekusi Playwright) dan
analysisQueue (untuk job AI analysis di Fase 2 nanti) — concurrency masing-masing
dikonfigurasi via env (default testRunQueue: 2, analysisQueue: 3, karena analysis
lebih ringan CPU-nya daripada browser automation).

Definisikan tipe job di src/queue/types.ts:
- TestRunJob: { type: 'test_run', testRunId: string }
- AnalysisJob: { type: 'analysis', testRunId: string }

Buat function enqueueTestRun(testRunId) dan enqueueAnalysis(testRunId) yang push ke
queue masing-masing. Untuk sekarang, handler job masih placeholder (console.log saja) —
akan diisi eksekusi sungguhan di Step 9 dan Step 19.

Tambahkan juga: saat server startup, cek test_run yang statusnya masih 'running' dari
sesi sebelumnya (server restart) — update jadi status 'error' (sesuai catatan di
spesifikasi bagian 7 baris "Persistensi job").
```

---



## STEP 8 — Test Case Compiler (JSON → Playwright Actions) 

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 7

**Tujuan:** Fungsi yang mengubah `test_case.steps` (JSON) menjadi eksekusi Playwright yang sesungguhnya terhadap sebuah `page` object.

**Acceptance criteria:**

- Semua action type yang didefinisikan di Step 6 (goto, fill, click, check, select, waitFor) berhasil dieksekusi terhadap halaman sungguhan
- Error di satu step tidak membuat seluruh proses crash tanpa informasi jelas — error ditangkap dengan step index dan pesan asli

**Prompt untuk AI IDE:**

```
Buat src/runner/testcase-compiler.ts. Fungsi utama: executeSteps(page: Page, steps: Step[]):
Promise<StepExecutionResult[]>.

Untuk setiap step, map action ke Playwright API:
- goto → page.goto(step.url)
- fill → page.fill(step.selector, step.value)
- click → page.click(step.selector)
- check → page.check(step.selector)
- select → page.selectOption(step.selector, step.value)
- waitFor → page.waitForSelector(step.selector)

Jalankan steps berurutan (bukan paralel — urutan penting untuk test case). Untuk tiap
step, catat: index, action, status ('passed'/'failed'), errorMessage (jika gagal),
durationMs. Kalau satu step gagal, HENTIKAN eksekusi step berikutnya (fail fast) tapi
tetap kembalikan array hasil sampai step yang gagal itu, jangan throw uncaught exception.

Tulis unit test sederhana (pakai Playwright Test) yang jalankan compiler ini terhadap
halaman HTML statis lokal (buat file test fixture kecil di src/runner/__tests__/fixtures/
untuk keperluan test) untuk memverifikasi tiap action type bekerja.
```

---



## STEP 9 — Test Runner Executor (Playwright) 

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 8

**Tujuan:** Fungsi yang mengorkestrasi satu eksekusi test_run penuh: buka browser, jalankan compiler, tutup browser, update status di DB.

**Acceptance criteria:**

- Memanggil executor dengan satu testRunId valid menghasilkan browser terbuka, steps dieksekusi, browser tertutup, dan test_run.status terupdate sesuai hasil
- video: 'on' dan trace: 'on' aktif sesuai spesifikasi

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian 6.1 (sequence eksekusi).
Buat src/runner/executor.ts dengan fungsi executeTestRun(testRunId: string).

Alur:
1. Ambil test_run dan test_case terkait dari repository (Step 3)
2. Update test_run.status = 'running', started_at = now
3. Launch Playwright browser (chromium), buat context dengan:
   - recordVideo: { dir: temp path khusus run ini }
   - viewport 1280x720
4. Buat page baru, mulai tracing: context.tracing.start({ screenshots: true, snapshots: true })
5. Jalankan testcase-compiler.ts (Step 8) dengan steps dari test_case
6. Simpan tiap step result ke test_step_result repository
7. Stop tracing: context.tracing.stop({ path: <path trace.zip> })
8. Tutup context (ini yang finalize video file)
9. Tutup browser
10. Hitung status akhir: 'passed' kalau semua step passed DAN sesuai expected (untuk
    sekarang expected belum dicek otomatis — itu tugas AI Analyzer Fase 2, jadi status
    di sini murni dari keberhasilan eksekusi step), 'failed' kalau ada step gagal
11. Update test_run: status, finished_at, duration_ms

Hubungkan fungsi ini ke testRunQueue dari Step 7 — ganti placeholder handler dengan
pemanggilan executeTestRun(job.testRunId) yang sesungguhnya.

Pastikan ada try-catch menyeluruh: kalau terjadi error tak terduga (browser crash dll),
test_run.status di-set 'error', browser tetap ditutup di finally block (jangan sampai
ada browser process menggantung).
```

---



## STEP 10 — Custom Reporter & Artifact Collector [Ready Process]

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 9

**Tujuan:** Console log dan network log ditangkap selama eksekusi, semua artifact (video, trace, console log, network log) dikumpulkan jadi satu set file per run.

**Acceptance criteria:**

- File console_log dan network_log tersimpan sebagai JSON terstruktur (bukan raw stream)
- Semua 4 jenis artifact (video, trace, console_log, network_log) punya path yang valid setelah run selesai

**Prompt untuk AI IDE:**

```
Perluas src/runner/executor.ts (Step 9). Sebelum menjalankan steps, pasang listener:
- page.on('console', ...) → kumpulkan { type, text, timestamp } ke array
- page.on('request', ...) dan page.on('response', ...) → kumpulkan
  { url, method, status, responseTimeMs, timestamp } ke array (pasangkan request-response
  by url+timing untuk hitung responseTimeMs)

Setelah run selesai, tulis kedua array ini sebagai file JSON terpisah:
console-log.json dan network-log.json, ke temp path yang sama dengan video/trace.

Buat src/runner/reporter.ts berisi fungsi collectArtifacts(testRunId, tempPaths) yang:
1. Pindahkan semua file (video.webm, trace.zip, console-log.json, network-log.json)
   dari temp path ke lokasi final (akan dipakai artifact-storage.ts di Step 11)
2. Insert row artifact untuk masing-masing file (type, file_path, size_bytes) via
   repository Step 3

Panggil collectArtifacts ini di akhir executeTestRun (Step 9), setelah context ditutup.
```

---



## STEP 11 — Artifact Storage (Filesystem)

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 10

**Tujuan:** Lapisan abstraksi penyimpanan file lokal yang konsisten, dan endpoint untuk download/stream artifact.

**Acceptance criteria:**

- Struktur folder persis `./storage/artifacts/<run_id>/` sesuai spesifikasi
- GET /test-runs/:id/artifacts/:artifactId berhasil stream file dengan content-type benar

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian 7 baris "Ukuran file screenshot/video"
dan struktur folder di bagian 2.

Buat src/storage/artifact-storage.ts dengan fungsi:
- getArtifactDir(runId): string → balikan path ./storage/artifacts/<runId>/, buat folder
  kalau belum ada
- saveArtifact(runId, filename, sourceBuffer/sourcePath): pindahkan/tulis file ke folder itu,
  balikan path relatif yang akan disimpan di kolom artifact.file_path
- getArtifactStream(filePath): fs.ReadStream untuk keperluan HTTP response

Update src/runner/reporter.ts (Step 10) untuk pakai saveArtifact ini alih-alih manipulasi
fs langsung.

Implementasikan penuh endpoint GET /test-runs/:id/artifacts/:artifactId di
testrun.routes.ts: ambil artifact row dari DB, tentukan content-type dari artifact.type
(video/webm, application/zip untuk trace, application/json untuk log), stream file
sebagai response menggunakan getArtifactStream.
```

---



## STEP 12 — Screencast Live View + WebSocket Gateway

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 11

**Tujuan:** Fitur live embedded browser view berfungsi — frame browser di-stream real-time ke dashboard selagi test berjalan.

**Acceptance criteria:**

- Client yang subscribe ke runId tertentu menerima event run:frame secara real-time selama test itu berjalan
- Client yang subscribe ke runId lain tidak menerima frame dari run yang berbeda

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "4.3 WebSocket Event Contract" (termasuk
catatan Autentikasi WebSocket di bagian itu) dan bagian fitur detail Fase 1 poin 5 (live
embedded browser view) di roadmap-ai-testing-tool.md.

Buat src/ws/gateway.ts: WebSocket server (pakai `ws`) yang di-attach ke Fastify server
yang sama.

WAJIB: validasi token JWT (dari Step 5) saat koneksi WS dibuka — baca dari query param
?token=... saat handshake, verifikasi sama seperti middleware REST. Kalau token tidak
ada/invalid, tutup koneksi segera (close code 4001) sebelum menerima pesan subscribe
apa pun. Jangan biarkan ada jalur untuk terhubung ke WS tanpa autentikasi, sama seperti
REST endpoint di Step 5.

Implementasikan pub/sub sederhana per runId:
- Simpan Map<runId, Set<WebSocket>> untuk tracking subscriber
- Handle client message { type: 'subscribe:run', runId } → tambahkan socket ke set
- Handle client message { type: 'unsubscribe:run', runId } → hapus socket dari set
- Export function broadcastToRun(runId, event) yang kirim ke semua socket dalam set itu

Definisikan semua event type di src/ws/events.ts sesuai kontrak di dokumen arsitektur
(run:status, run:frame, run:step, run:analysis).

Buat src/runner/screencast.ts: fungsi startScreencast(page, runId) yang panggil
page.screencast.start() (Playwright ≥1.59), listen event 'frame', dan untuk tiap frame
panggil broadcastToRun(runId, { type: 'run:frame', runId, frame: base64, timestamp }).
Kualitas/resolusi frame di-set rendah (misal quality 50, scale down) untuk hemat bandwidth.

Integrasikan ke src/runner/executor.ts (Step 9): panggil startScreencast di awal sebelum
steps dijalankan, stop screencast sebelum context ditutup. Panggil broadcastToRun untuk
event run:status di setiap perubahan status, dan run:step di setiap step selesai (dari
data yang sudah dikumpulkan Step 9).

CATATAN: jika versi Playwright yang terpasang belum punya page.screencast API, gunakan
CDP session sebagai fallback: const client = await context.newCDPSession(page);
client.send('Page.startScreencast', { format: 'jpeg', quality: 50 }); dan listen
client.on('Page.screencastFrame', ...). Sebutkan di komentar kode pendekatan mana yang
dipakai dan kenapa.
```

---



## STEP 13 — Dashboard Dasar (UI)

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 12

**Tujuan:** UI minimal untuk: lihat daftar test case, trigger run, lihat live view selagi jalan, lihat video/artifact setelah selesai.

**Acceptance criteria:**

- User bisa klik "Run" pada satu test case dan melihat live view muncul di halaman yang sama tanpa reload
- Setelah run selesai, panel otomatis berganti menampilkan video player

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian 1 (tech stack Dashboard) dan bagian
6.1 (sequence live view).

Buat dashboard dasar menggunakan EJS + HTMX (sesuai stack di dokumen), disajikan dari
Fastify (pakai @fastify/view untuk EJS, @fastify/static untuk asset).

Halaman yang dibutuhkan:
1. /dashboard — list semua test case dalam project, tombol "Run" di tiap baris
2. Saat tombol Run diklik: panggil POST /test-cases/:id/run via fetch, dapat runId,
   buka WebSocket connection, kirim subscribe:run, render panel live view di bawah
   baris test case itu
3. Panel live view: <img> yang src-nya di-update tiap terima event run:frame (base64
   → data URL), plus indikator status (queued/running/passed/failed) yang update dari
   event run:status
4. Saat status jadi passed/failed (test selesai): ganti panel dari live view jadi
   video player (<video> tag, src ke endpoint GET /test-runs/:id/artifacts/:artifactId
   untuk artifact type video) plus link download trace

Styling cukup minimal/functional (tidak perlu framework CSS berat) — prioritas fitur
bekerja dengan benar, bukan estetika di tahap ini.
```

---



## STEP 14 — Integrasi & Testing End-to-End Fase 1

**Fase:** 1 | **Status:** Planning | **Dependency:** Step 13

**Tujuan:** Verifikasi seluruh alur Fase 1 bekerja dari ujung ke ujung terhadap aplikasi web sungguhan.

**Acceptance criteria:**

- Satu test case nyata (misal login ke aplikasi contoh) berhasil dijalankan lewat dashboard, live view tampil, artifact tersimpan dan bisa diunduh, semua tanpa error di log server

**Prompt untuk AI IDE:**

```
Lakukan review menyeluruh terhadap seluruh kode Fase 1 (Step 0-13) untuk konsistensi
dengan docs/arsitektur-spesifikasi-teknis.md — cek khususnya:
1. Apakah semua nama kolom DB yang dipakai di kode persis sama dengan DDL di dokumen
2. Apakah WebSocket event payload persis sesuai kontrak di bagian 4.3
3. Apakah tidak ada raw process.env di luar src/config/env.ts

Buat satu test case contoh (bisa target https://the-internet.herokuapp.com/login atau
aplikasi test publik serupa) untuk verifikasi manual: project baru → test case baru
(steps: goto /login, fill username, fill password, click submit) → jalankan dari
dashboard → verifikasi live view muncul → verifikasi setelah selesai video/trace/log
bisa diunduh dan isinya benar.

Laporkan temuan bug/inkonsistensi yang ditemukan saat review, perbaiki, lalu jalankan
verifikasi manual ini sekali lagi sampai berhasil bersih.
```

---



## STEP 15 — Trace Parser

**Fase:** 2 | **Status:** Planning | **Dependency:** Step 14

**Tujuan:** File trace.zip diubah jadi data terstruktur ringkas yang siap dikirim ke LLM, tanpa membengkak token.

**Acceptance criteria:**

- Fungsi parseTrace menerima path trace.zip, balikan object ringkas (bukan seluruh isi trace mentah)

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian 4.2 (AnalyzerInput.traceSummary) dan
bagian 6.2 (alur AI Analysis).

Buat src/analyzer/trace-parser.ts dengan fungsi parseTrace(traceZipPath: string):
Promise<TraceSummary>. Trace Playwright adalah zip berisi file .trace (JSONL events)
dan resources — extract dan ambil hanya informasi penting:
- Daftar action yang terjadi dengan timing-nya (action name, duration, error jika ada)
- Network request yang tercatat dalam trace (jika berbeda dari network-log.json yang
  sudah dikumpulkan Step 10 — kalau redundant, boleh trace-parser fokus ke DOM
  snapshot/timing saja dan network tetap dari network-log.json)
- Total durasi test, dan durasi tiap step

Definisikan interface TraceSummary di src/analyzer/types.ts, buat ringkas (target
di bawah ~2000 token kalau di-JSON.stringify) — jangan sertakan raw snapshot HTML
penuh, cukup ringkasan terstruktur.
```

---



## STEP 16 — Provider Interface & Adapters (Multi-AI)

**Fase:** 2 | **Status:** Planning | **Dependency:** Step 15

**Tujuan:** Lapisan abstraksi AI provider berfungsi untuk kelima provider (Claude, OpenAI, DeepSeek, Kimi, opencode), dengan output yang konsisten.

**Acceptance criteria:**

- Memanggil provider mana pun dengan input yang sama menghasilkan struktur AnalysisResult yang sama
- Provider yang tidak support image tetap bisa jalan dengan menyertakan screenshot=undefined

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "4.2 Provider Interface (AI Analyzer)"
dan bagian "4.2.1 Lapisan Provider Generik" — implementasikan PERSIS interface
AnalyzerInput, AnalysisResult, AnalyzerProvider, DAN HistoricalContext/HealingEvent
yang tercantum di 4.2, taruh di src/analyzer/provider.interface.ts.

PENTING: setiap adapter mengimplementasikan DUA interface sesuai 4.2.1, bukan cuma satu:
1. LLMClient — method generik complete(systemPrompt, userContent) yang menangani auth
   dan format request/response spesifik vendor itu. Taruh interface ini di
   src/analyzer/llm-client.interface.ts (folder analyzer dipakai bersama karena provider
   generik ini akan dipakai lagi oleh generator.service.ts di Fase 3 dan
   feature-map.service.ts di Fase 5 — jangan taruh di lokasi yang terasa "Fase 2 only").
2. AnalyzerProvider — memakai LLMClient di dalamnya, lalu parse response jadi
   AnalysisResult sesuai STATUS_DEFINITIONS.

Buat adapter di src/analyzer/providers/ untuk masing-masing (tiap file mengekspor
implementasi LLMClient dan AnalyzerProvider untuk vendor itu):
- claude.provider.ts — pakai Anthropic Messages API, model claude terbaru yang tersedia,
  supportsImage: true
- openai.provider.ts — pakai OpenAI Chat Completions API dengan response_format json_object,
  supportsImage: true
- deepseek.provider.ts — pakai DeepSeek API (kompatibel format OpenAI-style), cek dokumentasi
  resmi DeepSeek untuk endpoint dan apakah mendukung image input, set supportsImage sesuai
  temuan
- kimi.provider.ts — pakai Moonshot/Kimi API, cek dokumentasi resmi untuk format request
  dan dukungan image
- opencode.provider.ts — cek dokumentasi resmi opencode untuk format API yang benar

Untuk setiap adapter: build prompt system yang menjelaskan definisi status
(success/fail/bug/anomaly) SAMA PERSIS di semua adapter (taruh definisi ini sebagai
shared constant di src/analyzer/prompt-builder.ts agar tidak duplikasi — akan
diimplementasikan penuh di Step 17, untuk sekarang buat placeholder constant dulu),
minta output JSON sesuai AnalysisResult, lalu parse response ke struktur itu.

Tangani error (network fail, invalid response, rate limit) dengan throw custom error
class (ProviderError) yang membawa info provider mana yang gagal dan kenapa — supaya
Step 18 bisa menentukan fallback.

Untuk provider yang supportsImage: false, JANGAN error kalau input.screenshots ada isinya
— cukup abaikan field itu saat build request.
```

---



## STEP 17 — Prompt Builder

**Fase:** 2 | **Status:** Planning | **Dependency:** Step 16

**Tujuan:** Satu fungsi terpusat yang menyusun AnalyzerInput dari data mentah (test_case, artifacts, trace summary) menjadi input siap pakai untuk provider mana pun.

**Acceptance criteria:**

- Console log dan network log yang panjang ter-filter jadi ringkasan (hanya error/warning, hanya anomali response time), bukan dikirim mentah penuh

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian 4.2 dan roadmap-ai-testing-tool.md
Fase 2 poin "Prompt builder".

Buat src/analyzer/prompt-builder.ts dengan fungsi buildAnalyzerInput(testRunId: string):
Promise<AnalyzerInput>.

Alur:
1. Ambil test_case.expected dari repository
2. Baca artifact console_log JSON (dari Step 10), filter hanya entry type 'error' dan
   'warning', susun jadi ringkasan text (bukan array JSON penuh — ringkas jadi kalimat
   per error, gabungkan yang duplikat)
3. Baca artifact network_log JSON, filter hanya request dengan status >= 400 ATAU
   responseTimeMs di atas threshold (misal 3000ms), susun jadi ringkasan text
4. Panggil parseTrace (Step 15) untuk dapat traceSummary
5. Ambil screenshot kunci (screenshot di step terakhir, dan screenshot di step yang
   gagal jika ada) sebagai Buffer

Susun definisi status (success/fail/bug/anomaly) SATU KALI di file ini sebagai constant
STATUS_DEFINITIONS, dipakai oleh semua provider adapter (Step 16) supaya konsisten —
refactor provider adapters untuk import constant ini alih-alih definisi sendiri-sendiri.

Balikan object AnalyzerInput lengkap sesuai interface Step 16.
```

---



## STEP 18 — Analyzer Service (Provider Selection + Fallback)

**Fase:** 2 | **Status:** Planning | **Dependency:** Step 17

**Tujuan:** Titik orkestrasi tunggal yang memilih provider, memanggilnya, menangani fallback, dan menyimpan hasil.

**Acceptance criteria:**

- Kalau provider default gagal (error/rate-limit), otomatis coba provider berikutnya dalam daftar fallback
- Hasil akhir (dari provider mana pun yang berhasil) tersimpan dengan kolom `provider` menunjukkan provider yang benar-benar dipakai

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian 4.2, 6.2, dan bagian 7 baris
"Rate limit provider AI".

Buat src/analyzer/analyzer.service.ts dengan fungsi analyzeTestRun(testRunId: string).

Alur:
1. Ambil project terkait test_run untuk tahu default_provider
2. Panggil buildAnalyzerInput (Step 17)
3. Susun daftar fallback order (misal: [default_provider, ...provider lain yang API
   key-nya tersedia di env], urutan sisanya bisa alfabetis atau sesuai config tambahan
   FALLBACK_ORDER di env kalau mau dibuat configurable)
4. Coba tiap provider di daftar fallback berurutan: panggil provider.analyze(input),
   kalau sukses langsung berhenti dan lanjut ke step 5; kalau ProviderError, log
   warning dan lanjut ke provider berikutnya; kalau semua provider di daftar gagal,
   throw error dan biarkan test_run tanpa analysis_result (akan terlihat sebagai
   "belum teranalisis" di dashboard, bukan crash)
5. Insert analysis_result ke DB (repository baru: src/db/repositories/analysis-result.repository.ts)
   dengan kolom provider = nama provider yang berhasil, raw_response = response asli
6. Panggil broadcastToRun(runId, { type: 'run:analysis', runId, analysisResult })
   (WebSocket dari Step 12)

Tulis unit test yang mock provider.analyze untuk memverifikasi fallback bekerja
(provider pertama gagal → provider kedua dipanggil → berhasil).
```

---



## STEP 19 — Integrasi Analyzer ke Queue

**Fase:** 2 | **Status:** Planning | **Dependency:** Step 18

**Tujuan:** Setiap test_run yang selesai otomatis memicu job analysis tanpa campur tangan manual.

**Acceptance criteria:**

- Test run yang selesai (passed/failed/error) otomatis masuk analysisQueue, analyzeTestRun terpanggil tanpa perlu trigger manual

**Prompt untuk AI IDE:**

```
Update src/runner/executor.ts (Step 9): setelah test_run.status diupdate ke status
final (passed/failed/error), panggil enqueueAnalysis(testRunId) (dari Step 7).

Update handler analysisQueue di src/queue/queue.ts (yang tadinya placeholder console.log
di Step 7) untuk memanggil analyzeTestRun (Step 18) yang sesungguhnya.

Pastikan error di analyzeTestRun tertangkap di level queue handler (try-catch) —
kegagalan analysis TIDAK BOLEH membuat proses Node crash atau job lain di queue
ikut gagal.
```

---



## STEP 20 — Update Dashboard untuk Analysis Result

**Fase:** 2 | **Status:** Planning | **Dependency:** Step 19

**Tujuan:** Hasil klasifikasi AI (status, reason/detail/solution) tampil di dashboard, berdampingan dengan bukti mentah.

**Acceptance criteria:**

- Setelah run selesai dan analysis masuk, dashboard menampilkan status berwarna (success=hijau, fail=merah, bug=oranye, anomaly=kuning) beserta detail dan solusi tanpa perlu reload

**Prompt untuk AI IDE:**

```
Baca roadmap-ai-testing-tool.md Fase 2 poin "Dashboard update".

Update dashboard (Step 13) untuk:
1. Listen event run:analysis dari WebSocket, tampilkan card/panel baru di bawah video
   player berisi: badge status berwarna, reason (untuk success) atau detail+solution
   (untuk fail/bug/anomaly)
2. Buat endpoint GET /projects/:id/test-cases yang sekarang juga join dengan
   analysis_result terbaru per test case (tampilkan status terakhir di list, bukan
   cuma untuk run yang sedang aktif ditonton)
3. Pastikan panel analysis SELALU berdampingan dengan video/trace (jangan pernah
   tampilkan kesimpulan AI tanpa link ke bukti mentahnya) — sesuai prinsip desain
   di arsitektur bagian 1.2
```

---



## STEP 21 — Anomaly Detection Berbasis Histori

**Fase:** 2 | **Status:** Planning | **Dependency:** Step 20

**Tujuan:** Klasifikasi `anomaly` juga mempertimbangkan tren histori run sebelumnya, bukan cuma satu run tunggal.

**Acceptance criteria:**

- Prompt yang dikirim ke provider menyertakan perbandingan response time run ini vs rata-rata beberapa run sebelumnya untuk test case yang sama

**Prompt untuk AI IDE:**

```
Baca roadmap-ai-testing-tool.md Fase 2 poin "Anomaly detection berbasis histori".

Update src/analyzer/prompt-builder.ts (Step 17): sebelum build AnalyzerInput, query
GET /test-cases/:id/runs (atau langsung repository test-run) untuk ambil N run
terakhir (misal 5) dari test_case yang sama dengan status yang sudah final, hitung
rata-rata durasi (duration_ms) dan network response time dari run-run itu.

Tambahkan field baru ke AnalyzerInput: historicalContext (opsional) berisi
{ avgDurationMs, avgResponseTimeMs, currentDurationMs, currentResponseTimeMs,
sampleSize }. Update interface di provider.interface.ts.

Update semua provider adapter (Step 16) dan STATUS_DEFINITIONS untuk menyertakan
instruksi: kalau currentDurationMs atau currentResponseTimeMs menyimpang signifikan
(misal >50%) dari rata-rata historis TANPA ada error eksplisit, klasifikasikan
sebagai 'anomaly' dengan detail yang menyebutkan angka perbandingannya.

Kalau historicalContext tidak ada (run pertama kali untuk test case ini, sampleSize=0),
lewati pengecekan anomaly berbasis tren ini — jangan paksa AI menyimpulkan anomaly
tanpa data pembanding.
```

---



## STEP 22 — Testing & Validasi Akurasi Klasifikasi

**Fase:** 2 | **Status:** Planning | **Dependency:** Step 21

**Tujuan:** Memastikan seluruh sistem Fase 1+2 bekerja end-to-end dan hasil klasifikasi AI masuk akal terhadap kasus nyata (bukan cuma tidak crash).

**Acceptance criteria:**

- Minimal 3 skenario diverifikasi manual: (a) test case yang benar-benar sukses → status success dengan reason masuk akal, (b) test case dengan assertion yang sengaja salah → status fail dengan detail benar, (c) test case terhadap endpoint yang sengaja error 500 → status bug terdeteksi

**Prompt untuk AI IDE:**

```
Lakukan review menyeluruh kode Fase 2 (Step 15-21) untuk konsistensi dengan
docs/arsitektur-spesifikasi-teknis.md, sama seperti review Step 14 tapi untuk Fase 2 —
cek khususnya konsistensi AnalyzerInput/AnalysisResult di semua provider adapter.

Buat 3 test case skenario manual untuk validasi:
1. Test case terhadap halaman yang memang berhasil sesuai expected → jalankan, verifikasi
   analysis_result.status = 'success' dan reason-nya masuk akal
2. Test case dengan expected yang sengaja tidak sesuai kenyataan (misal expected
   "redirect ke /dashboard" padahal app-nya redirect ke halaman lain) → verifikasi
   status = 'fail' dan detail menjelaskan ketidaksesuaian dengan benar
3. Test case terhadap endpoint yang bisa dipicu error server (500) → verifikasi
   status = 'bug' terdeteksi dari network log

Jalankan ketiga skenario ini dengan minimal 2 provider berbeda (misal Claude dan
salah satu provider lain yang API key-nya tersedia) untuk verifikasi konsistensi
hasil antar provider. Laporkan hasil dan temuan (termasuk kalau ada provider yang
hasilnya jauh berbeda/kurang akurat dibanding yang lain).
```

---



## STEP 23 — MCP Client Setup

**Fase:** 3 | **Status:** Planning | **Dependency:** Step 22

**Tujuan:** Server bisa berkomunikasi dengan Playwright MCP sebagai client, sebagai fondasi untuk generation (Step 24-26) dan self-healing (Step 27-29).

**Acceptance criteria:**

- Server berhasil start proses `@playwright/mcp`, kirim satu perintah eksplorasi sederhana (misal "buka halaman X, screenshot"), dan terima hasilnya

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "9.1 Komponen tambahan" (Fase 3).

Buat src/generator/mcp-client.ts. Install @playwright/mcp sebagai dependency.
Implementasikan MCPClient class yang:
1. Spawn proses @playwright/mcp (via child_process atau library MCP client resmi
   kalau tersedia untuk Node/TypeScript — cek dokumentasi resmi Playwright MCP untuk
   cara integrasi programatik, bukan cuma CLI standalone)
2. Method connect(): inisialisasi koneksi stdio/SSE ke proses MCP
3. Method explore(instruction: string, targetUrl?: string): Promise<MCPExplorationResult>
   — kirim instruksi bahasa natural, terima balik accessibility snapshot dan/atau
   daftar aksi yang dilakukan MCP
4. Method disconnect(): tutup proses MCP dengan bersih

Tulis integration test kecil: connect ke MCP, suruh eksplorasi halaman statis
sederhana (bisa pakai halaman contoh publik), verifikasi hasil balik masuk akal
(bukan cuma tidak error, tapi memang ada data snapshot/aksi yang ter-capture).

Tangani error kalau proses MCP gagal start (misal Node/npx tidak bisa spawn child
process) dengan pesan jelas.
```

---



## STEP 24 — Prompt-based Test Generation

**Fase:** 3 | **Status:** Planning | **Dependency:** Step 23

**Tujuan:** User bisa ketik instruksi bahasa natural, sistem hasilkan draft test case terstruktur.

**Acceptance criteria:**

- POST /projects/:id/generate/prompt dengan instruksi valid menghasilkan test_case_draft tersimpan dengan steps/expected yang masuk akal terhadap instruksi

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "9.2 Tambahan skema DB", "9.3 API
tambahan", dan "9.4 Sequence — Prompt-based generation".

1. Tambahkan migration baru (004_test_case_draft.sql atau nomor urut berikutnya)
   untuk tabel test_case_draft persis sesuai DDL di dokumen bagian 9.2.
2. Buat repository src/db/repositories/test-case-draft.repository.ts (pola sama
   seperti repository lain dari Step 3).
3. Buat src/generator/prompt-generation.ts: fungsi generateFromPrompt(projectId,
   prompt: string) yang:
   a. Ambil project.base_url
   b. Panggil mcp-client.ts (Step 23) explore(prompt, base_url) untuk eksplorasi
      elemen terkait
   c. Kirim hasil eksplorasi + prompt asli ke LLM lewat LLMClient dari provider adapter
      Fase 2 (Step 16, sesuai pola 4.2.1 arsitektur — PAKAI method complete() generik,
      BUKAN method analyze() yang khusus AnalysisResult), minta output steps+expected
      sesuai format kontrak di bagian 4.1, lalu parse response JSON sendiri di
      prompt-generation.ts (bukan lewat provider.interface.ts Fase 2 yang formatnya
      untuk AnalysisResult)
   d. Insert test_case_draft (source='ai_prompt', source_input=prompt, status='pending')
4. Buat src/generator/generator.service.ts sebagai orkestrator yang dipanggil dari
   route, dan implementasikan penuh endpoint POST /projects/:id/generate/prompt di
   src/api/routes/generator.routes.ts.

Pastikan response API balikan draftId dan draft yang di-generate (bukan cuma id),
supaya user langsung bisa lihat hasilnya di UI tanpa request tambahan.
```

---



## STEP 25 — URL-based Exploration Generation

**Fase:** 3 | **Status:** Planning | **Dependency:** Step 24

**Tujuan:** User kasih satu URL, sistem eksplorasi otomatis dan hasilkan beberapa draft test case sekaligus.

**Acceptance criteria:**

- POST /projects/:id/generate/url berjalan sebagai job async (tidak memblokir), menghasilkan lebih dari satu draft untuk halaman dengan beberapa flow (misal login + form kontak)

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian 9.3 dan 9.4 (bagian akhir yang
menyebut URL-based exploration dijalankan sebagai job).

Tambahkan generationQueue baru di src/queue/queue.ts (pola sama seperti testRunQueue/
analysisQueue dari Step 7), concurrency rendah (misal 1) karena eksplorasi MCP cukup
berat.

Buat fungsi generateFromUrl(projectId, url) di generator.service.ts:
1. Panggil mcp-client.ts explore() dengan instruksi umum seperti "jelajahi halaman
   ini, identifikasi semua flow utama (form, navigasi, tombol aksi penting)"
2. Kirim hasil eksplorasi ke LLM, minta output berupa ARRAY beberapa draft test case
   (bukan satu), tiap draft punya title yang menjelaskan flow apa yang dicover
3. Insert multiple test_case_draft sekaligus (source='ai_url_exploration')

Implementasikan endpoint POST /projects/:id/generate/url yang push job ke
generationQueue dan langsung balikan { jobId, status: 'processing' } — bukan
menunggu hasil selesai (karena ini bisa makan waktu lama). Buat endpoint tambahan
GET /generate/jobs/:jobId untuk cek status job ini (selesai/masih proses), atau
manfaatkan WebSocket event baru (generation:done) kalau ingin realtime.
```

---



## STEP 26 — Draft Review UI

**Fase:** 3 | **Status:** Planning | **Dependency:** Step 25

**Tujuan:** User bisa lihat, edit, approve, atau reject draft hasil generate sebelum jadi test case resmi.

**Acceptance criteria:**

- Draft yang di-approve muncul sebagai test_case baru dan bisa langsung dijalankan lewat flow Fase 1
- Draft yang di-reject tidak muncul lagi di list aktif tapi tetap tersimpan untuk audit

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian 9.3 (endpoint approve/reject).

Implementasikan penuh endpoint GET /projects/:id/drafts, POST /drafts/:id/approve,
POST /drafts/:id/reject di generator.routes.ts.

Logic approve: copy generated_steps dan generated_expected dari draft ke row baru
di tabel test_case (title bisa diambil dari draft atau diminta input user saat
approve), update test_case_draft.status = 'approved'. Logic reject: cukup update
status = 'rejected', tidak ada perubahan di test_case.

Update dashboard (extend dari Step 13/20): tambahkan halaman/section baru
"Generate Test Case" dengan:
1. Form input prompt bahasa natural → tombol generate → tampilkan draft hasilnya
   (steps + expected dalam bentuk readable, bukan raw JSON) dengan tombol
   Approve/Reject/Edit
2. Form input URL → tombol generate → tampilkan list draft yang dihasilkan
   (karena bisa lebih dari satu)
3. Kalau user pilih Edit sebelum approve, izinkan ubah steps/expected di form
   sebelum submit approve (approve dengan data yang sudah diedit, bukan draft asli)
```

---



## STEP 27 — Selector Failure Detection

**Fase:** 4 | **Status:** Planning | **Dependency:** Step 26

**Tujuan:** Sistem bisa membedakan kegagalan step karena "elemen tidak ketemu" vs kegagalan assertion/logic biasa.

**Acceptance criteria:**

- Kegagalan Playwright TimeoutError pada pencarian elemen terdeteksi dan ditandai berbeda dari kegagalan assertion di test_step_result

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "10.3 Perubahan alur eksekusi".

Update src/runner/testcase-compiler.ts (Step 8): tangkap error dari tiap action,
klasifikasikan errorType berdasarkan pesan/tipe error Playwright:
- 'selector_not_found' — kalau error adalah TimeoutError dari waitForSelector/
  click/fill karena elemen tidak ditemukan dalam waktu timeout
- 'assertion_failed' — kalau kegagalan berasal dari expect()/assertion eksplisit
- 'other' — error lain (network fail, page crash, dst)

Tambahkan kolom error_type ke tabel test_step_result (buat migration baru), simpan
klasifikasi ini di setiap step yang gagal.

JANGAN implementasikan healing-nya dulu di step ini — cukup deteksi dan klasifikasi
errorType-nya, healing sungguhan ada di Step 28.
```

---



## STEP 28 — Self-Healing via MCP

**Fase:** 4 | **Status:** Planning | **Dependency:** Step 27

**Tujuan:** Saat terdeteksi `selector_not_found`, sistem coba cari elemen pengganti lewat MCP dan lanjutkan eksekusi.

**Acceptance criteria:**

- Test case dengan satu selector yang sengaja diubah/rusak, saat dijalankan, berhasil "sembuh" dan lanjut ke step berikutnya (bukan langsung fail) ketika elemen penggantinya memang ada di halaman
- Selector healing tercatat di tabel selector_healing_log

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "10.2 Tambahan skema DB" dan
"10.3 Perubahan alur eksekusi" (bagian utama).

Tambahkan migration untuk tabel selector_healing_log persis sesuai DDL di dokumen.
Buat repository src/db/repositories/selector-healing-log.repository.ts.

Buat src/healing/selector-healer.ts: fungsi attemptHeal(page, step, testCaseId,
testRunId): Promise<{ healed: boolean, newSelector?: string }> yang:
1. Panggil mcp-client.ts (Step 23) dengan instruksi seperti: "cari elemen yang
   secara makna sama dengan [deskripsi dari step, misal action+selector asli]
   di halaman ini sekarang"
2. Kalau MCP temukan kandidat elemen, ambil selector barunya, coba jalankan ulang
   step itu dengan selector baru
3. Kalau berhasil: insert selector_healing_log (status='healed', new_selector),
   balikan { healed: true, newSelector }
4. Kalau tidak ketemu/gagal: insert selector_healing_log (status='failed_to_heal'),
   balikan { healed: false }

Update src/runner/executor.ts (Step 9) dan testcase-compiler.ts (Step 27): saat
step gagal dengan errorType='selector_not_found', panggil attemptHeal SEBELUM
menandai step sebagai failed. Kalau healed=true, step dianggap passed (dengan
catatan di test_step_result bahwa ini hasil healing) dan lanjut ke step berikutnya.
Kalau healed=false, step tetap failed seperti biasa (behavior existing tidak berubah).

PENTING: pastikan attemptHeal HANYA dipanggil untuk errorType='selector_not_found',
TIDAK PERNAH untuk 'assertion_failed' — tambahkan komentar kode yang menjelaskan
kenapa (mencegah AI "menyembunyikan" bug sungguhan).
```

---



## STEP 29 — Healing Approval Flow

**Fase:** 4 | **Status:** Planning | **Dependency:** Step 28

**Tujuan:** Selector hasil healing tidak otomatis permanen — user harus approve dulu sebelum test_case aslinya berubah, dan run yang mengandung healing diberi status `anomaly` bukan `success` polos.

**Acceptance criteria:**

- Run yang mengandung minimal satu healing sukses, hasil akhirnya berstatus `anomaly` di analysis_result (bukan `success`), dengan detail menyebutkan selector mana yang berubah
- User approve healing → test_case.steps ter-update ke selector baru secara permanen

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "10.3" (bagian akhir soal
anomaly) dan "10.4 API tambahan".

Update src/analyzer/prompt-builder.ts (Step 17): saat build AnalyzerInput untuk
suatu test_run, cek dulu apakah ada selector_healing_log dengan status='healed'
untuk run itu. Kalau ada, tambahkan informasi ini ke input yang dikirim ke LLM
(field baru healingEvents di AnalyzerInput), dan tambahkan instruksi ke
STATUS_DEFINITIONS: kalau ada healing event, klasifikasikan run sebagai 'anomaly'
(bukan 'success'), detail menyebutkan old_selector → new_selector, solution-nya
"review dan approve/reject perubahan selector di halaman healing log".

Implementasikan endpoint GET /test-cases/:id/healing-log, POST /healing-log/:id/approve,
POST /healing-log/:id/reject di healing.routes.ts. Logic approve: update
test_case.steps — ganti selector lama dengan selector baru di step yang sesuai
(step_index dari healing log), update selector_healing_log.status='approved'.
Logic reject: cukup update status='rejected', test_case.steps tidak berubah
(artinya run berikutnya akan healing lagi dari selector lama yang sama).

Update dashboard: tambahkan halaman/panel "Healing Log" per test case, list semua
healing event dengan tombol approve/reject, tampilkan diff selector lama vs baru
dengan jelas.
```

---



## STEP 30 — Fixture Upload & Management

**Fase:** 5 | **Status:** Planning | **Dependency:** Step 29

**Tujuan:** User bisa upload file data uji (CSV/JSON/gambar/PDF) sekali per project, dan mengelolanya (list, hapus).

**Acceptance criteria:**

- File yang diupload tersimpan di ./storage/fixtures//, tercatat di tabel fixture
- File bisa dihapus dan otomatis hilang dari filesystem juga (bukan cuma row DB)

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "11.1", skema tabel fixture di
bagian 3, dan API di bagian "11.3".

Buat src/fixture/fixture.service.ts dengan fungsi:
- uploadFixture(projectId, file: { buffer, filename, mimetype }): simpan file ke
  ./storage/fixtures/<projectId>/ (reuse pola dari artifact-storage.ts Step 11,
  bisa extract jadi shared utility src/storage/file-storage.ts kalau perlu),
  insert row fixture (name, file_path, file_type)
- listFixtures(projectId)
- deleteFixture(fixtureId): hapus file dari filesystem DAN row dari DB

Implementasikan endpoint POST /projects/:id/fixtures (pakai @fastify/multipart
untuk handle file upload), GET /projects/:id/fixtures, DELETE /fixtures/:id di
fixture.routes.ts.

Tambahkan section "Fixtures" di dashboard project: list file yang sudah diupload
dengan tombol delete, form upload file baru.
```

---



## STEP 31 — Fixture Matching di Test Execution

**Fase:** 5 | **Status:** Planning | **Dependency:** Step 30

**Tujuan:** Test case bisa merujuk fixture (eksplisit atau otomatis via AI) dan nilainya disubstitusi saat eksekusi.

**Acceptance criteria:**

- Step dengan value `{{fixture:nama_fixture}}` berhasil diganti dengan data sesungguhnya dari file fixture sebelum step dijalankan Playwright

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "11.5 Sequence — Fixture matching".

Buat src/fixture/fixture-matcher.ts dengan fungsi resolveFixtureReferences(steps,
projectId): Promise<Step[]> yang:
1. Scan semua step, cari value yang match pattern {{fixture:nama}}
2. Untuk tiap match, ambil isi file fixture terkait dari fixture.service.ts (Step 30)
   — untuk CSV/JSON, parse dan ambil field yang relevan (misal
   {{fixture:user_credentials.username}} ambil field username dari JSON/baris CSV
   pertama); untuk file gambar/PDF, substitusi dengan path file-nya (dipakai untuk
   step upload file, bukan fill text)
3. Balikan steps baru dengan value sudah tersubstitusi, steps asli di DB TIDAK diubah
   (substitusi terjadi saat runtime saja, bukan permanen)

Integrasikan ke src/runner/executor.ts (Step 9): panggil resolveFixtureReferences
SEBELUM steps dikirim ke testcase-compiler.ts.

Untuk kasus otomatis (bukan eksplisit {{fixture:...}}) seperti disebut di dokumen
—AI pilih fixture relevan berdasarkan konteks— itu HANYA relevan saat generate
test case baru (Fase 3), bukan saat eksekusi. Jadi tambahkan logic pemilihan
fixture otomatis itu di generator.service.ts (Step 24), bukan di sini: saat LLM
menyusun draft test case, sertakan daftar fixture project yang tersedia sebagai
konteks, minta LLM pakai {{fixture:...}} eksplisit di draft yang dihasilkan kalau
relevan.
```

---



## STEP 32 — PRD Parser & Feature Map Generation

**Fase:** 5 | **Status:** Planning | **Dependency:** Step 31

**Tujuan:** User upload dokumen PRD, sistem breakdown otomatis jadi daftar fitur, dan cocokkan dengan test case yang sudah ada.

**Acceptance criteria:**

- Upload PDF PRD sederhana menghasilkan feature_map dengan minimal beberapa fitur terdeteksi, dan status covered yang masuk akal terhadap test case yang sudah ada di project itu

**Prompt untuk AI IDE:**

```
Baca docs/arsitektur-spesifikasi-teknis.md bagian "11.1", skema tabel feature_map
di bagian 3, dan "11.4 Sequence — Feature Map generation".

Buat src/feature-map/prd-parser.ts: fungsi extractText(filePath, mimetype) yang
ekstrak teks dari PDF (pakai library seperti pdf-parse) atau markdown (baca
langsung sebagai text).

Buat src/feature-map/feature-map.service.ts: fungsi generateFeatureMap(projectId,
prdFile) yang:
1. Simpan file PRD ke fixture storage atau folder terpisah ./storage/prd/<projectId>/
2. extractText() dari file itu
3. Kirim teks ke LLM lewat LLMClient dari provider adapter Fase 2 (Step 16, method
   complete() generik sesuai pola 4.2.1 — bukan method analyze()), minta breakdown
   terstruktur jadi array {name, description} per fitur/flow/edge-case yang
   teridentifikasi, parse response JSON sendiri di feature-map.service.ts
4. Ambil semua test_case existing di project itu (title + expected)
5. Untuk tiap fitur hasil breakdown, minta LLM (bisa panggilan terpisah atau sekali
   jalan dengan step 3) tentukan apakah ada test_case yang sudah mengcover fitur
   itu — set covered=true dan test_case_id kalau ada match, false kalau tidak
6. Insert feature_map (source_document=path PRD, features=hasil array lengkap)

Implementasikan endpoint POST /projects/:id/feature-map (multipart upload, jalankan
sebagai job async karena PDF besar + 2x pemanggilan LLM bisa lama) dan
GET /projects/:id/feature-map di feature-map.routes.ts.
```

---



## STEP 33 — Feature Map Coverage UI

**Fase:** 5 | **Status:** Planning | **Dependency:** Step 32

**Tujuan:** User bisa lihat visual jelas: fitur mana yang sudah ada test-nya, mana yang belum — dan langsung generate test case untuk yang belum tercover.

**Acceptance criteria:**

- Dashboard menampilkan daftar fitur dari feature map dengan indikator visual covered/belum, dan tombol untuk langsung generate test case (via Step 24) untuk fitur yang belum tercover

**Prompt untuk AI IDE:**

```
Update dashboard: tambahkan halaman "Feature Map" per project.

Tampilan:
1. Form upload PRD → trigger POST /projects/:id/feature-map, tampilkan progress
   (job async, bisa polling atau WebSocket event feature_map:done)
2. List semua fitur dari feature map terbaru, tiap baris ada badge "Covered" (hijau,
   dengan link ke test_case terkait) atau "Not Covered" (merah)
3. Di baris "Not Covered", tombol "Generate Test Case" yang prefill form generate
   dari Step 26 dengan prompt otomatis berdasarkan name+description fitur itu —
   user tinggal review/submit, bukan mulai dari kosong
4. Ringkasan angka di atas: "X dari Y fitur sudah tercover (Z%)"

Ini menutup siklus penuh: PRD → feature map → identifikasi gap → generate test
case untuk gap itu → approve → jalankan → dapat hasil klasifikasi.
```

---



## Catatan Penggunaan Dokumen Ini

- Step 0–14 = **Fase 1 (fondasi eksekusi & rekam, termasuk live view)** — di akhir Step 14, aplikasi sudah bisa dipakai standalone sebagai test runner + recorder tanpa AI.
- Step 15–22 = **Fase 2 (AI Analyzer, MVP inti)** — di akhir Step 22, aplikasi sudah setara MVP TestSprite dari sisi value inti.
- Step 23–26 = **Fase 3 (Test Generation dari AI)** — MCP client, prompt-based & URL-based generation, draft review.
- Step 27–29 = **Fase 4 (Self-Healing Selector)** — deteksi kegagalan selector, healing via MCP, approval flow.
- Step 30–33 = **Fase 5 (Fixture Management & Feature Map)** — upload & matching fixture, PRD parser, feature map coverage UI.
- Update kolom Status di tabel "Ringkasan Progress" setiap kali menyelesaikan satu step, supaya progress selalu terlihat jelas di satu tempat.

