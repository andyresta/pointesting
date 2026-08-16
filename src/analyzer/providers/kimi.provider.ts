import { config } from '../../config/env';
import type { LLMClient } from '../llm-client.interface';
import {
  BaseAnalyzerProvider,
  OpenAICompatibleLLMClient,
  type FetchImplementation,
} from './provider-utils';

const KIMI_CHAT_URL = 'https://api.moonshot.ai/v1/chat/completions';

export interface KimiClientOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchImplementation;
}

export class KimiLLMClient extends OpenAICompatibleLLMClient {
  /**
   * Keterangan: Membuat client Kimi/Moonshot OpenAI-compatible dengan JSON
   * mode dan vision content data URL sesuai API resmi.
   */
  constructor(options: KimiClientOptions = {}) {
    super(
      'kimi',
      KIMI_CHAT_URL,
      options.apiKey ?? config.providers.kimi.apiKey,
      options.model ?? config.providers.kimi.defaultModel,
      true,
      true,
      options.fetchImpl,
    );
  }
}

export class KimiAnalyzerProvider extends BaseAnalyzerProvider {
  /**
   * Keterangan: Membuat analyzer Kimi multimodal di atas LLMClient generik.
   */
  constructor(client: LLMClient = new KimiLLMClient()) {
    super('kimi', true, client);
  }
}

export const kimiLLMClient = new KimiLLMClient();
export const kimiAnalyzerProvider = new KimiAnalyzerProvider(kimiLLMClient);
