import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AnalysisStatus } from '../../db/repositories/types';

interface BrowserElement {
  dataset: Record<string, string | undefined>;
}

const DASHBOARD_SCRIPT = path.resolve(
  __dirname,
  '../public/dashboard.js',
);

/**
 * Keterangan: Menyiapkan DOM dashboard minimal dan token session agar fungsi
 * render analysis dapat diuji di browser nyata tanpa server/provider AI.
 */
async function prepareDashboardPage(page: Page): Promise<void> {
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
              <article class="test-case">
                <div class="latest-analysis-summary" hidden></div>
                <section class="run-panel">
                  <div class="evidence-layout">
                    <div class="run-content">
                      <video></video>
                      <a class="artifact-link">Download trace</a>
                    </div>
                    <aside class="analysis-panel" hidden></aside>
                  </div>
                </section>
              </article>
            </main>
          </body>
        </html>`,
    });
  });
  await page.goto('http://dashboard.test/');
  await page.addScriptTag({ path: DASHBOARD_SCRIPT });
}

for (const status of [
  'success',
  'fail',
  'bug',
  'anomaly',
] as AnalysisStatus[]) {
  test(`analysis ${status} tampil bersama bukti dan badge berwarna`, async ({
    page,
  }) => {
    await prepareDashboardPage(page);
    await page.evaluate((analysisStatus) => {
      const browserGlobal = globalThis as unknown as {
        document: {
          querySelector(selector: string): BrowserElement | null;
        };
        renderAnalysisResult(
          runId: string,
          targetPanel: BrowserElement,
          result: Record<string, string>,
          socket: null,
        ): void;
      };
      const panel = browserGlobal.document.querySelector('.run-panel');
      if (!panel) {
        throw new Error('Panel fixture tidak ditemukan');
      }
      panel.dataset.activeRunId = 'run-ui-test';
      panel.dataset.finished = 'false';
      panel.dataset.evidenceReady = 'true';

      browserGlobal.renderAnalysisResult(
        'run-ui-test',
        panel,
        analysisStatus === 'success'
          ? {
              status: analysisStatus,
              provider: 'claude',
              reason: 'Semua expected result terpenuhi.',
            }
          : {
              status: analysisStatus,
              provider: 'openai',
              detail: 'Terjadi perbedaan terhadap expected result.',
              solution: 'Periksa implementasi dan jalankan regression test.',
            },
        null,
      );
    }, status);

    const panel = page.locator('.run-panel');
    await expect(
      panel.locator(`.analysis-panel .analysis-status-${status}`),
    ).toHaveText(status);
    await expect(panel.locator('.artifact-link')).toHaveText('Download trace');
    await expect(panel.locator('video')).toHaveCount(1);
    await expect(
      page.locator(`.latest-analysis-summary .analysis-status-${status}`),
    ).toHaveText(status);

    if (status === 'success') {
      await expect(panel.locator('.analysis-panel')).toContainText(
        'Semua expected result terpenuhi.',
      );
      await expect(panel.locator('.analysis-panel')).not.toContainText(
        'Solusi',
      );
    } else {
      await expect(panel.locator('.analysis-panel')).toContainText(
        'Terjadi perbedaan terhadap expected result.',
      );
      await expect(panel.locator('.analysis-panel')).toContainText(
        'Periksa implementasi dan jalankan regression test.',
      );
    }
  });
}
