import { config } from '../../config/env';
import type { LLMClient } from '../llm-client.interface';
import {
  BaseAnalyzerProvider,
  OpenAICompatibleLLMClient,
  type FetchImplementation,
} from './provider-utils';

const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';

export interface DeepSeekClientOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchImplementation;
}

export class DeepSeekLLMClient extends OpenAICompatibleLLMClient {
  /**
   * Keterangan: Membuat client DeepSeek Chat Completions text-only dengan JSON
   * output; screenshot pada content generik diabaikan dengan aman.
   */
  constructor(options: DeepSeekClientOptions = {}) {
    super(
      'deepseek',
      DEEPSEEK_CHAT_URL,
      options.apiKey ?? config.providers.deepseek.apiKey,
      options.model ?? config.providers.deepseek.defaultModel,
      false,
      true,
      options.fetchImpl,
    );
  }
}

export class DeepSeekAnalyzerProvider extends BaseAnalyzerProvider {
  /**
   * Keterangan: Membuat analyzer DeepSeek text-only; screenshots tidak
   * diteruskan tetapi tidak menyebabkan error.
   */
  constructor(client: LLMClient = new DeepSeekLLMClient()) {
    super('deepseek', false, client);
  }
}

export const deepseekLLMClient = new DeepSeekLLMClient();
export const deepseekAnalyzerProvider = new DeepSeekAnalyzerProvider(
  deepseekLLMClient,
);
