import { config } from '../../config/env';
import type { LLMClient } from '../llm-client.interface';
import {
  BaseAnalyzerProvider,
  OpenAICompatibleLLMClient,
  type FetchImplementation,
} from './provider-utils';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

export interface OpenAIClientOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchImplementation;
}

export class OpenAILLMClient extends OpenAICompatibleLLMClient {
  /**
   * Keterangan: Membuat client OpenAI Chat Completions dengan JSON mode dan
   * dukungan image_url berbasis data URL.
   */
  constructor(options: OpenAIClientOptions = {}) {
    super(
      'openai',
      OPENAI_CHAT_URL,
      options.apiKey ?? config.providers.openai.apiKey,
      options.model ?? config.providers.openai.defaultModel,
      true,
      true,
      options.fetchImpl,
    );
  }
}

export class OpenAIAnalyzerProvider extends BaseAnalyzerProvider {
  /**
   * Keterangan: Membuat analyzer OpenAI multimodal di atas LLMClient generik.
   */
  constructor(client: LLMClient = new OpenAILLMClient()) {
    super('openai', true, client);
  }
}

export const openaiLLMClient = new OpenAILLMClient();
export const openaiAnalyzerProvider = new OpenAIAnalyzerProvider(
  openaiLLMClient,
);
