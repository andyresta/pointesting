import { expect, test } from '@playwright/test';
import {
  buildGenerationUserPrompt,
  parseExplorationSteps,
  parseGeneratedTestCases,
} from '../prompt-generation';
import type { GeneratorDependencies } from '../generator.service';
import { generateTestCasesFromPrompt } from '../generator.service';
import { AllProvidersFailedError } from '../../analyzer/analyzer.service';
import { ProviderError } from '../../analyzer/provider.error';
import type { Project } from '../../db/repositories/types';
import type { PageExplorationResult } from '../page-explorer';
import { PageExplorationError } from '../page-explorer';

const SAMPLE_CASE = {
  title: 'Login berhasil',
  description: 'Memastikan login valid membuka dashboard.',
  steps: [
    { action: 'goto', url: '/login' },
    { action: 'fill', selector: '#email', value: 'user@test' },
    { action: 'click', selector: '#submit' },
  ],
  expected: ['Dashboard tampil'],
};

/**
 * Keterangan: Memastikan parser menerima JSON AI dalam beberapa bentuk
 * (object tunggal, array, dan code fence) lalu menolak action invalid.
 */
test('parseGeneratedTestCases menerima object, array, dan fence markdown', () => {
  expect(parseGeneratedTestCases(JSON.stringify(SAMPLE_CASE))).toEqual([
    SAMPLE_CASE,
  ]);
  expect(
    parseGeneratedTestCases(JSON.stringify({ testCases: [SAMPLE_CASE] })),
  ).toEqual([SAMPLE_CASE]);
  expect(
    parseGeneratedTestCases(`\`\`\`json\n${JSON.stringify([SAMPLE_CASE])}\n\`\`\``),
  ).toEqual([SAMPLE_CASE]);
  expect(() =>
    parseGeneratedTestCases(
      JSON.stringify({
        title: 'Bad',
        steps: [{ action: 'hover', selector: '#x' }],
        expected: ['ok'],
      }),
    ),
  ).toThrow(/format test case/);
});

test('parseGeneratedTestCases menolak test case tanpa keterangan', () => {
  expect(() =>
    parseGeneratedTestCases(
      JSON.stringify({
        title: 'Login berhasil',
        steps: SAMPLE_CASE.steps,
        expected: SAMPLE_CASE.expected,
      }),
    ),
  ).toThrow(/description/);
});

test('parseExplorationSteps menerima langkah fill/click dan menolak test case utuh', () => {
  expect(
    parseExplorationSteps(
      JSON.stringify({
        steps: [
          { action: 'fill', selector: '#email', value: 'user@test' },
          { action: 'click', selector: '#login-btn' },
        ],
      }),
    ),
  ).toHaveLength(2);
  expect(parseExplorationSteps(JSON.stringify({ steps: [] }))).toEqual([]);
  expect(() => parseExplorationSteps(JSON.stringify(SAMPLE_CASE))).toThrow(
    /langkah eksplorasi/,
  );
});

const PAGE_SNAPSHOT: PageExplorationResult = {
  url: 'https://portal.test/login',
  title: 'Portal Login',
  headings: ['h1: Masuk ke Portal'],
  elements: [
    {
      tag: 'input',
      role: null,
      type: 'email',
      id: 'email',
      nameAttr: 'email',
      testId: null,
      label: null,
      placeholder: 'nama@contoh.test',
      text: null,
      href: null,
      selector: '#email',
      x: 24,
      y: 80,
      width: 280,
      height: 40,
    },
    {
      tag: 'button',
      role: null,
      type: 'submit',
      id: 'login-btn',
      nameAttr: null,
      testId: null,
      label: null,
      placeholder: null,
      text: 'Masuk',
      href: null,
      selector: '#login-btn',
      x: 24,
      y: 180,
      width: 120,
      height: 40,
    },
  ],
};

test('buildGenerationUserPrompt memuat instruction, extra data, dan judul lama', () => {
  const prompt = buildGenerationUserPrompt({
    prompt: 'Uji login',
    extraData: 'selector #login',
    baseUrl: 'https://app.test',
    existingTitles: ['Login gagal'],
    pageSnapshot: PAGE_SNAPSHOT,
  });
  expect(prompt).toContain('Uji login');
  expect(prompt).toContain('selector #login');
  expect(prompt).toContain('https://app.test');
  expect(prompt).toContain('Login gagal');
  expect(prompt).toContain('selector=#email');
  expect(prompt).toContain('selector=#login-btn');
  expect(prompt).toContain('letak=24,180');
});

/**
 * Keterangan: Menyusun dependency generate tanpa database/API eksternal.
 */
function createGenerateDeps(
  complete: (systemPrompt: string, userContent: unknown[]) => Promise<string>,
): GeneratorDependencies {
  const project: Project = {
    id: 'project-1',
    name: 'Portal',
    baseUrl: 'https://portal.test',
    defaultProvider: 'claude',
    instruction: null,
    extraData: null,
    createdAt: null,
  };
  return {
    projects: { findById: async () => project },
    loadProjectProviderSecrets: async () => [
      {
        provider: 'claude',
        apiKey: 'key-placeholder',
        defaultModel: 'claude-test',
        sortOrder: 0,
      },
    ],
    listTestCases: async () => [],
    persistTestCases: async (items) =>
      items.map((item, index) => ({
        id: `case-${index}`,
        projectId: item.projectId,
        title: item.title,
        description: item.description ?? null,
        steps: item.steps,
        expected: item.expected,
        source: item.source ?? 'ai_prompt',
        createdAt: null,
        updatedAt: null,
      })),
    createClient: () => ({
      complete,
    }),
    explorePage: async () => PAGE_SNAPSHOT,
    runLiveExploration: async (_url, _id, _onStatus, work) =>
      work({ snapshot: PAGE_SNAPSHOT }),
  };
}

test('generateTestCasesFromPrompt menyimpan hasil AI sebagai source ai_prompt', async () => {
  let sentPrompt = '';
  const result = await generateTestCasesFromPrompt(
    { projectId: 'project-1', prompt: 'Uji login', extraData: 'dummy' },
    createGenerateDeps(async (_system, content) => {
      sentPrompt = String(content[0]);
      return JSON.stringify({ testCases: [SAMPLE_CASE] });
    }),
  );
  expect(sentPrompt).toContain('selector=#email');
  expect(sentPrompt).toContain('selector=#login-btn');
  expect(result.provider).toBe('claude');
  expect(result.testCases).toHaveLength(1);
  expect(result.testCases[0]?.source).toBe('ai_prompt');
  expect(result.testCases[0]?.title).toBe('Login berhasil');
  expect(result.testCases[0]?.description).toBe(
    'Memastikan login valid membuka dashboard.',
  );
});

test('generateTestCasesFromPrompt dengan generateId memakai live exploration', async () => {
  let liveUsed = false;
  const deps = createGenerateDeps(async () =>
    JSON.stringify({ testCases: [SAMPLE_CASE] }),
  );
  deps.runLiveExploration = async (_url, id, onStatus, work) => {
    liveUsed = id === 'gen-1';
    onStatus('analyze', 'AI sedang menganalisis aplikasi…');
    return work({ snapshot: PAGE_SNAPSHOT });
  };

  await generateTestCasesFromPrompt(
    { projectId: 'project-1', prompt: 'Uji login', generateId: 'gen-1' },
    deps,
  );
  expect(liveUsed).toBe(true);
});

test('generate live menjalankan langkah instruction sebelum menyusun test case', async () => {
  const followed: unknown[] = [];
  const deps = createGenerateDeps(async (systemPrompt) => {
    if (systemPrompt.includes('menggerakkan browser')) {
      return JSON.stringify({
        steps: [
          { action: 'fill', selector: '#email', value: 'user@test' },
          { action: 'click', selector: '#login-btn' },
        ],
      });
    }
    return JSON.stringify({ testCases: [SAMPLE_CASE] });
  });
  deps.runLiveExploration = async (_url, _id, _onStatus, work) =>
    work({
      snapshot: PAGE_SNAPSHOT,
      followInstruction: async (steps) => {
        followed.push(...steps);
        return PAGE_SNAPSHOT;
      },
    });

  await generateTestCasesFromPrompt(
    {
      projectId: 'project-1',
      prompt: 'Login lalu buka dashboard',
      extraData: 'user@test',
      generateId: 'gen-2',
    },
    deps,
  );
  expect(followed).toEqual([
    { action: 'fill', selector: '#email', value: 'user@test' },
    { action: 'click', selector: '#login-btn' },
  ]);
});

test('generate live menjelajahi halaman lain lalu menyertakan ringkasannya ke prompt final', async () => {
  let generationPrompt = '';
  const deps = createGenerateDeps(async (systemPrompt, content) => {
    if (systemPrompt.includes('menggerakkan browser')) {
      return JSON.stringify({ steps: [] });
    }
    generationPrompt = String(content[0]);
    return JSON.stringify({ testCases: [SAMPLE_CASE] });
  });
  deps.runLiveExploration = async (_url, _id, _onStatus, work) =>
    work({
      snapshot: PAGE_SNAPSHOT,
      followInstruction: async () => PAGE_SNAPSHOT,
      crawlAdditionalPages: async () => [
        {
          url: 'https://portal.test/customers',
          title: 'Data Pelanggan',
          headings: ['h1: Data Pelanggan'],
          actionLabels: ['Tambah Pelanggan'],
        },
      ],
    });

  await generateTestCasesFromPrompt(
    {
      projectId: 'project-1',
      prompt: 'Login lalu jelajahi aplikasi',
      generateId: 'gen-3',
    },
    deps,
  );
  expect(generationPrompt).toContain('Data Pelanggan (https://portal.test/customers)');
  expect(generationPrompt).toContain('Tambah Pelanggan');
});

test('generateTestCasesFromPrompt fallback jika output AI tidak valid', async () => {
  await expect(
    generateTestCasesFromPrompt(
      { projectId: 'project-1', prompt: 'Uji login' },
      createGenerateDeps(async () => 'bukan json'),
    ),
  ).rejects.toBeInstanceOf(AllProvidersFailedError);
});

test('generateTestCasesFromPrompt fallback pada ProviderError', async () => {
  await expect(
    generateTestCasesFromPrompt(
      { projectId: 'project-1', prompt: 'Uji login' },
      createGenerateDeps(async () => {
        throw new ProviderError('claude', 'rate limit', { statusCode: 429 });
      }),
    ),
  ).rejects.toBeInstanceOf(AllProvidersFailedError);
});

test('generateTestCasesFromPrompt menolak project tanpa Base URL', async () => {
  const deps = createGenerateDeps(async () =>
    JSON.stringify({ testCases: [SAMPLE_CASE] }),
  );
  deps.projects.findById = async () => ({
    id: 'project-1',
    name: 'Portal',
    baseUrl: null,
    defaultProvider: 'claude',
    instruction: null,
    extraData: null,
    createdAt: null,
  });
  await expect(
    generateTestCasesFromPrompt(
      { projectId: 'project-1', prompt: 'Uji login' },
      deps,
    ),
  ).rejects.toBeInstanceOf(PageExplorationError);
});
