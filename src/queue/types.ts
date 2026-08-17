/**
 * Keterangan: Job untuk mengeksekusi satu test run (Playwright) — dipush ke
 * testRunQueue. Eksekusi sungguhan diisi di Step 9 (runner/executor.ts).
 */
export interface TestRunJob {
  type: 'test_run';
  testRunId: string;
}

/**
 * Keterangan: Job untuk menjalankan AI analysis atas satu test run — dipush
 * ke analysisQueue dan diproses oleh analyzer.service.ts.
 */
export interface AnalysisJob {
  type: 'analysis';
  testRunId: string;
}

/**
 * Keterangan: Union semua tipe job yang dikenal oleh in-memory queue.
 */
export type QueueJob = TestRunJob | AnalysisJob;
