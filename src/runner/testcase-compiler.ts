import type { PageDriver } from './page-driver';
import type { Step, StepExecutionResult } from './types';

export type StepCompleteHandler = (
  result: StepExecutionResult,
) => void | Promise<void>;

const ASSERTION_TIMEOUT_MS = 5000;
const ASSERTION_POLL_INTERVAL_MS = 150;

/**
 * Keterangan: Polling generik untuk assertion yang butuh cek nilai berulang
 * (teks/nilai input/jumlah elemen/URL) — Playwright tidak punya API tunggu
 * bawaan untuk kondisi ini di luar `@playwright/test`'s `expect`, yang
 * terikat konteks test runner dan tidak aman dipakai di sini karena
 * compiler ini juga jalan standalone (`executor.ts`/`run-session.ts` di
 * luar test runner). Melempar error berisi nilai aktual terakhir supaya
 * kegagalan assertion mudah didiagnosis dari `errorMessage`.
 */
async function pollUntil(
  describeFailure: string,
  readActual: () => Promise<string>,
  matches: (actual: string) => boolean,
): Promise<void> {
  const deadline = Date.now() + ASSERTION_TIMEOUT_MS;
  let lastActual = '';
  for (;;) {
    lastActual = await readActual();
    if (matches(lastActual)) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`${describeFailure} (nilai aktual terakhir: "${lastActual}")`);
    }
    await new Promise((resolve) => setTimeout(resolve, ASSERTION_POLL_INTERVAL_MS));
  }
}

/**
 * Keterangan: Menjalankan satu step terhadap `PageDriver` (Playwright asli
 * ATAU backend MCP — lihat page-driver.ts) sesuai pemetaan action →
 * operasi driver (goto/fill/click/check/select/waitFor), termasuk grup
 * assert* — action checkpoint yang memverifikasi state saat ini tanpa
 * mengubah apa pun (dipakai untuk membuktikan item `expected` benar-benar
 * terjadi, bukan cuma teks deskriptif). Melempar error asli kalau gagal —
 * ditangkap oleh caller (`executeSteps`), bukan di sini, supaya
 * errorMessage tetap pesan asli.
 */
async function runStep(driver: PageDriver, step: Step): Promise<void> {
  switch (step.action) {
    case 'goto':
      await driver.goto(step.url);
      return;
    case 'fill':
      await driver.fill(step.selector, step.value);
      return;
    case 'click':
      await driver.click(step.selector);
      return;
    case 'check':
      await driver.check(step.selector);
      return;
    case 'select':
      await driver.selectOption(step.selector, step.value);
      return;
    case 'waitFor':
      await driver.waitForSelector(step.selector);
      return;
    case 'assertVisible':
      await driver.waitForSelector(step.selector, {
        state: 'visible',
        timeout: ASSERTION_TIMEOUT_MS,
      });
      return;
    case 'assertHidden':
      await driver.waitForSelector(step.selector, {
        state: 'hidden',
        timeout: ASSERTION_TIMEOUT_MS,
      });
      return;
    case 'assertChecked':
      await pollUntil(
        `assertChecked "${step.selector}" gagal: elemen tidak tercentang`,
        async () => ((await driver.isChecked(step.selector)) ? 'checked' : 'unchecked'),
        (actual) => actual === 'checked',
      );
      return;
    case 'assertText':
      await pollUntil(
        `assertText "${step.selector}" gagal: teks tidak mengandung "${step.value}"`,
        async () => (await driver.textContent(step.selector)) ?? '',
        (actual) => actual.toLowerCase().includes(step.value.toLowerCase()),
      );
      return;
    case 'assertValue':
      await pollUntil(
        `assertValue "${step.selector}" gagal: nilai tidak sama dengan "${step.value}"`,
        () => driver.inputValue(step.selector),
        (actual) => actual === step.value,
      );
      return;
    case 'assertCount':
      await pollUntil(
        `assertCount "${step.selector}" gagal: jumlah elemen tidak sama dengan "${step.value}"`,
        async () => String(await driver.count(step.selector)),
        (actual) => actual === step.value.trim(),
      );
      return;
    case 'assertUrl':
      await pollUntil(
        `assertUrl gagal: URL saat ini tidak mengandung "${step.value}"`,
        () => driver.url(),
        (actual) => actual.toLowerCase().includes(step.value.toLowerCase()),
      );
      return;
  }
}

/**
 * Keterangan: Mengeksekusi seluruh `steps` satu per satu (berurutan, bukan
 * paralel — urutan step penting untuk hasil test case) terhadap `driver`.
 * Tiap step dicatat index, action, status, errorMessage, dan durationMs.
 * Begitu satu step gagal, eksekusi step berikutnya dihentikan (fail fast),
 * tapi error Playwright tidak dilempar — hasil sampai step yang gagal tetap
 * dikembalikan. Callback opsional dipanggil segera setelah tiap step selesai.
 */
export async function executeSteps(
  driver: PageDriver,
  steps: Step[],
  onStepComplete?: StepCompleteHandler,
  shouldAbort?: () => boolean,
): Promise<StepExecutionResult[]> {
  const results: StepExecutionResult[] = [];

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    const startedAt = Date.now();

    if (shouldAbort?.()) {
      const result: StepExecutionResult = {
        index,
        action: step.action,
        status: 'failed',
        errorMessage: 'Run dihentikan paksa',
        durationMs: Date.now() - startedAt,
      };
      results.push(result);
      await onStepComplete?.(result);
      break;
    }

    let result: StepExecutionResult;
    try {
      await runStep(driver, step);
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
