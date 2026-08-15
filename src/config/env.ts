import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

/**
 * Keterangan: Mengubah string CSV dari env ("a, b ,c") jadi array string
 * bersih (trim, buang item kosong). Dipakai untuk field *_MODELS per provider.
 */
function parseCsvList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Keterangan: Schema Zod untuk satu env provider AI (API key/model/daftar
 * model) — semuanya opsional dan default string kosong, dicek nanti saat
 * provider terkait benar-benar dipakai (Fase 2).
 */
const optionalEnvString = () => z.string().optional().default('');

/**
 * Keterangan: Schema Zod untuk environment variable aplikasi.
 * Variable wajib: DB_HOST, DB_NAME, DB_USER, AUTH_SECRET, AUTH_USERNAME,
 * AUTH_PASSWORD_HASH. DB_PORT default 5432, PORT server default 3000.
 * API key/model provider AI bersifat opsional (boleh kosong) — dicek nanti
 * saat provider terkait benar-benar dipakai (Fase 2).
 */
const envSchema = z.object({
  DB_HOST: z.string({ error: 'DB_HOST wajib diisi' }).min(1, 'DB_HOST wajib diisi'),
  DB_NAME: z.string({ error: 'DB_NAME wajib diisi' }).min(1, 'DB_NAME wajib diisi'),
  DB_PORT: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce.number().int().positive('DB_PORT harus berupa angka positif').default(5432),
  ),
  DB_USER: z.string({ error: 'DB_USER wajib diisi' }).min(1, 'DB_USER wajib diisi'),
  DB_PASS: z.string().optional().default(''),
  PORT: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce.number().int().positive('PORT harus berupa angka positif').default(3000),
  ),
  AUTH_SECRET: z
    .string({ error: 'AUTH_SECRET wajib diisi' })
    .min(1, 'AUTH_SECRET wajib diisi'),
  AUTH_USERNAME: z
    .string({ error: 'AUTH_USERNAME wajib diisi' })
    .min(1, 'AUTH_USERNAME wajib diisi'),
  AUTH_PASSWORD_HASH: z
    .string({ error: 'AUTH_PASSWORD_HASH wajib diisi (hash bcrypt, bukan plain text)' })
    .min(1, 'AUTH_PASSWORD_HASH wajib diisi (hash bcrypt, bukan plain text)'),

  CLAUDE_API_KEY: optionalEnvString(),
  CLAUDE_MODEL: optionalEnvString(),
  CLAUDE_MODELS: optionalEnvString(),

  OPENAI_API_KEY: optionalEnvString(),
  OPENAI_MODEL: optionalEnvString(),
  OPENAI_MODELS: optionalEnvString(),

  DEEPSEEK_API_KEY: optionalEnvString(),
  DEEPSEEK_MODEL: optionalEnvString(),
  DEEPSEEK_MODELS: optionalEnvString(),

  KIMI_API_KEY: optionalEnvString(),
  KIMI_MODEL: optionalEnvString(),
  KIMI_MODELS: optionalEnvString(),

  OPENCODE_API_KEY: optionalEnvString(),
  OPENCODE_MODEL: optionalEnvString(),
  OPENCODE_MODELS: optionalEnvString(),

  TEST_RUN_QUEUE_CONCURRENCY: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce
      .number()
      .int()
      .positive('TEST_RUN_QUEUE_CONCURRENCY harus berupa angka positif')
      .default(2),
  ),
  ANALYSIS_QUEUE_CONCURRENCY: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce
      .number()
      .int()
      .positive('ANALYSIS_QUEUE_CONCURRENCY harus berupa angka positif')
      .default(3),
  ),
});

type EnvShape = z.infer<typeof envSchema>;

/**
 * Keterangan: Konfigurasi satu provider AI yang sudah dirapikan — apiKey,
 * model default yang dipakai (defaultModel), dan daftar model yang bisa
 * dipilih (availableModels). Dipakai oleh analyzer/provider adapter di Fase 2.
 */
export interface ProviderConfig {
  apiKey: string;
  defaultModel: string;
  availableModels: string[];
}

export type ProviderName = 'claude' | 'openai' | 'deepseek' | 'kimi' | 'opencode';

export interface Config extends EnvShape {
  providers: Record<ProviderName, ProviderConfig>;
}

/**
 * Keterangan: Menyusun object ProviderConfig dari tiga env mentah
 * (*_API_KEY, *_MODEL, *_MODELS) satu provider. Kalau MODEL kosong tapi
 * MODELS terisi, model pertama di MODELS dipakai sebagai default.
 */
function buildProviderConfig(apiKey: string, model: string, modelsCsv: string): ProviderConfig {
  const availableModels = parseCsvList(modelsCsv);
  const defaultModel = model || availableModels[0] || '';

  return { apiKey, defaultModel, availableModels };
}

/**
 * Keterangan: Memformat pesan error validasi env agar jelas menyebut
 * variable mana yang hilang/tidak valid, supaya mudah diperbaiki di .env.
 */
function formatEnvError(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `  - ${key}: ${issue.message}`;
    })
    .join('\n');

  return [
    'Konfigurasi environment tidak valid. Periksa file .env:',
    details,
    'Salin dari .env.example lalu isi nilai yang wajib.',
  ].join('\n');
}

/**
 * Keterangan: Membaca process.env, memvalidasinya dengan Zod, lalu
 * mengembalikan object config yang sudah strongly-typed (termasuk
 * config.providers per provider AI). Jika gagal, mencetak pesan jelas dan
 * menghentikan proses (exit 1) agar server tidak jalan dengan config tidak
 * lengkap.
 */
function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(formatEnvError(parsed.error));
    process.exit(1);
  }

  const env = parsed.data;

  return {
    ...env,
    providers: {
      claude: buildProviderConfig(env.CLAUDE_API_KEY, env.CLAUDE_MODEL, env.CLAUDE_MODELS),
      openai: buildProviderConfig(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.OPENAI_MODELS),
      deepseek: buildProviderConfig(env.DEEPSEEK_API_KEY, env.DEEPSEEK_MODEL, env.DEEPSEEK_MODELS),
      kimi: buildProviderConfig(env.KIMI_API_KEY, env.KIMI_MODEL, env.KIMI_MODELS),
      opencode: buildProviderConfig(env.OPENCODE_API_KEY, env.OPENCODE_MODEL, env.OPENCODE_MODELS),
    },
  };
}

export const config: Config = loadConfig();
