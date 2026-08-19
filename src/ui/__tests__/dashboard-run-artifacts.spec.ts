import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_SCRIPT = path.resolve(__dirname, '../public/dashboard.js');

// Keterangan: tsconfig proyek ini tidak menyertakan lib "dom" (server-only) —
// interface minimal ini menghindari referensi tipe DOM global (HTMLElement
// dkk.) di dalam callback page.evaluate, mengikuti pola dashboard-analysis.spec.ts.
interface BrowserElement {
  dataset: Record<string, string | undefined>;
}

/**
 * Keterangan: Menyiapkan DOM minimal yang meniru struktur nyata
 * testcases.ejs (run-view-panel + run-result-panel gabungan + video-preview
 * dialog) supaya renderFinalArtifacts dapat diuji end-to-end tanpa server
 * sungguhan — memverifikasi permintaan user: panel live Playwright TIDAK
 * boleh diganti/direset saat run selesai, video hanya tersedia lewat modal,
 * dan bukti+analysis jadi SATU panel dengan SATU tombol collapse.
 */
async function prepareTestCasesPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('pointestingToken', 'token-placeholder');
  });
  await page.route('http://dashboard.test/', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html>
        <html>
          <body>
            <div id="page-loading"></div>
            <main id="dashboard-content" hidden>
              <section class="run-workspace-panel">
                <div class="run-panel-header"><span class="status-badge status-queued">idle</span></div>
                <div class="run-view-column">
                  <div class="generate-view run-view-panel">
                    <div class="live-placeholder" hidden>Menunggu tampilan Playwright…</div>
                    <img class="live-frame" alt="Live Playwright view" src="data:image/jpeg;base64,LAST_FRAME" />
                  </div>
                  <aside class="run-result-panel" hidden></aside>
                </div>
              </section>
            </main>
            <dialog id="video-preview-dialog">
              <video id="video-preview-player" controls></video>
            </dialog>
          </body>
        </html>`,
    });
  });
  await page.route('http://dashboard.test/test-runs/run-1', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'passed',
        artifacts: [
          { id: 'artifact-video', type: 'video' },
          { id: 'artifact-trace', type: 'trace' },
        ],
        analysisResult: null,
      }),
    });
  });
  await page.route('http://dashboard.test/test-runs/run-1/artifacts/**', async (route) => {
    await route.fulfill({ contentType: 'video/webm', body: Buffer.from('fake-video-bytes') });
  });
  await page.goto('http://dashboard.test/');
  await page.addScriptTag({ path: DASHBOARD_SCRIPT });
}

test('renderFinalArtifacts tidak mengganti live-frame dan menampilkan tombol Putar Video di panel terpisah', async ({
  page,
}) => {
  await prepareTestCasesPage(page);

  await page.evaluate(async () => {
    const browserGlobal = globalThis as unknown as {
      document: {
        querySelector(selector: string): BrowserElement | null;
      };
      renderFinalArtifacts(
        runId: string,
        targetPanel: BrowserElement,
        button: null,
        socket: null,
      ): Promise<void>;
    };
    const panel = browserGlobal.document.querySelector('.run-workspace-panel');
    if (!panel) {
      throw new Error('Panel fixture tidak ditemukan');
    }
    panel.dataset.activeRunId = 'run-1';
    panel.dataset.finished = 'false';
    await browserGlobal.renderFinalArtifacts('run-1', panel, null, null);
  });

  // Live view tidak berubah sama sekali — masih menampilkan frame terakhir.
  const liveFrameSrc = await page.locator('.live-frame').getAttribute('src');
  expect(liveFrameSrc).toContain('LAST_FRAME');
  await expect(page.locator('.run-view-panel video')).toHaveCount(0);

  // Bukti (tombol Putar Video + link download) tampil di panel TERPISAH.
  const resultPanel = page.locator('.run-result-panel');
  await expect(resultPanel).toBeVisible();
  const playButton = resultPanel.getByRole('button', { name: 'Putar Video' });
  await expect(playButton).toBeVisible();
  // 2 tautan unduhan: video + trace (fixture menyediakan keduanya).
  await expect(resultPanel.locator('a.artifact-link')).toHaveCount(2);

  // Klik "Putar Video" membuka modal, BUKAN menampilkan video di panel live.
  await playButton.click();
  const dialogOpen = await page.evaluate(() => {
    const browserGlobal = globalThis as unknown as {
      document: { querySelector(selector: string): { open: boolean } | null };
    };
    return browserGlobal.document.querySelector('#video-preview-dialog')?.open ?? false;
  });
  expect(dialogOpen).toBe(true);
  const playerSrc = await page
    .locator('#video-preview-player')
    .evaluate((el: unknown) => (el as { src: string }).src);
  expect(playerSrc).toContain('blob:');
  await page.evaluate(() => {
    const browserGlobal = globalThis as unknown as {
      document: { querySelector(selector: string): { close(): void } | null };
    };
    browserGlobal.document.querySelector('#video-preview-dialog')?.close();
  });

  // Tombol collapse/expand menyembunyikan isi panel (bukan menghapusnya) —
  // supaya panel bukti tidak menutupi panel live Playwright bila terlalu
  // tinggi, dan bisa ditampilkan lagi tanpa reload/re-fetch.
  const body = resultPanel.locator('.panel-body');
  await expect(body).toBeVisible();
  const toggleButton = resultPanel.locator('.panel-toggle-button');
  await toggleButton.click();
  await expect(body).toBeHidden();
  await toggleButton.click();
  await expect(body).toBeVisible();
});
