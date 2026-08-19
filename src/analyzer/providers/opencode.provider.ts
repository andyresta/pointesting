import { config, type ProviderName } from '../../config/env';
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
const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
// Generator butuh output JSON banyak step; 1000 token gampang terpotong.
const MESSAGES_PROTOCOL_MAX_TOKENS = 8_192;

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
  providerName?: Extract<ProviderName, 'opencode' | 'opencode-go'>;
  baseUrl?: string;
}

/**
 * Keterangan: Memilih protokol resmi OpenCode Zen/Go berdasarkan keluarga
 * model, sesuai tabel endpoint resmi (https://opencode.ai/docs/zen dan
 * https://opencode.ai/docs/go). Claude/Qwen selalu Messages (Anthropic);
 * MiniMax hanya Messages khusus di produk Go (di Zen tetap Chat Completions);
 * GPT/Grok/Muse→Responses; Gemini→generateContent; sisanya→Chat Completions.
 */
function getOpenCodeProtocol(
  model: string,
  providerName: Extract<ProviderName, 'opencode' | 'opencode-go'>,
): OpenCodeProtocol {
  if (model.startsWith('claude-') || model.startsWith('qwen')) {
    return 'messages';
  }
  if (model.startsWith('minimax-') && providerName === 'opencode-go') {
    return 'messages';
  }
  if (
    model.startsWith('gpt-') ||
    model.startsWith('grok-') ||
    model.startsWith('muse-')
  ) {
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
  private readonly providerName: Extract<ProviderName, 'opencode' | 'opencode-go'>;
  private readonly baseUrl: string;

  /**
   * Keterangan: Membuat client OpenCode multi-protocol. Zen dan Go memakai
   * API key yang sama, tetapi base URL berbeda sesuai produk yang dipilih.
   */
  constructor(options: OpenCodeClientOptions = {}) {
    this.providerName = options.providerName ?? 'opencode';
    this.baseUrl =
      options.baseUrl ??
      (this.providerName === 'opencode-go'
        ? OPENCODE_GO_BASE_URL
        : OPENCODE_ZEN_BASE_URL);
    const providerConfig = config.providers[this.providerName];
    this.apiKey = options.apiKey ?? providerConfig.apiKey;
    this.model = options.model ?? providerConfig.defaultModel;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Keterangan: Mengirim text content melalui endpoint resmi keluarga model
   * OpenCode; screenshot diabaikan karena kemampuan vision tidak seragam.
   */
  async complete(
    systemPrompt: string,
    userContent: LLMUserContent[],
  ): Promise<string> {
    assertProviderConfigured(this.providerName, this.apiKey, this.model);
    const protocol = getOpenCodeProtocol(this.model, this.providerName);
    const userText = joinTextContent(userContent);
    const headers = { Authorization: `Bearer ${this.apiKey}` };

    let endpoint: string;
    let body: unknown;
    if (protocol === 'messages') {
      endpoint = `${this.baseUrl}/messages`;
      body = {
        model: this.model,
        max_tokens: MESSAGES_PROTOCOL_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      };
    } else if (protocol === 'responses') {
      endpoint = `${this.baseUrl}/responses`;
      body = {
        model: this.model,
        instructions: systemPrompt,
        input: userText,
      };
    } else if (protocol === 'gemini') {
      endpoint = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
      body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { responseMimeType: 'application/json' },
      };
    } else {
      endpoint = `${this.baseUrl}/chat/completions`;
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
    >(this.providerName, endpoint, headers, body, this.fetchImpl);
    const responseText = extractOpenCodeText(protocol, payload);
    if (!responseText) {
      throw new ProviderError(
        this.providerName,
        `Response protokol ${protocol} tidak memiliki text`,
      );
    }
    return responseText;
  }
}

export class OpenCodeAnalyzerProvider extends BaseAnalyzerProvider {
  /**
   * Keterangan: Membuat analyzer OpenCode text-only secara konservatif
   * karena dukungan image berbeda pada tiap model katalog dinamis.
   */
  constructor(
    client: LLMClient = new OpenCodeLLMClient(),
    providerName: Extract<ProviderName, 'opencode' | 'opencode-go'> = 'opencode',
  ) {
    super(providerName, false, client);
  }
}

export const opencodeLLMClient = new OpenCodeLLMClient();
export const opencodeAnalyzerProvider = new OpenCodeAnalyzerProvider(
  opencodeLLMClient,
);
export const opencodeGoLLMClient = new OpenCodeLLMClient({
  providerName: 'opencode-go',
});
export const opencodeGoAnalyzerProvider = new OpenCodeAnalyzerProvider(
  opencodeGoLLMClient,
  'opencode-go',
);
