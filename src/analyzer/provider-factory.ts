import type { ProviderConfig, ProviderName } from '../config/env';
import type { LLMClient } from './llm-client.interface';
import type { AnalyzerProvider } from './provider.interface';
import { ClaudeAnalyzerProvider, ClaudeLLMClient } from './providers/claude.provider';
import { DeepSeekAnalyzerProvider, DeepSeekLLMClient } from './providers/deepseek.provider';
import { KimiAnalyzerProvider, KimiLLMClient } from './providers/kimi.provider';
import { OpenAIAnalyzerProvider, OpenAILLMClient } from './providers/openai.provider';
import {
  OpenCodeAnalyzerProvider,
  OpenCodeLLMClient,
} from './providers/opencode.provider';
import { logProviderResult } from './providers/provider-utils';

/**
 * Keterangan: Membungkus LLMClient supaya setiap response provider dicatat
 * ke console server, tanpa mengubah kontrak complete().
 */
function withProviderResultLog(
  provider: ProviderName,
  model: string,
  client: LLMClient,
): LLMClient {
  return {
    async complete(systemPrompt, userContent) {
      try {
        const result = await client.complete(systemPrompt, userContent);
        logProviderResult(provider, model, result);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ai] ${provider} model=${model} error=${message}`);
        throw error;
      }
    },
  };
}

/**
 * Keterangan: Membuat LLMClient generik satu provider (Fase 2 analyzer dan
 * generate test case memakai factory yang sama).
 */
export function createLLMClient(
  provider: ProviderName,
  apiKey: string,
  model: string,
): LLMClient {
  const client = createRawLLMClient(provider, apiKey, model);
  return withProviderResultLog(provider, model, client);
}

/**
 * Keterangan: Membuat instance LLMClient vendor tanpa wrapper log, dipakai
 * internal factory sebelum response di-tulis ke console.
 */
function createRawLLMClient(
  provider: ProviderName,
  apiKey: string,
  model: string,
): LLMClient {
  switch (provider) {
    case 'claude':
      return new ClaudeLLMClient({ apiKey, model });
    case 'openai':
      return new OpenAILLMClient({ apiKey, model });
    case 'deepseek':
      return new DeepSeekLLMClient({ apiKey, model });
    case 'kimi':
      return new KimiLLMClient({ apiKey, model });
    case 'opencode':
      return new OpenCodeLLMClient({ apiKey, model, providerName: 'opencode' });
    case 'opencode-go':
      return new OpenCodeLLMClient({
        apiKey,
        model,
        providerName: 'opencode-go',
      });
  }
}

/**
 * Keterangan: Membuat instance analyzer satu provider memakai API key/model
 * runtime (dari project, bukan singleton env).
 */
export function createAnalyzerProvider(
  provider: ProviderName,
  apiKey: string,
  model: string,
): AnalyzerProvider {
  const client = createLLMClient(provider, apiKey, model);
  switch (provider) {
    case 'claude':
      return new ClaudeAnalyzerProvider(client);
    case 'openai':
      return new OpenAIAnalyzerProvider(client);
    case 'deepseek':
      return new DeepSeekAnalyzerProvider(client);
    case 'kimi':
      return new KimiAnalyzerProvider(client);
    case 'opencode':
      return new OpenCodeAnalyzerProvider(client, 'opencode');
    case 'opencode-go':
      return new OpenCodeAnalyzerProvider(client, 'opencode-go');
  }
}

/**
 * Keterangan: Menyusun map analyzer untuk semua provider dari konfigurasi
 * yang sudah digabung (key project menimpa env).
 */
export function createAnalyzerProviders(
  providerConfigs: Record<ProviderName, ProviderConfig>,
): Record<ProviderName, AnalyzerProvider> {
  return {
    claude: createAnalyzerProvider(
      'claude',
      providerConfigs.claude.apiKey,
      providerConfigs.claude.defaultModel,
    ),
    openai: createAnalyzerProvider(
      'openai',
      providerConfigs.openai.apiKey,
      providerConfigs.openai.defaultModel,
    ),
    deepseek: createAnalyzerProvider(
      'deepseek',
      providerConfigs.deepseek.apiKey,
      providerConfigs.deepseek.defaultModel,
    ),
    kimi: createAnalyzerProvider(
      'kimi',
      providerConfigs.kimi.apiKey,
      providerConfigs.kimi.defaultModel,
    ),
    opencode: createAnalyzerProvider(
      'opencode',
      providerConfigs.opencode.apiKey,
      providerConfigs.opencode.defaultModel,
    ),
    'opencode-go': createAnalyzerProvider(
      'opencode-go',
      providerConfigs['opencode-go'].apiKey,
      providerConfigs['opencode-go'].defaultModel,
    ),
  };
}
