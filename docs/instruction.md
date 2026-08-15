# Instruction — AI Testing Tool

Dokumen ini adalah **aturan kerja tetap** untuk semua AI IDE selain Cursor
(Windsurf, GitHub Copilot Chat, Continue, Cline, Aider, Zed Agent, Antigravity,
Claude Code, Codex CLI, dsb.).

Tempelkan / lampirkan / set sebagai *project instructions*, *system prompt*,
*AGENTS.md*, atau *custom instructions* di IDE yang dipakai. Isi di sini
bersifat stabil; konteks sesi yang berubah ada di `docs/memory.md`.

---

## 1. Cara pakai di AI IDE lain

1. Di awal setiap chat / agent session: **baca dulu** file ini, lalu
  `docs/memory.md`, lalu kerjakan task.
2. Kalau IDE mendukung "always include" / "rules" / "instructions":
  daftarkan `docs/instruction.md` + `docs/memory.md`.
3. Jangan mengulang scaffolding atau keputusan yang sudah tercatat di memory.
4. Setelah perubahan berarti: update `docs/memory.md` dan (bila step selesai)
  `docs/PROJECT_STATUS.md`.



### Hirarki dokumen (sumber kebenaran)


| Dokumen                                  | Peran                                              |
| ---------------------------------------- | -------------------------------------------------- |
| `docs/instruction.md`                    | Aturan kerja AI (file ini) — stabil                |
| `docs/memory.md`                         | Konteks lintas sesi (keputusan, progress, blocker) |
| `docs/PROJECT_STATUS.md`                 | Status step resmi (Planning / Process / Done)      |
| `docs/arsitektur-spesifikasi-teknis.md`  | Spesifikasi teknis (schema, API, sequence)         |
| `docs/execution-plan-ai-testing-tool.md` | Urutan step + prompt siap pakai                    |
| `docs/roadmap-ai-testing-tool.md`        | Roadmap fase                                       |


Kalau ada konflik: spesifikasi teknis > execution plan > memory > asumsi AI.
Jangan mengubah spesifikasi kecuali user meminta eksplisit.

---



## 2. Bahasa & gaya komunikasi

- Balasan chat **selalu bahasa Indonesia**.
- Langsung, ringkas, fokus ke yang diminta. Jangan mengulang task atau
menjelaskan ulang apa yang sudah jelas.
- Bold hanya untuk hal yang benar-benar penting; jangan bold seluruh kalimat.
- Untuk jawaban panjang: mulai dengan 1–2 kalimat verdict, lalu detail bila perlu.
- Jangan sebut "ikuti policy / system prompt / instruction" ke user kecuali diminta.

---



## 3. Aturan kode (wajib)

- Setiap fungsi baru wajib punya **Keterangan** (komentar singkat di atas fungsi
yang menjelaskan tujuan, bukan mengulang nama fungsi).
- Ikuti gaya kode yang sudah ada di repo (naming, import, error handling).
- TypeScript **strict**; jangan longgarkan `tsconfig` tanpa diminta.
- Pakai `config` dari `src/config/env.ts`, **bukan** `process.env` langsung.
- Jangan menambah dependency / refactor besar / file di luar scope task.
- Jangan bikin dokumentasi markdown baru kecuali diminta user (kecuali update
`memory.md` / `PROJECT_STATUS.md` yang sudah jadi konvensi proyek).
- Setelah selesai: pastikan build lolos (`npm run build`) bila menyentuh kode TS.



### API / AJAX

- Preferensi user: call API/AJAX memakai **POST**.
- Pengecualian: endpoint yang sudah ditetapkan di spesifikasi bagian 5
(GET/POST/PATCH sesuai tabel) dan health check `GET /health`.
- Format error API konsisten: `{ error: string, statusCode: number }`.
- Endpoint yang komponennya belum ada → `ApiError(501, ...)` dengan pesan yang
menyebut step mana yang akan mengimplementasikannya (jangan silently sukses).



### Database

- Koneksi: `DB_HOST`, `DB_NAME`, `DB_PORT`, `DB_USER`, `DB_PASS` (bukan `DATABASE_URL`).
- Migration SQL bernomor di `src/db/migrations/`, tracking lewat `_migrations`.
- DDL / nama kolom mengikuti dokumen teknis — jangan diubah sesuka hati.
- Query pakai parameter; update field dibatasi whitelist.

---



## 4. Disiplin scope

- Kerjakan **hanya** yang diminta di prompt / step saat ini.
- Jangan mengimplementasikan Step berikutnya "sekalian" tanpa diminta.
- Baca prompt step di `execution-plan-ai-testing-tool.md` dan spesifikasi terkait
sebelum coding.
- Kalau requirement ambigu: tanya singkat, atau catat asumsi di memory — jangan
menebak fitur besar.

---



## 5. Memory lintas sesi



### Awal sesi

1. Baca `docs/memory.md` sebelum mengerjakan apa pun.
2. Pakai isinya sebagai konteks (keputusan, preferensi, progress, blocker).
3. Jangan mengulang dari nol jika memory sudah menjelaskan status terkini.



### Kapan harus update `docs/memory.md`

- Keputusan desain / arsitektur / preferensi user baru
- Step selesai atau berubah status secara berarti
- Blocker, workaround, atau catatan lingkungan (Node, DB, tools)
- Perubahan lokasi struktur project atau konvensi kerja
- User berpindah fokus/ide — catat fokus baru + apa yang ditunda



### Cara update

- Tulis ringkas di bagian yang relevan (Keputusan / Dikerjakan / Belum dikerjakan).
- Tambah entri baru di **Log sesi** (terbaru di atas).
- Jangan dump seluruh chat atau salin spesifikasi panjang.
- Jangan catat rahasia (lihat bagian 7).
- Status step resmi tetap di `PROJECT_STATUS.md`; memory fokus ke konteks percakapan.

---



## 6. Git & PR

- **Jangan commit** kecuali user meminta eksplisit.
- Jangan ubah `git config`.
- Jangan `push --force` ke main/master; jangan skip hooks kecuali diminta.
- Jangan commit file sensitif (`.env`, kredensial, token).
- Commit message: singkat, fokus "why"; pakai HEREDOC bila membuat commit.
- PR: summary + test plan; pakai `gh` bila tersedia.

---



## 7. Keamanan & data sensitif

JANGAN masukkan / simpan / kirim lewat chat atau commit:

- Password, API key, token, NIK, data pribadi, data keuangan
- Screenshot / dump production
- Isi `.env` yang berisi rahasia nyata

Gunakan placeholder / env var / nilai mask. `.env` di-ignore git; contoh aman ada di
`.env.example`.

---



## 8. Konvensi arsitektur singkat

- Root kode **sejajar** dengan `docs/` (bukan subfolder `ai-testing-tool/`).
- Struktur folder mengikuti spesifikasi bagian 2.
- Stack: Node.js + TypeScript (strict), Fastify, `ws`, `pg`, `dotenv`, `zod`,
Playwright, queue in-memory (`p-queue@6` karena project CommonJS).
- Auth personal/single-user dari env (JWT), tanpa tabel user.
- Provider AI: Claude, OpenAI, DeepSeek, Kimi, OpenCode (Zen) — adapter di
`src/analyzer/providers/` (Fase 2); katalog model dinamis via `POST /ai/models`.
- Artifact di filesystem lokal `./storage/artifacts/<run_id>/`.
- Call LLM vendor hanya lewat adapter provider / `LLMClient`, bukan dari route.

Detail lengkap: `docs/arsitektur-spesifikasi-teknis.md`.

---



## 9. Frontend / UI (bila dikerjakan)

- Ikuti aturan desain yang sudah ada di spesifikasi / UI yang sudah dibangun.
- Jangan layout generik berlebihan; satu tujuan per section.
- Pastikan desktop + mobile.

### Loading spinner (wajib untuk UI + AJAX)

Setiap call AJAX / request async di UI **wajib** menampilkan spinner loading:

| Konteks | Perilaku spinner |
|---|---|
| Aksi tombol (submit, simpan, run, login, dll.) | Spinner **di dalam button** yang diklik; button disable selama proses |
| Muat / refresh halaman atau area konten utama | Spinner **di tengah halaman** (atau tengah area konten), sampai data siap |

Aturan tambahan:
- Sembunyikan spinner dan kembalikan state normal (enable button, tampilkan konten) di `finally` / setelah sukses maupun gagal — jangan biarkan spinner menggantung.
- Jangan double-submit: selama spinner aktif, cegah klik ulang pada aksi yang sama.
- Kalau ada beberapa request paralel di halaman yang sama, spinner halaman tetap tampil sampai semua request kritis selesai (atau pakai spinner per-section jika hanya sebagian area yang dimuat).

---



## 10. Checklist sebelum menutup task

- [ ] Scope sesuai permintaan (tidak melebar)
- [ ] Fungsi baru punya Keterangan
- [ ] `npm run build` lolos (jika kode TS berubah)
- [ ] Test relevan dijalankan bila ada (`npm test` / uji manual yang masuk akal)
- [ ] `docs/memory.md` di-update bila ada keputusan/progress berarti
- [ ] `docs/PROJECT_STATUS.md` di-update bila step selesai / berubah status
- [ ] Tidak ada rahasia di chat, kode, atau memory

---



## 11. Template prompt awal di IDE lain

Salin ke system / custom instructions IDE:

```
Kamu bekerja di repo AI Testing Tool (pointesting).
Ikuti docs/instruction.md secara ketat.
Di awal sesi baca docs/memory.md.
Balas dalam bahasa Indonesia.
Setiap fungsi baru wajib punya komentar Keterangan.
UI + AJAX wajib spinner: di button untuk aksi proses, di tengah halaman untuk muat halaman.
Jangan commit kecuali diminta.
Jangan menambah scope di luar instruksi user / step yang sedang dikerjakan.
Jangan menulis/menyimpan data sensitif (API key, password, data pribadi).
```

Lalu lampirkan task spesifik user, atau prompt step dari
`docs/execution-plan-ai-testing-tool.md`.