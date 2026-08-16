# Project Instructions — AI Testing Tool (pointesting)

Kamu bekerja di repo AI Testing Tool (pointesting). Aturan lengkap:
`docs/instruction.md`. Ikuti aturan ini secara ketat.

## Wajib di awal sesi

- Baca dulu `docs/instruction.md`, lalu `docs/memory.md`, baru kerjakan task.
- Jangan mengulang scaffolding/keputusan yang sudah tercatat di memory.
- Hirarki dokumen (sumber kebenaran): `docs/arsitektur-spesifikasi-teknis.md`
  > `docs/execution-plan-ai-testing-tool.md` > `docs/memory.md` > asumsi AI.

## Bahasa & gaya

- Balas chat **selalu bahasa Indonesia**, langsung, ringkas.
- Setiap fungsi baru wajib punya komentar **Keterangan** di atasnya.
- TypeScript strict; pakai `config` dari `src/config/env.ts`, bukan `process.env`.
- Call API/AJAX memakai **POST** (kecuali endpoint yang sudah ditetapkan di
  spesifikasi dan `GET /health`). Format error: `{ error, statusCode }`.
- Database: `DB_HOST`, `DB_NAME`, `DB_PORT`, `DB_USER`, `DB_PASS`; migration SQL
  bernomor di `src/db/migrations/`; query berparameter; update field whitelist.

## UI + AJAX (wajib spinner)

- Setiap call AJAX/request async wajib menampilkan spinner loading.
- Aksi tombol (submit, simpan, run, login): spinner di dalam button; button
  disable selama proses.
- Muat/refresh halaman: spinner di tengah halaman sampai data siap.
- Kembalikan state normal di `finally` (sukses maupun gagal); jangan
  double-submit.
- Pastikan desktop + mobile.

## Disiplin scope

- Kerjakan **hanya** yang diminta di prompt/step saat ini. Jangan melebar.
- Baca prompt step di `docs/execution-plan-ai-testing-tool.md` dan spesifikasi
  terkait sebelum coding.
- Requirement ambigu → tanya singkat atau catat asumsi di memory.
- Jangan menambah dependency / refactor besar / file di luar scope task.
- Jangan bikin dokumentasi markdown baru kecuali diminta (update `memory.md` /
  `PROJECT_STATUS.md` adalah konvensi proyek).
- Jangan commit kecuali diminta.

## Keamanan

- Jangan menulis/menyimpan data sensitif (API key, password, token, NIK, data
  pribadi/keuangan, isi `.env`). Pakai placeholder/env var/nilai mask.

## Checklist penutup task

- [ ] Scope sesuai permintaan
- [ ] Fungsi baru punya Keterangan
- [ ] `npm run build` lolos (bila kode TS berubah)
- [ ] Test relevan dijalankan bila ada
- [ ] `docs/memory.md` di-update bila ada keputusan/progress berarti
- [ ] `docs/PROJECT_STATUS.md` di-update bila step selesai/berubah status
- [ ] Tidak ada rahasia di chat, kode, atau memory
