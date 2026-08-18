import { config, type ProviderConfig, type ProviderName } from '../config/env';
import { analysisResultRepository } from '../db/repositories/analysis-result.repository';
import { projectProviderRepository } from '../db/repositories/project-provider.repository';
import { projectRepository } from '../db/repositories/project.repository';
import { testCaseRepository } from '../db/repositories/test-case.repository';
import { testRunRepository } from '../db/repositories/test-run.repository';
import type {
  AnalysisResultRecord,
  JsonValue,
  Project,
  ProjectProviderSecret,
  TestCase,
  TestRun,
} from '../db/repositories/types';
import { broadcastToRun } from '../ws/gateway';
import { createAnalyzerProviders } from './provider-factory';
import { buildAnalyzerInput } from './prompt-builder';
import { ProviderError } from './provider.error';
import type {
  AnalysisResult,
  AnalyzerInput,
  AnalyzerProvider,
} from './provider.interface';
import { claudeAnalyzerProvider } from './providers/claude.provider';
import { deepseekAnalyzerProvider } from './providers/deepseek.provider';
import { kimiAnalyzerProvider } from './providers/kimi.provider';
import { openaiAnalyzerProvider } from './providers/openai.provider';
import { opencodeAnalyzerProvider, opencodeGoAnalyzerProvider } from './providers/opencode.provider';
import { getRawProviderResponse } from './providers/provider-utils';

const PROVIDER_NAMES: ProviderName[] = [
  'claude',
  'deepseek',
  'kimi',
  'openai',
  'opencode',
  'opencode-go',
];

export const analyzerProviders: Record<ProviderName, AnalyzerProvider> = {
  claude: claudeAnalyzerProvider,
  deepseek: deepseekAnalyzerProvider,
  kimi: kimiAnalyzerProvider,
  openai: openaiAnalyzerProvider,
  opencode: opencodeAnalyzerProvider,
  'opencode-go': opencodeGoAnalyzerProvider,
};

export class AllProvidersFailedError extends Error {
  readonly attemptedProviders: ProviderName[];

  /**
   * Keterangan: Menandai bahwa tidak ada provider terkonfigurasi atau seluruh
   * provider yang dicoba gagal secara terkontrol.
   */
  constructor(attemptedProviders: ProviderName[]) {
    const detail =
      attemptedProviders.length > 0
        ? attemptedProviders.join(', ')
        : 'tidak ada provider terkonfigurasi';
    super(`Analisis gagal pada seluruh provider: ${detail}`);
    this.name = 'AllProvidersFailedError';
    this.attemptedProviders = attemptedProviders;
  }
}

interface TestRunReader {
  findById(id: string): Promise<TestRun | null>;
}

interface TestCaseReader {
  findById(id: string): Promise<TestCase | null>;
}

interface ProjectReader {
  findById(id: string): Promise<Project | null>;
}

interface AnalysisResultWriter {
  create(data: {
    testRunId: string;
    status: AnalysisResult['status'];
    reason?: string | null;
    detail?: string | null;
    solution?: string | null;
    provider: ProviderName;
    rawResponse?: JsonValue | null;
  }): Promise<AnalysisResultRecord>;
}

export interface AnalyzerServiceDependencies {
  testRuns: TestRunReader;
  testCases: TestCaseReader;
  projects: ProjectReader;
  analysisResults: AnalysisResultWriter;
  providers: Record<ProviderName, AnalyzerProvider>;
  providerConfigs: Record<ProviderName, ProviderConfig>;
  loadProjectProviderSecrets?(projectId: string): Promise<ProjectProviderSecret[]>;
  createProviders?(
    providerConfigs: Record<ProviderName, ProviderConfig>,
  ): Record<ProviderName, AnalyzerProvider>;
  buildInput(testRunId: string): Promise<AnalyzerInput>;
  broadcast(runId: string, result: AnalysisResult & { provider: ProviderName }): void;
  warn(message: string): void;
}

export interface ProviderAnalysisOutcome {
  provider: ProviderName;
  result: AnalysisResult;
}

/**
 * Keterangan: Memastikan string default_provider DB termasuk salah satu nama
 * provider yang didukung aplikasi.
 */
function isProviderName(value: string | null): value is ProviderName {
  return value !== null && PROVIDER_NAMES.includes(value as ProviderName);
}

/**
 * Keterangan: Mengubah response mentah provider menjadi nilai JSONB; string
 * JSON valid diparse agar tetap dapat diaudit/query sebagai object.
 */
function normalizeRawResponse(
  rawResponse: string | AnalysisResult,
): JsonValue {
  if (typeof rawResponse === 'string') {
    try {
      return JSON.parse(rawResponse) as JsonValue;
    } catch {
      return rawResponse;
    }
  }
  return JSON.parse(JSON.stringify(rawResponse)) as JsonValue;
}

/**
 * Keterangan: Menyusun urutan fallback: default project, lalu provider yang
 * punya key di tabel project (sort_order), lalu sisa yang punya key env.
 */
export function buildProviderOrder(
  defaultProvider: string | null,
  providerConfigs: Record<ProviderName, ProviderConfig>,
  projectProviderOrder: ProviderName[] = [],
): ProviderName[] {
  const validDefault = isProviderName(defaultProvider)
    ? defaultProvider
    : undefined;
  const configured = new Set(
    PROVIDER_NAMES.filter((provider) => Boolean(providerConfigs[provider].apiKey)),
  );
  const ordered: ProviderName[] = [];
  const pushIfNew = (provider: ProviderName) => {
    if (!ordered.includes(provider)) {
      ordered.push(provider);
    }
  };

  if (validDefault) {
    pushIfNew(validDefault);
  }
  for (const provider of projectProviderOrder) {
    if (configured.has(provider)) {
      pushIfNew(provider);
    }
  }
  for (const provider of PROVIDER_NAMES.filter((name) => configured.has(name)).sort(
    (left, right) => left.localeCompare(right),
  )) {
    pushIfNew(provider);
  }
  return ordered;
}

/**
 * Keterangan: Menimpa konfigurasi env dengan API key/model yang tersimpan
 * per project. Key project selalu menang; model project dipakai jika diisi.
 */
export function mergeProviderConfigs(
  envConfigs: Record<ProviderName, ProviderConfig>,
  projectSecrets: ProjectProviderSecret[],
): Record<ProviderName, ProviderConfig> {
  const merged = { ...envConfigs };
  for (const secret of projectSecrets) {
    const current = merged[secret.provider];
    merged[secret.provider] = {
      ...current,
      apiKey: secret.apiKey,
      defaultModel: secret.defaultModel || current.defaultModel,
    };
  }
  return merged;
}

/**
 * Keterangan: Mencoba provider sesuai urutan dan hanya melakukan fallback
 * untuk ProviderError; error pemrograman/infrastruktur internal diteruskan.
 */
export async function analyzeWithFallback(
  input: AnalyzerInput,
  providerOrder: ProviderName[],
  providers: Record<ProviderName, AnalyzerProvider>,
  warn: (message: string) => void,
): Promise<ProviderAnalysisOutcome> {
  const attemptedProviders: ProviderName[] = [];

  for (const providerName of providerOrder) {
    attemptedProviders.push(providerName);
    try {
      const result = await providers[providerName].analyze(input);
      return { provider: providerName, result };
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        throw error;
      }
      warn(
        `[analyzer] Provider "${providerName}" gagal (${error.statusCode ?? 'tanpa status'}); mencoba fallback berikutnya.`,
      );
    }
  }

  throw new AllProvidersFailedError(attemptedProviders);
}

/**
 * Keterangan: Membuat fungsi analyzer yang dependensinya dapat diganti test,
 * sementara alur production tetap menggunakan repository/provider nyata.
 */
export function createAnalyzeTestRun(
  dependencies: AnalyzerServiceDependencies,
): (testRunId: string) => Promise<AnalysisResultRecord> {
  return async (testRunId: string): Promise<AnalysisResultRecord> => {
    const testRun = await dependencies.testRuns.findById(testRunId);
    if (!testRun) {
      throw new Error(`Test run "${testRunId}" tidak ditemukan`);
    }
    if (!['passed', 'failed', 'error'].includes(testRun.status)) {
      throw new Error(
        `Test run "${testRunId}" belum terminal (status: ${testRun.status})`,
      );
    }

    const testCase = await dependencies.testCases.findById(testRun.testCaseId);
    if (!testCase) {
      throw new Error(`Test case "${testRun.testCaseId}" tidak ditemukan`);
    }
    const project = await dependencies.projects.findById(testCase.projectId);
    if (!project) {
      throw new Error(`Project "${testCase.projectId}" tidak ditemukan`);
    }

    const input = await dependencies.buildInput(testRunId);
    const projectSecrets =
      (await dependencies.loadProjectProviderSecrets?.(project.id)) ?? [];
    const providerConfigs = mergeProviderConfigs(
      dependencies.providerConfigs,
      projectSecrets,
    );
    const providers =
      dependencies.createProviders?.(providerConfigs) ?? dependencies.providers;
    const providerOrder = buildProviderOrder(
      project.defaultProvider ?? 'claude',
      providerConfigs,
      projectSecrets.map((secret) => secret.provider),
    );
    const outcome = await analyzeWithFallback(
      input,
      providerOrder,
      providers,
      dependencies.warn,
    );
    const rawProviderResponse = getRawProviderResponse(outcome.result);
    const savedResult = await dependencies.analysisResults.create({
      testRunId,
      status: outcome.result.status,
      reason: outcome.result.reason ?? null,
      detail: outcome.result.detail ?? null,
      solution: outcome.result.solution ?? null,
      provider: outcome.provider,
      rawResponse: normalizeRawResponse(rawProviderResponse),
    });

    dependencies.broadcast(testRunId, {
      ...outcome.result,
      provider: outcome.provider,
    });
    return savedResult;
  };
}

const analyzeTestRunWithDefaults = createAnalyzeTestRun({
  testRuns: testRunRepository,
  testCases: testCaseRepository,
  projects: projectRepository,
  analysisResults: analysisResultRepository,
  providers: analyzerProviders,
  providerConfigs: config.providers,
  loadProjectProviderSecrets: (projectId) =>
    projectProviderRepository.findSecretsByProjectId(projectId),
  createProviders: createAnalyzerProviders,
  buildInput: buildAnalyzerInput,
  broadcast: (runId, analysisResult) => {
    broadcastToRun(runId, {
      type: 'run:analysis',
      runId,
      analysisResult,
    });
  },
  warn: (message) => console.warn(message),
});

/**
 * Keterangan: Entry point production untuk menganalisis satu run terminal,
 * menyimpan provider yang berhasil, dan mengirim event WebSocket.
 */
export async function analyzeTestRun(
  testRunId: string,
): Promise<AnalysisResultRecord> {
  return analyzeTestRunWithDefaults(testRunId);
}
