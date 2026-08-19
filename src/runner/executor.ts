import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Video,
} from '@playwright/test';
import { projectRepository } from '../db/repositories/project.repository';
import { testCaseRepository } from '../db/repositories/test-case.repository';
import { testRunRepository } from '../db/repositories/test-run.repository';
import { testStepResultRepository } from '../db/repositories/test-step-result.repository';
import type { TestRunStatus } from '../db/repositories/types';
import {
  addSuiteAnalysisTestRun,
  beginSuiteAnalysisTracking,
  discardSuiteAnalysisTracking,
  enqueueAnalysis,
  enqueueSuiteAnalysis,
  sealSuiteAnalysisTracking,
} from '../queue/queue';
import { broadcastToRun } from '../ws/gateway';
import { PlaywrightPageDriver } from './page-driver';
import { collectArtifacts } from './reporter';
import {
  startScreencast,
  type ScreencastController,
} from './screencast';
import { executeSteps } from './testcase-compiler';
import type { Step, StepExecutionResult } from './types';

const VIEWPORT = { width: 1280, height: 720 };

interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp: string;
}

interface NetworkLogEntry {
  url: string;
  method: string;
  status: number;
  responseTimeMs: number;
  timestamp: string;
}

interface RequestTiming {
  startedAt: number;
  timestamp: string;
}

/**
 * Keterangan: Membuat folder temp khusus satu test run untuk video, trace,
 * console log, dan network log sebelum dikumpulkan ke storage final.
 */
function createTempRunDir(testRunId: string): string {
  const dir = path.join(os.tmpdir(), 'ai-testing-tool-runs', testRunId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Keterangan: Memasang listener console dan network sebelum steps dijalankan.
 * Request timing dipasangkan lewat object Request agar request paralel ke URL
 * yang sama tetap menghasilkan responseTimeMs yang tepat.
 */
function attachPageLogListeners(
  page: Page,
  consoleLogs: ConsoleLogEntry[],
  networkLogs: NetworkLogEntry[],
): void {
  const requestTimings = new Map<Request, RequestTiming>();

  page.on('console', (message) => {
    consoleLogs.push({
      type: message.type(),
      text: message.text(),
      timestamp: new Date().toISOString(),
    });
  });

  page.on('request', (request) => {
    requestTimings.set(request, {
      startedAt: Date.now(),
      timestamp: new Date().toISOString(),
    });
  });

  page.on('response', (response) => {
    const request = response.request();
    const timing = requestTimings.get(request);
    const finishedAt = Date.now();

    networkLogs.push({
      url: request.url(),
      method: request.method(),
      status: response.status(),
      responseTimeMs: timing ? finishedAt - timing.startedAt : 0,
      timestamp: timing?.timestamp ?? new Date(finishedAt).toISOString(),
    });
    requestTimings.delete(request);
  });

  page.on('requestfailed', (request) => {
    const timing = requestTimings.get(request);
    const finishedAt = Date.now();

    networkLogs.push({
      url: request.url(),
      method: request.method(),
      status: 0,
      responseTimeMs: timing ? finishedAt - timing.startedAt : 0,
      timestamp: timing?.timestamp ?? new Date(finishedAt).toISOString(),
    });
    requestTimings.delete(request);
  });
}

/**
 * Keterangan: Menulis console/network log sebagai JSON terstruktur ke temp
 * directory yang sama dengan video dan trace untuk diproses reporter.
 */
async function writeStructuredLogs(
  consoleLogPath: string,
  networkLogPath: string,
  consoleLogs: ConsoleLogEntry[],
  networkLogs: NetworkLogEntry[],
): Promise<void> {
  await Promise.all([
    fs.promises.writeFile(consoleLogPath, JSON.stringify(consoleLogs, null, 2)),
    fs.promises.writeFile(networkLogPath, JSON.stringify(networkLogs, null, 2)),
  ]);
}

/**
 * Keterangan: Menyimpan satu hasil step lalu langsung broadcast run:step,
 * sehingga dashboard menerima progres real-time setelah tiap step selesai.
 */
async function saveStepResult(
  testRunId: string,
  result: StepExecutionResult,
  broadcast?: { runId: string; testCaseId?: string },
): Promise<void> {
  await testStepResultRepository.create({
    testRunId,
    stepIndex: result.index,
    action: result.action,
    status: result.status,
    errorMessage: result.errorMessage,
    durationMs: result.durationMs,
  });
  broadcastToRun(broadcast?.runId ?? testRunId, {
    type: 'run:step',
    runId: broadcast?.runId ?? testRunId,
    stepIndex: result.index,
    action: result.action,
    status: result.status,
    testCaseId: broadcast?.testCaseId,
    testRunId,
  });
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
 * Keterangan: Menandai test_run sebagai error terminal beserta broadcast agar
 * dashboard/late subscriber tidak menggantung bila lifecycle gagal di tengah jalan.
 */
async function markTestRunError(
  testRunId: string,
  startedAt: Date | undefined,
): Promise<void> {
  const finishedAt = new Date();
  await testRunRepository.update(testRunId, {
    status: 'error',
    finishedAt,
    ...(startedAt
      ? { durationMs: finishedAt.getTime() - startedAt.getTime() }
      : {}),
  });
  broadcastToRun(testRunId, {
    type: 'run:status',
    runId: testRunId,
    status: 'error',
  });
}

/**
 * Keterangan: Alur inti satu eksekusi test_run sesuai sequence 6.1 — buka
 * browser+context (video & trace aktif), jalankan steps via testcase-compiler
 * (Step 8), simpan hasil tiap step, lalu tutup context/browser. Browser dan
 * context SELALU ditutup di blok finally supaya tidak ada proses browser yang
 * menggantung walau terjadi error tak terduga (mis. crash saat eksekusi step).
 * Seluruh lifecycle setelah row ditemukan dibungkus failure boundary agar status
 * tidak bisa tertinggal queued/running tanpa event terminal.
 */
async function runTestRun(testRunId: string): Promise<void> {
  const testRun = await testRunRepository.findById(testRunId);
  if (!testRun) {
    console.error(`[executor] test_run "${testRunId}" tidak ditemukan, eksekusi dibatalkan`);
    return;
  }

  let startedAt: Date | undefined;
  let finalStatus: TestRunStatus | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let screencast: ScreencastController | undefined;
  let video: Video | null = null;
  let videoPath: string | undefined;
  let tracingStarted = false;
  let traceAvailable = false;
  let tempDir: string | undefined;
  let consoleLogPath: string | undefined;
  let networkLogPath: string | undefined;
  let consoleLogs: ConsoleLogEntry[] = [];
  let networkLogs: NetworkLogEntry[] = [];
  let tracePath: string | undefined;

  try {
    const testCase = await testCaseRepository.findById(testRun.testCaseId);
    if (!testCase) {
      throw new Error(
        `test_case "${testRun.testCaseId}" untuk test_run "${testRunId}" tidak ditemukan`,
      );
    }

    const project = await projectRepository.findById(testCase.projectId);
    if (!project) {
      throw new Error(
        `project "${testCase.projectId}" untuk test_case "${testCase.id}" tidak ditemukan`,
      );
    }

    startedAt = new Date();
    await testRunRepository.update(testRunId, { status: 'running', startedAt });
    broadcastToRun(testRunId, {
      type: 'run:status',
      runId: testRunId,
      status: 'running',
    });

    tempDir = createTempRunDir(testRunId);
    tracePath = path.join(tempDir, 'trace.zip');
    consoleLogPath = path.join(tempDir, 'console-log.json');
    networkLogPath = path.join(tempDir, 'network-log.json');

    browser = await chromium.launch();
    context = await browser.newContext({
      recordVideo: { dir: tempDir },
      viewport: VIEWPORT,
      // Keterangan: baseURL project memungkinkan step goto relatif seperti
      // "/login" sesuai kontrak spesifikasi bagian 4.1.
      ...(project.baseUrl ? { baseURL: project.baseUrl } : {}),
    });

    const page = await context.newPage();
    video = page.video();
    attachPageLogListeners(page, consoleLogs, networkLogs);
    screencast = await startScreencast(page, testRunId);

    await context.tracing.start({ screenshots: true, snapshots: true });
    tracingStarted = true;

    const steps = (testCase.steps as unknown as Step[]) ?? [];
    // Keterangan: Persist + broadcast callback dijalankan compiler segera
    // setelah masing-masing step selesai, bukan setelah seluruh test berakhir.
    const onStepComplete = async (result: StepExecutionResult): Promise<void> => {
      await saveStepResult(testRunId, result);
    };
    const stepResults = await executeSteps(new PlaywrightPageDriver(page), steps, onStepComplete);

    await context.tracing.stop({ path: tracePath });
    tracingStarted = false;
    traceAvailable = true;

    finalStatus = computeFinalStatus(stepResults);
  } catch (error) {
    console.error(`[executor] Error tak terduga saat eksekusi test_run "${testRunId}":`, error);
    finalStatus = 'error';
  } finally {
    if (screencast) {
      await screencast
        .stop()
        .catch((screencastError) =>
          console.error(
            `[executor] Gagal menghentikan screencast test_run "${testRunId}":`,
            screencastError,
          ),
        );
    }
    if (context) {
      if (tracingStarted && tracePath) {
        await context.tracing
          .stop({ path: tracePath })
          .then(() => {
            traceAvailable = true;
          })
          .catch(() => undefined);
      }
      await context
        .close()
        .catch((closeError) =>
          console.error(`[executor] Gagal menutup context test_run "${testRunId}":`, closeError),
        );
    }
    if (video) {
      await video
        .path()
        .then((resolvedPath) => {
          videoPath = resolvedPath;
        })
        .catch((videoError) => {
          finalStatus = 'error';
          console.error(
            `[executor] Gagal mendapatkan video test_run "${testRunId}":`,
            videoError,
          );
        });
    }
    if (browser) {
      await browser
        .close()
        .catch((closeError) =>
          console.error(`[executor] Gagal menutup browser test_run "${testRunId}":`, closeError),
        );
    }
  }

  if (consoleLogPath && networkLogPath) {
    try {
      await writeStructuredLogs(
        consoleLogPath,
        networkLogPath,
        consoleLogs,
        networkLogs,
      );
      await collectArtifacts(testRunId, {
        video: videoPath,
        trace: traceAvailable && tracePath ? tracePath : undefined,
        consoleLog: consoleLogPath,
        networkLog: networkLogPath,
      });
    } catch (artifactError) {
      finalStatus = 'error';
      console.error(
        `[executor] Gagal mengumpulkan artifact test_run "${testRunId}":`,
        artifactError,
      );
    }
  }

  const finishedAt = new Date();
  const statusToPersist = finalStatus ?? 'error';
  let persistedFinalStatus: TestRunStatus | undefined;
  try {
    await testRunRepository.update(testRunId, {
      status: statusToPersist,
      finishedAt,
      durationMs: startedAt
        ? finishedAt.getTime() - startedAt.getTime()
        : undefined,
    });
    broadcastToRun(testRunId, {
      type: 'run:status',
      runId: testRunId,
      status: statusToPersist,
    });
    persistedFinalStatus = statusToPersist;
  } catch (updateError) {
    console.error(`[executor] Gagal update status akhir test_run "${testRunId}":`, updateError);
    try {
      await markTestRunError(testRunId, startedAt);
      persistedFinalStatus = 'error';
    } catch (markError) {
      console.error(
        `[executor] Gagal menandai error terminal test_run "${testRunId}":`,
        markError,
      );
    }
  }

  if (persistedFinalStatus) {
    enqueueAnalysis(testRunId);
  }

  console.log(
    `[executor] test_run "${testRunId}" selesai dengan status "${persistedFinalStatus ?? statusToPersist}" (artifact di storage/artifacts/${testRunId})`,
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

export interface SharedContextRunOptions {
  liveRunId: string;
  projectId: string;
  testCaseId: string;
  testRunId: string;
  context: BrowserContext;
  caseIndex: number;
  caseTotal: number;
  getScreencast: () => ScreencastController | undefined;
  setScreencast: (controller: ScreencastController | undefined) => void;
  shouldAbort?: () => boolean;
  registerPage?: (page: Page | undefined) => void;
}

interface SuiteHandle {
  abortRequested: boolean;
  currentPage?: Page;
}

const suiteHandles = new Map<string, SuiteHandle>();

/**
 * Keterangan: Mendaftarkan suite run ke registry abort sebelum job queue mulai
 * supaya tombol Stop bisa dipakai sejak status queued.
 */
export function registerTestRunSuite(suiteRunId: string): void {
  if (!suiteHandles.has(suiteRunId)) {
    suiteHandles.set(suiteRunId, { abortRequested: false });
  }
}

/**
 * Keterangan: Menghentikan paksa suite run yang sedang jalan — page aktif
 * ditutup agar step Playwright tidak menggantung, sisa test case dilewati.
 */
export function abortTestRunSuite(suiteRunId: string): boolean {
  const handle = suiteHandles.get(suiteRunId);
  if (!handle) {
    return false;
  }
  handle.abortRequested = true;
  void handle.currentPage?.close().catch(() => undefined);
  return true;
}

/**
 * Keterangan: Menjalankan satu test case di browser context yang sudah ada
 * (dipakai suite run dan sesi persisten halaman test case).
 */
export async function runTestCaseInBrowserContext(
  options: SharedContextRunOptions,
): Promise<TestRunStatus> {
  const {
    liveRunId,
    projectId,
    testCaseId,
    testRunId,
    context,
    caseIndex,
    caseTotal,
    getScreencast,
    setScreencast,
    shouldAbort,
    registerPage,
  } = options;

  const testCase = await testCaseRepository.findById(testCaseId);
  if (!testCase || testCase.projectId !== projectId) {
    return 'error';
  }
  if (shouldAbort?.()) {
    return 'error';
  }

  const tempDir = createTempRunDir(testRunId);
  const tracePath = path.join(tempDir, 'trace.zip');
  const consoleLogPath = path.join(tempDir, 'console-log.json');
  const networkLogPath = path.join(tempDir, 'network-log.json');
  const consoleLogs: ConsoleLogEntry[] = [];
  const networkLogs: NetworkLogEntry[] = [];
  let page: Page | undefined;
  let video: Video | null = null;
  let videoPath: string | undefined;
  let tracingStarted = false;
  let traceAvailable = false;
  let caseStatus: TestRunStatus = 'error';

  try {
    page = await context.newPage();
    registerPage?.(page);
    video = page.video();
    attachPageLogListeners(page, consoleLogs, networkLogs);

    const existingScreencast = getScreencast();
    if (existingScreencast) {
      await existingScreencast.stop().catch(() => undefined);
    }
    setScreencast(await startScreencast(page, liveRunId));

    await context.tracing.start({ screenshots: true, snapshots: true });
    tracingStarted = true;

    const steps = (testCase.steps as unknown as Step[]) ?? [];
    const onStepComplete = async (result: StepExecutionResult): Promise<void> => {
      await saveStepResult(testRunId, result, {
        runId: liveRunId,
        testCaseId,
      });
    };
    const stepResults = await executeSteps(
      new PlaywrightPageDriver(page),
      steps,
      onStepComplete,
      shouldAbort,
    );

    await context.tracing.stop({ path: tracePath });
    tracingStarted = false;
    traceAvailable = true;
    caseStatus = shouldAbort?.() ? 'error' : computeFinalStatus(stepResults);
  } catch (error) {
    if (shouldAbort?.()) {
      caseStatus = 'error';
    } else {
      console.error(
        `[executor] Error saat shared-context test_run "${testRunId}" (case ${testCaseId}):`,
        error,
      );
      caseStatus = 'error';
    }
  } finally {
    registerPage?.(undefined);
    if (page && tracingStarted && tracePath) {
      await context.tracing
        .stop({ path: tracePath })
        .then(() => {
          traceAvailable = true;
        })
        .catch(() => undefined);
    }
    if (page) {
      await page.close().catch(() => undefined);
    }
    if (video) {
      await video
        .path()
        .then((resolvedPath) => {
          videoPath = resolvedPath;
        })
        .catch(() => undefined);
    }
  }

  try {
    await writeStructuredLogs(
      consoleLogPath,
      networkLogPath,
      consoleLogs,
      networkLogs,
    );
    await collectArtifacts(testRunId, {
      video: videoPath,
      trace: traceAvailable && tracePath ? tracePath : undefined,
      consoleLog: consoleLogPath,
      networkLog: networkLogPath,
    });
  } catch (artifactError) {
    caseStatus = 'error';
    console.error(
      `[executor] Gagal artifact shared-context test_run "${testRunId}":`,
      artifactError,
    );
  }

  return caseStatus;
}

/**
 * Keterangan: Menjalankan beberapa test case berurutan dalam satu browser
 * context Playwright agar sesi/cookie tetap hidup antar test case. Tiap test
 * case tetap punya test_run + artifact sendiri; live view memakai suiteRunId.
 */
export async function executeTestRunSuite(
  suiteRunId: string,
  projectId: string,
  testCaseIds: string[],
): Promise<void> {
  if (testCaseIds.length === 0) {
    broadcastToRun(suiteRunId, {
      type: 'run:status',
      runId: suiteRunId,
      status: 'error',
    });
    return;
  }

  const project = await projectRepository.findById(projectId);
  if (!project) {
    broadcastToRun(suiteRunId, {
      type: 'run:status',
      runId: suiteRunId,
      status: 'error',
    });
    return;
  }

  const suiteStartedAt = new Date();
  broadcastToRun(suiteRunId, {
    type: 'run:status',
    runId: suiteRunId,
    status: 'running',
  });

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let screencast: ScreencastController | undefined;
  const suiteHandle = suiteHandles.get(suiteRunId) ?? { abortRequested: false };
  suiteHandles.set(suiteRunId, suiteHandle);
  if (suiteHandle.abortRequested) {
    suiteHandles.delete(suiteRunId);
    broadcastToRun(suiteRunId, {
      type: 'run:suite-done',
      runId: suiteRunId,
      status: 'error',
      results: [],
    });
    broadcastToRun(suiteRunId, {
      type: 'run:status',
      runId: suiteRunId,
      status: 'error',
    });
    return;
  }
  const suiteResults: Array<{
    testCaseId: string;
    testRunId: string;
    status: TestRunStatus;
  }> = [];
  let suiteFinalStatus: TestRunStatus = 'passed';
  beginSuiteAnalysisTracking(suiteRunId, projectId);

  try {
    browser = await chromium.launch();
    const suiteVideoDir = path.join(os.tmpdir(), 'ai-testing-tool-runs', suiteRunId);
    fs.mkdirSync(suiteVideoDir, { recursive: true });
    context = await browser.newContext({
      recordVideo: { dir: suiteVideoDir },
      viewport: VIEWPORT,
      ...(project.baseUrl ? { baseURL: project.baseUrl } : {}),
    });

    for (let caseIndex = 0; caseIndex < testCaseIds.length; caseIndex += 1) {
      if (suiteHandle.abortRequested) {
        suiteFinalStatus = 'error';
        break;
      }
      const testCaseId = testCaseIds[caseIndex];
      if (!testCaseId) {
        suiteFinalStatus = 'error';
        continue;
      }
      const testCase = await testCaseRepository.findById(testCaseId);
      if (!testCase || testCase.projectId !== projectId) {
        suiteFinalStatus = 'error';
        continue;
      }

      const testRun = await testRunRepository.create({
        testCaseId,
        status: 'queued',
      });
      const testRunId = testRun.id;
      addSuiteAnalysisTestRun(suiteRunId, testRunId);
      const caseStartedAt = new Date();

      broadcastToRun(suiteRunId, {
        type: 'run:suite-case',
        runId: suiteRunId,
        testCaseId,
        testRunId,
        status: 'running',
        caseIndex,
        caseTotal: testCaseIds.length,
      });

      await testRunRepository.update(testRunId, {
        status: 'running',
        startedAt: caseStartedAt,
      });

      const caseStatus = await runTestCaseInBrowserContext({
        liveRunId: suiteRunId,
        projectId,
        testCaseId,
        testRunId,
        context,
        caseIndex,
        caseTotal: testCaseIds.length,
        getScreencast: () => screencast,
        setScreencast: (controller) => {
          screencast = controller;
        },
        shouldAbort: () => suiteHandle.abortRequested,
        registerPage: (activePage) => {
          suiteHandle.currentPage = activePage;
        },
      });

      const caseFinishedAt = new Date();
      await testRunRepository.update(testRunId, {
        status: caseStatus,
        finishedAt: caseFinishedAt,
        durationMs: caseFinishedAt.getTime() - caseStartedAt.getTime(),
      });
      broadcastToRun(testRunId, {
        type: 'run:status',
        runId: testRunId,
        status: caseStatus,
      });
      broadcastToRun(suiteRunId, {
        type: 'run:suite-case',
        runId: suiteRunId,
        testCaseId,
        testRunId,
        status: caseStatus,
        caseIndex,
        caseTotal: testCaseIds.length,
      });

      suiteResults.push({ testCaseId, testRunId, status: caseStatus });
      if (caseStatus !== 'passed') {
        suiteFinalStatus = caseStatus === 'error' ? 'error' : 'failed';
      }
      if (!suiteHandle.abortRequested) {
        enqueueAnalysis(testRunId);
      }
    }
  } catch (error) {
    console.error(`[executor] Suite "${suiteRunId}" gagal:`, error);
    suiteFinalStatus = 'error';
  } finally {
    if (screencast) {
      await screencast.stop().catch(() => undefined);
    }
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    if (suiteHandle.abortRequested) {
      // Suite dihentikan paksa — tidak akan pernah lengkap, buang tracking
      // supaya tidak menggantung selamanya menunggu id yang tidak akan datang.
      discardSuiteAnalysisTracking(suiteRunId);
    } else {
      const finalized = sealSuiteAnalysisTracking(suiteRunId);
      if (finalized) {
        enqueueSuiteAnalysis(finalized.projectId, suiteRunId, finalized.testRunIds);
      }
    }
    suiteHandles.delete(suiteRunId);
  }

  broadcastToRun(suiteRunId, {
    type: 'run:suite-done',
    runId: suiteRunId,
    status: suiteFinalStatus,
    results: suiteResults,
  });
  broadcastToRun(suiteRunId, {
    type: 'run:status',
    runId: suiteRunId,
    status: suiteFinalStatus,
  });

  console.log(
    `[executor] suite "${suiteRunId}" selesai status="${suiteFinalStatus}" (${suiteResults.length} test case, ${Date.now() - suiteStartedAt.getTime()}ms)`,
  );
}
