# Pointesting — AI Testing Tool

Alat **automate testing web apps** yang dibantu **AI**: menjalankan test case lewat browser (Playwright), merekam hasil, lalu (nanti) menganalisis kegagalan dengan multi-provider LLM.

> **Status: masih dalam pengembangan (WIP).**  
> Saat ini fokus **Fase 1 — fondasi eksekusi & rekam**. Belum production-ready. UI dashboard, live view WebSocket, dan AI Analyzer belum selesai.

Repo: [andyresta/pointesting](https://github.com/andyresta/pointesting)

---

## Yang sudah ada (ringkas)

- API REST (Fastify) + autentikasi personal (JWT)
- PostgreSQL: project, test case, test run, step result, artifact (schema)
- Validasi test case (Zod) + CRUD
- In-memory job queue (`p-queue`)
- Eksekusi Playwright: steps → browser, video & trace sementara, update status run
- Katalog model AI dinamis (`POST /ai/models`) untuk Claude / OpenAI / DeepSeek / Kimi / OpenCode Zen

## Yang masih dikerjakan / belum ada

- Collect artifact ke `./storage/artifacts/` + download endpoint
- Screencast live view + WebSocket
- Dashboard UI
- AI Analyzer (klasifikasi hasil + saran perbaikan)
- Test generation, self-healing selector, fixture & feature map (fase berikutnya)

Progress detail: [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)

---

## Stack

| Bagian | Teknologi |
|---|---|
| Runtime | Node.js + TypeScript (strict) |
| API | Fastify |
| DB | PostgreSQL (`pg`) |
| Browser automation | Playwright (Chromium) |
| Queue | In-memory `p-queue` |
| Validasi | Zod |
| Auth | JWT + bcrypt (single-user dari env) |

---

## Setup cepat

### Prasyarat

- Node.js (disarankan LTS)
- PostgreSQL
- Chromium untuk Playwright: `npx playwright install chromium`

### Instalasi

```bash
git clone https://github.com/andyresta/pointesting.git
cd pointesting
npm install

cp .env.example .env
# Edit .env: DB_*, AUTH_SECRET, AUTH_USERNAME, AUTH_PASSWORD_HASH
# Generate hash password:
npm run hash-password -- "password-anda"
# Salin output ke AUTH_PASSWORD_HASH di .env

npm run migrate
npm run dev
```

Server default: `http://localhost:3000`  
Health check: `GET /health` → `{ "status": "ok" }`

### Script utama

| Script | Fungsi |
|---|---|
| `npm run dev` | Jalankan API (tsx watch) |
| `npm run build` | Compile TypeScript |
| `npm start` | Jalankan hasil build |
| `npm run migrate` | Jalankan migrasi DB |
| `npm run hash-password -- "..."` | Generate bcrypt hash |
| `npm test` | Unit test Playwright (compiler) |

---

## Dokumentasi

| File | Isi |
|---|---|
| [`docs/roadmap-ai-testing-tool.md`](docs/roadmap-ai-testing-tool.md) | Roadmap fase |
| [`docs/arsitektur-spesifikasi-teknis.md`](docs/arsitektur-spesifikasi-teknis.md) | Spesifikasi teknis |
| [`docs/execution-plan-ai-testing-tool.md`](docs/execution-plan-ai-testing-tool.md) | Urutan step implementasi |
| [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) | Status step (living) |
| [`docs/memory.md`](docs/memory.md) | Konteks keputusan lintas sesi |
| [`docs/instruction.md`](docs/instruction.md) | Aturan kerja untuk AI IDE |

---

## Catatan keamanan

- Jangan commit file `.env` (sudah di-ignore).
- API key provider AI hanya di environment server, tidak dikirim ke browser.
- Kredensial contoh di dokumentasi lokal hanya untuk development — ganti sebelum dipakai nyata.

---

## Lisensi

ISC (lihat `package.json`).
