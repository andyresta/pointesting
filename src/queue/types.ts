import type { GenerateAuthPrefill } from '../generator/generator.service';

/**
 * Keterangan: Job untuk mengeksekusi satu test run (Playwright) — dipush ke
 * testRunQueue. Eksekusi sungguhan diisi di Step 9 (runner/executor.ts).
 */
export interface TestRunJob {
  type: 'test_run';
  testRunId: string;
}

/**
 * Keterangan: Job menjalankan beberapa test case berurutan dalam satu sesi
 * browser Playwright (context/cookie shared) dengan live view suiteRunId.
 */
export interface TestSuiteRunJob {
  type: 'test_suite';
  suiteRunId: string;
  projectId: string;
  testCaseIds: string[];
}

export interface TestSessionRunJob {
  type: 'test_session_run';
  sessionId: string;
  testCaseId: string;
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
 * Keterangan: Job Suite Analysis — analisis AI lintas-fitur setelah SEMUA
 * test run dalam satu suite selesai dianalisis individual. Dipush otomatis
 * oleh countdown-latch di queue.ts (bukan langsung dari executor), diproses
 * oleh suite-analysis.service.ts.
 */
export interface SuiteAnalysisJob {
  type: 'suite_analysis';
  suiteRunId: string;
  projectId: string;
  testRunIds: string[];
}

/**
 * Keterangan: Job generate test case via AI + live Playwright — dipush ke
 * testRunQueue karena memakai browser (berat, sama seperti test run).
 * authPrefill.values hanya hidup di memory selama proses generate berjalan.
 */
export interface GenerateJob {
  type: 'generate';
  generateId: string;
  projectId: string;
  prompt: string;
  extraData?: string;
  authPrefill?: GenerateAuthPrefill | null;
  replaceExisting?: boolean;
}

/**
 * Keterangan: Job guided single-flow generate (Tambah Test Case via prompt
 * AI) — dipush ke testRunQueue yang sama dengan GenerateJob karena sama-sama
 * memakai browser (berat). Beda dari GenerateJob: scope satu alur/satu test
 * case (bukan crawl+authoring seluruh situs), DAN dijalankan di dalam sesi
 * Playwright persisten yang sudah ada (sessionId, panel "Live run" kanan) —
 * bukan browser baru, sehingga tidak butuh authPrefill (cookie/login sesi
 * yang sudah ada dipakai langsung).
 */
export interface GuidedGenerateJob {
  type: 'guided_generate';
  generateId: string;
  projectId: string;
  prompt: string;
  sessionId: string;
  /** Kalau diisi: mode edit — hasil akhir meng-update test case ini, bukan membuat baru. */
  testCaseId?: string;
}

/**
 * Keterangan: Union semua tipe job yang dikenal oleh in-memory queue.
 */
export type QueueJob =
  | TestRunJob
  | TestSuiteRunJob
  | TestSessionRunJob
  | AnalysisJob
  | SuiteAnalysisJob
  | GenerateJob
  | GuidedGenerateJob;
