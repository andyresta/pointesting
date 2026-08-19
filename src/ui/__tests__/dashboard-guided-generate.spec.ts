import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_SCRIPT = path.resolve(__dirname, '../public/dashboard.js');

interface BrowserElement {
  dataset: Record<string, string | undefined>;
  hidden?: boolean;
}

/**
 * Keterangan: Meniru struktur testcases.ejs (live-frame + panel sidebar AI +
 * daftar test case) supaya generate:done bisa diuji tanpa server/WS
 * sungguhan — memverifikasi permintaan user: selesai guided generate TIDAK
 * boleh reload halaman (yang bikin panel live Playwright ikut reset), dan
 * daftar test case cukup di-refresh sebagian.
 */
async function prepareTestCasesPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('pointestingToken', 'token-placeholder');
  });
  const pageHtml = (listContent: string) => `<!doctype html>
    <html>
      <body>
        <div id="page-loading"></div>
        <main id="dashboard-content" hidden>
          <section class="run-workspace-panel">
            <div class="run-view-column">
              <div class="generate-view run-view-panel">
                <img class="live-frame" alt="Live Playwright view" src="data:image/jpeg;base64,LAST_FRAME" />
              </div>
            </div>
          </section>
          <aside class="test-case-sidebar">
            <div id="guided-generate-sidebar-panel" class="guided-generate-sidebar-panel">
              <ol class="generate-log-list guided-generate-log"></ol>
            </div>
            <form id="test-case-search-form" hidden></form>
            <ol class="test-case-list" hidden>${listContent}</ol>
          </aside>
        </main>
      </body>
    </html>`;

  const pageUrl = 'http://dashboard.test/projects/proj-1/test-cases';
  let requestCount = 0;
  await page.route(pageUrl, async (route) => {
    requestCount += 1;
    // Request pertama = navigasi awal (list kosong). Request berikutnya =
    // fetch refreshTestCaseList setelah generate:done (list berisi item baru).
    const listContent =
      requestCount === 1
        ? ''
        : '<li class="test-case test-case-item" data-test-case-id="tc-new"><h3>Test Case Baru</h3></li>';
    await route.fulfill({ contentType: 'text/html', body: pageHtml(listContent) });
  });
  await page.goto(pageUrl);
  await page.addScriptTag({ path: DASHBOARD_SCRIPT });
}

test('generate:done tidak reload halaman, live-frame tetap, dan daftar test case ter-refresh', async ({
  page,
}) => {
  await prepareTestCasesPage(page);

  await page.evaluate(async () => {
    const browserGlobal = globalThis as unknown as {
      document: { querySelector(selector: string): BrowserElement | null };
      handleGuidedGenerateEvent(
        event: Record<string, unknown>,
        projectId: string,
        generateId: string,
        guidedPanel: BrowserElement,
        finish: () => void,
      ): void;
    };
    const guidedPanel = browserGlobal.document.querySelector('#guided-generate-sidebar-panel');
    if (!guidedPanel) {
      throw new Error('Panel sidebar AI tidak ditemukan');
    }
    guidedPanel.dataset.activeGenerateId = 'gen-1';
    guidedPanel.dataset.finished = 'false';
    browserGlobal.handleGuidedGenerateEvent(
      { type: 'generate:done', runId: 'gen-1', testCases: [{ id: 'tc-new', title: 'Test Case Baru' }] },
      'proj-1',
      'gen-1',
      guidedPanel,
      () => {
        guidedPanel.dataset.finished = 'true';
      },
    );
  });

  // Live view tidak berubah / tidak ada navigasi.
  await expect(page.locator('.live-frame')).toHaveAttribute('src', /LAST_FRAME/);
  expect(page.url()).toBe('http://dashboard.test/projects/proj-1/test-cases');

  // Daftar test case ter-refresh (item baru muncul) tanpa reload penuh.
  await expect(page.locator('.test-case-list .test-case-item')).toHaveCount(1);
  await expect(page.locator('.test-case-item h3')).toHaveText('Test Case Baru');

  // Panel sidebar AI otomatis tertutup lagi setelah beberapa saat.
  await expect(page.locator('#guided-generate-sidebar-panel')).toBeHidden({ timeout: 2000 });
});
