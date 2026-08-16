import type { ProviderName } from '../config/env';

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly cause?: unknown;

  /**
   * Keterangan: Membungkus kegagalan provider dengan identitas vendor, status
   * HTTP, dan petunjuk retry agar fallback Step 18 dapat mengambil keputusan.
   */
  constructor(
    provider: ProviderName,
    message: string,
    options: {
      statusCode?: number;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.statusCode = options.statusCode;
    this.retryable =
      options.retryable ??
      (options.statusCode === 429 ||
        (options.statusCode !== undefined && options.statusCode >= 500));
    this.cause = options.cause;
  }
}
