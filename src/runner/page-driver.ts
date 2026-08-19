import type { Page } from '@playwright/test';

/**
 * Keterangan: Abstraksi operasi browser yang dibutuhkan `testcase-compiler.ts`
 * — dipenuhi baik oleh Playwright `Page` asli (`PlaywrightPageDriver`, dipakai
 * eksekusi test case sungguhan di executor.ts/run-session.ts, TIDAK berubah
 * perilaku) maupun driver berbasis MCP (`McpPageDriver` di
 * `src/generator/mcp-client.ts`, dipakai browser generate/eksplorasi).
 * Satu compiler, dua backend — supaya login/instruksi saat generate bisa
 * jalan di atas MCP tanpa duplikasi logika step-execution.
 */
export interface PageDriver {
  goto(url: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  check(selector: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  waitForSelector(
    selector: string,
    options?: { state?: 'visible' | 'hidden'; timeout?: number },
  ): Promise<void>;
  isChecked(selector: string): Promise<boolean>;
  textContent(selector: string): Promise<string | null>;
  inputValue(selector: string): Promise<string>;
  count(selector: string): Promise<number>;
  url(): Promise<string>;
}

/**
 * Keterangan: Implementasi PageDriver di atas Playwright `Page` asli — murni
 * passthrough, tidak mengubah perilaku eksekusi test case sungguhan sama
 * sekali dibanding sebelum abstraksi ini ada.
 */
export class PlaywrightPageDriver implements PageDriver {
  constructor(private readonly page: Page) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url);
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  async check(selector: string): Promise<void> {
    await this.page.check(selector);
  }

  async selectOption(selector: string, value: string): Promise<void> {
    await this.page.selectOption(selector, value);
  }

  async waitForSelector(
    selector: string,
    options?: { state?: 'visible' | 'hidden'; timeout?: number },
  ): Promise<void> {
    if (options) {
      await this.page.waitForSelector(selector, options);
    } else {
      await this.page.waitForSelector(selector);
    }
  }

  isChecked(selector: string): Promise<boolean> {
    return this.page.locator(selector).first().isChecked();
  }

  textContent(selector: string): Promise<string | null> {
    return this.page.locator(selector).first().textContent();
  }

  inputValue(selector: string): Promise<string> {
    return this.page.locator(selector).first().inputValue();
  }

  count(selector: string): Promise<number> {
    return this.page.locator(selector).count();
  }

  url(): Promise<string> {
    return Promise.resolve(this.page.url());
  }
}
