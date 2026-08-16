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

const PROVIDER_TIMEOUT_MS = 30_000;

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
 * Keterangan: Melakukan POST JSON ke provider dengan timeout dan menormalkan
 * network/rate-limit/HTTP/JSON error menjadi ProviderError.
 */
export async function postProviderJson<T>(
  provider: ProviderName,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  fetchImpl: FetchImplementation,
): Promise<T> {
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
    throw new ProviderError(provider, 'Request jaringan gagal', {
      retryable: true,
      cause: error,
    });
  }

  if (!response.ok) {
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

  return {
    status,
    ...(reason ? { reason } : {}),
    ...(detail ? { detail } : {}),
    ...(solution ? { solution } : {}),
  };
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
