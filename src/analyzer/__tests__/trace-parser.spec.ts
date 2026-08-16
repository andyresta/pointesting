import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { parseTrace } from '../trace-parser';

const FIXTURE_URL = `file://${path.resolve(
  __dirname,
  '../../runner/__tests__/fixtures/sample.html',
)}`;

test('meringkas action dan timing dari trace Playwright nyata', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'trace-parser-test-'));
  const tracePath = path.join(tempDir, 'trace.zip');
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.goto(FIXTURE_URL);
    await page.fill('#name-input', 'Trace Parser');
    await page.click('#submit-btn');
    await page
      .click('#selector-tidak-ada', { timeout: 100 })
      .catch(() => undefined);
    await context.tracing.stop({ path: tracePath });
    await context.close();

    const summary = await parseTrace(tracePath);
    const serialized = JSON.stringify(summary);

    expect(summary.traceFileCount).toBeGreaterThan(0);
    expect(summary.totalActions).toBeGreaterThanOrEqual(3);
    expect(summary.failedActions).toBe(1);
    expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(summary.actions.some((action) => action.name.includes('goto'))).toBe(
      true,
    );
    expect(summary.actions.some((action) => action.name.includes('fill'))).toBe(
      true,
    );
    expect(
      summary.actions.some(
        (action) => action.status === 'failed' && Boolean(action.error),
      ),
    ).toBe(true);
    expect(summary.actions.every((action) => action.durationMs >= 0)).toBe(true);
    expect(serialized).not.toContain('frame-snapshot');
    expect(serialized.length).toBeLessThan(8_000);
  } finally {
    await browser.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('menolak file yang bukan ZIP trace valid', async () => {
  await expect(parseTrace('/path/trace-tidak-ada.zip')).rejects.toThrow();
});
