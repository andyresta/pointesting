import { z } from 'zod';
import {
  createTestCaseBodySchema,
  testCaseStepSchema,
  type CreateTestCaseBody,
  type TestCaseStep,
} from '../api/schemas/testcase.schema';
import {
  formatExplorationForPrompt,
  formatPageSummariesForPrompt,
  type PageExplorationResult,
  type PageSummary,
} from './page-explorer';

/**
 * Keterangan: Schema hasil generate AI — sama dengan create test case,
 * tetapi description/keterangan wajib 1–2 kalimat.
 */
const generatedTestCaseSchema = createTestCaseBodySchema.extend({
  description: z.string().trim().min(1, 'Field "description" wajib diisi'),
});

const generatedListSchema = z.object({
  testCases: z.array(generatedTestCaseSchema).min(1),
});

const explorationStepsSchema = z.object({
  steps: z.array(testCaseStepSchema).max(8),
});

export interface GenerationPromptInput {
  prompt: string;
  extraData?: string;
  baseUrl?: string | null;
  existingTitles?: string[];
  pageSnapshot?: PageExplorationResult;
  additionalPages?: PageSummary[];
}

/**
 * Keterangan: Menyusun system prompt generate test case sesuai kontrak steps
 * bagian 4.1. Selector wajib diambil dari snapshot halaman yang dianalisis.
 */
export function buildGenerationSystemPrompt(): string {
  return [
    'Anda menyusun test case automated web testing dari snapshot halaman nyata.',
    'Balas JSON saja, tanpa markdown dan tanpa teks lain.',
    'Format: {"testCases":[{"title":"...","description":"...","steps":[...],"expected":["..."]}]}',
    'steps memakai action: goto, fill, click, check, select, waitFor.',
    'goto wajib url. fill/select wajib selector+value. click/check/waitFor wajib selector.',
    'Wajib memakai selector dari daftar elemen halaman. Jangan mengarang id, name, atau selector yang tidak ada di snapshot.',
    'Pakai letak (x,y) hanya sebagai petunjuk visual, bukan sebagai selector.',
    'goto pertama harus ke URL halaman yang dianalisis atau path relatif dari base URL itu.',
    'Setiap test case wajib punya description: 1–2 kalimat keterangan tujuan uji.',
    'Jangan pakai data produksi sungguhan; credential hanya dummy uji.',
    'Kalau ada ringkasan halaman lain di prompt, boleh susun test case tambahan berupa navigasi (goto ke halaman itu, lalu waitFor heading/teks dari ringkasannya) untuk cakupan lebih luas, tapi JANGAN fill/click di halaman itu karena tidak ada data selector detailnya.',
  ].join(' ');
}

/**
 * Keterangan: Menyusun system prompt langkah browser singkat agar AI mengisi
 * form (misal login) sesuai instruction sebelum test case disusun.
 */
export function buildExplorationSystemPrompt(): string {
  return [
    'Anda menggerakkan browser pada halaman yang sudah terbuka sesuai instruction.',
    'Balas JSON saja, tanpa markdown dan tanpa teks lain.',
    'Format: {"steps":[{"action":"fill","selector":"...","value":"..."}]}',
    'steps memakai action: goto, fill, click, check, select, waitFor.',
    'Halaman sudah terbuka: jangan goto ke URL yang sama. Isi login/form dari instruction dan data tambahan.',
    'Wajib memakai selector dari snapshot. Jangan mengarang id/selector.',
    'Maksimal 8 langkah. Jika tidak perlu interaksi, balas {"steps":[]}.',
    'Jangan menyusun test case di response ini.',
  ].join(' ');
}

/**
 * Keterangan: Menyusun user prompt langkah eksplorasi dari instruction,
 * snapshot, dan data tambahan (kredensial dummy, selector, dsb.).
 */
export function buildExplorationUserPrompt(input: GenerationPromptInput): string {
  return buildGenerationUserPrompt(input);
}

/**
 * Keterangan: Menyusun user prompt dari instruction, snapshot tampilan
 * halaman (id/tombol/input/letak), data tambahan, dan test case yang sudah ada.
 */
export function buildGenerationUserPrompt(input: GenerationPromptInput): string {
  const parts = [
    `Instruction:\n${input.prompt.trim()}`,
    `Base URL project: ${input.baseUrl?.trim() || '(tidak diisi)'}`,
  ];
  if (input.pageSnapshot) {
    parts.push(
      `Snapshot tampilan halaman (hasil analisis browser):\n${formatExplorationForPrompt(input.pageSnapshot)}`,
    );
  }
  if (input.additionalPages && input.additionalPages.length > 0) {
    parts.push(formatPageSummariesForPrompt(input.additionalPages));
  }
  if (input.extraData?.trim()) {
    parts.push(`Data tambahan:\n${input.extraData.trim()}`);
  }
  if (input.existingTitles && input.existingTitles.length > 0) {
    parts.push(
      `Test case yang sudah ada (jangan diduplikasi):\n- ${input.existingTitles.join('\n- ')}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * Keterangan: Mengambil JSON object/array dari response model, termasuk yang
 * terbungkus markdown code fence.
 */
export function extractGeneratedJson(rawResponse: string): unknown {
  const trimmed = rawResponse.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const objectStart = withoutFence.indexOf('{');
    const objectEnd = withoutFence.lastIndexOf('}');
    const arrayStart = withoutFence.indexOf('[');
    const arrayEnd = withoutFence.lastIndexOf(']');
    if (
      arrayStart >= 0 &&
      arrayEnd > arrayStart &&
      (objectStart < 0 || arrayStart < objectStart)
    ) {
      return JSON.parse(withoutFence.slice(arrayStart, arrayEnd + 1)) as unknown;
    }
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(withoutFence.slice(objectStart, objectEnd + 1)) as unknown;
    }
    throw new Error('JSON test case tidak ditemukan pada response AI');
  }
}

/**
 * Keterangan: Menormalkan output LLM menjadi daftar test case yang lolos
 * schema API (title, description, steps, expected).
 */
export function parseGeneratedTestCases(rawResponse: string): CreateTestCaseBody[] {
  const payload = extractGeneratedJson(rawResponse);
  const wrapped = generatedListSchema.safeParse(payload);
  if (wrapped.success) {
    return wrapped.data.testCases;
  }

  const single = generatedTestCaseSchema.safeParse(payload);
  if (single.success) {
    return [single.data];
  }

  const list = z.array(generatedTestCaseSchema).min(1).safeParse(payload);
  if (list.success) {
    return list.data;
  }

  throw new Error(
    'Output AI tidak sesuai format test case (title, description, steps, expected)',
  );
}

/**
 * Keterangan: Menormalkan output AI menjadi langkah browser (boleh kosong)
 * untuk dijalankan di halaman yang sedang terbuka.
 */
export function parseExplorationSteps(rawResponse: string): TestCaseStep[] {
  const payload = extractGeneratedJson(rawResponse);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if ('testCases' in record || 'title' in record) {
      throw new Error('Output AI tidak sesuai format langkah eksplorasi');
    }
  }

  const wrapped = explorationStepsSchema.safeParse(payload);
  if (wrapped.success) {
    return wrapped.data.steps;
  }

  const list = z.array(testCaseStepSchema).max(8).safeParse(payload);
  if (list.success) {
    return list.data;
  }

  throw new Error('Output AI tidak sesuai format langkah eksplorasi');
}
