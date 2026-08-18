import { config, type ProviderName } from '../config/env';
import {
  AllProvidersFailedError,
  buildProviderOrder,
  mergeProviderConfigs,
} from '../analyzer/analyzer.service';
import type { LLMClient } from '../analyzer/llm-client.interface';
import { createLLMClient } from '../analyzer/provider-factory';
import { ProviderError } from '../analyzer/provider.error';
import type { TestCaseStep } from '../api/schemas/testcase.schema';
import type { Page } from '@playwright/test';
import { withTransaction } from '../db/client';
import { projectProviderRepository } from '../db/repositories/project-provider.repository';
import { projectRepository } from '../db/repositories/project.repository';
import { testCaseRepository } from '../db/repositories/test-case.repository';
import type {
  Project,
  ProjectProviderSecret,
  TestCase,
  TestCaseCreateData,
} from '../db/repositories/types';
import { startScreencast } from '../runner/screencast';
import { executeSteps } from '../runner/testcase-compiler';
import type { Step } from '../runner/types';
import { broadcastToRun } from '../ws/gateway';
import {
  collectPageSnapshot,
  crawlAdditionalPages,
  explorePage,
  navigateForExploration,
  PageExplorationError,
  withExploredPage,
  type PageExplorationResult,
  type PageSummary,
} from './page-explorer';
import {
  buildExplorationSystemPrompt,
  buildExplorationUserPrompt,
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  parseExplorationSteps,
  parseGeneratedTestCases,
} from './prompt-generation';

export interface GenerateFromPromptInput {
  projectId: string;
  prompt: string;
  extraData?: string;
  generateId?: string;
}

export interface GenerateFromPromptResult {
  provider: ProviderName;
  testCases: TestCase[];
}

export type GenerateStatusFn = (phase: string, message: string) => void;

const MAX_ADDITIONAL_PAGES = 6;

export interface LiveExplorationContext {
  snapshot: PageExplorationResult;
  followInstruction?: (
    steps: TestCaseStep[],
  ) => Promise<PageExplorationResult>;
  crawlAdditionalPages?: (
    fromSnapshot: PageExplorationResult,
  ) => Promise<PageSummary[]>;
}

export interface GeneratorDependencies {
  projects: { findById(id: string): Promise<Project | null> };
  loadProjectProviderSecrets(
    projectId: string,
  ): Promise<ProjectProviderSecret[]>;
  listTestCases(filter: { projectId: string }): Promise<TestCase[]>;
  persistTestCases(items: TestCaseCreateData[]): Promise<TestCase[]>;
  createClient: typeof createLLMClient;
  explorePage(targetUrl: string): Promise<PageExplorationResult>;
  runLiveExploration(
    targetUrl: string,
    generateId: string,
    onStatus: GenerateStatusFn,
    work: (context: LiveExplorationContext) => Promise<GenerateFromPromptResult>,
  ): Promise<GenerateFromPromptResult>;
}

/**
 * Keterangan: Menyimpan hasil generate dalam satu transaction supaya gagal
 * di tengah tidak meninggalkan test case setengah jadi.
 */
async function persistGeneratedTestCases(
  items: TestCaseCreateData[],
): Promise<TestCase[]> {
  return withTransaction(async (client) => {
    const created: TestCase[] = [];
    for (const item of items) {
      created.push(await testCaseRepository.create(item, client));
    }
    return created;
  });
}

/**
 * Keterangan: Menyusun teks status langkah tanpa menampilkan nilai isian
 * (password/kredensial tidak boleh bocor ke panel log).
 */
function describeInstructionStep(step: TestCaseStep): string {
  switch (step.action) {
    case 'fill':
      return `AI sedang mengisi ${step.selector}…`;
    case 'click':
      return `AI sedang klik ${step.selector}…`;
    case 'check':
      return `AI sedang mencentang ${step.selector}…`;
    case 'select':
      return `AI sedang memilih opsi pada ${step.selector}…`;
    case 'waitFor':
      return `AI menunggu ${step.selector}…`;
    case 'goto':
      return `AI membuka ${step.url}…`;
  }
}

/**
 * Keterangan: Membuang goto ke URL yang sudah terbuka supaya Playwright
 * tidak reload halaman sebelum mengisi form.
 */
function skipRedundantGoto(
  steps: TestCaseStep[],
  currentUrl: string,
): TestCaseStep[] {
  return steps.filter((step) => {
    if (step.action !== 'goto') {
      return true;
    }
    try {
      return new URL(step.url, currentUrl).href !== new URL(currentUrl).href;
    } catch {
      return true;
    }
  });
}

/**
 * Keterangan: Menjalankan langkah instruction pada page yang sudah terbuka,
 * lalu mengambil snapshot baru setelah halaman merespons.
 */
async function executeInstructionOnPage(
  page: Page,
  steps: TestCaseStep[],
  onStatus: GenerateStatusFn,
): Promise<PageExplorationResult> {
  const runnable = skipRedundantGoto(steps, page.url());
  if (runnable.length === 0) {
    return collectPageSnapshot(page);
  }
  onStatus('act', 'AI sedang mengisi form sesuai instruction…');
  await executeSteps(page, runnable as Step[], async (result) => {
    const step = runnable[result.index];
    if (step && result.status === 'passed') {
      onStatus('act', describeInstructionStep(step));
    }
  });
  await page
    .waitForLoadState('networkidle', { timeout: 5_000 })
    .catch(() => undefined);
  return collectPageSnapshot(page);
}

/**
 * Keterangan: Menjelajahi kandidat link menu navigasi utama dari halaman
 * yang sedang terbuka, menyiarkan status per halaman ke panel log.
 */
async function crawlNavPages(
  page: Page,
  fromSnapshot: PageExplorationResult,
  onStatus: GenerateStatusFn,
): Promise<PageSummary[]> {
  return crawlAdditionalPages(page, fromSnapshot, MAX_ADDITIONAL_PAGES, (label) =>
    onStatus('crawl', `AI sedang menjelajahi halaman "${label}"…`),
  );
}

/**
 * Keterangan: Membuka Playwright, menyiarkan screencast, menjalankan
 * instruction di halaman (isi login, dsb.), lalu menahan browser selama LLM
 * menyusun test case.
 */
async function defaultRunLiveExploration(
  targetUrl: string,
  generateId: string,
  onStatus: GenerateStatusFn,
  work: (context: LiveExplorationContext) => Promise<GenerateFromPromptResult>,
): Promise<GenerateFromPromptResult> {
  return withExploredPage(targetUrl, async (page) => {
    const screencast = await startScreencast(page, generateId, {
      maxWidth: 1280,
      maxHeight: 720,
      quality: 70,
    });
    try {
      onStatus('open', 'AI sedang membuka aplikasi di Playwright…');
      await navigateForExploration(page, targetUrl);
      onStatus('analyze', 'AI sedang menganalisis aplikasi…');
      const snapshot = await collectPageSnapshot(page);
      return await work({
        snapshot,
        followInstruction: async (steps) =>
          executeInstructionOnPage(page, steps, onStatus),
        crawlAdditionalPages: async (fromSnapshot) =>
          crawlNavPages(page, fromSnapshot, onStatus),
      });
    } finally {
      await screencast.stop();
    }
  });
}

const defaultDependencies: GeneratorDependencies = {
  projects: projectRepository,
  loadProjectProviderSecrets: (projectId) =>
    projectProviderRepository.findSecretsByProjectId(projectId),
  listTestCases: (filter) => testCaseRepository.findAll(filter),
  persistTestCases: persistGeneratedTestCases,
  createClient: createLLMClient,
  explorePage,
  runLiveExploration: defaultRunLiveExploration,
};

/**
 * Keterangan: Menyiarakan fase generate ke subscriber WebSocket generateId,
 * diabaikan jika generate berjalan tanpa live panel (unit test).
 */
function emitGenerateStatus(
  generateId: string | undefined,
  phase: string,
  message: string,
): void {
  if (!generateId) {
    return;
  }
  broadcastToRun(generateId, {
    type: 'generate:status',
    runId: generateId,
    phase,
    message,
  });
}

/**
 * Keterangan: Menganalisis tampilan halaman project (Playwright), menjalankan
 * instruction di browser bila live, lalu LLM menyusun test case.
 */
export async function generateTestCasesFromPrompt(
  input: GenerateFromPromptInput,
  dependencies: GeneratorDependencies = defaultDependencies,
): Promise<GenerateFromPromptResult> {
  const project = await dependencies.projects.findById(input.projectId);
  if (!project) {
    throw new Error(`Project "${input.projectId}" tidak ditemukan`);
  }
  if (!project.baseUrl?.trim()) {
    throw new PageExplorationError(
      'Base URL project wajib diisi supaya AI dapat menganalisis tampilan halaman',
      400,
    );
  }

  const emit: GenerateStatusFn = (phase, message) =>
    emitGenerateStatus(input.generateId, phase, message);

  /**
   * Keterangan: Memanggil LLM (dengan fallback provider), mengisi form sesuai
   * instruction bila session live, lalu menyimpan test case.
   */
  const generateFromContext = async (
    context: LiveExplorationContext,
  ): Promise<GenerateFromPromptResult> => {
    const secrets = await dependencies.loadProjectProviderSecrets(input.projectId);
    const providerConfigs = mergeProviderConfigs(config.providers, secrets);
    const providerOrder = buildProviderOrder(
      project.defaultProvider,
      providerConfigs,
      secrets.map((secret) => secret.provider),
    );

    const existing = await dependencies.listTestCases({
      projectId: input.projectId,
    });
    let pageSnapshot = context.snapshot;
    let didFollowInstruction = false;
    let additionalPages: PageSummary[] = [];

    const attempted: ProviderName[] = [];
    for (const providerName of providerOrder) {
      const providerConfig = providerConfigs[providerName];
      if (!providerConfig.apiKey || !providerConfig.defaultModel) {
        continue;
      }
      attempted.push(providerName);
      try {
        const client: LLMClient = dependencies.createClient(
          providerName,
          providerConfig.apiKey,
          providerConfig.defaultModel,
        );

        if (context.followInstruction && !didFollowInstruction) {
          emit('act', 'AI sedang merencanakan langkah sesuai instruction…');
          try {
            const exploreRaw = await client.complete(
              buildExplorationSystemPrompt(),
              [
                buildExplorationUserPrompt({
                  prompt: input.prompt,
                  extraData: input.extraData,
                  baseUrl: project.baseUrl,
                  pageSnapshot,
                }),
              ],
            );
            const exploreSteps = parseExplorationSteps(exploreRaw);
            didFollowInstruction = true;
            if (exploreSteps.length > 0) {
              pageSnapshot = await context.followInstruction(exploreSteps);
              emit('analyze', 'AI sedang menganalisis halaman setelah instruction…');
            }
          } catch (error) {
            if (error instanceof ProviderError) {
              continue;
            }
            didFollowInstruction = true;
          }

          if (context.crawlAdditionalPages) {
            emit('crawl', 'AI sedang menjelajahi menu lain di aplikasi…');
            try {
              additionalPages = await context.crawlAdditionalPages(pageSnapshot);
              if (additionalPages.length > 0) {
                emit(
                  'analyze',
                  `AI selesai menjelajahi ${additionalPages.length} halaman lain.`,
                );
              }
            } catch {
              additionalPages = [];
            }
          }
        }

        emit('generate', 'AI sedang generate test case…');
        const raw = await client.complete(buildGenerationSystemPrompt(), [
          buildGenerationUserPrompt({
            prompt: input.prompt,
            extraData: input.extraData,
            baseUrl: project.baseUrl,
            existingTitles: existing.map((item) => item.title),
            pageSnapshot,
            additionalPages,
          }),
        ]);
        let parsed;
        try {
          parsed = parseGeneratedTestCases(raw);
        } catch {
          continue;
        }
        emit('save', 'AI sedang menyimpan test case…');
        const testCases = await dependencies.persistTestCases(
          parsed.map((item) => ({
            projectId: input.projectId,
            title: item.title,
            description: item.description?.trim() || null,
            steps: item.steps,
            expected: item.expected,
            source: 'ai_prompt',
          })),
        );
        emit('done', 'Test case siap.');
        if (input.generateId) {
          broadcastToRun(input.generateId, {
            type: 'generate:done',
            runId: input.generateId,
            testCases: testCases.map((item) => ({
              id: item.id,
              title: item.title,
              description: item.description,
            })),
          });
        }
        return { provider: providerName, testCases };
      } catch (error) {
        if (error instanceof ProviderError) {
          continue;
        }
        throw error;
      }
    }

    throw new AllProvidersFailedError(attempted);
  };

  if (input.generateId) {
    return dependencies.runLiveExploration(
      project.baseUrl,
      input.generateId,
      emit,
      generateFromContext,
    );
  }

  emit('analyze', 'AI sedang menganalisis aplikasi…');
  const pageSnapshot = await dependencies.explorePage(project.baseUrl);
  return generateFromContext({ snapshot: pageSnapshot });
}
