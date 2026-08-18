import type { ProviderName } from '../../config/env';
import type {
  ImageInput,
  LLMClient,
  LLMUserContent,
} from '../llm-client.interface';
import { STATUS_DEFINITIONS } from '../prompt-builder';
import { ProviderError } from '../provider.error';
import type {
  AnalysisResult,
  AnalyzerInput,
  AnalyzerProvider,
} from '../provider.interface';

export type FetchImplementation = typeof fetch;

const PROVIDER_TIMEOUT_MS = 45_000;
const PROVIDER_MAX_ATTEMPTS = 3;
const PROVIDER_RETRY_DELAY_MS = 800;
const RAW_PROVIDER_RESPONSE = Symbol('rawProviderResponse');
const PROVIDER_RESULT_LOG_LIMIT = 20_000;

type AnalysisResultWithRawResponse = AnalysisResult & {
  [RAW_PROVIDER_RESPONSE]?: string;
};

/**
 * Keterangan: Menulis response mentah provider AI ke stdout (terminal server)
 * tanpa API key atau prompt, supaya hasil generate/analisis bisa ditelusuri.
 */
export function logProviderResult(
  provider: ProviderName,
  model: string,
  result: string,
): void {
  const trimmed = result.trim();
  const body =
    trimmed.length > PROVIDER_RESULT_LOG_LIMIT
      ? `${trimmed.slice(0, PROVIDER_RESULT_LOG_LIMIT)}\n… [dipotong ${trimmed.length - PROVIDER_RESULT_LOG_LIMIT} karakter]`
      : trimmed;
  console.log(`[ai] ${provider} model=${model}\n${body}`);
}

/**
 * Keterangan: Memastikan API key dan model tersedia saat provider benar-benar
 * dipakai; config kosong tetap diperbolehkan saat startup aplikasi.
 */
export function assertProviderConfigured(
  provider: ProviderName,
  apiKey: string,
  model: string,
): void {
  if (!apiKey) {
    throw new ProviderError(provider, 'API key belum dikonfigurasi');
  }
  if (!model) {
    throw new ProviderError(provider, 'Model default belum dikonfigurasi');
  }
}

/**
 * Keterangan: Memberi jeda backoff pendek sebelum satu retry provider agar
 * rate-limit/transient server error tidak langsung membebani endpoint lagi.
 */
async function waitBeforeProviderRetry(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, PROVIDER_RETRY_DELAY_MS * attempt);
  });
}

/**
 * Keterangan: Mengecek apakah error fetch berasal dari AbortSignal.timeout
 * (bukan koneksi putus) supaya pesan ke user lebih tepat sasaran.
 */
function isProviderTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

/**
 * Keterangan: Melakukan POST JSON ke provider dengan timeout dan menormalkan
 * network/rate-limit/HTTP/JSON error menjadi ProviderError. Network, HTTP 429,
 * dan 5xx dicoba ulang dengan backoff bertahap sebelum fallback lintas vendor
 * (jaringan ke sebagian provider bisa lambat/tidak stabil).
 */
export async function postProviderJson<T>(
  provider: ProviderName,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  fetchImpl: FetchImplementation,
): Promise<T> {
  for (let attempt = 1; attempt <= PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt < PROVIDER_MAX_ATTEMPTS) {
        await waitBeforeProviderRetry(attempt);
        continue;
      }
      const message = isProviderTimeoutError(error)
        ? `Request timeout setelah ${PROVIDER_TIMEOUT_MS / 1000} detik (percobaan ${PROVIDER_MAX_ATTEMPTS}x)`
        : 'Request jaringan gagal';
      throw new ProviderError(provider, message, {
        retryable: true,
        cause: error,
      });
    }

    const retryableStatus = response.status === 429 || response.status >= 500;
    if (!response.ok) {
      if (retryableStatus && attempt < PROVIDER_MAX_ATTEMPTS) {
        await waitBeforeProviderRetry(attempt);
        continue;
      }
      throw new ProviderError(
        provider,
        `Provider mengembalikan HTTP ${response.status}`,
        { statusCode: response.status },
      );
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new ProviderError(provider, 'Response bukan JSON valid', {
        cause: error,
      });
    }
  }

  throw new ProviderError(provider, 'Request gagal setelah retry', {
    retryable: true,
  });
}

/**
 * Keterangan: Menggabungkan bagian teks user menjadi satu string untuk
 * provider text-only; ImageInput sengaja diabaikan.
 */
export function joinTextContent(userContent: LLMUserContent[]): string {
  return userContent
    .filter((item): item is string => typeof item === 'string')
    .join('\n\n');
}

/**
 * Keterangan: Mengubah Buffer gambar menjadi data URL untuk API kompatibel
 * OpenAI/Kimi yang menerima image_url.
 */
export function imageToDataUrl(image: ImageInput): string {
  return `data:${image.mediaType};base64,${image.data.toString('base64')}`;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

export abstract class OpenAICompatibleLLMClient implements LLMClient {
  /**
   * Keterangan: Menyimpan konfigurasi dasar API Chat Completions kompatibel
   * OpenAI untuk dipakai adapter OpenAI, DeepSeek, Kimi, dan OpenCode Zen.
   */
  constructor(
    protected readonly provider: ProviderName,
    protected readonly endpoint: string,
    protected readonly apiKey: string,
    protected readonly model: string,
    protected readonly supportsImage: boolean,
    protected readonly useJsonResponseFormat: boolean,
    protected readonly fetchImpl: FetchImplementation = fetch,
  ) {}

  /**
   * Keterangan: Mengubah input generik menjadi Chat Completions request dan
   * mengambil choices[0].message.content sebagai teks.
   */
  async complete(
    systemPrompt: string,
    userContent: LLMUserContent[],
  ): Promise<string> {
    assertProviderConfigured(this.provider, this.apiKey, this.model);

    const hasImages =
      this.supportsImage &&
      userContent.some((item) => typeof item !== 'string');
    const content = hasImages
      ? userContent.map((item) =>
          typeof item === 'string'
            ? { type: 'text', text: item }
            : {
                type: 'image_url',
                image_url: { url: imageToDataUrl(item) },
              },
        )
      : joinTextContent(userContent);

    const payload = await postProviderJson<OpenAICompatibleResponse>(
      this.provider,
      this.endpoint,
      { Authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        ...(this.useJsonResponseFormat
          ? { response_format: { type: 'json_object' } }
          : {}),
      },
      this.fetchImpl,
    );
    const responseText = payload.choices?.[0]?.message?.content;
    if (typeof responseText !== 'string' || responseText.trim() === '') {
      throw new ProviderError(
        this.provider,
        'Response tidak memiliki message content',
      );
    }
    return responseText;
  }
}

/**
 * Keterangan: Mengambil JSON object dari response model, termasuk response
 * yang keliru dibungkus markdown code fence.
 */
function extractJsonObject(rawResponse: string): unknown {
  const trimmed = rawResponse.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
    }
    throw new Error('JSON object tidak ditemukan');
  }
}

/**
 * Keterangan: Memvalidasi output semua provider ke kontrak AnalysisResult yang
 * sama dan menolak field wajib yang kosong.
 */
export function parseAnalysisResult(
  provider: ProviderName,
  rawResponse: string,
): AnalysisResult {
  let payload: unknown;
  try {
    payload = extractJsonObject(rawResponse);
  } catch (error) {
    throw new ProviderError(provider, 'Output analisis bukan JSON valid', {
      cause: error,
    });
  }

  if (!payload || typeof payload !== 'object') {
    throw new ProviderError(provider, 'Output analisis harus berupa object');
  }

  const candidate = payload as Record<string, unknown>;
  const status = candidate.status;
  if (
    status !== 'success' &&
    status !== 'fail' &&
    status !== 'bug' &&
    status !== 'anomaly'
  ) {
    throw new ProviderError(provider, 'Status analisis tidak valid');
  }

  const reason =
    typeof candidate.reason === 'string' && candidate.reason.trim()
      ? candidate.reason.trim()
      : undefined;
  const detail =
    typeof candidate.detail === 'string' && candidate.detail.trim()
      ? candidate.detail.trim()
      : undefined;
  const solution =
    typeof candidate.solution === 'string' && candidate.solution.trim()
      ? candidate.solution.trim()
      : undefined;

  if (status === 'success' && !reason) {
    throw new ProviderError(
      provider,
      'Output status success wajib memiliki reason',
    );
  }
  if (status !== 'success' && (!detail || !solution)) {
    throw new ProviderError(
      provider,
      `Output status ${status} wajib memiliki detail dan solution`,
    );
  }

  const result: AnalysisResultWithRawResponse = {
    status,
    ...(reason ? { reason } : {}),
    ...(detail ? { detail } : {}),
    ...(solution ? { solution } : {}),
  };
  Object.defineProperty(result, RAW_PROVIDER_RESPONSE, {
    value: rawResponse,
    enumerable: false,
  });
  return result;
}

/**
 * Keterangan: Mengambil teks asli keluaran model yang disimpan adapter secara
 * non-enumerable; provider mock/custom akan memakai hasil ternormalisasi.
 */
export function getRawProviderResponse(
  result: AnalysisResult,
): string | AnalysisResult {
  return (result as AnalysisResultWithRawResponse)[RAW_PROVIDER_RESPONSE] ?? result;
}

/**
 * Keterangan: Menyusun content generik analyzer sekali untuk semua adapter.
 * Screenshot hanya ditambahkan bila provider menyatakan supportsImage.
 */
function buildAnalyzerUserContent(
  input: AnalyzerInput,
  supportsImage: boolean,
): LLMUserContent[] {
  const structuredInput = {
    expected: input.expected,
    consoleLogSummary: input.consoleLogSummary,
    networkLogSummary: input.networkLogSummary,
    traceSummary: input.traceSummary,
    historicalContext: input.historicalContext,
    healingEvents: input.healingEvents,
  };
  const content: LLMUserContent[] = [
    `Analisis bukti test berikut dan balas JSON saja:\n${JSON.stringify(structuredInput)}`,
  ];

  if (supportsImage) {
    for (const screenshot of input.screenshots ?? []) {
      content.push({
        type: 'image',
        data: screenshot,
        mediaType: 'image/png',
      });
    }
  }
  return content;
}

export abstract class BaseAnalyzerProvider implements AnalyzerProvider {
  /**
   * Keterangan: Menyimpan metadata provider dan LLMClient generik yang dipakai
   * untuk menghasilkan response analisis terstruktur.
   */
  constructor(
    public readonly name: ProviderName,
    public readonly supportsImage: boolean,
    protected readonly client: LLMClient,
  ) {}

  /**
   * Keterangan: Memanggil LLMClient dengan definisi status terpusat lalu
   * menormalkan response vendor menjadi AnalysisResult.
   */
  async analyze(input: AnalyzerInput): Promise<AnalysisResult> {
    const systemPrompt = [
      'Anda adalah AI analyzer untuk hasil automated web testing.',
      STATUS_DEFINITIONS,
      'Balas JSON object saja dengan schema:',
      '{"status":"success|fail|bug|anomaly","reason?":"...","detail?":"...","solution?":"..."}',
    ].join('\n\n');
    const rawResponse = await this.client.complete(
      systemPrompt,
      buildAnalyzerUserContent(input, this.supportsImage),
    );
    return parseAnalysisResult(this.name, rawResponse);
  }
}
