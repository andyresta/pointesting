import { expect, test } from '@playwright/test';
import type { ProviderConfig, ProviderName } from '../../config/env';
import type {
  AnalysisResultRecord,
  Project,
  TestCase,
  TestRun,
} from '../../db/repositories/types';
import {
  AllProvidersFailedError,
  buildProviderOrder,
  createAnalyzeTestRun,
  type AnalyzerServiceDependencies,
} from '../analyzer.service';
import { ProviderError } from '../provider.error';
import type {
  AnalysisResult,
  AnalyzerInput,
  AnalyzerProvider,
} from '../provider.interface';
import { parseAnalysisResult } from '../providers/provider-utils';

const PROVIDER_NAMES: ProviderName[] = [
  'claude',
  'openai',
  'deepseek',
  'kimi',
  'opencode',
];

const INPUT: AnalyzerInput = {
  expected: ['halaman tampil'],
  consoleLogSummary: 'bersih',
  networkLogSummary: 'bersih',
  traceSummary: {
    totalDurationMs: 10,
    totalActions: 1,
    failedActions: 0,
    actions: [],
    truncated: false,
    traceFileCount: 1,
    malformedEventCount: 0,
  },
};

/**
 * Keterangan: Membuat konfigurasi provider test dengan API key hanya untuk
 * provider fallback yang dipilih skenario.
 */
function createProviderConfigs(
  configured: ProviderName[],
): Record<ProviderName, ProviderConfig> {
  return Object.fromEntries(
    PROVIDER_NAMES.map((provider) => [
      provider,
      {
        apiKey: configured.includes(provider) ? 'key-placeholder' : '',
        defaultModel: `${provider}-test`,
        availableModels: [],
      },
    ]),
  ) as unknown as Record<ProviderName, ProviderConfig>;
}

/**
 * Keterangan: Membuat map provider mock lengkap; handler tiap provider dapat
 * diganti per test tanpa memanggil API eksternal.
 */
function createMockProviders(
  handlers: Partial<Record<ProviderName, () => Promise<AnalysisResult>>>,
): Record<ProviderName, AnalyzerProvider> {
  return Object.fromEntries(
    PROVIDER_NAMES.map((provider) => [
      provider,
      {
        name: provider,
        supportsImage: false,
        analyze: handlers[provider] ?? (async () => {
          throw new Error(`Provider ${provider} seharusnya tidak dipanggil`);
        }),
      },
    ]),
  ) as unknown as Record<ProviderName, AnalyzerProvider>;
}

/**
 * Keterangan: Menyusun dependency analyzer service mock dan menangkap data
 * persist/broadcast untuk assertion orchestration.
 */
function createServiceDependencies(
  providers: Record<ProviderName, AnalyzerProvider>,
  providerConfigs: Record<ProviderName, ProviderConfig>,
  captured: {
    created?: Record<string, unknown>;
    broadcast?: Record<string, unknown>;
    warnings: string[];
  },
): AnalyzerServiceDependencies {
  const testRun: TestRun = {
    id: 'run-1',
    testCaseId: 'case-1',
    status: 'passed',
    startedAt: null,
    finishedAt: null,
    durationMs: 10,
    createdAt: null,
  };
  const testCase: TestCase = {
    id: 'case-1',
    projectId: 'project-1',
    title: 'Test',
    steps: [],
    expected: [],
    source: 'manual',
    createdAt: null,
    updatedAt: null,
  };
  const project: Project = {
    id: 'project-1',
    name: 'Project',
    baseUrl: null,
    defaultProvider: 'claude',
    createdAt: null,
  };

  return {
    testRuns: { findById: async () => testRun },
    testCases: { findById: async () => testCase },
    projects: { findById: async () => project },
    analysisResults: {
      create: async (data) => {
        captured.created = data;
        return {
          id: 'analysis-1',
          testRunId: data.testRunId,
          status: data.status,
          reason: data.reason ?? null,
          detail: data.detail ?? null,
          solution: data.solution ?? null,
          provider: data.provider,
          rawResponse: data.rawResponse ?? null,
          createdAt: null,
        } satisfies AnalysisResultRecord;
      },
    },
    providers,
    providerConfigs,
    buildInput: async () => INPUT,
    broadcast: (runId, result) => {
      captured.broadcast = { runId, ...result };
    },
    warn: (message) => captured.warnings.push(message),
  };
}

test('fallback menyimpan dan broadcast provider yang benar-benar berhasil', async () => {
  const calls: ProviderName[] = [];
  const providers = createMockProviders({
    claude: async () => {
      calls.push('claude');
      throw new ProviderError('claude', 'rate limit', { statusCode: 429 });
    },
    openai: async () => {
      calls.push('openai');
      return parseAnalysisResult(
        'openai',
        JSON.stringify({
          status: 'success',
          reason: 'Expected terpenuhi',
          vendor_meta: 'audit-value',
        }),
      );
    },
  });
  const captured: {
    created?: Record<string, unknown>;
    broadcast?: Record<string, unknown>;
    warnings: string[];
  } = { warnings: [] };
  const analyze = createAnalyzeTestRun(
    createServiceDependencies(
      providers,
      createProviderConfigs(['openai']),
      captured,
    ),
  );

  const saved = await analyze('run-1');

  expect(calls).toEqual(['claude', 'openai']);
  expect(saved.provider).toBe('openai');
  expect(captured.created).toMatchObject({
    testRunId: 'run-1',
    provider: 'openai',
    status: 'success',
    rawResponse: {
      status: 'success',
      reason: 'Expected terpenuhi',
      vendor_meta: 'audit-value',
    },
  });
  expect(captured.broadcast).toEqual({
    runId: 'run-1',
    provider: 'openai',
    status: 'success',
    reason: 'Expected terpenuhi',
  });
  expect(captured.warnings).toHaveLength(1);
});

test('semua ProviderError gagal tidak menyimpan atau broadcast hasil', async () => {
  const providers = createMockProviders({
    claude: async () => {
      throw new ProviderError('claude', 'gagal');
    },
    openai: async () => {
      throw new ProviderError('openai', 'gagal');
    },
  });
  const captured: {
    created?: Record<string, unknown>;
    broadcast?: Record<string, unknown>;
    warnings: string[];
  } = { warnings: [] };
  const analyze = createAnalyzeTestRun(
    createServiceDependencies(
      providers,
      createProviderConfigs(['openai']),
      captured,
    ),
  );

  const error = await analyze('run-1').catch((caught) => caught);
  expect(error).toBeInstanceOf(AllProvidersFailedError);
  expect(error.attemptedProviders).toEqual(['claude', 'openai']);
  expect(captured.created).toBeUndefined();
  expect(captured.broadcast).toBeUndefined();
});

test('error non-provider tidak disamarkan menjadi fallback', async () => {
  let openAICalled = false;
  const providers = createMockProviders({
    claude: async () => {
      throw new Error('database internal rusak');
    },
    openai: async () => {
      openAICalled = true;
      return { status: 'success', reason: 'tidak boleh tercapai' };
    },
  });
  const captured = { warnings: [] as string[] };
  const analyze = createAnalyzeTestRun(
    createServiceDependencies(
      providers,
      createProviderConfigs(['openai']),
      captured,
    ),
  );

  await expect(analyze('run-1')).rejects.toThrow('database internal rusak');
  expect(openAICalled).toBe(false);
});

test('urutan provider deterministik dan mengabaikan default tidak dikenal', () => {
  const configs = createProviderConfigs(['opencode', 'deepseek']);
  expect(buildProviderOrder('vendor-lain', configs)).toEqual([
    'deepseek',
    'opencode',
  ]);
  expect(buildProviderOrder('opencode', configs)).toEqual([
    'opencode',
    'deepseek',
  ]);
});
