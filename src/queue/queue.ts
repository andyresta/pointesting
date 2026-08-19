import PQueue from 'p-queue';
import { analyzeTestRun } from '../analyzer/analyzer.service';
import { config } from '../config/env';
import { testRunRepository } from '../db/repositories/test-run.repository';
import type {
  AnalysisJob,
  GenerateJob,
  GuidedGenerateJob,
  SuiteAnalysisJob,
  TestRunJob,
  TestSessionRunJob,
  TestSuiteRunJob,
} from './types';

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
 * sungguhan lewat import dinamis untuk menghindari circular dependency saat
 * executor mengantrekan analysis. Executor menangani error internal sendiri.
 */
async function handleTestRunJob(job: TestRunJob): Promise<void> {
  const { executeTestRun } = await import('../runner/executor.js');
  await executeTestRun(job.testRunId);
}

/**
 * Keterangan: Handler job suite — menjalankan banyak test case dalam satu sesi
 * browser Playwright lewat executor suite.
 */
async function handleTestSuiteRunJob(job: TestSuiteRunJob): Promise<void> {
  const { executeTestRunSuite } = await import('../runner/executor.js');
  await executeTestRunSuite(job.suiteRunId, job.projectId, job.testCaseIds);
}

/**
 * Keterangan: Handler job run test case di sesi browser persisten halaman test case.
 */
async function handleTestSessionRunJob(job: TestSessionRunJob): Promise<void> {
  const { executeSessionTestRun } = await import('../runner/run-session.js');
  await executeSessionTestRun(job.sessionId, job.testRunId, job.testCaseId);
}

/**
 * Keterangan: Countdown-latch in-memory yang tahu kapan SEMUA test run dalam
 * satu suite sudah selesai dianalisis individual, supaya Suite Analysis
 * (lintas-fitur) dipicu tepat saat itu — bukan polling berulang yang boros
 * dan ikut memakan slot concurrency analysisQueue. `testRunIds` bertambah
 * progresif selama suite loop berjalan (test_run dibuat satu per satu),
 * `sealed` menandai loop sudah selesai menambahkan semuanya; latch hanya
 * final ketika sealed DAN semua id di dalamnya sudah masuk `completed`.
 */
interface SuiteAnalysisTracking {
  projectId: string;
  testRunIds: string[];
  completed: Set<string>;
  sealed: boolean;
}

const suiteAnalysisTracking = new Map<string, SuiteAnalysisTracking>();

/**
 * Keterangan: Dipanggil executor sekali di awal suite run, sebelum test_run
 * pertama dibuat, supaya progressive tracking punya tempat menampung id.
 */
export function beginSuiteAnalysisTracking(suiteRunId: string, projectId: string): void {
  suiteAnalysisTracking.set(suiteRunId, {
    projectId,
    testRunIds: [],
    completed: new Set(),
    sealed: false,
  });
}

/**
 * Keterangan: Dipanggil executor setiap satu test_run baru dibuat di dalam
 * suite, sebelum test case itu selesai dieksekusi (mencegah race dengan
 * penyelesaian analysisnya sendiri yang bisa datang lebih dulu).
 */
export function addSuiteAnalysisTestRun(suiteRunId: string, testRunId: string): void {
  suiteAnalysisTracking.get(suiteRunId)?.testRunIds.push(testRunId);
}

function finalizeIfReady(
  suiteRunId: string,
): { suiteRunId: string; projectId: string; testRunIds: string[] } | null {
  const entry = suiteAnalysisTracking.get(suiteRunId);
  if (!entry || !entry.sealed || entry.completed.size < entry.testRunIds.length) {
    return null;
  }
  suiteAnalysisTracking.delete(suiteRunId);
  return { suiteRunId, projectId: entry.projectId, testRunIds: entry.testRunIds };
}

/**
 * Keterangan: Dipanggil executor setelah suite loop selesai (semua test_run
 * sudah dibuat, tidak akan bertambah lagi). Kalau semua analysis individual
 * kebetulan sudah selesai duluan (provider cepat, browser lambat), latch
 * langsung final di sini; kalau belum, `markSuiteAnalysisTestRunDone` yang
 * akan menyelesaikannya nanti. Suite tanpa test_run valid (`length===0`)
 * langsung dibuang, tidak ada yang perlu dianalisis.
 */
export function sealSuiteAnalysisTracking(
  suiteRunId: string,
): { suiteRunId: string; projectId: string; testRunIds: string[] } | null {
  const entry = suiteAnalysisTracking.get(suiteRunId);
  if (!entry) {
    return null;
  }
  entry.sealed = true;
  if (entry.testRunIds.length === 0) {
    suiteAnalysisTracking.delete(suiteRunId);
    return null;
  }
  return finalizeIfReady(suiteRunId);
}

/**
 * Keterangan: Dipanggil executor saat suite di-abort paksa oleh user — suite
 * yang sengaja dihentikan tidak perlu (dan tidak akan pernah lengkap untuk)
 * dianalisis lintas-fitur, jadi tracking dibuang langsung agar tidak
 * menggantung selamanya di memory.
 */
export function discardSuiteAnalysisTracking(suiteRunId: string): void {
  suiteAnalysisTracking.delete(suiteRunId);
}

/**
 * Keterangan: Dipanggil handleAnalysisJob setelah satu test run (anggota
 * suite manapun) selesai dianalisis — sukses maupun gagal tetap dihitung
 * "selesai diproses" supaya satu test case yang gagal dianalisis tidak
 * membuat Suite Analysis menggantung selamanya menunggu id yang tidak akan
 * pernah datang.
 */
export function markSuiteAnalysisTestRunDone(
  testRunId: string,
): { suiteRunId: string; projectId: string; testRunIds: string[] } | null {
  for (const [suiteRunId, entry] of suiteAnalysisTracking) {
    if (entry.testRunIds.includes(testRunId) && !entry.completed.has(testRunId)) {
      entry.completed.add(testRunId);
      return finalizeIfReady(suiteRunId);
    }
  }
  return null;
}

/**
 * Keterangan: Menjalankan analyzer sungguhan dengan failure boundary; error
 * provider/persistensi dicatat tetapi tidak diteruskan agar worker dan job
 * analysis lain tetap berjalan. Setelah itu, cek apakah test run ini adalah
 * anggota terakhir suatu suite yang belum selesai dianalisis — jika ya,
 * picu Suite Analysis (lintas-fitur) untuk suite tersebut.
 */
export async function handleAnalysisJob(
  job: AnalysisJob,
  analyze: (testRunId: string) => Promise<unknown> = analyzeTestRun,
): Promise<void> {
  try {
    await analyze(job.testRunId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[analysisQueue] Analisis test run "${job.testRunId}" gagal: ${message}`,
    );
  } finally {
    const finalized = markSuiteAnalysisTestRunDone(job.testRunId);
    if (finalized) {
      enqueueSuiteAnalysis(finalized.projectId, finalized.suiteRunId, finalized.testRunIds);
    }
  }
}

/**
 * Keterangan: Menjalankan Suite Analysis sungguhan dengan failure boundary
 * yang sama seperti analysis biasa — kegagalan tidak boleh menjatuhkan worker.
 */
async function handleSuiteAnalysisJob(job: SuiteAnalysisJob): Promise<void> {
  try {
    const { analyzeSuiteRun } = await import('../analyzer/suite-analysis.service.js');
    await analyzeSuiteRun({
      suiteRunId: job.suiteRunId,
      projectId: job.projectId,
      testRunIds: job.testRunIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[analysisQueue] Suite analysis "${job.suiteRunId}" gagal: ${message}`,
    );
  }
}

/**
 * Keterangan: Menjalankan generate test case dengan failure boundary; error
 * dikirim ke subscriber live panel dan tidak mematikan worker queue.
 */
export async function handleGenerateJob(job: GenerateJob): Promise<void> {
  try {
    const { generateTestCasesFromPrompt } = await import(
      '../generator/generator.service.js'
    );
    await generateTestCasesFromPrompt({
      projectId: job.projectId,
      prompt: job.prompt,
      extraData: job.extraData,
      generateId: job.generateId,
      authPrefill: job.authPrefill,
      replaceExisting: job.replaceExisting === true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[testRunQueue] Generate "${job.generateId}" gagal: ${message}`,
    );
    const { broadcastToRun } = await import('../ws/gateway.js');
    broadcastToRun(job.generateId, {
      type: 'generate:error',
      runId: job.generateId,
      message,
    });
  }
}

/**
 * Keterangan: Menjalankan guided single-flow generate (Tambah Test Case via
 * prompt AI) dengan failure boundary yang sama seperti handleGenerateJob —
 * error dikirim ke subscriber live panel, tidak mematikan worker queue.
 */
export async function handleGuidedGenerateJob(job: GuidedGenerateJob): Promise<void> {
  try {
    const { generateGuidedTestCase } = await import(
      '../generator/guided-flow.service.js'
    );
    await generateGuidedTestCase({
      projectId: job.projectId,
      prompt: job.prompt,
      generateId: job.generateId,
      sessionId: job.sessionId,
      testCaseId: job.testCaseId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[testRunQueue] Guided generate "${job.generateId}" gagal: ${message}`,
    );
    const { broadcastToRun } = await import('../ws/gateway.js');
    broadcastToRun(job.generateId, {
      type: 'generate:error',
      runId: job.generateId,
      message,
    });
  }
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
 * Keterangan: Push job suite test case (satu sesi browser) ke testRunQueue.
 * Fire-and-forget; route API balas 202 + suiteRunId untuk live WS.
 */
export function enqueueTestSuiteRun(
  suiteRunId: string,
  projectId: string,
  testCaseIds: string[],
): void {
  const job: TestSuiteRunJob = {
    type: 'test_suite',
    suiteRunId,
    projectId,
    testCaseIds,
  };
  void testRunQueue.add(() => handleTestSuiteRunJob(job));
}

/**
 * Keterangan: Push job run test case ke sesi browser persisten (satu context).
 */
export function enqueueSessionTestRun(
  sessionId: string,
  testCaseId: string,
  testRunId: string,
): void {
  const job: TestSessionRunJob = {
    type: 'test_session_run',
    sessionId,
    testCaseId,
    testRunId,
  };
  void testRunQueue.add(() => handleTestSessionRunJob(job));
}

/**
 * Keterangan: Push job generate test case ke testRunQueue (browser + AI).
 * Fire-and-forget; route API langsung balas 202 + generateId untuk live WS.
 */
export function enqueueGenerate(job: Omit<GenerateJob, 'type'>): void {
  const queued: GenerateJob = { type: 'generate', ...job };
  void testRunQueue.add(() => handleGenerateJob(queued));
}

/**
 * Keterangan: Push job guided single-flow generate ke testRunQueue (browser +
 * AI, scope satu test case). Fire-and-forget; route API langsung balas 202 +
 * generateId untuk live WS.
 */
export function enqueueGuidedGenerate(job: Omit<GuidedGenerateJob, 'type'>): void {
  const queued: GuidedGenerateJob = { type: 'guided_generate', ...job };
  void testRunQueue.add(() => handleGuidedGenerateJob(queued));
}

/**
 * Keterangan: Push job AI analysis ke analysisQueue. Bersifat fire-and-forget,
 * dipanggil executor setelah status terminal dan artifact selesai disimpan.
 */
export function enqueueAnalysis(testRunId: string): void {
  const job: AnalysisJob = { type: 'analysis', testRunId };
  void analysisQueue.add(() => handleAnalysisJob(job));
}

/**
 * Keterangan: Push job Suite Analysis ke analysisQueue. Dipanggil otomatis
 * oleh countdown-latch di atas (bukan dari route/executor langsung) tepat
 * saat test run terakhir dalam suite selesai dianalisis individual.
 */
export function enqueueSuiteAnalysis(
  projectId: string,
  suiteRunId: string,
  testRunIds: string[],
): void {
  const job: SuiteAnalysisJob = { type: 'suite_analysis', suiteRunId, projectId, testRunIds };
  void analysisQueue.add(() => handleSuiteAnalysisJob(job));
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
