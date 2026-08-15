# Roadmap AI Testing Tool (ala TestSprite) — Full Node.js

## Ringkasan Tech Stack Keseluruhan

| Komponen | Teknologi | Fungsi |
|---|---|---|
| Bahasa & runtime | Node.js (TypeScript) | Satu bahasa untuk seluruh sistem — orchestrator, API, worker, analyzer |
| Test execution engine | `@playwright/test` | Menjalankan test case di browser sungguhan, hasilkan video/trace/screenshot/console/network otomatis |
| Test generation & healing | `@playwright/mcp`, `@playwright/cli` | Menerjemahkan bahasa natural / eksplorasi URL jadi test case; memperbaiki selector rusak |
| API server | Fastify | Endpoint untuk trigger test run, ambil hasil, kelola test case — dipilih karena ringan dan cepat dibanding Express |
| Job queue | In-memory queue (array/variable di proses Node) | Menjalankan test run secara async, tidak memblokir API — tanpa Redis, cukup untuk skala awal single-instance |
| Database | PostgreSQL | Simpan test case, riwayat run, hasil analisis, relasi antar entitas |
| File storage | Filesystem lokal (path biasa, misal `./storage/artifacts/<run_id>/`) | Simpan artifact besar: video, trace `.zip`, screenshot — path-nya disimpan sebagai kolom string di DB |
| AI Analyzer | API LLM multi-provider — Claude, OpenAI, DeepSeek, Kimi, opencode | Membaca expected result + log + trace, menghasilkan klasifikasi status + detail + solusi dalam JSON terstruktur; provider bisa dipilih/diganti sesuai kebutuhan (biaya, kecepatan, atau kualitas reasoning) |
| Dashboard | EJS/Handlebars + HTMX (atau Next.js bila ingin lebih interaktif) | Menampilkan daftar run, detail per test case, video player, viewer trace |
| Realtime update | WebSocket | Progress test run & live browser view tampil real-time di dashboard tanpa refresh manual |
| Live browser view | `page.screencast` (Playwright ≥1.59) + WebSocket | Stream frame browser secara real-time ke dashboard, sehingga user bisa melihat test sedang berjalan di aplikasinya (mirip TestSprite) |
| Autentikasi | Personal/single-user (session sederhana atau API key, tanpa role/multi-tenant) | Login untuk melindungi akses dashboard — belum butuh multi-user/role, bisa ditambahkan belakangan kalau dipakai tim |

---

## Fase 1 — Fondasi Eksekusi & Rekam

**Tujuan:** Test case bisa dijalankan otomatis dan seluruh artifact-nya terekam rapi, meski belum ada AI sama sekali.

### Fitur detail
1. **Definisi test case terstruktur**
   - Format YAML/JSON berisi steps (action, selector, value) + expected result eksplisit
   - Validasi schema saat disimpan (supaya tidak ada test case cacat format)
2. **Test runner**
   - Wrapper di atas `@playwright/test` yang membaca test case dari DB, generate `.spec.ts` on-the-fly atau eksekusi dinamis
   - Konfigurasi: `video: 'on'`, `trace: 'on'`, listener `page.on('console')` dan `page.on('request'/'response')`
3. **Artifact collector**
   - Custom Playwright Reporter (`onTestEnd`) yang mengambil path video, trace, dan log per test case
   - Pindahkan/simpan file ke folder storage lokal (misal `./storage/artifacts/<run_id>/`), simpan path-nya sebagai string di DB — tidak perlu object storage terpisah
4. **Job queue sederhana (in-memory)**
   - Test run masuk sebagai job ke array/queue di memory proses Node (misal pakai `p-queue` atau array manual dengan flag `isProcessing`)
   - Cukup untuk skala awal (single instance, single Node process) — belum butuh Redis/BullMQ; bisa dinaikkan ke BullMQ+Redis nanti kalau sudah butuh multi-instance atau job harus tahan restart server
5. **Live embedded browser view**
   - Worker aktifkan `page.screencast.start()` saat test mulai jalan, listen event `frame`
   - Tiap frame (Buffer JPEG) dikirim dari worker ke server via WebSocket, lalu di-broadcast ke client dashboard yang sedang menonton test_run tersebut
   - Dashboard render frame sebagai gambar yang terus di-update (pola mirip MJPEG) — terasa seperti menonton browser secara live tanpa perlu WebRTC
   - Opsional: aktifkan `annotateActions: true` supaya tiap frame membawa metadata aksi yang sedang terjadi (misal "sedang klik tombol Login"), bisa dipakai untuk overlay label di live view
   - Resolusi/kualitas frame untuk live view dibuat rendah agar hemat bandwidth; video final hasil `video: 'on'` tetap kualitas penuh untuk arsip
6. **Dashboard dasar**
   - List test run, status per test case (masih manual/raw: pass/fail dari assertion Playwright biasa)
   - Panel live browser view saat test sedang berjalan, otomatis berganti ke video player + link download trace setelah test selesai

### Tech stack fase ini
| Tech | Fungsi di fase ini |
|---|---|
| `@playwright/test` | Eksekusi test case, sumber semua artifact mentah |
| Fastify | Endpoint trigger run, list test case, list hasil |
| In-memory queue (`p-queue` atau array manual) | Antrian eksekusi test di dalam proses Node, tanpa dependency eksternal |
| PostgreSQL | Simpan test_case, test_run, artifact reference (path file) |
| Filesystem lokal | Simpan file video & trace yang ukurannya besar, path-nya direferensikan di DB |
| `page.screencast` (Playwright ≥1.59) | Sumber frame gambar live selama test berjalan, untuk live browser view |
| WebSocket server (`ws` atau Socket.IO) | Broadcast frame live dari worker ke dashboard client secara real-time |
| EJS/Handlebars + HTMX | Dashboard awal, termasuk panel live browser view & video player |

**Keluaran fase ini:** sistem bisa dipakai sebagai "test runner + recorder" murni, termasuk bisa menonton test berjalan secara live di browser — sudah berguna standalone walau AI belum ada.

---

## Fase 2 — AI Analyzer (MVP inti pembeda produk)

**Tujuan:** Setiap hasil test case diklasifikasikan otomatis: success/fail/bug/anomaly, lengkap detail dan solusi.

### Fitur detail
1. **Provider abstraction layer**
   - Satu interface internal (`analyzeTest(input): AnalysisResult`) yang di baliknya bisa switch ke Claude, OpenAI, DeepSeek, Kimi, atau opencode — tiap provider punya adapter sendiri untuk format request/response API-nya
   - Provider default bisa diset per project atau per test case, plus fallback kalau satu provider error/rate-limited
2. **Prompt builder**
   - Susun input terstruktur untuk LLM: expected result dari test case, ringkasan console log (filter noise, ambil error/warning), ringkasan network log (status code aneh, response time), beberapa screenshot kunci
   - Trace `.zip` diparse dulu jadi data terstruktur (bukan dikirim mentah — terlalu besar)
   - Catatan: tidak semua provider punya kemampuan multimodal (baca gambar) yang setara — kalau provider yang dipilih tidak mendukung image input, screenshot bisa dilewati dan analisis mengandalkan log terstruktur saja
3. **Klasifikasi status**
   - Definisi tegas dikirim sebagai instruksi ke LLM (success/fail/bug/anomaly seperti sudah dibahas)
   - Output dipaksa JSON terstruktur: `{status, reason, detail, solution}`
4. **Penanganan khusus per status**
   - `success` → hanya `reason` (bukti apa yang mendasari kesimpulan sukses)
   - `fail`/`bug`/`anomaly` → `detail` (root cause) + `solution` (langkah perbaikan konkret)
5. **Anomaly detection berbasis histori**
   - Bandingkan response time & pola network run sekarang vs beberapa run sebelumnya (query dari DB) — anomaly bukan cuma dari satu run, tapi dari deviasi tren
6. **Dashboard update**
   - Tampilkan status berwarna per test case, expand untuk lihat detail + solusi
   - Selalu pasangkan kesimpulan AI dengan bukti mentahnya (video/trace) di panel yang sama

### Tech stack fase ini
| Tech | Fungsi di fase ini |
|---|---|
| API LLM multi-provider (Claude, OpenAI, DeepSeek, Kimi, opencode) | Otak klasifikasi — terima data terstruktur, keluarkan status + detail + solusi; provider dapat dipilih/diganti |
| Trace parser (`@playwright/trace-viewer` internals atau parse manual `.zip`) | Ubah trace jadi data terstruktur yang bisa dikirim ke LLM tanpa membengkak token |
| PostgreSQL | Simpan `analysis_result`, dan histori run untuk anomaly detection berbasis tren |
| In-memory queue | Job analisis dijalankan sebagai step lanjutan setelah test selesai, tetap async, tanpa Redis |

**Keluaran fase ini:** produk sudah setara MVP TestSprite dari sisi value inti — otomatis jalankan test, otomatis simpulkan hasil dengan penjelasan.

---

## Fase 3 — Test Generation dari AI

**Tujuan:** Test case tidak perlu ditulis manual — bisa digenerate dari bahasa natural atau eksplorasi URL.

### Fitur detail
1. **Prompt-based generation**
   - User tulis: "Test login flow dengan kredensial valid" → sistem panggil Playwright MCP untuk eksplorasi form login sungguhan, hasilkan steps + expected result
   - Hasil generate ditampilkan sebagai draft, user bisa edit sebelum disimpan sebagai test case resmi
2. **URL-based exploration**
   - User kasih URL app → MCP agent jelajahi halaman, temukan flow-flow utama (form, navigasi, tombol aksi), usulkan sekumpulan test case
   - Ini lebih mahal (token & waktu), jalankan sebagai job terpisah, bukan sinkron
3. **Output tetap format terbuka**
   - Hasil generate disimpan sebagai test case terstruktur yang sama dengan Fase 1 (bukan format tertutup) — supaya tetap bisa diedit manual & dieksekusi oleh runner yang sama

### Tech stack fase ini
| Tech | Fungsi di fase ini |
|---|---|
| `@playwright/mcp` | Agent yang mengeksplorasi UI sungguhan dan menerjemahkan bahasa natural jadi langkah interaksi browser |
| LLM API (provider sama seperti Fase 2) | Menyusun ulang hasil eksplorasi MCP jadi test case terstruktur (steps + expected) yang konsisten dengan schema Fase 1 |
| In-memory queue | Job generation (terutama URL-based) berjalan di background, karena bisa makan waktu |

**Keluaran fase ini:** hambatan terbesar automated testing (menulis test case manual) hilang — user cukup deskripsi atau kasih URL.

---

## Fase 4 — Self-Healing Selector

**Tujuan:** Saat UI berubah dan selector lama tidak valid, sistem tidak langsung `fail` — coba cari elemen setara dulu.

### Fitur detail
1. **Deteksi kegagalan selector**
   - Bedakan error "selector not found" dari kegagalan assertion biasa (logic gagal) — ini dua kasus yang beda penanganan
2. **Healing via MCP**
   - Saat selector gagal, panggil MCP agent: "cari elemen dengan maksud yang sama secara semantik di halaman ini" (misal tombol login berubah dari `#btn-login` jadi `.auth-submit`)
   - Kalau ketemu, jalankan ulang step itu dengan selector baru
3. **Approval, bukan auto-commit**
   - Selector baru hasil healing tidak langsung menggantikan test case asli — masuk status `anomaly` dengan detail "selector berubah, kemungkinan UI diperbarui" + solusi "update test case ke selector baru", user yang approve
4. **Batasan realistis**
   - Untuk redesign UI besar (bukan cuma selector berubah, tapi struktur flow berubah), sistem tetap `fail`/`bug` — tidak dipaksakan auto-heal karena berisiko false positive

### Tech stack fase ini
| Tech | Fungsi di fase ini |
|---|---|
| `@playwright/mcp` | Eksplorasi halaman real-time untuk mencari elemen pengganti saat selector lama gagal |
| PostgreSQL | Simpan histori perubahan selector per test case, untuk audit trail |

**Keluaran fase ini:** maintenance test case jadi jauh lebih ringan — tidak semua perubahan UI kecil bikin seluruh suite merah.

---

## Fase 5 — Fixture Management & Feature Map

**Tujuan:** Mempermudah persiapan data uji dan percepat pembuatan test case awal dari dokumen spek produk.

### Fitur detail
1. **Fixture management**
   - Upload file (CSV, JSON, gambar, PDF) di level project, sekali saja
   - Saat generate/jalankan test case, sistem otomatis pilih fixture yang relevan (misalnya data user untuk test registrasi) berdasarkan konteks test
2. **Feature map dari PRD**
   - Upload dokumen spek produk (PDF/markdown)
   - AI ekstrak daftar fitur, flow, dan edge case → jadi daftar test case awal (draft, bisa diedit)
   - Feature map ini jadi "ground truth" yang bisa dibandingkan lagi dengan test case yang sudah ada — untuk cek coverage mana yang belum ada testnya

### Tech stack fase ini
| Tech | Fungsi di fase ini |
|---|---|
| Filesystem lokal | Simpan file fixture yang diupload user, misal di `./storage/fixtures/<project_id>/` |
| LLM API multi-provider (multimodal untuk PDF/gambar — cek dukungan tiap provider) | Ekstraksi fitur dari dokumen PRD, dan pemilihan fixture relevan secara kontekstual |
| PostgreSQL | Simpan feature map, relasi fixture ↔ test case |

**Keluaran fase ini:** siklus dari dokumen spek produk sampai test case siap jalan makin pendek, dan ada visibilitas coverage (fitur mana yang belum tercover test).

---

## Catatan Prioritas

- **Fase 1 & 2 adalah MVP** — sudah cukup untuk dipakai internal dan membuktikan nilai inti produk (otomatisasi + klasifikasi + solusi). Jangan mulai Fase 3 sebelum akurasi klasifikasi di Fase 2 teruji cukup baik.
- **CI/CD gate sengaja tidak dimasukkan** ke roadmap ini sesuai keputusan sebelumnya — bisa ditambahkan belakangan setelah engine klasifikasi terbukti akurat dan false positive-nya rendah.
- Fase 3–5 bisa ditukar urutannya sesuai kebutuhan aktual — misalnya kalau ternyata menulis test case manual tidak jadi masalah besar, Fase 3 bisa digeser ke belakang Fase 4.
