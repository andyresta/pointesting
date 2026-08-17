import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from '@playwright/test';
import {
  AUTH_COOKIE_NAME,
  signAuthToken,
} from '../src/api/auth.middleware';
import { buildServer } from '../src/api/server';
import { config } from '../src/config/env';
import { pool } from '../src/db/client';
import { parseTrace } from '../src/analyzer/trace-parser';
import { buildAnalyzerInput } from '../src/analyzer/prompt-builder';
import {
  analyzerProviders,
} from '../src/analyzer/analyzer.service';
import type { AnalyzerProvider } from '../src/analyzer/provider.interface';
import { analysisQueue, testRunQueue } from '../src/queue/queue';

interface CreatedResource {
  id: string;
}

interface RunResponse {
  runId: string;
  status: string;
}

interface ArtifactResponse {
  id: string;
  type: string;
  filePath: string;
}

interface RunDetailResponse {
  status: string;
  artifacts: ArtifactResponse[];
  analysisResult: {
    status: string;
    provider: string;
    reason: string | null;
  } | null;
}

interface TestCaseListResponse {
  id: string;
  latestAnalysisResult: {
    status: string;
    provider: string;
  } | null;
}

interface ConsoleLogEntry {
  text: string;
}

interface NetworkLogEntry {
  url: string;
  status: number;
}

/**
 * Keterangan: Memastikan response API sukses dan mengembalikan JSON bertipe;
 * body error hanya dipakai lokal tanpa mencetak token/credential.
 */
async function readSuccessfulJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request gagal dengan status ${response.status}`);
  }
  return body;
}

/**
 * Keterangan: Menjalankan aplikasi web target lokal yang memiliki form dan
 * perubahan visual tertunda agar live screencast dapat diamati secara nyata.
 */
async function createTargetServer(): Promise<FastifyInstance> {
  const target = Fastify({ logger: false });
  target.get('/failure', async (_request, reply) => {
    reply.status(503);
    return { error: 'simulasi network anomaly' };
  });
  target.get('/login', async (_request, reply) => {
    reply.type('text/html');
    return `<!doctype html>
      <html lang="id">
        <head><meta charset="utf-8"><title>Target E2E</title></head>
        <body>
          <h1>Target Login E2E</h1>
          <input id="username" aria-label="Username">
          <input id="password" aria-label="Password" type="password">
          <button id="submit" type="button">Masuk</button>
          <div id="progress">Menunggu</div>
          <script>
            document.querySelector('#submit').addEventListener('click', () => {
              fetch('/failure').catch(() => undefined);
              let tick = 0;
              const timer = setInterval(() => {
                tick += 1;
                document.querySelector('#progress').textContent = 'Memproses ' + tick;
                document.body.style.backgroundColor =
                  tick % 2 === 0 ? '#eef4ff' : '#ffffff';
              }, 100);
              setTimeout(() => {
                clearInterval(timer);
                const success = document.createElement('p');
                success.id = 'success';
                success.textContent = 'Login demo berhasil';
                document.body.append(success);
                console.warn('e2e-warning');
                console.log('e2e-target-success');
              }, 1500);
            });
          </script>
        </body>
      </html>`;
  });
  return target;
}

/**
 * Keterangan: Memanggil API aplikasi dengan JWT internal tanpa mengekspos
 * token ke output terminal atau menyimpannya di source.
 */
async function callApi(
  baseUrl: string,
  token: string,
  endpoint: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

/**
 * Keterangan: Mengumpulkan exception JavaScript halaman dashboard agar error
 * runtime yang tidak terlihat oleh assertion UI tetap menggagalkan E2E.
 */
function collectPageErrors(page: Page, errors: string[]): void {
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
}

/**
 * Keterangan: Membuat provider deterministik untuk acceptance E2E agar alur
 * queue/analyzer/persistensi teruji tanpa memakai API key atau biaya vendor.
 */
function createE2eAnalyzerProvider(): AnalyzerProvider {
  return {
    name: 'claude',
    supportsImage: true,
    analyze: async (input) => {
      if (
        input.expected[0] !== 'Elemen #success muncul' ||
        !input.consoleLogSummary.includes('e2e-warning') ||
        !input.networkLogSummary.includes('status 503') ||
        input.traceSummary.totalActions < 5
      ) {
        throw new Error('Input analyzer otomatis tidak lengkap');
      }
      return {
        status: 'success',
        reason: 'Expected result dan bukti artifact sesuai.',
      };
    },
  };
}

/**
 * Keterangan: Menjalankan acceptance E2E dari dashboard sampai live frame,
 * empat artifact, lalu auto-analysis queue dan persistensi hasil Step 18–19.
 */
async function runPhaseOneE2e(): Promise<void> {
  const app = buildServer();
  const target = await createTargetServer();
  const originalClaudeProvider = analyzerProviders.claude;
  analyzerProviders.claude = createE2eAnalyzerProvider();
  let browser: Browser | undefined;
  let projectId: string | undefined;
  let runId: string | undefined;

  try {
    const [appUrl, targetUrl] = await Promise.all([
      app.listen({ host: '127.0.0.1', port: 0 }),
      target.listen({ host: '127.0.0.1', port: 0 }),
    ]);
    const token = signAuthToken(config.AUTH_USERNAME);

    const project = await readSuccessfulJson<CreatedResource>(
      await callApi(appUrl, token, '/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: `E2E Fase 1 ${Date.now()}`,
          baseUrl: targetUrl,
        }),
      }),
    );
    projectId = project.id;

    const testCase = await readSuccessfulJson<CreatedResource>(
      await callApi(appUrl, token, `/projects/${project.id}/test-cases`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Login target lokal melalui dashboard',
          steps: [
            { action: 'goto', url: '/login' },
            { action: 'fill', selector: '#username', value: 'demo-user' },
            { action: 'fill', selector: '#password', value: 'demo-value' },
            { action: 'click', selector: '#submit' },
            { action: 'waitFor', selector: '#success' },
          ],
          expected: ['Elemen #success muncul'],
        }),
      }),
    );

    browser = await chromium.launch();
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: AUTH_COOKIE_NAME,
        value: token,
        url: appUrl,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await context.addInitScript(
      ({ authToken }) => {
        sessionStorage.setItem('pointestingToken', authToken);
      },
      { authToken: token },
    );

    const page = await context.newPage();
    const pageErrors: string[] = [];
    collectPageErrors(page, pageErrors);
    await page.goto(`${appUrl}/dashboard`);
    const runButton = page.locator(
      `.run-button[data-test-case-id="${testCase.id}"]`,
    );
    await runButton.waitFor();

    const runResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/test-cases/${testCase.id}/run`),
    );
    await runButton.click();
    const run = await readSuccessfulJson<RunResponse>(await runResponsePromise);
    runId = run.runId;

    await page.locator('.live-frame').waitFor({ state: 'visible', timeout: 15_000 });
    await page
      .locator('.status-badge')
      .filter({ hasText: 'passed' })
      .waitFor({ timeout: 30_000 });
    await page.locator('.run-content video').waitFor({ timeout: 10_000 });
    await page.getByRole('link', { name: 'Download trace' }).waitFor({ timeout: 10_000 });
    await page
      .getByRole('link', { name: 'Download console log' })
      .waitFor({ timeout: 10_000 });
    await page
      .getByRole('link', { name: 'Download network log' })
      .waitFor({ timeout: 10_000 });
    const activeTestCase = page.locator(
      `.test-case[data-test-case-id="${testCase.id}"]`,
    );
    await activeTestCase
      .locator('.analysis-panel .analysis-status-success')
      .waitFor({ timeout: 15_000 });
    await activeTestCase
      .locator('.analysis-panel')
      .getByText('Expected result dan bukti artifact sesuai.')
      .waitFor();
    await activeTestCase
      .locator('.latest-analysis-summary .analysis-status-success')
      .waitFor();

    const detail = await readSuccessfulJson<RunDetailResponse>(
      await callApi(appUrl, token, `/test-runs/${run.runId}`),
    );
    if (detail.status !== 'passed') {
      throw new Error(`Status akhir bukan passed: ${detail.status}`);
    }

    const requiredTypes = ['video', 'trace', 'console_log', 'network_log'];
    const downloadedArtifacts = new Map<string, Buffer>();
    for (const type of requiredTypes) {
      const artifact = detail.artifacts.find((item) => item.type === type);
      if (!artifact) {
        throw new Error(`Artifact ${type} tidak ditemukan`);
      }
      const download = await callApi(
        appUrl,
        token,
        `/test-runs/${run.runId}/artifacts/${artifact.id}`,
      );
      const content = Buffer.from(await download.arrayBuffer());
      if (!download.ok || content.byteLength === 0) {
        throw new Error(`Artifact ${type} gagal diunduh atau kosong`);
      }
      downloadedArtifacts.set(type, content);
    }

    const consoleLogs = JSON.parse(
      downloadedArtifacts.get('console_log')!.toString('utf8'),
    ) as ConsoleLogEntry[];
    const networkLogs = JSON.parse(
      downloadedArtifacts.get('network_log')!.toString('utf8'),
    ) as NetworkLogEntry[];
    if (!consoleLogs.some((entry) => entry.text === 'e2e-target-success')) {
      throw new Error('Console artifact tidak memuat event target');
    }
    if (
      !networkLogs.some(
        (entry) => entry.url === `${targetUrl}/login` && entry.status === 200,
      )
    ) {
      throw new Error('Network artifact tidak memuat request target sukses');
    }
    if (
      downloadedArtifacts.get('trace')?.subarray(0, 2).toString() !== 'PK'
    ) {
      throw new Error('Artifact trace bukan file ZIP valid');
    }
    if (
      downloadedArtifacts.get('video')?.subarray(0, 4).toString('hex') !==
      '1a45dfa3'
    ) {
      throw new Error('Artifact video bukan WebM valid');
    }

    const trace = detail.artifacts.find((item) => item.type === 'trace');
    if (!trace) {
      throw new Error('Artifact trace tidak tersedia');
    }
    const traceSummary = await parseTrace(path.resolve(trace.filePath));
    if (traceSummary.totalActions < 5 || traceSummary.actions.length === 0) {
      throw new Error('TraceSummary tidak memuat action yang diharapkan');
    }
    const analyzerInput = await buildAnalyzerInput(run.runId);
    if (
      !analyzerInput.consoleLogSummary.includes('e2e-warning') ||
      !analyzerInput.networkLogSummary.includes('status 503') ||
      analyzerInput.expected[0] !== 'Elemen #success muncul'
    ) {
      throw new Error('AnalyzerInput tidak memuat ringkasan artifact yang tepat');
    }
    await testRunQueue.onIdle();
    await analysisQueue.onIdle();
    const analyzedDetail = await readSuccessfulJson<RunDetailResponse>(
      await callApi(appUrl, token, `/test-runs/${run.runId}`),
    );
    if (
      analyzedDetail.analysisResult?.status !== 'success' ||
      analyzedDetail.analysisResult.provider !== 'claude'
    ) {
      throw new Error('Analysis queue tidak menyimpan hasil provider otomatis');
    }
    await pool.query(
      `INSERT INTO analysis_result
         (test_run_id, status, detail, solution, provider, raw_response, created_at)
       VALUES ($1, 'bug', 'hasil lama', 'abaikan hasil lama', 'openai', $2, now() - interval '1 day')`,
      [run.runId, JSON.stringify({ source: 'older-e2e-result' })],
    );
    const listedTestCases = await readSuccessfulJson<TestCaseListResponse[]>(
      await callApi(appUrl, token, `/projects/${project.id}/test-cases`),
    );
    const listedTestCase = listedTestCases.find((item) => item.id === testCase.id);
    if (
      listedTestCase?.latestAnalysisResult?.status !== 'success' ||
      listedTestCase.latestAnalysisResult.provider !== 'claude'
    ) {
      throw new Error('List test case tidak memuat analysis terbaru');
    }

    await page.reload();
    await page
      .locator(
        `.test-case[data-test-case-id="${testCase.id}"] .latest-analysis-summary .analysis-status-success`,
      )
      .waitFor();
    if (pageErrors.length > 0) {
      throw new Error(`Dashboard memiliki error runtime: ${pageErrors.join('; ')}`);
    }

    console.log(
      JSON.stringify({
        status: detail.status,
        liveFrame: true,
        dashboardVideo: true,
        artifactTypes: requiredTypes,
        traceActions: traceSummary.totalActions,
        analyzerInput: true,
        analysisQueued: true,
        analysisProvider: analyzedDetail.analysisResult.provider,
        dashboardAnalysis: true,
        latestAnalysisApi: true,
      }),
    );

    await context.close();
  } finally {
    await Promise.all([
      testRunQueue.onIdle().catch(() => undefined),
      analysisQueue.onIdle().catch(() => undefined),
    ]);
    analyzerProviders.claude = originalClaudeProvider;
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    app.server.closeAllConnections();
    target.server.closeAllConnections();
    await Promise.all([
      app.close().catch(() => undefined),
      target.close().catch(() => undefined),
    ]);
    if (projectId) {
      await pool
        .query('DELETE FROM project WHERE id = $1', [projectId])
        .catch(() => undefined);
    }
    if (runId) {
      await rm(path.resolve('storage', 'artifacts', runId), {
        recursive: true,
        force: true,
      });
    }
    await pool.end();
  }
}

void runPhaseOneE2e().catch((error: unknown) => {
  console.error(
    '[e2e-phase1]',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
