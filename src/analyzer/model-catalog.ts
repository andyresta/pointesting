import { config, type ProviderName } from '../config/env';

export interface ProviderModelCatalog {
  provider: ProviderName;
  defaultModel: string;
  models: string[];
  source: 'provider' | 'env_fallback';
  configured: boolean;
}

interface ModelListResponse {
  data?: Array<{ id?: unknown }>;
}

interface ProviderModelEndpoint {
  url: string;
  headers(apiKey: string): Record<string, string>;
  requiresApiKey: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const modelEndpoints: Record<ProviderName, ProviderModelEndpoint> = {
  claude: {
    url: 'https://api.anthropic.com/v1/models',
    requiresApiKey: true,
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    requiresApiKey: true,
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
  deepseek: {
    url: 'https://api.deepseek.com/models',
    requiresApiKey: true,
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
  kimi: {
    url: 'https://api.moonshot.ai/v1/models',
    requiresApiKey: true,
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
  opencode: {
    url: 'https://opencode.ai/zen/v1/models',
    requiresApiKey: false,
    headers: (apiKey) => {
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      return headers;
    },
  },
  'opencode-go': {
    url: 'https://opencode.ai/zen/go/v1/models',
    requiresApiKey: false,
    headers: (apiKey) => {
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      return headers;
    },
  },
};

const catalogCache = new Map<
  ProviderName,
  { expiresAt: number; catalog: ProviderModelCatalog }
>();

/**
 * Keterangan: Memastikan response endpoint model provider berbentuk daftar
 * ID model string, membuang item invalid/duplikat, lalu mengurutkannya agar
 * pilihan di UI stabil.
 */
function parseModelIds(payload: ModelListResponse): string[] {
  const modelIds =
    payload.data
      ?.map((model) => model.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0) ?? [];

  return [...new Set(modelIds)].sort((left, right) => left.localeCompare(right));
}

/**
 * Keterangan: Mengambil katalog model langsung dari endpoint resmi provider.
 * Request dibatasi 10 detik dan API key hanya dikirim lewat header server-side,
 * tidak pernah diteruskan ke client/UI.
 */
async function fetchProviderModels(
  provider: ProviderName,
  apiKey: string,
): Promise<string[]> {
  const endpoint = modelEndpoints[provider];

  if (endpoint.requiresApiKey && !apiKey) {
    throw new Error(`API key provider "${provider}" belum dikonfigurasi`);
  }

  const response = await fetch(endpoint.url, {
    method: 'GET',
    headers: endpoint.headers(apiKey),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Provider "${provider}" mengembalikan HTTP ${response.status}`);
  }

  const models = parseModelIds((await response.json()) as ModelListResponse);
  if (models.length === 0) {
    throw new Error(`Provider "${provider}" tidak mengembalikan daftar model`);
  }

  return models;
}

/**
 * Keterangan: Mengambil pilihan model satu provider untuk UI. Sumber utama
 * adalah katalog dinamis milik provider; `*_MODELS` dari env hanya fallback
 * ketika API key belum tersedia atau endpoint provider sedang gagal.
 * Hasil remote di-cache lima menit agar UI tidak memanggil provider berulang.
 */
export async function getProviderModelCatalog(
  provider: ProviderName,
  forceRefresh = false,
  apiKeyOverride?: string,
): Promise<ProviderModelCatalog> {
  const skipCache = Boolean(apiKeyOverride);
  const cached = catalogCache.get(provider);
  if (!skipCache && !forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.catalog;
  }

  const providerConfig = config.providers[provider];
  const apiKey = apiKeyOverride?.trim() || providerConfig.apiKey;

  try {
    const models = await fetchProviderModels(provider, apiKey);
    const catalog: ProviderModelCatalog = {
      provider,
      defaultModel:
        providerConfig.defaultModel && models.includes(providerConfig.defaultModel)
          ? providerConfig.defaultModel
          : models[0]!,
      models,
      source: 'provider',
      configured: Boolean(apiKey),
    };

    if (!skipCache) {
      catalogCache.set(provider, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        catalog,
      });
    }
    return catalog;
  } catch {
    return {
      provider,
      defaultModel: providerConfig.defaultModel || providerConfig.availableModels[0] || '',
      models: providerConfig.availableModels,
      source: 'env_fallback',
      configured: Boolean(apiKey),
    };
  }
}

/**
 * Keterangan: Mengambil katalog semua provider secara paralel untuk membangun
 * dropdown provider/model di UI tanpa mengekspos credential provider.
 */
export async function getAllProviderModelCatalogs(
  forceRefresh = false,
): Promise<ProviderModelCatalog[]> {
  const providers = Object.keys(config.providers) as ProviderName[];
  return Promise.all(
    providers.map((provider) => getProviderModelCatalog(provider, forceRefresh)),
  );
}
