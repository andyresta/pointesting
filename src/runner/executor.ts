import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { testCaseRepository } from '../db/repositories/test-case.repository';
import { testRunRepository } from '../db/repositories/test-run.repository';
import { testStepResultRepository } from '../db/repositories/test-step-result.repository';
import type { TestRunStatus } from '../db/repositories/types';
import { executeSteps } from './testcase-compiler';
import type { Step, StepExecutionResult } from './types';

const VIEWPORT = { width: 1280, height: 720 };

/**
 * Keterangan: Membuat folder temp khusus satu test run untuk video + trace
 * sementara (belum lokasi final ./storage/artifacts/<run_id>/ — pemindahan
 * file dan insert row `artifact` adalah scope Step 10/11).
 */
function createTempRunDir(testRunId: string): string {
  const dir = path.join(os.tmpdir(), 'ai-testing-tool-runs', testRunId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Keterangan: Menyimpan tiap hasil eksekusi step ke tabel test_step_result
 * lewat repository Step 3, berurutan sesuai index step.
 */
async function saveStepResults(
  testRunId: string,
  stepResults: StepExecutionResult[],
): Promise<void> {
  for (const result of stepResults) {
    await testStepResultRepository.create({
      testRunId,
      stepIndex: result.index,
      action: result.action,
      status: result.status,
      errorMessage: result.errorMessage,
      durationMs: result.durationMs,
    });
  }
}

/**
 * Keterangan: Status akhir test_run murni dari keberhasilan eksekusi step
 * (bukan dari `expected` — pengecekan expected via AI Analyzer di Fase 2).
 * 'passed' hanya kalau ada minimal satu step dan semua step berstatus passed.
 */
function computeFinalStatus(stepResults: StepExecutionResult[]): TestRunStatus {
  const allPassed = stepResults.length > 0 && stepResults.every((result) => result.status === 'passed');
  return allPassed ? 'passed' : 'failed';
}

/**
 * Keterangan: Alur inti satu eksekusi test_run sesuai sequence 6.1 — buka
 * browser+context (video & trace aktif), jalankan steps via testcase-compiler
 * (Step 8), simpan hasil tiap step, lalu tutup context/browser. Browser dan
 * context SELALU ditutup di blok finally supaya tidak ada proses browser yang
 * menggantung walau terjadi error tak terduga (mis. crash saat eksekusi step).
 */
async function runTestRun(testRunId: string): Promise<void> {
  const testRun = await testRunRepository.findById(testRunId);
  if (!testRun) {
    console.error(`[executor] test_run "${testRunId}" tidak ditemukan, eksekusi dibatalkan`);
    return;
  }

  const testCase = await testCaseRepository.findById(testRun.testCaseId);
  if (!testCase) {
    console.error(
      `[executor] test_case "${testRun.testCaseId}" untuk test_run "${testRunId}" tidak ditemukan`,
    );
    await testRunRepository.update(testRunId, { status: 'error', finishedAt: new Date() });
    return;
  }

  const startedAt = new Date();
  await testRunRepository.update(testRunId, { status: 'running', startedAt });

  const tempDir = createTempRunDir(testRunId);
  const tracePath = path.join(tempDir, 'trace.zip');

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let finalStatus: TestRunStatus;

  try {
    browser = await chromium.launch();
    context = await browser.newContext({
      recordVideo: { dir: tempDir },
      viewport: VIEWPORT,
    });

    const page = await context.newPage();
    await context.tracing.start({ screenshots: true, snapshots: true });

    const steps = (testCase.steps as unknown as Step[]) ?? [];
    const stepResults = await executeSteps(page, steps);
    await saveStepResults(testRunId, stepResults);

    await context.tracing.stop({ path: tracePath });
    await context.close();
    context = undefined; // sudah ditutup normal, jangan ditutup lagi di finally

    finalStatus = computeFinalStatus(stepResults);
  } catch (error) {
    console.error(`[executor] Error tak terduga saat eksekusi test_run "${testRunId}":`, error);
    finalStatus = 'error';
  } finally {
    if (context) {
      await context.tracing.stop({ path: tracePath }).catch(() => undefined);
      await context
        .close()
        .catch((closeError) =>
          console.error(`[executor] Gagal menutup context test_run "${testRunId}":`, closeError),
        );
    }
    if (browser) {
      await browser
        .close()
        .catch((closeError) =>
          console.error(`[executor] Gagal menutup browser test_run "${testRunId}":`, closeError),
        );
    }
  }

  const finishedAt = new Date();
  try {
    await testRunRepository.update(testRunId, {
      status: finalStatus,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });
  } catch (updateError) {
    console.error(`[executor] Gagal update status akhir test_run "${testRunId}":`, updateError);
  }

  console.log(
    `[executor] test_run "${testRunId}" selesai dengan status "${finalStatus}" (video+trace sementara di ${tempDir})`,
  );
}

/**
 * Keterangan: Entry point yang dipanggil queue worker (testRunQueue, Step 7)
 * untuk mengeksekusi satu test_run penuh. Tidak pernah throw ke pemanggil —
 * semua error tak terduga ditangkap dan dicatat di sini supaya satu job gagal
 * tidak menghentikan worker/queue.
 */
export async function executeTestRun(testRunId: string): Promise<void> {
  try {
    await runTestRun(testRunId);
  } catch (error) {
    console.error(
      `[executor] Kegagalan tak terduga di luar alur normal untuk test_run "${testRunId}":`,
      error,
    );
  }
}
