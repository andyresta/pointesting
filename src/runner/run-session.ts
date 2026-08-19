import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { projectRepository } from '../db/repositories/project.repository';
import { testCaseRepository } from '../db/repositories/test-case.repository';
import { testRunRepository } from '../db/repositories/test-run.repository';
import type { TestRunStatus } from '../db/repositories/types';
import { enqueueAnalysis } from '../queue/queue';
import { broadcastToRun } from '../ws/gateway';
import { runTestCaseInBrowserContext } from './executor';
import { startScreencast } from './screencast';

const VIEWPORT = { width: 1280, height: 720 };

interface RunSession {
  sessionId: string;
  projectId: string;
  browser: Browser;
  context: BrowserContext;
  screencast?: import('./screencast').ScreencastController;
  videoDir: string;
  busy: boolean;
  abortRequested: boolean;
  currentPage?: import('@playwright/test').Page;
  activeTestRunId?: string;
}

const sessions = new Map<string, RunSession>();

/**
 * Keterangan: Membuka sesi Playwright persisten untuk satu project — browser
 * context tetap hidup antar run test case individual di halaman test case.
 */
export async function createRunSession(projectId: string): Promise<string> {
  const project = await projectRepository.findById(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" tidak ditemukan`);
  }

  const sessionId = randomUUID();
  const browser = await chromium.launch();
  const videoDir = path.join(os.tmpdir(), 'ai-testing-tool-runs', `session-${sessionId}`);
  fs.mkdirSync(videoDir, { recursive: true });
  const context = await browser.newContext({
    recordVideo: { dir: videoDir },
    viewport: VIEWPORT,
    ...(project.baseUrl ? { baseURL: project.baseUrl } : {}),
  });

  // Keterangan: Untuk test-cases workspace, preview harus tampil langsung
  // mengikuti URL baseUrl tanpa menunggu klik "Run".
  const page = await context.newPage();
  const screencast = await startScreencast(page, sessionId, {
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
  });

  sessions.set(sessionId, {
    sessionId,
    projectId,
    browser,
    context,
    videoDir,
    busy: false,
    abortRequested: false,
    screencast,
    currentPage: page,
  });

  broadcastToRun(sessionId, {
    type: 'run:status',
    runId: sessionId,
    status: 'running',
  });

  // Keterangan: Navigasi dilakukan "best-effort" agar preview segera
  // terlihat; error navigasi tidak mematikan sesi (user bisa retry via Run).
  void (async () => {
    if (!project.baseUrl?.trim()) {
      return;
    }
    await page
      .goto(project.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch(() => undefined);
  })();

  return sessionId;
}

/**
 * Keterangan: Mengembalikan sesi aktif bila masih ada di memory.
 */
export function getRunSession(sessionId: string): RunSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Keterangan: Apakah sesi sedang menjalankan satu test case.
 */
export function isRunSessionBusy(sessionId: string): boolean {
  return sessions.get(sessionId)?.busy ?? false;
}

/**
 * Keterangan: Menghentikan paksa test case yang sedang jalan di sesi tanpa
 * menutup browser — cookie/login tetap hidup untuk run berikutnya.
 */
export async function abortRunSession(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.abortRequested = true;
  if (session.currentPage) {
    await session.currentPage.close().catch(() => undefined);
  }
  return true;
}

/**
 * Keterangan: Menutup sesi Playwright persisten dan membersihkan registry memory.
 */
export async function closeRunSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  sessions.delete(sessionId);
  if (session.screencast) {
    await session.screencast.stop().catch(() => undefined);
  }
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);

  broadcastToRun(sessionId, {
    type: 'run:status',
    runId: sessionId,
    status: 'passed',
  });
}

export class RunSessionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunSessionUnavailableError';
  }
}

/**
 * Keterangan: Membuka page BARU di dalam context sesi persisten yang sudah
 * ada (cookie/login ikut karena context sama — page lama tetap dianggap
 * "diganti" sementara, persis pola runTestCaseInBrowserContext) untuk
 * dipakai modul lain (guided single-flow generate) yang butuh mengendalikan
 * Playwright TANPA membuka browser baru. Live view panel kanan otomatis
 * ikut menampilkan page baru ini karena screencast di-retarget dengan key
 * broadcast yang TETAP sessionId (subscriber lama tidak perlu resubscribe).
 */
export async function withSessionPage<T>(
  sessionId: string,
  work: (page: Page) => Promise<T>,
): Promise<T> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new RunSessionUnavailableError(`Sesi "${sessionId}" tidak ditemukan`);
  }
  if (session.busy) {
    throw new RunSessionUnavailableError(`Sesi "${sessionId}" sedang sibuk`);
  }

  session.busy = true;
  session.abortRequested = false;
  const page = await session.context.newPage();
  session.currentPage = page;

  const existingScreencast = session.screencast;
  if (existingScreencast) {
    await existingScreencast.stop().catch(() => undefined);
  }
  session.screencast = await startScreencast(page, sessionId);

  try {
    return await work(page);
  } finally {
    session.busy = false;
    session.currentPage = undefined;
    await page.close().catch(() => undefined);
  }
}

/**
 * Keterangan: Menjalankan satu test case di dalam sesi browser yang sudah
 * terbuka (cookie/login shared). Live view memakai sessionId.
 */
export async function executeSessionTestRun(
  sessionId: string,
  testRunId: string,
  testCaseId: string,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`[run-session] Sesi "${sessionId}" tidak ditemukan`);
    await testRunRepository.update(testRunId, {
      status: 'error',
      finishedAt: new Date(),
    });
    broadcastToRun(testRunId, {
      type: 'run:status',
      runId: testRunId,
      status: 'error',
    });
    return;
  }

  if (session.busy) {
    console.error(`[run-session] Sesi "${sessionId}" masih sibuk`);
    await testRunRepository.update(testRunId, {
      status: 'error',
      finishedAt: new Date(),
    });
    broadcastToRun(testRunId, {
      type: 'run:status',
      runId: testRunId,
      status: 'error',
    });
    return;
  }

  if (session.abortRequested) {
    session.abortRequested = false;
    await testRunRepository.update(testRunId, {
      status: 'error',
      finishedAt: new Date(),
    });
    broadcastToRun(testRunId, {
      type: 'run:status',
      runId: testRunId,
      status: 'error',
    });
    broadcastToRun(sessionId, {
      type: 'run:suite-case',
      runId: sessionId,
      testCaseId,
      testRunId,
      status: 'error',
      caseIndex: 0,
      caseTotal: 1,
    });
    return;
  }

  session.busy = true;
  session.activeTestRunId = testRunId;
  let caseStatus: TestRunStatus = 'error';

  try {
    const testCase = await testCaseRepository.findById(testCaseId);
    if (!testCase || testCase.projectId !== session.projectId) {
      throw new Error(`Test case "${testCaseId}" tidak valid untuk sesi ini`);
    }

    const caseStartedAt = new Date();
    await testRunRepository.update(testRunId, {
      status: 'running',
      startedAt: caseStartedAt,
    });

    broadcastToRun(sessionId, {
      type: 'run:suite-case',
      runId: sessionId,
      testCaseId,
      testRunId,
      status: 'running',
      caseIndex: 0,
      caseTotal: 1,
    });

    caseStatus = await runTestCaseInBrowserContext({
      liveRunId: sessionId,
      projectId: session.projectId,
      testCaseId,
      testRunId,
      context: session.context,
      caseIndex: 0,
      caseTotal: 1,
      getScreencast: () => session.screencast,
      setScreencast: (controller) => {
        session.screencast = controller;
      },
      shouldAbort: () => session.abortRequested,
      registerPage: (page) => {
        session.currentPage = page;
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
    broadcastToRun(sessionId, {
      type: 'run:suite-case',
      runId: sessionId,
      testCaseId,
      testRunId,
      status: caseStatus,
      caseIndex: 0,
      caseTotal: 1,
    });
    if (!session.abortRequested) {
      enqueueAnalysis(testRunId);
    }
  } catch (error) {
    console.error(`[run-session] Gagal menjalankan test_run "${testRunId}":`, error);
    caseStatus = 'error';
    await testRunRepository.update(testRunId, {
      status: 'error',
      finishedAt: new Date(),
    });
    broadcastToRun(testRunId, {
      type: 'run:status',
      runId: testRunId,
      status: 'error',
    });
    broadcastToRun(sessionId, {
      type: 'run:suite-case',
      runId: sessionId,
      testCaseId,
      testRunId,
      status: 'error',
      caseIndex: 0,
      caseTotal: 1,
    });
  } finally {
    session.busy = false;
    session.abortRequested = false;
    session.currentPage = undefined;
    session.activeTestRunId = undefined;
  }

  console.log(
    `[run-session] test_run "${testRunId}" selesai status="${caseStatus}" di sesi "${sessionId}"`,
  );
}
