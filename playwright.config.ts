import { defineConfig } from '@playwright/test';

/**
 * Keterangan: Konfigurasi Playwright Test untuk unit test internal
 * (bukan Playwright yang dijalankan sebagai executor test case pengguna —
 * itu ada di src/runner untuk Step 9). testDir menunjuk ke src supaya
 * file *.spec.ts di dalam folder __tests__ manapun otomatis terdeteksi.
 * actionTimeout dibuat pendek agar test skenario gagal (fail-fast) tidak
 * menunggu lama sebelum melempar error.
 */
export default defineConfig({
  testDir: './src',
  testMatch: '**/__tests__/**/*.spec.ts',
  fullyParallel: true,
  timeout: 15_000,
  use: {
    actionTimeout: 3_000,
    headless: true,
  },
});
