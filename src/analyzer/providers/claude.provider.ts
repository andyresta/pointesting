import { config } from '../../config/env';
import type { LLMClient, LLMUserContent } from '../llm-client.interface';
import { ProviderError } from '../provider.error';
import {
  BaseAnalyzerProvider,
  type FetchImplementation,
  assertProviderConfigured,
  postProviderJson,
} from './provider-utils';

const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
// Generator butuh output JSON banyak step; 1000 token gampang terpotong.
const CLAUDE_MAX_TOKENS = 8_192;

interface ClaudeResponse {
  content?: Array<{ type?: unknown; text?: unknown }>;
}

export interface ClaudeClientOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchImplementation;
}

export class ClaudeLLMClient implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchImplementation;

  /**
   * Keterangan: Membuat client Anthropic Messages dengan config env sebagai
   * default dan dependency fetch opsional untuk pengujian.
   */
  constructor(options: ClaudeClientOptions = {}) {
    this.apiKey = options.apiKey ?? config.providers.claude.apiKey;
    this.model = options.model ?? config.providers.claude.defaultModel;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Keterangan: Mengubah content generik menjadi block text/image Anthropic
   * dan mengembalikan seluruh block text response yang tidak kosong.
   */
  async complete(
    systemPrompt: string,
    userContent: LLMUserContent[],
  ): Promise<string> {
    assertProviderConfigured('claude', this.apiKey, this.model);
    const content = userContent.map((item) =>
      typeof item === 'string'
        ? { type: 'text', text: item }
        : {
            type: 'image',
            source: {
              type: 'base64',
              media_type: item.mediaType,
              data: item.data.toString('base64'),
            },
          },
    );
    const payload = await postProviderJson<ClaudeResponse>(
      'claude',
      CLAUDE_MESSAGES_URL,
      {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model: this.model,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      },
      this.fetchImpl,
    );
    const responseText =
      payload.content
        ?.filter(
          (item): item is { type?: unknown; text: string } =>
            item.type === 'text' && typeof item.text === 'string',
        )
        .map((item) => item.text)
        .join('\n')
        .trim() ?? '';
    if (!responseText) {
      throw new ProviderError('claude', 'Response tidak memiliki block text');
    }
    return responseText;
  }
}

export class ClaudeAnalyzerProvider extends BaseAnalyzerProvider {
  /**
   * Keterangan: Membuat analyzer Claude multimodal di atas LLMClient generik.
   */
  constructor(client: LLMClient = new ClaudeLLMClient()) {
    super('claude', true, client);
  }
}

export const claudeLLMClient = new ClaudeLLMClient();
export const claudeAnalyzerProvider = new ClaudeAnalyzerProvider(
  claudeLLMClient,
);
