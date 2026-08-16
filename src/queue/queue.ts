import PQueue from 'p-queue';
import { config } from '../config/env';
import { testRunRepository } from '../db/repositories/test-run.repository';
import { executeTestRun } from '../runner/executor';
import type { AnalysisJob, TestRunJob } from './types';

/**
 * Keterangan: Named queue in-memory untuk job eksekusi test case (Playwright).
 * Concurrency dikonfigurasi via env TEST_RUN_QUEUE_CONCURRENCY (default 2)
 * karena tiap instance browser Playwright cukup berat di CPU/RAM.
 */
export const testRunQueue = new PQueue({
  concurrency: config.TEST_RUN_QUEUE_CONCURRENCY,
});

/**
 * Keterangan: Named queue in-memory untuk job AI analysis (Fase 2).
 * Concurrency dikonfigurasi via env ANALYSIS_QUEUE_CONCURRENCY (default 3),
 * lebih tinggi dari testRunQueue karena panggilan ke provider AI lebih ringan
 * CPU dibanding menjalankan browser automation.
 */
export const analysisQueue = new PQueue({
  concurrency: config.ANALYSIS_QUEUE_CONCURRENCY,
});

/**
 * Keterangan: Handler job test_run — memanggil executor Playwright
 * sungguhan (Step 9). `executeTestRun` sudah menangani seluruh error di
 * dalam dirinya sendiri (tidak pernah throw), jadi satu job gagal tidak
 * menghentikan worker queue.
 */
async function handleTestRunJob(job: TestRunJob): Promise<void> {
  await executeTestRun(job.testRunId);
}

/**
 * Keterangan: Handler job analysis — untuk sekarang masih placeholder
 * (console.log saja). Pemanggilan AI provider untuk analisis hasil test run
 * sungguhan akan diisi di Step 19.
 */
async function handleAnalysisJob(job: AnalysisJob): Promise<void> {
  console.log(
    `[analysisQueue] Placeholder — akan menganalisis test run "${job.testRunId}" (lihat Step 19)`,
  );
}

/**
 * Keterangan: Push job eksekusi test case ke testRunQueue. Bersifat
 * fire-and-forget (tidak menunggu job selesai) — pemanggil (route API)
 * langsung lanjut tanpa terblokir oleh eksekusi job.
 */
export function enqueueTestRun(testRunId: string): void {
  const job: TestRunJob = { type: 'test_run', testRunId };
  void testRunQueue.add(() => handleTestRunJob(job));
}

/**
 * Keterangan: Push job AI analysis ke analysisQueue. Bersifat fire-and-forget,
 * biasanya dipanggil setelah satu test run selesai dieksekusi (Step 9/19).
 */
export function enqueueAnalysis(testRunId: string): void {
  const job: AnalysisJob = { type: 'analysis', testRunId };
  void analysisQueue.add(() => handleAnalysisJob(job));
}

export interface QueueStats {
  /** Jumlah job yang sedang berjalan (sudah dapat slot concurrency). */
  running: number;
  /** Jumlah job yang masih menunggu slot concurrency kosong. */
  waiting: number;
}

/**
 * Keterangan: Mengambil jumlah job running & waiting saat ini di
 * testRunQueue dan analysisQueue — dipakai untuk monitoring/observability.
 */
export function getQueueStats(): { testRun: QueueStats; analysis: QueueStats } {
  return {
    testRun: { running: testRunQueue.pending, waiting: testRunQueue.size },
    analysis: { running: analysisQueue.pending, waiting: analysisQueue.size },
  };
}

/**
 * Keterangan: Dipanggil sekali saat server startup. Job in-memory hilang
 * setiap kali proses restart (trade-off MVP, lihat spesifikasi bagian 7
 * baris "Persistensi job"), jadi test_run yang statusnya masih 'running'
 * ATAU 'queued' dari sesi sebelumnya di-mark 'error' agar tidak menggantung
 * selamanya di UI. Mengembalikan jumlah test_run yang di-recover.
 */
export async function recoverStaleRunningTestRuns(): Promise<number> {
  const [staleRunning, staleQueued] = await Promise.all([
    testRunRepository.findAll({ status: 'running' }),
    testRunRepository.findAll({ status: 'queued' }),
  ]);
  const staleRuns = [...staleRunning, ...staleQueued];

  for (const run of staleRuns) {
    await testRunRepository.update(run.id, {
      status: 'error',
      finishedAt: new Date(),
    });
  }

  if (staleRuns.length > 0) {
    console.log(
      `[queue] ${staleRuns.length} test_run berstatus 'running'/'queued' dari sesi sebelumnya di-mark 'error' (server restart).`,
    );
  }

  return staleRuns.length;
}
