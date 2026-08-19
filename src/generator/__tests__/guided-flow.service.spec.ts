import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import {
  GuidedFlowAbortedError,
  GuidedFlowBudgetExceededError,
  generateGuidedTestCase,
  type GuidedFlowDependencies,
} from '../guided-flow.service';
import type { Project, TestCase } from '../../db/repositories/types';

const FORM_URL = pathToFileURL(
  path.join(__dirname, 'fixtures', 'form-constraints.html'),
).href;

const PROJECT: Project = {
  id: 'project-guided',
  name: 'Form App',
  baseUrl: FORM_URL,
  defaultProvider: 'claude',
  instruction: null,
  extraData: null,
  createdAt: null,
};

/**
 * Keterangan: Fake runInSessionPage yang membuka browser+context+page
 * Playwright SUNGGUHAN langsung (bukan lewat run-session.ts asli) — cukup
 * untuk memverifikasi loop guided flow benar-benar mengeksekusi aksi nyata
 * ke DOM lewat sebuah Page biasa, tanpa perlu menguji ulang mekanisme sesi
 * persisten (sudah dites terpisah di run-session.spec.ts).
 */
function createFakeRunInSessionPage(): GuidedFlowDependencies['runInSessionPage'] {
  return async <T>(_sessionId: string, work: (page: Page) => Promise<T>): Promise<T> => {
    const browser: Browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      return await work(page);
    } finally {
      await browser.close();
    }
  };
}

function createFakeDeps(
  complete: (systemPrompt: string, userContent: unknown[]) => Promise<string>,
): GuidedFlowDependencies {
  const savedTestCases: TestCase[] = [];
  return {
    projects: { findById: async () => PROJECT },
    loadProjectProviderSecrets: async () => [
      { provider: 'claude', apiKey: 'key-placeholder', defaultModel: 'claude-test', sortOrder: 0 },
    ],
    createClient: () => ({ complete }),
    runInSessionPage: createFakeRunInSessionPage(),
    findTestCase: async (testCaseId) =>
      savedTestCases.find((item) => item.id === testCaseId) ?? null,
    persistTestCase: async (item) => {
      const testCase: TestCase = {
        id: `guided-case-${savedTestCases.length}`,
        projectId: item.projectId,
        title: item.title,
        description: item.description ?? null,
        steps: item.steps,
        expected: item.expected,
        source: item.source,
        createdAt: null,
        updatedAt: null,
      };
      savedTestCases.push(testCase);
      return testCase;
    },
    updateTestCase: async (testCaseId, item) => {
      const index = savedTestCases.findIndex((entry) => entry.id === testCaseId);
      if (index < 0) {
        return null;
      }
      const updated: TestCase = {
        ...savedTestCases[index]!,
        title: item.title,
        description: item.description ?? null,
        steps: item.steps,
        expected: item.expected,
        source: item.source,
      };
      savedTestCases[index] = updated;
      return updated;
    },
  };
}

test('generateGuidedTestCase menjalankan loop step-by-step lalu menyimpan test case hasil compile', async () => {
  const responses = [
    JSON.stringify({
      done: false,
      reasoning: 'isi username',
      step: { action: 'fill', selector: '#username', value: 'qa-guided' },
    }),
    JSON.stringify({
      done: false,
      reasoning: 'isi nickname',
      step: { action: 'fill', selector: '#nickname', value: 'QA Guided' },
    }),
    JSON.stringify({ done: true, reasoning: 'kedua field sudah terisi' }),
    JSON.stringify({
      title: 'Isi username dan nickname pada form registrasi',
      description: 'Memastikan field username dan nickname bisa diisi.',
      steps: [
        { action: 'fill', selector: '#username', value: 'qa-guided' },
        { action: 'fill', selector: '#nickname', value: 'QA Guided' },
        { action: 'assertValue', selector: '#username', value: 'qa-guided' },
      ],
      expected: ['Field username terisi sesuai input'],
    }),
  ];
  let callIndex = 0;
  const complete = async () => {
    const response = responses[callIndex];
    callIndex += 1;
    if (response === undefined) {
      throw new Error(`Tidak ada scripted response untuk call ke-${callIndex}`);
    }
    return response;
  };

  const result = await generateGuidedTestCase(
    {
      projectId: PROJECT.id,
      prompt: 'Isi field username dan nickname pada form registrasi',
      generateId: 'guided-gen-1',
      sessionId: 'session-1',
    },
    createFakeDeps(complete),
  );

  expect(result.testCase.source).toBe('ai_guided');
  expect(result.testCase.title).toBe('Isi username dan nickname pada form registrasi');
  expect(callIndex).toBe(4);

  // Regresi: history tidak pernah mencatat navigasi awal, jadi compile akhir
  // (LLM) sering lupa menyertakan goto — test case akhir WAJIB tetap diawali
  // goto ke baseUrl walau LLM tidak menuliskannya sendiri (lihat scripted
  // compile response di atas yang sengaja TIDAK menyertakan goto).
  const steps = result.testCase.steps;
  expect(Array.isArray(steps)).toBe(true);
  expect((steps as Array<Record<string, unknown>>)[0]).toEqual({
    action: 'goto',
    url: PROJECT.baseUrl,
  });
});

test('generateGuidedTestCase mode edit meng-update test case yang sama (bukan membuat baru) dan mengirim konteks test case lama ke prompt', async () => {
  const capturedEditPrompts: string[] = [];
  const holder: { current: (systemPrompt: string, userContent: unknown[]) => Promise<string> } = {
    current: async () => '',
  };
  const deps = createFakeDeps((systemPrompt, userContent) => holder.current(systemPrompt, userContent));

  const createResponses = [
    JSON.stringify({
      done: false,
      reasoning: 'isi username',
      step: { action: 'fill', selector: '#username', value: 'awal' },
    }),
    JSON.stringify({ done: true, reasoning: 'selesai' }),
    JSON.stringify({
      title: 'Isi username form registrasi',
      description: 'Mengisi username.',
      steps: [{ action: 'fill', selector: '#username', value: 'awal' }],
      expected: ['Username terisi'],
    }),
  ];
  let createIndex = 0;
  holder.current = async () => {
    const response = createResponses[createIndex];
    createIndex += 1;
    if (response === undefined) {
      throw new Error(`Tidak ada scripted response create ke-${createIndex}`);
    }
    return response;
  };

  const created = await generateGuidedTestCase(
    {
      projectId: PROJECT.id,
      prompt: 'Isi username form registrasi',
      generateId: 'guided-create-for-edit',
      sessionId: 'session-edit-1',
    },
    deps,
  );

  const editResponses = [
    JSON.stringify({
      done: false,
      reasoning: 'isi nickname juga',
      step: { action: 'fill', selector: '#nickname', value: 'baru' },
    }),
    JSON.stringify({ done: true, reasoning: 'selesai' }),
    JSON.stringify({
      title: 'Isi username dan nickname form registrasi',
      description: 'Mengisi username dan nickname.',
      steps: [{ action: 'fill', selector: '#nickname', value: 'baru' }],
      expected: ['Nickname terisi'],
    }),
  ];
  let editIndex = 0;
  holder.current = async (_systemPrompt, userContent) => {
    capturedEditPrompts.push(String(userContent[0]));
    const response = editResponses[editIndex];
    editIndex += 1;
    if (response === undefined) {
      throw new Error(`Tidak ada scripted response edit ke-${editIndex}`);
    }
    return response;
  };

  const edited = await generateGuidedTestCase(
    {
      projectId: PROJECT.id,
      prompt: 'Tambahkan pengisian field nickname juga',
      generateId: 'guided-edit-1',
      sessionId: 'session-edit-2',
      testCaseId: created.testCase.id,
    },
    deps,
  );

  expect(edited.testCase.id).toBe(created.testCase.id);
  expect(edited.testCase.title).toBe('Isi username dan nickname form registrasi');
  expect(capturedEditPrompts.some((p) => p.includes('Test case yang SEDANG DIEDIT'))).toBe(true);
  expect(capturedEditPrompts.some((p) => p.includes('Isi username form registrasi'))).toBe(true);
});

test('generateGuidedTestCase berhenti dengan GuidedFlowAbortedError setelah 2x selector halusinasi berturut-turut', async () => {
  const complete = async () =>
    JSON.stringify({
      done: false,
      reasoning: 'klik tombol yang tidak ada',
      step: { action: 'click', selector: '#tombol-tidak-ada' },
    });

  await expect(
    generateGuidedTestCase(
      {
        projectId: PROJECT.id,
        prompt: 'Klik tombol yang tidak pernah ada',
        generateId: 'guided-gen-2',
        sessionId: 'session-2',
      },
      createFakeDeps(complete),
    ),
  ).rejects.toBeInstanceOf(GuidedFlowAbortedError);
});

test('generateGuidedTestCase gagal dengan GuidedFlowBudgetExceededError kalau AI tidak pernah menyatakan selesai', async () => {
  const complete = async () =>
    JSON.stringify({
      done: false,
      reasoning: 'terus mengisi ulang',
      step: { action: 'fill', selector: '#username', value: 'terus-menerus' },
    });

  await expect(
    generateGuidedTestCase(
      {
        projectId: PROJECT.id,
        prompt: 'Instruksi yang tidak pernah dianggap selesai oleh AI',
        generateId: 'guided-gen-3',
        sessionId: 'session-3',
      },
      createFakeDeps(complete),
    ),
  ).rejects.toBeInstanceOf(GuidedFlowBudgetExceededError);
});
