# Arsitektur & Spesifikasi Teknis — AI Testing Tool

Dokumen ini adalah spesifikasi teknis lengkap berdasarkan roadmap yang sudah disepakati (`roadmap-ai-testing-tool.md`), fokus pada Fase 1 & 2 (MVP), dengan struktur yang sudah mengantisipasi Fase 3–5 agar tidak perlu migrasi besar nanti.

---

## 1. Gambaran Arsitektur Sistem

### 1.1 High-level architecture

```
                              ┌─────────────────────┐
                              │      Browser         │
                              │   (Dashboard User)   │
                              └──────────┬───────────┘
                                         │ HTTP + WebSocket
                                         ▼
                        ┌────────────────────────────────┐
                        │        API Server (Fastify)      │
                        │  - REST endpoints                │
                        │  - WebSocket gateway              │
                        │  - Auth (session/API key)         │
                        └───────┬───────────────┬──────────┘
                                │                │
                    enqueue job │                │ query/command
                                ▼                ▼
                  ┌──────────────────────┐   ┌──────────────────┐
                  │   In-memory Queue     │   │   PostgreSQL      │
                  │  (test run & analysis │   │  (semua data      │
                  │   jobs, single proc)  │   │   terstruktur)     │
                  └──────────┬────────────┘   └──────────────────┘
                             │ dequeue
                             ▼
                  ┌───────────────────────┐
                  │     Test Runner Worker  │
                  │  (Playwright Test)       │
                  │  - eksekusi test case     │
                  │  - screencast (live view)  │
                  │  - video/trace/console/network │
                  └───────┬──────────┬───────┘
                          │          │
             artifact file│          │ frame live (WS)
                          ▼          ▼
                ┌──────────────┐  ┌────────────────┐
                │  Filesystem   │  │  WebSocket       │
                │  ./storage/   │  │  broadcast ke     │
                │  artifacts/   │  │  dashboard client │
                └──────────────┘  └────────────────┘
                          │
                 setelah test selesai
                          ▼
                ┌────────────────────────┐
                │   AI Analyzer Worker      │
                │  - trace/log parser        │
                │  - prompt builder           │
                │  - provider adapter (multi) │
                └───────┬────────────────┘
                        │ HTTP
                        ▼
        ┌───────────────────────────────────────┐
        │   LLM Provider (pilih salah satu)        │
        │   Claude / OpenAI / DeepSeek / Kimi /     │
        │   opencode                                 │
        └───────────────────────────────────────┘
```

### 1.2 Prinsip desain

- **Single Node process untuk MVP** — API server, queue, dan worker berjalan di satu proses (atau proses terpisah tapi satu mesin) untuk menyederhanakan deployment awal. Antarmuka internal (queue, storage) didesain sebagai modul yang bisa diekstrak ke proses/servis terpisah nanti tanpa mengubah kontrak data.
- **Artifact-first, bukan video-first** — data terstruktur (trace, console, network) adalah sumber utama untuk AI Analyzer; video adalah bukti visual untuk manusia. Ini menekan biaya token dan meningkatkan akurasi klasifikasi.
- **Provider-agnostic AI layer** — semua pemanggilan LLM lewat satu interface (`AnalyzerProvider`), bukan hardcoded ke satu vendor. Menambah provider baru = menambah satu adapter, tanpa mengubah kode di atasnya.
- **Semua status punya bukti** — setiap `analysis_result` selalu terhubung ke artifact yang mendasarinya (video/trace/log path), tidak pernah berdiri sendiri sebagai teks.

---

## 2. Struktur Proyek

```
ai-testing-tool/
├── src/
│   ├── api/                    # Fastify routes & controllers
│   │   ├── routes/
│   │   │   ├── testcase.routes.ts
│   │   │   ├── testrun.routes.ts
│   │   │   ├── project.routes.ts
│   │   │   └── auth.routes.ts
│   │   └── server.ts
│   ├── ws/                     # WebSocket gateway
│   │   ├── gateway.ts
│   │   └── events.ts           # definisi event contract
│   ├── queue/                  # in-memory job queue
│   │   ├── queue.ts
│   │   └── types.ts
│   ├── runner/                 # Playwright execution
│   │   ├── executor.ts         # jalankan test case → Playwright
│   │   ├── reporter.ts         # custom reporter (onTestEnd)
│   │   ├── screencast.ts       # live view handler
│   │   └── testcase-compiler.ts # test case terstruktur → Playwright steps
│   ├── analyzer/                # AI Analyzer
│   │   ├── providers/
│   │   │   ├── claude.provider.ts
│   │   │   ├── openai.provider.ts
│   │   │   ├── deepseek.provider.ts
│   │   │   ├── kimi.provider.ts
│   │   │   └── opencode.provider.ts
│   │   ├── provider.interface.ts
│   │   ├── prompt-builder.ts
│   │   ├── trace-parser.ts
│   │   └── analyzer.service.ts
│   ├── storage/                 # filesystem artifact management
│   │   └── artifact-storage.ts
│   ├── db/
│   │   ├── schema.sql
│   │   ├── migrations/
│   │   └── repositories/        # query layer per entity
│   └── config/
│       └── env.ts
├── storage/
│   ├── artifacts/<run_id>/
│   └── fixtures/<project_id>/   # (Fase 5)
├── package.json
└── playwright.config.ts
```

---

## 3. Skema Database (PostgreSQL)

### 3.1 Entity Relationship (ringkas)

```
project (1) ──< test_case (1) ──< test_run (1) ──< test_step_result
                                        │
                                        ├──< artifact
                                        └──< analysis_result

project (1) ──< fixture              (Fase 5)
project (1) ──< feature_map          (Fase 5)
```

### 3.2 DDL

```sql
-- Project: unit tertinggi, aplikasi yang mau ditest
CREATE TABLE project (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  base_url      TEXT,
  default_provider TEXT DEFAULT 'claude', -- default AI provider utk project ini
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Test case: definisi steps + expected result
CREATE TABLE test_case (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  steps         JSONB NOT NULL,      -- array of {action, selector, value, ...}
  expected      JSONB NOT NULL,      -- array of string expected result
  source        TEXT DEFAULT 'manual', -- manual | ai_prompt | ai_url_exploration (Fase 3)
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Test run: satu eksekusi test case
CREATE TABLE test_run (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id  UUID NOT NULL REFERENCES test_case(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'queued',
                -- queued | running | passed | failed | error
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Artifact: file yang dihasilkan per run (video, trace, screenshot)
CREATE TABLE artifact (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id   UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,       -- video | trace | screenshot | console_log | network_log
  file_path     TEXT NOT NULL,       -- path relatif di ./storage/artifacts/<run_id>/
  size_bytes    BIGINT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Analysis result: hasil klasifikasi AI per test run
CREATE TABLE analysis_result (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id   UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,       -- success | fail | bug | anomaly
  reason        TEXT,                -- wajib diisi untuk status = success
  detail        TEXT,                -- root cause, untuk fail/bug/anomaly
  solution      TEXT,                -- saran perbaikan, untuk fail/bug/anomaly
  provider      TEXT NOT NULL,       -- provider LLM yang dipakai saat analisis ini
  raw_response  JSONB,               -- simpan response mentah utk audit/debug
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Step result: detail per-step di dalam satu run (opsional tapi berguna utk debugging)
CREATE TABLE test_step_result (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id   UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
  step_index    INTEGER NOT NULL,
  action        TEXT NOT NULL,
  status        TEXT NOT NULL,       -- passed | failed
  error_message TEXT,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Fixture (Fase 5)
CREATE TABLE fixture (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_type     TEXT NOT NULL,       -- csv | json | image | pdf
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Feature map (Fase 5)
CREATE TABLE feature_map (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  source_document TEXT,              -- path file PRD yang diupload
  features      JSONB NOT NULL,      -- array of {name, description, covered: bool, test_case_id?}
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

**Catatan desain:** `steps` dan `expected` disimpan sebagai `JSONB`, bukan tabel relasional terpisah — karena strukturnya fleksibel dan tidak butuh query relasional kompleks per-step di level SQL (query per-step yang butuh index cukup ditangani `test_step_result`). Ini mengurangi jumlah join untuk kasus penggunaan paling umum: ambil satu test case lengkap dengan sekali query.

---

## 4. Kontrak Data Internal

### 4.1 Test Case (format tersimpan di `test_case.steps` / `.expected`)

```json
{
  "steps": [
    { "action": "goto", "url": "/login" },
    { "action": "fill", "selector": "#username", "value": "user1" },
    { "action": "fill", "selector": "#password", "value": "secret" },
    { "action": "click", "selector": "#btn-login" }
  ],
  "expected": [
    "Redirect ke /dashboard",
    "Tidak ada error di console",
    "Response /api/login status 200"
  ]
}
```

**Action type yang didukung (enum resmi):**

| Action | Field wajib | Map ke Playwright |
|---|---|---|
| `goto` | `url` | `page.goto(url)` |
| `fill` | `selector`, `value` | `page.fill(selector, value)` |
| `click` | `selector` | `page.click(selector)` |
| `check` | `selector` | `page.check(selector)` |
| `select` | `selector`, `value` | `page.selectOption(selector, value)` |
| `waitFor` | `selector` | `page.waitForSelector(selector)` |

Daftar ini adalah kontrak resmi — kalau ada action baru yang dibutuhkan nanti, tambahkan di tabel ini dulu sebelum diimplementasikan, supaya validasi schema (API) dan compiler (executor) tidak drift satu sama lain.

### 4.2 Provider Interface (AI Analyzer)

```typescript
// analyzer/provider.interface.ts
export interface HistoricalContext {
  avgDurationMs: number;
  avgResponseTimeMs: number;
  currentDurationMs: number;
  currentResponseTimeMs: number;
  sampleSize: number;         // 0 kalau belum ada histori (run pertama)
}

export interface HealingEvent {
  stepIndex: number;
  oldSelector: string;
  newSelector: string;
}

export interface AnalyzerInput {
  expected: string[];
  consoleLogSummary: string;      // sudah difilter, hanya error/warning
  networkLogSummary: string;      // status code aneh, response time
  screenshots?: Buffer[];          // opsional, tergantung dukungan provider
  traceSummary: TraceSummary;      // hasil parse trace.zip
  historicalContext?: HistoricalContext;  // diisi mulai Fase 2 (anomaly detection berbasis histori)
  healingEvents?: HealingEvent[];         // diisi mulai Fase 4 (self-healing), kosong/absen sebelum itu
}

export interface AnalysisResult {
  status: 'success' | 'fail' | 'bug' | 'anomaly';
  reason?: string;    // wajib untuk status success
  detail?: string;    // wajib untuk fail/bug/anomaly
  solution?: string;  // wajib untuk fail/bug/anomaly
}

export interface AnalyzerProvider {
  name: string;                 // 'claude' | 'openai' | 'deepseek' | 'kimi' | 'opencode'
  supportsImage: boolean;       // dipakai prompt-builder utk skip screenshot bila false
  analyze(input: AnalyzerInput): Promise<AnalysisResult>;
}
```

**Catatan:** `historicalContext` dan `healingEvents` ada di interface sejak awal (bukan ditambah belakangan secara ad-hoc) supaya kontrak ini tetap jadi satu-satunya sumber kebenaran — walau secara implementasi field ini baru benar-benar diisi saat Fase 2 dan Fase 4 dikerjakan (lihat bagian 10.3 untuk detail `healingEvents`). Provider adapter wajib menangani kasus field ini `undefined` (belum ada fase itu) dengan aman.

Setiap adapter (`claude.provider.ts`, `openai.provider.ts`, dst.) mengimplementasikan interface ini, menangani format request/response spesifik API masing-masing, lalu menormalkan output ke `AnalysisResult` yang sama. `analyzer.service.ts` memilih provider berdasarkan `project.default_provider` (atau override per-request), dan menerapkan fallback ke provider berikutnya kalau terjadi error/rate-limit.

### 4.2.1 Lapisan Provider Generik (dipakai bersama Fase 2, 3, 5)

Fase 2 (Analyzer), Fase 3 (Test Generation), dan Fase 5 (Feature Map) semua memanggil kelima provider LLM yang sama (Claude, OpenAI, DeepSeek, Kimi, opencode) — tapi masing-masing butuh **bentuk output berbeda** (`AnalysisResult` vs test case draft vs daftar fitur). Supaya integrasi ke 5 vendor itu tidak ditulis ulang tiga kali, provider layer dipecah dua tingkat:

```
src/analyzer/providers/claude.provider.ts, openai.provider.ts, dst.
  └── mengimplementasikan DUA hal:
      1. LLMClient (generik) — satu method rendah: 
         complete(systemPrompt: string, userContent: (string | ImageInput)[]): Promise<string>
         → menangani auth, format request/response, dan quirk API spesifik vendor itu SEKALI SAJA
      2. AnalyzerProvider (spesifik Fase 2) — memakai LLMClient internal, lalu parse
         response jadi AnalysisResult sesuai STATUS_DEFINITIONS
```

Fase 3 (`generator.service.ts`) dan Fase 5 (`feature-map.service.ts`) memakai **`LLMClient` yang sama** (bukan `AnalyzerProvider`), lalu masing-masing punya parser/formatter sendiri untuk mengubah response mentah jadi bentuk yang mereka butuhkan (test case draft / daftar fitur). Dengan begitu: menambah provider baru = satu adapter baru yang mengimplementasikan `LLMClient` sekali, otomatis bisa dipakai di Fase 2, 3, dan 5 tanpa duplikasi kode auth/request per vendor.

### 4.3 WebSocket Event Contract

**Fase 1–2 (fondasi):**

| Event (server → client) | Payload | Kapan dikirim |
|---|---|---|
| `run:status` | `{ runId, status }` | Setiap kali status test_run berubah (queued → running → passed/failed) |
| `run:frame` | `{ runId, frame: base64, timestamp, action? }` | Setiap frame screencast selama test berjalan |
| `run:step` | `{ runId, stepIndex, action, status }` | Setiap step selesai dieksekusi |
| `run:analysis` | `{ runId, analysisResult }` | AI Analyzer selesai memproses run tersebut |

| Event (client → server) | Payload | Fungsi |
|---|---|---|
| `subscribe:run` | `{ runId }` | Client mulai "menonton" test_run tertentu (live view + status) |
| `unsubscribe:run` | `{ runId }` | Client berhenti menonton |

**Fase 3–5 (tambahan):**

| Event (server → client) | Payload | Kapan dikirim | Fase |
|---|---|---|---|
| `generation:done` | `{ jobId, projectId, draftIds: string[] }` | Job generate test case (prompt/URL-based) selesai | 3 |
| `healing:detected` | `{ runId, testCaseId, stepIndex, oldSelector, newSelector }` | Selector berhasil di-heal saat run berjalan | 4 |
| `feature_map:done` | `{ jobId, projectId, featureMapId }` | Job generate feature map dari PRD selesai | 5 |

Pola subscribe sama seperti run — client kirim `subscribe:project { projectId }` untuk terima event level-project ini (generation/feature_map), tidak perlu tahu runId/jobId spesifik dulu.

**Autentikasi WebSocket:** karena live view berpotensi menampilkan sesi browsing aplikasi yang ditest, koneksi WS **wajib divalidasi** dengan token yang sama seperti REST API (bagian 7) — kirim JWT sebagai query param saat koneksi (`ws://host/ws?token=...`) atau sebagai pesan pertama sebelum `subscribe:run` diterima. Koneksi tanpa token valid ditolak (close connection), bukan dibiarkan terhubung tanpa scope.

Desain ini pub/sub sederhana per `runId`/`projectId` — server hanya broadcast ke client yang sudah subscribe, bukan broadcast global (menghindari bandwidth terbuang untuk client yang sedang melihat run/project lain).

---

## 5. Spesifikasi API (REST)

| Method | Endpoint | Fungsi |
|---|---|---|
| `POST` | `/projects` | Buat project baru |
| `GET` | `/projects/:id` | Detail project |
| `POST` | `/projects/:id/test-cases` | Buat test case baru (manual) |
| `GET` | `/projects/:id/test-cases` | List test case dalam project |
| `PATCH` | `/test-cases/:id` | Edit test case |
| `POST` | `/test-cases/:id/run` | Trigger eksekusi (masuk ke in-memory queue), balikan `runId` |
| `GET` | `/test-runs/:id` | Detail run: status, artifact list, analysis result |
| `GET` | `/test-runs/:id/artifacts/:artifactId` | Download/stream file artifact (video/trace) |
| `GET` | `/test-cases/:id/runs` | Riwayat run untuk satu test case (dipakai anomaly detection & UI histori) |
| `POST` | `/ai/models` | Katalog model dinamis untuk UI; body opsional `{ provider, forceRefresh }`, API key tetap server-side |
| `POST` | `/auth/login` | Autentikasi personal (session/API key) |

Autentikasi: semua endpoint di atas (kecuali `/auth/login`) memerlukan session/API key yang valid — karena skema personal/single-user, cukup satu credential yang divalidasi di middleware Fastify, tanpa tabel `user` bercabang role.

---

## 6. Alur Kerja Detail (Sequence)

### 6.1 Eksekusi Test Case + Live View

```
User klik "Run Test"
   → POST /test-cases/:id/run
   → API: insert test_run (status=queued), push job ke in-memory queue
   → API balikan runId ke client
   → Client buka WebSocket, kirim subscribe:run {runId}

Queue worker ambil job
   → update test_run.status = running, broadcast run:status
   → executor.ts compile test_case.steps → Playwright actions
   → page.screencast.start() → tiap frame → broadcast run:frame via WS
   → tiap step selesai → insert test_step_result, broadcast run:step
   → test selesai → screencast stop, video/trace/log disimpan ke ./storage/artifacts/<runId>/
   → insert artifact rows (video, trace, console_log, network_log)
   → update test_run.status = passed/failed, finished_at, duration_ms
   → broadcast run:status

   → push job baru ke queue: "analyze runId"
```

### 6.2 AI Analysis

```
Queue worker ambil job "analyze runId"
   → trace-parser.ts baca trace.zip → TraceSummary terstruktur
   → prompt-builder.ts susun AnalyzerInput (expected + log summary + trace summary + screenshot jika didukung)
   → analyzer.service.ts pilih provider (project.default_provider)
   → provider.analyze(input) → AnalysisResult
   → jika error/rate-limit → fallback ke provider berikutnya (jika dikonfigurasi)
   → insert analysis_result
   → broadcast run:analysis via WS
```

---

## 7. Non-Functional & Operasional

| Aspek | Keputusan |
|---|---|
| Konkurensi eksekusi | In-memory queue MVP jalan sekuensial atau dengan concurrency terbatas (`p-queue` dengan `concurrency: 2–3`) — sesuai kapasitas CPU/RAM mesin, karena tiap Playwright instance browser cukup berat |
| Persistensi job | Job hilang jika proses restart (trade-off yang sudah disepakati untuk kesederhanaan MVP) — `test_run` yang `status=running` saat startup sebaiknya di-mark `error` otomatis saat server boot, supaya tidak "menggantung" selamanya di UI |
| Retensi artifact | Video/trace untuk status `success` disarankan auto-cleanup setelah N hari; `fail`/`bug`/`anomaly` disimpan permanen sampai dihapus manual |
| Rate limit provider AI | Adapter tiap provider perlu retry-with-backoff dasar; fallback antar provider di level `analyzer.service.ts`, bukan di tiap adapter |
| Katalog model AI | UI mengambil model melalui `POST /ai/models`; backend membaca endpoint model resmi provider dan cache 5 menit. `*_MODELS` di env hanya fallback saat provider gagal/tidak dikonfigurasi, bukan daftar utama yang hardcoded |
| Keamanan kredensial provider | API key tiap provider (Claude, OpenAI, DeepSeek, Kimi, opencode) disimpan sebagai environment variable, tidak pernah di DB dalam bentuk plain text |
| Autentikasi | Karena personal-only, cukup satu credential (password/API key) tervalidasi lewat session cookie atau bearer token — tidak perlu tabel `user`, `role`, `permission` di MVP. Berlaku untuk REST maupun WebSocket (lihat bagian 4.3) — jangan hanya kunci REST dan biarkan WS terbuka |
| Ukuran file screenshot/video | Live view screencast pakai kualitas rendah (hemat bandwidth WebSocket); video final tetap kualitas penuh untuk arsip — dua konfigurasi terpisah |

---

## 8. Pemetaan ke Roadmap

| Bagian spesifikasi ini | Fase roadmap |
|---|---|
| Struktur proyek, DB core (project, test_case, test_run, artifact, test_step_result), executor, reporter, screencast, WebSocket gateway | Fase 1 |
| analysis_result, provider interface + adapters, prompt-builder, trace-parser, anomaly detection berbasis histori | Fase 2 |
| `test_case.source` (`ai_prompt`/`ai_url_exploration`) sudah diantisipasi di skema | Fase 3 |
| Kolom audit trail selector di `test_step_result` bisa diperluas untuk healing log | Fase 4 |
| Tabel `fixture`, `feature_map` sudah didesain dari awal | Fase 5 |

Skema database di atas sudah dirancang mengakomodasi seluruh fase — Fase 3–5 hanya menambah tabel/kolom baru, tidak mengubah struktur inti Fase 1–2.

---

## 9. Spesifikasi Fase 3 — Test Generation dari AI

### 9.1 Komponen tambahan

```
src/
├── generator/
│   ├── mcp-client.ts          # koneksi & kontrol ke Playwright MCP
│   ├── prompt-generation.ts   # bahasa natural / hasil eksplorasi → test case terstruktur
│   └── generator.service.ts   # orkestrasi: MCP explore → LLM susun ulang → simpan draft
```

`@playwright/mcp` dijalankan sebagai proses terpisah (biasanya via `npx @playwright/mcp`), API server berkomunikasi dengannya sebagai MCP client melalui stdio/SSE — bukan library yang di-import langsung seperti `@playwright/test`.

### 9.2 Tambahan skema DB

Tidak ada tabel baru — `test_case.source` (sudah ada di skema Fase 1) dipakai untuk menandai asal test case: `manual` | `ai_prompt` | `ai_url_exploration`. Tambahkan satu tabel untuk menyimpan draft sebelum disetujui user:

```sql
CREATE TABLE test_case_draft (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,       -- ai_prompt | ai_url_exploration
  source_input  TEXT NOT NULL,       -- prompt asli user, atau URL yang dieksplorasi
  generated_steps    JSONB,
  generated_expected JSONB,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at    TIMESTAMPTZ DEFAULT now()
);
```
Draft yang di-approve akan di-copy jadi row baru di `test_case` (bukan langsung insert ke `test_case`) — supaya ada jejak audit "ini hasil AI, sudah direview user sebelum dipakai".

### 9.3 API tambahan

| Method | Endpoint | Fungsi |
|---|---|---|
| `POST` | `/projects/:id/generate/prompt` | Body `{ prompt: string }` — generate draft dari bahasa natural via MCP |
| `POST` | `/projects/:id/generate/url` | Body `{ url: string }` — generate beberapa draft dari eksplorasi URL (job async, karena lebih lama) |
| `GET` | `/projects/:id/drafts` | List draft yang menunggu approval |
| `POST` | `/drafts/:id/approve` | Approve draft → copy jadi `test_case` resmi |
| `POST` | `/drafts/:id/reject` | Reject draft, tandai status rejected |

### 9.4 Sequence — Prompt-based generation

```
User isi form "Test login flow dengan kredensial valid"
   → POST /projects/:id/generate/prompt
   → generator.service.ts:
       1. mcp-client.ts perintahkan MCP agent membuka base_url project, eksplorasi
          form/elemen terkait prompt
       2. MCP balikan langkah interaksi + accessibility snapshot elemen yang disentuh
       3. prompt-generation.ts kirim hasil itu ke LLM (provider sama seperti Fase 2)
          untuk disusun ulang jadi format steps/expected standar (sesuai kontrak 4.1)
       4. insert test_case_draft (status=pending)
   → balikan draftId ke user
   → user review di dashboard → approve/reject
```

URL-based exploration mengikuti pola sama tapi dijalankan sebagai job di queue (bukan sinkron), karena MCP perlu menjelajahi banyak halaman.

---

## 10. Spesifikasi Fase 4 — Self-Healing Selector

### 10.1 Komponen tambahan

```
src/
├── healing/
│   ├── selector-healer.ts     # deteksi kegagalan selector + panggil MCP untuk cari pengganti
│   └── healing.service.ts     # orkestrasi: deteksi → heal → simpan sebagai anomaly, minta approval
```

### 10.2 Tambahan skema DB

```sql
CREATE TABLE selector_healing_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id    UUID NOT NULL REFERENCES test_case(id) ON DELETE CASCADE,
  test_run_id     UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
  step_index      INTEGER NOT NULL,
  old_selector    TEXT NOT NULL,
  new_selector    TEXT,               -- null kalau healing gagal menemukan pengganti
  status          TEXT NOT NULL,      -- healed | failed_to_heal | approved | rejected
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 10.3 Perubahan alur eksekusi (executor.ts)

Modifikasi `testcase-compiler.ts` (Fase 1): saat sebuah step gagal dengan error tipe "selector not found" (dibedakan dari kegagalan assertion biasa — cek pesan error Playwright, biasanya `TimeoutError` pada `waitForSelector`/`click` karena elemen tidak ketemu):

```
Step gagal karena selector not found
   → healing.service.ts dipanggil, bukan langsung mark step failed
   → selector-healer.ts panggil MCP: "cari elemen dengan maksud yang sama secara
     semantik dengan [deskripsi elemen dari test case, misal 'tombol submit login']
     di halaman ini"
   → jika ketemu: jalankan ulang step itu dengan selector baru, insert
     selector_healing_log (status=healed), lanjutkan eksekusi step berikutnya
   → jika tidak ketemu: step tetap failed seperti biasa, insert
     selector_healing_log (status=failed_to_heal)
   → SETELAH run selesai dan status=healed ada, analysis_result untuk run ini
     diarahkan menjadi status 'anomaly' (bukan 'success' polos), dengan detail
     yang menyebutkan selector mana yang berubah, dan solution "review & update
     test case ke selector baru"
```

### 10.4 API tambahan

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/test-cases/:id/healing-log` | Riwayat healing untuk satu test case |
| `POST` | `/healing-log/:id/approve` | User setujui selector baru → update `test_case.steps` otomatis |
| `POST` | `/healing-log/:id/reject` | User tolak, selector lama tetap dipakai (test akan tetap fail run berikutnya sampai diperbaiki manual) |

**Batasan yang wajib dijaga:** healing hanya dicoba untuk kegagalan selector, TIDAK PERNAH untuk kegagalan assertion/expected result — kalau dicampur, sistem berisiko "menyembunyikan" bug sungguhan dengan berpura-pura mencari elemen pengganti.

---

## 11. Spesifikasi Fase 5 — Fixture Management & Feature Map

### 11.1 Komponen tambahan

```
src/
├── fixture/
│   ├── fixture.service.ts     # upload, simpan, dan pemilihan fixture relevan
│   └── fixture-matcher.ts     # cocokkan fixture dengan konteks test case (via LLM)
├── feature-map/
│   ├── prd-parser.ts          # ekstrak teks dari PDF/markdown PRD
│   └── feature-map.service.ts # LLM breakdown PRD → daftar fitur + cek coverage
```

### 11.2 Skema DB
Sudah didefinisikan di bagian 3 (`fixture`, `feature_map`) — tidak ada perubahan, cukup diimplementasikan.

### 11.3 API tambahan

| Method | Endpoint | Fungsi |
|---|---|---|
| `POST` | `/projects/:id/fixtures` | Upload file fixture (multipart) |
| `GET` | `/projects/:id/fixtures` | List fixture dalam project |
| `DELETE` | `/fixtures/:id` | Hapus fixture |
| `POST` | `/projects/:id/feature-map` | Upload dokumen PRD (multipart), trigger generate feature map (job async) |
| `GET` | `/projects/:id/feature-map` | Ambil feature map project, termasuk status coverage tiap fitur |

### 11.4 Sequence — Feature Map generation

```
User upload PRD.pdf
   → POST /projects/:id/feature-map
   → prd-parser.ts ekstrak teks dari PDF (pakai library seperti pdf-parse)
   → feature-map.service.ts kirim teks ke LLM, minta breakdown terstruktur:
     daftar {name, description} per fitur/flow/edge-case
   → untuk tiap fitur hasil breakdown, cocokkan dengan test_case yang sudah ada
     (via kemiripan judul/deskripsi, bisa pakai LLM juga untuk matching semantik)
   → insert feature_map dengan features JSONB berisi array
     {name, description, covered: bool, test_case_id?}
```

### 11.5 Sequence — Fixture matching saat generate/run test

```
Saat test case (baru atau existing) butuh data (misal step fill dengan value
placeholder seperti "{{fixture:user_credentials}}")
   → fixture-matcher.ts baca daftar fixture project
   → kalau step eksplisit menyebut nama fixture → langsung pakai
   → kalau tidak eksplisit (misal saat generate dari AI di Fase 3) → LLM pilih
     fixture yang paling relevan berdasarkan konteks step & deskripsi fixture
   → nilai fixture disubstitusi ke steps sebelum dieksekusi executor (Fase 1)
```

**Catatan keamanan:** fixture yang berisi data sensitif (kredensial, nomor rekening dummy) tetap harus data uji/dummy — bukan data produksi sungguhan, karena disimpan sebagai file biasa di filesystem tanpa enkripsi khusus di MVP ini.

