import { createConnection } from '@playwright/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ExplorationDriver } from './exploration-driver';
import type { PageDriver } from '../runner/page-driver';

const WAIT_FOR_SELECTOR_POLL_INTERVAL_MS = 200;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

interface McpToolContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

interface McpToolCallResult {
  content: McpToolContentBlock[];
  isError?: boolean;
}

/**
 * Keterangan: Mengambil blok teks pertama dari hasil tool call MCP — semua
 * tool @playwright/mcp membalas ringkasan dalam satu blok markdown text
 * (verified via POC empiris, bukan cuma dokumentasi resmi).
 */
function extractResultText(result: McpToolCallResult): string {
  return result.content.find((block) => block.type === 'text')?.text ?? '';
}

/**
 * Keterangan: Mem-parsing blok "### Result\n<JSON>\n### ..." dari teks
 * respons tool MCP. Tool tanpa nilai balik (mis. browser_click/browser_type
 * sukses) tidak punya bagian "### Result" sama sekali — dikembalikan
 * `undefined` (aman untuk operasi yang memang tidak butuh nilai balik).
 */
function parseToolResultJson<T>(result: McpToolCallResult): T {
  const text = extractResultText(result);
  const marker = '### Result\n';
  const start = text.indexOf(marker);
  if (start < 0) {
    return undefined as T;
  }
  const afterMarker = text.slice(start + marker.length);
  const nextSectionIndex = afterMarker.indexOf('\n### ');
  const jsonText = (
    nextSectionIndex >= 0 ? afterMarker.slice(0, nextSectionIndex) : afterMarker
  ).trim();
  if (jsonText === 'undefined') {
    // Fungsi evaluate tanpa `return` eksplisit menghasilkan literal
    // "undefined" (bukan JSON valid) — dianggap tidak ada nilai balik,
    // bukan error parsing.
    return undefined as T;
  }
  return JSON.parse(jsonText) as T;
}

/**
 * Keterangan: Mengekstrak pesan error singkat dari blok "### Error\n..."
 * supaya konsisten dengan gaya errorMessage Playwright asli (pesan bersih,
 * tanpa heading markdown/log tambahan).
 */
function extractErrorMessage(result: McpToolCallResult): string {
  const text = extractResultText(result);
  const withoutHeading = text.replace(/^### Error\n/, '');
  return withoutHeading.split('\n### ')[0]?.trim() || 'MCP tool call gagal tanpa pesan';
}

/**
 * Keterangan: Mendeteksi error spesifik "dialog belum ditangani" — terverifikasi
 * empiris bahwa SEMUA tool lain (evaluate/click/type/dst.) gagal dengan pesan
 * ini selama ada window.confirm/alert/prompt yang terbuka, sampai
 * browser_handle_dialog dipanggil. Dipakai untuk auto-dismiss otomatis
 * (menggantikan listener page.on('dialog') Playwright yang tidak ada
 * padanannya di protokol MCP).
 */
function isModalStateError(result: McpToolCallResult): boolean {
  return extractResultText(result).includes('does not handle the modal state');
}

/**
 * Keterangan: Mengelola satu koneksi in-process ke @playwright/mcp (server
 * MCP dijalankan di proses yang sama via `createConnection()`, dihubungkan
 * ke client MCP lewat InMemoryTransport — tanpa spawn child process/stdio)
 * dan membungkus tool-call generik dengan auto-dismiss dialog. Dipakai
 * sebagai mesin browser-control untuk generate/eksplorasi test case
 * (BUKAN untuk eksekusi test case tersimpan — itu tetap Playwright asli).
 */
export class McpBrowserSession {
  private client: Client | null = null;
  private server: Awaited<ReturnType<typeof createConnection>> | null = null;
  // Keterangan: satu browser/tab MCP tidak aman dipakai konkuren — terbukti
  // empiris terhadap situs remote sungguhan: live-view screenshot polling
  // (startScreenshotPolling di generator.service.ts) berjalan di loop
  // terpisah dari crawl (navigate/evaluate), dan begitu ada latensi jaringan
  // nyata (fixture lokal terlalu cepat untuk memicu race ini), tool call yang
  // saling tumpang tindih membuat @playwright/mcp macet/timeout atau
  // mengembalikan state halaman yang salah (mis. "about:blank" walau navigate
  // sudah "berhasil"). Semua tool call pada satu sesi diserialisasi lewat
  // antrean promise ini supaya hanya ada satu aksi Playwright berjalan
  // kapanpun, sama seperti semantik satu halaman browser sungguhan.
  private queue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async connect(viewport?: { width: number; height: number }): Promise<void> {
    // Keterangan: `isolated: true` WAJIB — tanpa ini @playwright/mcp memakai
    // profil browser persisten di disk (shared antar koneksi), jadi sesi
    // kedua yang jalan sebelum sesi pertama benar-benar tertutup akan gagal
    // "Browser is already in use" (terbukti nyata lewat test). Isolated =
    // profil in-memory per sesi, aman untuk generate job yang berjalan
    // konkuren (testRunQueue concurrency > 1). `viewport` WAJIB disamakan
    // dengan konstanta VIEWPORT di page-explorer.ts — heuristik deteksi
    // sidebar/navbar di sana menghitung threshold pixel relatif terhadap
    // lebar viewport tertentu; kalau browser MCP pakai ukuran default yang
    // berbeda, threshold itu jadi salah.
    this.server = await createConnection({
      browser: {
        isolated: true,
        launchOptions: { headless: true },
        ...(viewport ? { contextOptions: { viewport } } : {}),
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    this.client = new Client({ name: 'ai-testing-tool-generator', version: '1.0.0' });
    await Promise.all([
      this.server.connect(serverTransport),
      this.client.connect(clientTransport),
    ]);
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }
    // Keterangan: tunggu antrean (mis. screenshot poll yang masih in-flight)
    // selesai dulu sebelum browser_close, supaya tidak menutup tab yang lagi
    // dipakai tool call lain — konsisten dengan serialisasi callToolRaw.
    await this.queue.catch(() => undefined);
    try {
      await this.client.callTool({ name: 'browser_close', arguments: {} });
    } catch {
      // Diamkan — browser mungkin sudah crash/tertutup, tidak boleh
      // menghalangi cleanup sesi generate.
    }
    await this.client.close().catch(() => undefined);
    this.client = null;
    this.server = null;
  }

  /**
   * Keterangan: Memanggil satu tool MCP mentah. Kalau gagal karena dialog
   * belum ditangani, otomatis panggil browser_handle_dialog(accept:false)
   * (setara auto-dismiss Playwright — TIDAK PERNAH accept/submit dialog),
   * lalu retry SEKALI. Error lain dilempar sebagai Error biasa (pesan
   * bersih, tanpa heading markdown) supaya errorMessage step tetap jelas.
   */
  private callToolRaw(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    return this.enqueue(async () => {
      if (!this.client) {
        throw new Error('McpBrowserSession belum connect()');
      }
      let result = (await this.client.callTool({ name, arguments: args })) as McpToolCallResult;
      if (result.isError && isModalStateError(result)) {
        await this.client.callTool({
          name: 'browser_handle_dialog',
          arguments: { accept: false },
        });
        result = (await this.client.callTool({ name, arguments: args })) as McpToolCallResult;
      }
      return result;
    });
  }

  /**
   * Keterangan: Memanggil tool MCP dan mem-parsing nilai baliknya sebagai
   * JSON (dipakai browser_evaluate). Melempar Error kalau tool gagal.
   */
  async callTool<T = undefined>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.callToolRaw(name, args);
    if (result.isError) {
      throw new Error(extractErrorMessage(result));
    }
    return parseToolResultJson<T>(result);
  }

  /**
   * Keterangan: Menjalankan JS di halaman (tanpa target = whole-page,
   * setara `page.evaluate()`) dan mengembalikan hasilnya sebagai JSON —
   * primitive utama untuk snapshot/ekstraksi DOM di page-explorer.ts.
   */
  evaluate<T>(fn: string): Promise<T> {
    return this.callTool<T>('browser_evaluate', { function: fn });
  }

  navigate(url: string): Promise<void> {
    return this.callTool('browser_navigate', { url });
  }

  click(selector: string): Promise<void> {
    return this.callTool('browser_click', { target: selector });
  }

  pressKey(key: string): Promise<void> {
    return this.callTool('browser_press_key', { key });
  }

  /**
   * Keterangan: Screenshot JPEG base64 untuk live view generate (pengganti
   * CDP screencast Playwright yang tidak tersedia di balik MCP) — dipoll
   * berkala oleh caller, bukan event push seperti CDP.
   */
  async screenshot(): Promise<{ data: string; mimeType: string } | null> {
    const result = await this.callToolRaw('browser_take_screenshot', {
      type: 'jpeg',
      scale: 'css',
    });
    if (result.isError) {
      return null;
    }
    const image = result.content.find((block) => block.type === 'image');
    return image?.data ? { data: image.data, mimeType: image.mimeType ?? 'image/jpeg' } : null;
  }
}

/**
 * Keterangan: Adapter PageDriver di atas McpBrowserSession — dipakai
 * `executeSteps` (testcase-compiler.ts) untuk menjalankan langkah login saat
 * generate (`executeInstructionOnPage`) tanpa duplikasi logika step-execution
 * dengan eksekusi test case sungguhan (yang tetap pakai PlaywrightPageDriver).
 */
export class McpPageDriver implements PageDriver {
  constructor(private readonly session: McpBrowserSession) {}

  goto(url: string): Promise<void> {
    return this.session.navigate(url);
  }

  fill(selector: string, value: string): Promise<void> {
    return this.session.callTool('browser_type', { target: selector, text: value });
  }

  click(selector: string): Promise<void> {
    return this.session.click(selector);
  }

  async check(selector: string): Promise<void> {
    await this.session.evaluate(
      `() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (element && !element.checked) {
          element.checked = true;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return null;
      }`,
    );
  }

  selectOption(selector: string, value: string): Promise<void> {
    return this.session.callTool('browser_select_option', {
      target: selector,
      values: [value],
    });
  }

  async waitForSelector(
    selector: string,
    options?: { state?: 'visible' | 'hidden'; timeout?: number },
  ): Promise<void> {
    const state = options?.state ?? 'visible';
    const timeout = options?.timeout ?? DEFAULT_WAIT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    const wantsHidden = state === 'hidden';
    const selectorJson = JSON.stringify(selector);
    for (;;) {
      const matches = await this.session.evaluate<boolean>(
        `() => {
          const el = document.querySelector(${selectorJson});
          if (!el) return ${wantsHidden};
          const style = window.getComputedStyle(el);
          const visible = style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
          return ${wantsHidden} ? !visible : visible;
        }`,
      );
      if (matches) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timeout menunggu selector "${selector}" (state=${state})`);
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_SELECTOR_POLL_INTERVAL_MS));
    }
  }

  isChecked(selector: string): Promise<boolean> {
    return this.session.evaluate<boolean>(
      `() => Boolean(document.querySelector(${JSON.stringify(selector)})?.checked)`,
    );
  }

  textContent(selector: string): Promise<string | null> {
    return this.session.evaluate<string | null>(
      `() => document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`,
    );
  }

  inputValue(selector: string): Promise<string> {
    return this.session.evaluate<string>(
      `() => document.querySelector(${JSON.stringify(selector)})?.value ?? ''`,
    );
  }

  count(selector: string): Promise<number> {
    return this.session.evaluate<number>(
      `() => document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
  }

  url(): Promise<string> {
    return this.session.evaluate<string>('() => window.location.href');
  }
}

/**
 * Keterangan: Adapter ExplorationDriver di atas McpBrowserSession — dipakai
 * mesin eksplorasi/crawl (page-explorer.ts, interaction-explorer.ts) sebagai
 * pengganti Playwright `Page` langsung sesuai keputusan mengganti mesin
 * eksplorasi ke MCP. `goto` mengabaikan `timeoutMs` (browser_navigate MCP
 * tidak mengekspos parameter timeout; MCP server punya batas waktu internal
 * sendiri). `waitForIdle` adalah approksimasi (poll `document.readyState`
 * lalu jeda singkat) — MCP tidak mengekspos konsep "networkidle" seperti
 * Playwright.
 */
export class McpExplorationDriver implements ExplorationDriver {
  constructor(private readonly session: McpBrowserSession) {}

  async goto(url: string): Promise<void> {
    await this.session.navigate(url);
  }

  evaluate<T>(fn: string): Promise<T> {
    return this.session.evaluate<T>(fn);
  }

  click(selector: string): Promise<void> {
    return this.session.click(selector);
  }

  pressKey(key: string): Promise<void> {
    return this.session.pressKey(key);
  }

  currentUrl(): Promise<string> {
    return this.session.evaluate<string>('() => window.location.href');
  }

  async waitForIdle(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const ready = await this.session
        .evaluate<boolean>("() => document.readyState === 'complete'")
        .catch(() => true);
      if (ready || Date.now() >= deadline) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  screenshot(): Promise<{ data: string; mimeType: string } | null> {
    return this.session.screenshot();
  }

  asPageDriver(): PageDriver {
    return new McpPageDriver(this.session);
  }
}
