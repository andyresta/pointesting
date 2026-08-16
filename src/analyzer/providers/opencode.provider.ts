import { config } from '../../config/env';
import type { LLMClient, LLMUserContent } from '../llm-client.interface';
import { ProviderError } from '../provider.error';
import {
  BaseAnalyzerProvider,
  type FetchImplementation,
  assertProviderConfigured,
  joinTextContent,
  postProviderJson,
} from './provider-utils';

const OPENCODE_ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

type OpenCodeProtocol = 'chat' | 'messages' | 'responses' | 'gemini';

interface ChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

interface MessagesResponse {
  content?: Array<{ type?: unknown; text?: unknown }>;
}

interface ResponsesResponse {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{ type?: unknown; text?: unknown }>;
  }>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown }>;
    };
  }>;
}

export interface OpenCodeClientOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchImplementation;
}

/**
 * Keterangan: Memilih protokol resmi OpenCode Zen berdasarkan keluarga model:
 * Claude→Messages, GPT/Grok→Responses, Gemini→generateContent, lainnya→Chat.
 */
function getOpenCodeProtocol(model: string): OpenCodeProtocol {
  if (model.startsWith('claude-')) {
    return 'messages';
  }
  if (model.startsWith('gpt-') || model.startsWith('grok-')) {
    return 'responses';
  }
  if (model.startsWith('gemini-')) {
    return 'gemini';
  }
  return 'chat';
}

/**
 * Keterangan: Mengambil dan menggabungkan text block dari response protokol
 * OpenCode Zen yang berbeda-beda.
 */
function extractOpenCodeText(
  protocol: OpenCodeProtocol,
  payload: ChatResponse | MessagesResponse | ResponsesResponse | GeminiResponse,
): string {
  if (protocol === 'chat') {
    const text = (payload as ChatResponse).choices?.[0]?.message?.content;
    return typeof text === 'string' ? text.trim() : '';
  }
  if (protocol === 'messages') {
    return (
      (payload as MessagesResponse).content
        ?.filter(
          (item): item is { type?: unknown; text: string } =>
            item.type === 'text' && typeof item.text === 'string',
        )
        .map((item) => item.text)
        .join('\n')
        .trim() ?? ''
    );
  }
  if (protocol === 'responses') {
    const response = payload as ResponsesResponse;
    if (typeof response.output_text === 'string') {
      return response.output_text.trim();
    }
    return (
      response.output
        ?.flatMap((item) => item.content ?? [])
        .filter(
          (item): item is { type?: unknown; text: string } =>
            item.type === 'output_text' && typeof item.text === 'string',
        )
        .map((item) => item.text)
        .join('\n')
        .trim() ?? ''
    );
  }

  return (
    (payload as GeminiResponse).candidates?.[0]?.content?.parts
      ?.filter(
        (part): part is { text: string } => typeof part.text === 'string',
      )
      .map((part) => part.text)
      .join('\n')
      .trim() ?? ''
  );
}

export class OpenCodeLLMClient implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchImplementation;

  /**
   * Keterangan: Membuat client OpenCode Zen multi-protocol berdasarkan model
   * dinamis yang dipilih dari katalog provider.
   */
  constructor(options: OpenCodeClientOptions = {}) {
    this.apiKey = options.apiKey ?? config.providers.opencode.apiKey;
    this.model = options.model ?? config.providers.opencode.defaultModel;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Keterangan: Mengirim text content melalui endpoint resmi keluarga model
   * OpenCode Zen; screenshot diabaikan karena kemampuan vision tidak seragam.
   */
  async complete(
    systemPrompt: string,
    userContent: LLMUserContent[],
  ): Promise<string> {
    assertProviderConfigured('opencode', this.apiKey, this.model);
    const protocol = getOpenCodeProtocol(this.model);
    const userText = joinTextContent(userContent);
    const headers = { Authorization: `Bearer ${this.apiKey}` };

    let endpoint: string;
    let body: unknown;
    if (protocol === 'messages') {
      endpoint = `${OPENCODE_ZEN_BASE_URL}/messages`;
      body = {
        model: this.model,
        max_tokens: 1_000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      };
    } else if (protocol === 'responses') {
      endpoint = `${OPENCODE_ZEN_BASE_URL}/responses`;
      body = {
        model: this.model,
        instructions: systemPrompt,
        input: userText,
      };
    } else if (protocol === 'gemini') {
      endpoint = `${OPENCODE_ZEN_BASE_URL}/models/${encodeURIComponent(this.model)}:generateContent`;
      body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { responseMimeType: 'application/json' },
      };
    } else {
      endpoint = `${OPENCODE_ZEN_BASE_URL}/chat/completions`;
      body = {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
      };
    }

    const payload = await postProviderJson<
      ChatResponse | MessagesResponse | ResponsesResponse | GeminiResponse
    >('opencode', endpoint, headers, body, this.fetchImpl);
    const responseText = extractOpenCodeText(protocol, payload);
    if (!responseText) {
      throw new ProviderError(
        'opencode',
        `Response protokol ${protocol} tidak memiliki text`,
      );
    }
    return responseText;
  }
}

export class OpenCodeAnalyzerProvider extends BaseAnalyzerProvider {
  /**
   * Keterangan: Membuat analyzer OpenCode Zen text-only secara konservatif
   * karena dukungan image berbeda pada tiap model katalog dinamis.
   */
  constructor(client: LLMClient = new OpenCodeLLMClient()) {
    super('opencode', false, client);
  }
}

export const opencodeLLMClient = new OpenCodeLLMClient();
export const opencodeAnalyzerProvider = new OpenCodeAnalyzerProvider(
  opencodeLLMClient,
);
