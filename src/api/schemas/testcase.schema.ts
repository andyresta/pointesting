import { z } from 'zod';
import { ApiError } from '../errors';

/**
 * Keterangan: Enum action resmi sesuai docs/arsitektur-spesifikasi-teknis.md
 * bagian 4.1 — dipakai bersama schema API dan (nanti) testcase-compiler.
 */
export const TEST_CASE_ACTIONS = [
  'goto',
  'fill',
  'click',
  'check',
  'select',
  'waitFor',
] as const;

export type TestCaseAction = (typeof TEST_CASE_ACTIONS)[number];

const nonEmptyString = (field: string) =>
  z
    .string({ error: () => ({ message: `Field "${field}" wajib diisi` }) })
    .min(1, `Field "${field}" wajib diisi`);

/**
 * Keterangan: Schema satu step test case. Field wajib berbeda per action
 * (goto→url, fill/select→selector+value, click/check/waitFor→selector).
 * Field lain yang tidak relevan boleh diabaikan/dihilangkan.
 */
export const testCaseStepSchema = z.discriminatedUnion(
  'action',
  [
    z.object({
      action: z.literal('goto'),
      url: nonEmptyString('url'),
    }),
    z.object({
      action: z.literal('fill'),
      selector: nonEmptyString('selector'),
      value: nonEmptyString('value'),
    }),
    z.object({
      action: z.literal('click'),
      selector: nonEmptyString('selector'),
    }),
    z.object({
      action: z.literal('check'),
      selector: nonEmptyString('selector'),
    }),
    z.object({
      action: z.literal('select'),
      selector: nonEmptyString('selector'),
      value: nonEmptyString('value'),
    }),
    z.object({
      action: z.literal('waitFor'),
      selector: nonEmptyString('selector'),
    }),
  ],
  {
    error: `Field "action" wajib salah satu dari: ${TEST_CASE_ACTIONS.join(', ')}`,
  },
);

export const expectedSchema = z
  .array(nonEmptyString('expected[]'), {
    error: 'Field "expected" wajib berupa array of string',
  })
  .min(1, 'Field "expected" wajib minimal 1 item');

export const stepsSchema = z
  .array(testCaseStepSchema, {
    error: 'Field "steps" wajib berupa array of step object',
  })
  .min(1, 'Field "steps" wajib minimal 1 item');

/**
 * Keterangan: Schema body POST /projects/:id/test-cases — title, steps,
 * expected wajib; source opsional (default "manual" di repository).
 */
export const createTestCaseBodySchema = z.object({
  title: nonEmptyString('title'),
  steps: stepsSchema,
  expected: expectedSchema,
  source: z.string().min(1).optional(),
});

/**
 * Keterangan: Schema body PATCH /test-cases/:id — semua field opsional,
 * tapi minimal satu field harus ada; kalau steps/expected dikirim harus
 * lolos schema penuh (bukan array kosong / step invalid).
 */
export const updateTestCaseBodySchema = z
  .object({
    title: nonEmptyString('title').optional(),
    steps: stepsSchema.optional(),
    expected: expectedSchema.optional(),
    source: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.steps !== undefined ||
      data.expected !== undefined ||
      data.source !== undefined,
    {
      message:
        'Tidak ada field valid untuk di-update (title/steps/expected/source)',
    },
  );

export type CreateTestCaseBody = z.infer<typeof createTestCaseBodySchema>;
export type UpdateTestCaseBody = z.infer<typeof updateTestCaseBodySchema>;
export type TestCaseStep = z.infer<typeof testCaseStepSchema>;

/**
 * Keterangan: Memformat error Zod jadi pesan singkat yang menyebut path
 * field yang salah (misal "steps[0].url: Field \"url\" wajib diisi"),
 * supaya response 400 mudah dibaca client/UI.
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * Keterangan: Menjalankan safeParse Zod dan melempar ApiError 400 dengan
 * pesan field-spesifik jika validasi gagal. Dipakai di route handler.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    throw new ApiError(400, formatZodError(parsed.error));
  }

  return parsed.data;
}
