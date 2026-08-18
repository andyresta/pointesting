import { expect, test } from '@playwright/test';
import type {
  LLMClient,
  LLMUserContent,
} from '../llm-client.interface';
import { ProviderError } from '../provider.error';
import type { AnalyzerInput } from '../provider.interface';
import {
  ClaudeAnalyzerProvider,
  ClaudeLLMClient,
} from '../providers/claude.provider';
import {
  DeepSeekAnalyzerProvider,
  DeepSeekLLMClient,
} from '../providers/deepseek.provider';
import {
  KimiAnalyzerProvider,
  KimiLLMClient,
} from '../providers/kimi.provider';
import {
  OpenAIAnalyzerProvider,
  OpenAILLMClient,
} from '../providers/openai.provider';
import {
  OpenCodeAnalyzerProvider,
  OpenCodeLLMClient,
} from '../providers/opencode.provider';

const ANALYZER_INPUT: AnalyzerInput = {
  expected: ['Halaman berhasil dimuat'],
  consoleLogSummary: 'Tidak ada error atau warning pada console.',
  networkLogSummary: 'Tidak ada status error atau response network lambat.',
  screenshots: [Buffer.from('gambar-uji')],
  traceSummary: {
    totalDurationMs: 100,
    totalActions: 1,
    failedActions: 0,
    actions: [
      {
        name: 'Frame.goto',
        startOffsetMs: 0,
        durationMs: 100,
        status: 'passed',
      },
    ],
    truncated: false,
    traceFileCount: 1,
    malformedEventCount: 0,
  },
};

class MockLLMClient implements LLMClient {
  receivedContent: LLMUserContent[] = [];

  /**
   * Keterangan: Mengembalikan response JSON konsisten dan menyimpan content
   * untuk memverifikasi filtering screenshot per provider.
   */
  async complete(
    _systemPrompt: string,
    userContent: LLMUserContent[],
  ): Promise<string> {
    this.receivedContent = userContent;
    return JSON.stringify({
      status: 'success',
      reason: 'Expected result terpenuhi.',
    });
  }
}

interface CapturedRequest {
  url?: string;
  init?: RequestInit;
  calls?: number;
}

/**
 * Keterangan: Membuat fetch mock yang menangkap URL/body tanpa melakukan call
 * jaringan dan mengembalikan payload provider yang ditentukan test.
 */
function createFetchMock(
  payload: unknown,
  capture: CapturedRequest,
  status = 200,
): typeof fetch {
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    capture.calls = (capture.calls ?? 0) + 1;
    capture.url = String(input);
    capture.init = init;
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

/**
 * Keterangan: Membaca body JSON request yang sudah ditangkap fetch mock.
 */
function capturedBody(capture: CapturedRequest): Record<string, unknown> {
  return JSON.parse(String(capture.init?.body)) as Record<string, unknown>;
}

test('semua AnalyzerProvider menormalkan input yang sama ke AnalysisResult sama', async () => {
  const clients = Array.from({ length: 5 }, () => new MockLLMClient());
  const providers = [
    new ClaudeAnalyzerProvider(clients[0]),
    new OpenAIAnalyzerProvider(clients[1]),
    new DeepSeekAnalyzerProvider(clients[2]),
    new KimiAnalyzerProvider(clients[3]),
    new OpenCodeAnalyzerProvider(clients[4]),
  ];

  const results = await Promise.all(
    providers.map((provider) => provider.analyze(ANALYZER_INPUT)),
  );
  expect(results).toEqual(
    Array.from({ length: 5 }, () => ({
      status: 'success',
      reason: 'Expected result terpenuhi.',
    })),
  );

  expect(clients[0]?.receivedContent).toHaveLength(2);
  expect(clients[1]?.receivedContent).toHaveLength(2);
  expect(clients[2]?.receivedContent).toHaveLength(1);
  expect(clients[3]?.receivedContent).toHaveLength(2);
  expect(clients[4]?.receivedContent).toHaveLength(1);
});

test('Claude client memakai Messages API dan block image base64', async () => {
  const capture: CapturedRequest = {};
  const client = new ClaudeLLMClient({
    apiKey: 'key-placeholder',
    model: 'claude-test',
    fetchImpl: createFetchMock(
      { content: [{ type: 'text', text: '{"status":"success"}' }] },
      capture,
    ),
  });

  await client.complete('system', [
    'user',
    { type: 'image', data: Buffer.from('x'), mediaType: 'image/png' },
  ]);

  expect(capture.url).toBe('https://api.anthropic.com/v1/messages');
  expect(capturedBody(capture)).toMatchObject({ model: 'claude-test' });
  expect(JSON.stringify(capturedBody(capture))).toContain('"type":"image"');
});

test('OpenAI dan Kimi mengirim image_url, DeepSeek mengabaikan image', async () => {
  const cases = [
    {
      client: (capture: CapturedRequest) =>
        new OpenAILLMClient({
          apiKey: 'key-placeholder',
          model: 'openai-test',
          fetchImpl: createFetchMock(
            { choices: [{ message: { content: '{}' } }] },
            capture,
          ),
        }),
      imageExpected: true,
    },
    {
      client: (capture: CapturedRequest) =>
        new KimiLLMClient({
          apiKey: 'key-placeholder',
          model: 'kimi-test',
          fetchImpl: createFetchMock(
            { choices: [{ message: { content: '{}' } }] },
            capture,
          ),
        }),
      imageExpected: true,
    },
    {
      client: (capture: CapturedRequest) =>
        new DeepSeekLLMClient({
          apiKey: 'key-placeholder',
          model: 'deepseek-test',
          fetchImpl: createFetchMock(
            { choices: [{ message: { content: '{}' } }] },
            capture,
          ),
        }),
      imageExpected: false,
    },
  ];

  for (const item of cases) {
    const capture: CapturedRequest = {};
    await item.client(capture).complete('system', [
      'user',
      { type: 'image', data: Buffer.from('x'), mediaType: 'image/png' },
    ]);
    expect(JSON.stringify(capturedBody(capture)).includes('image_url')).toBe(
      item.imageExpected,
    );
  }
});

test('OpenCode memilih endpoint resmi berdasarkan keluarga model', async () => {
  const cases = [
    {
      model: 'deepseek-v4-pro',
      endpoint: '/chat/completions',
      response: { choices: [{ message: { content: '{}' } }] },
    },
    {
      model: 'claude-opus-5',
      endpoint: '/messages',
      response: { content: [{ type: 'text', text: '{}' }] },
    },
    {
      model: 'gpt-5.6-luna',
      endpoint: '/responses',
      response: { output_text: '{}' },
    },
    {
      model: 'gemini-3.7-flash',
      endpoint: '/models/gemini-3.7-flash:generateContent',
      response: {
        candidates: [{ content: { parts: [{ text: '{}' }] } }],
      },
    },
  ];

  for (const item of cases) {
    const capture: CapturedRequest = {};
    const client = new OpenCodeLLMClient({
      apiKey: 'key-placeholder',
      model: item.model,
      fetchImpl: createFetchMock(item.response, capture),
    });
    await client.complete('system', ['user']);
    expect(capture.url).toBe(`https://opencode.ai/zen/v1${item.endpoint}`);
  }
});

test('OpenCode Go memakai base URL terpisah dengan API key yang sama', async () => {
  const capture: CapturedRequest = {};
  const client = new OpenCodeLLMClient({
    apiKey: 'key-placeholder',
    model: 'deepseek-v4-pro',
    providerName: 'opencode-go',
    fetchImpl: createFetchMock(
      { choices: [{ message: { content: '{}' } }] },
      capture,
    ),
  });
  await client.complete('system', ['user']);
  expect(capture.url).toBe(
    'https://opencode.ai/zen/go/v1/chat/completions',
  );
});

test('rate limit dinormalisasi menjadi ProviderError retryable', async () => {
  const capture: CapturedRequest = {};
  const client = new DeepSeekLLMClient({
    apiKey: 'key-placeholder',
    model: 'deepseek-test',
    fetchImpl: createFetchMock({ error: 'rate limit' }, capture, 429),
  });

  const error = await client.complete('system', ['user']).catch((caught) => caught);
  expect(error).toBeInstanceOf(ProviderError);
  expect(error).toMatchObject({
    provider: 'deepseek',
    statusCode: 429,
    retryable: true,
  });
  expect(capture.calls).toBe(3);
});
