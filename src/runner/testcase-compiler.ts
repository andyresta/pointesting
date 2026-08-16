import type { Page } from '@playwright/test';
import type { Step, StepExecutionResult } from './types';

export type StepCompleteHandler = (
  result: StepExecutionResult,
) => void | Promise<void>;

/**
 * Keterangan: Menjalankan satu step terhadap Playwright `page` sesuai
 * pemetaan action → API Playwright (goto/fill/click/check/select/waitFor).
 * Melempar error asli dari Playwright kalau gagal — ditangkap oleh caller
 * (`executeSteps`), bukan di sini, supaya errorMessage tetap pesan asli.
 */
async function runStep(page: Page, step: Step): Promise<void> {
  switch (step.action) {
    case 'goto':
      await page.goto(step.url);
      return;
    case 'fill':
      await page.fill(step.selector, step.value);
      return;
    case 'click':
      await page.click(step.selector);
      return;
    case 'check':
      await page.check(step.selector);
      return;
    case 'select':
      await page.selectOption(step.selector, step.value);
      return;
    case 'waitFor':
      await page.waitForSelector(step.selector);
      return;
  }
}

/**
 * Keterangan: Mengeksekusi seluruh `steps` satu per satu (berurutan, bukan
 * paralel — urutan step penting untuk hasil test case) terhadap `page`.
 * Tiap step dicatat index, action, status, errorMessage, dan durationMs.
 * Begitu satu step gagal, eksekusi step berikutnya dihentikan (fail fast),
 * tapi error Playwright tidak dilempar — hasil sampai step yang gagal tetap
 * dikembalikan. Callback opsional dipanggil segera setelah tiap step selesai.
 */
export async function executeSteps(
  page: Page,
  steps: Step[],
  onStepComplete?: StepCompleteHandler,
): Promise<StepExecutionResult[]> {
  const results: StepExecutionResult[] = [];

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    const startedAt = Date.now();

    let result: StepExecutionResult;
    try {
      await runStep(page, step);
      result = {
        index,
        action: step.action,
        status: 'passed',
        errorMessage: null,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      result = {
        index,
        action: step.action,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    }

    results.push(result);
    await onStepComplete?.(result);

    if (result.status === 'failed') {
      break;
    }
  }

  return results;
}
