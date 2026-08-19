import type { Page } from '@playwright/test';
import { PlaywrightPageDriver, type PageDriver } from '../runner/page-driver';

/**
 * Keterangan: Abstraksi operasi browser yang dibutuhkan eksplorasi/crawl
 * (page-explorer.ts, interaction-explorer.ts) — dipenuhi Playwright `Page`
 * asli (`PlaywrightExplorationDriver`, dipakai SELURUH test yang sudah ada
 * tanpa perubahan perilaku) maupun `McpBrowserSession` (dipakai generate
 * sungguhan sesuai keputusan mengganti mesin eksplorasi ke MCP). Primitif
 * sengaja minim (goto/evaluate/click/pressKey/currentUrl/waitForIdle) —
 * SEMUA heuristik (deteksi nav/backdrop/dropdown, dst.) tetap logika Node
 * biasa yang beroperasi di atas hasil `evaluate`, bukan API locator
 * Playwright, supaya driver-agnostic.
 */
export interface ExplorationDriver {
  goto(url: string, options?: { timeoutMs?: number }): Promise<void>;
  evaluate<T>(fn: string): Promise<T>;
  click(selector: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  currentUrl(): Promise<string>;
  /** Menunggu halaman "settle" setelah navigasi/aksi — approksimasi networkidle. */
  waitForIdle(timeoutMs: number): Promise<void>;
  /** Screenshot JPEG base64 untuk live view — null kalau gagal/tidak tersedia. */
  screenshot(): Promise<{ data: string; mimeType: string } | null>;
  /**
   * Keterangan: Mengembalikan PageDriver (kontrak testcase-compiler.ts) di
   * atas backend yang sama — dipakai `executeInstructionOnPage` di
   * generator.service.ts untuk menjalankan langkah login tanpa duplikasi
   * logika step-execution, tetap satu compiler untuk dua backend (lihat
   * page-driver.ts).
   */
  asPageDriver(): PageDriver;
}

/**
 * Keterangan: Implementasi ExplorationDriver di atas Playwright `Page` asli —
 * dipakai seluruh test yang sudah ada (page-explorer.spec.ts dkk.) tanpa
 * perubahan perilaku dibanding sebelum abstraksi ini ada.
 */
export class PlaywrightExplorationDriver implements ExplorationDriver {
  constructor(private readonly page: Page) {
    // Keterangan: Dialog native (confirm/alert/prompt) SELALU di-dismiss
    // otomatis selama eksplorasi — menyamakan perilaku dengan McpBrowserSession
    // yang auto-dismiss lewat browser_handle_dialog(accept:false). Dipasang
    // sekali di sini (bukan per-klik seperti sebelumnya) karena listener ini
    // berlaku untuk seluruh umur driver, mencakup semua dialog yang muncul.
    page.on('dialog', (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });
  }

  async goto(url: string, options?: { timeoutMs?: number }): Promise<void> {
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options?.timeoutMs,
    });
  }

  evaluate<T>(fn: string): Promise<T> {
    // Keterangan: page.evaluate() Playwright memperlakukan argumen string
    // sebagai EKSPRESI mentah untuk dievaluasi (seperti isi <script>), BUKAN
    // fungsi yang otomatis dipanggil — beda dengan browser_evaluate MCP yang
    // memanggil fungsinya sendiri. Tanpa IIFE ini, hasil evaluate() adalah
    // function value itu sendiri (gagal diserialisasi → undefined), bukan
    // nilai baliknya — bug nyata yang ditemukan lewat test nyata.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return this.page.evaluate(`(${fn})()` as unknown as () => T);
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async waitForIdle(timeoutMs: number): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
  }

  async screenshot(): Promise<{ data: string; mimeType: string } | null> {
    const buffer = await this.page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null);
    return buffer ? { data: buffer.toString('base64'), mimeType: 'image/jpeg' } : null;
  }

  asPageDriver(): PageDriver {
    return new PlaywrightPageDriver(this.page);
  }

  /** Keterangan: Akses Page asli untuk kode yang belum diporting ke driver. */
  get raw(): Page {
    return this.page;
  }
}
