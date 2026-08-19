import { z } from 'zod';
import { config, type ProviderConfig, type ProviderName } from '../config/env';
import { buildProviderOrder, mergeProviderConfigs } from './analyzer.service';
import { createLLMClient } from './provider-factory';
import { ProviderError } from './provider.error';
import { analysisResultRepository } from '../db/repositories/analysis-result.repository';
import { projectProviderRepository } from '../db/repositories/project-provider.repository';
import { projectRepository } from '../db/repositories/project.repository';
import { suiteAnalysisResultRepository } from '../db/repositories/suite-analysis-result.repository';
import { testCaseRepository } from '../db/repositories/test-case.repository';
import { testRunRepository } from '../db/repositories/test-run.repository';
import type {
  JsonValue,
  SuiteAnalysisFinding,
  SuiteAnalysisResultRecord,
  SuiteAnalysisStatus,
  TestRunStatus,
} from '../db/repositories/types';
import { broadcastToRun } from '../ws/gateway';

export interface AnalyzeSuiteRunInput {
  suiteRunId: string;
  projectId: string;
  testRunIds: string[];
}

interface SuiteAnalysisItem {
  testCaseTitle: string;
  testCaseDescription: string | null;
  testRunStatus: TestRunStatus;
  analysisStatus: string | null;
  analysisReason: string | null;
  analysisDetail: string | null;
  analysisSolution: string | null;
}

const suiteFindingSchema = z.object({
  category: z
    .enum(['inconsistency', 'coverage_gap', 'systemic_failure', 'other'])
    .catch('other'),
  title: z.string().min(1),
  detail: z.string().min(1),
  relatedTestCases: z.array(z.string()).optional(),
});

const suiteAnalysisOutputSchema = z.object({
  summary: z.string().optional(),
  findings: z.array(suiteFindingSchema).optional(),
});

/**
 * Keterangan: Menyusun instruksi Suite Analysis — beda dari AI Analyzer biasa
 * (Fase 2, per test_run) yang menilai satu run tunggal, ini secara eksplisit
 * mencari HUBUNGAN/POLA lintas test case: inkonsistensi antar fitur, coverage
 * gap dari daftar test case yang ada, dan pola kegagalan sistemik.
 */
function buildSuiteAnalysisSystemPrompt(): string {
  return [
    'Anda adalah QA lead yang meninjau hasil SEMUA test case dalam satu project setelah semuanya dijalankan.',
    'Tugas Anda mencari hal yang HANYA terlihat kalau membandingkan/menggabungkan banyak test case sekaligus — bukan mengulang detail satu test case saja.',
    'Balas JSON saja, tanpa markdown dan tanpa teks lain.',
    'Format: {"summary":"1-3 kalimat ringkasan kondisi keseluruhan","findings":[{"category":"inconsistency|coverage_gap|systemic_failure|other","title":"...","detail":"...","relatedTestCases":["judul test case persis"]}]}',
    'category "inconsistency": ada dua atau lebih test case yang seharusnya berhubungan (mis. data dibuat di satu fitur, seharusnya terlihat di fitur lain) tapi tidak ada test case yang menghubungkan/memverifikasi itu, atau hasil test case saling bertentangan.',
    'category "coverage_gap": berdasarkan judul/deskripsi test case yang ada, ada indikasi alur penting (mis. edit/hapus data padahal cuma ada test tambah, atau alur lanjutan dari suatu fitur) yang belum tercover test case apa pun — JANGAN menebak fitur yang sama sekali tidak disinggung test case manapun.',
    'category "systemic_failure": pola kegagalan/detail yang SAMA muncul berulang di banyak test case berbeda — indikasi bug sistemik/infrastruktur, bukan bug lokal satu halaman.',
    'category "other": temuan relevan lain yang tidak cocok tiga kategori di atas.',
    'relatedTestCases WAJIB memakai judul test case PERSIS seperti yang diberikan di prompt — jangan mengarang judul baru.',
    'JANGAN membuat finding yang cuma mengulang detail/solution satu test case saja — finding wajib melibatkan perbandingan/hubungan antar minimal dua test case, atau pola yang muncul di beberapa test case sekaligus.',
    'Kalau semua test case terlihat konsisten dan tidak ada temuan lintas-fitur yang berarti, balas findings sebagai array kosong — jangan memaksakan temuan.',
  ].join(' ');
}

/**
 * Keterangan: Menyusun daftar seluruh test case dalam suite beserta hasil
 * eksekusi dan analisis individualnya sebagai bahan Suite Analysis.
 */
function buildSuiteAnalysisUserPrompt(items: SuiteAnalysisItem[]): string {
  const lines = items.map((item, index) => {
    const parts = [`${index + 1}. "${item.testCaseTitle}"`];
    if (item.testCaseDescription) {
      parts.push(`   Deskripsi: ${item.testCaseDescription}`);
    }
    parts.push(`   Status eksekusi: ${item.testRunStatus}`);
    if (item.analysisStatus) {
      parts.push(`   Hasil AI Analyzer: ${item.analysisStatus}`);
      if (item.analysisStatus === 'success') {
        parts.push(`   Reason: ${item.analysisReason || '(kosong)'}`);
      } else {
        parts.push(`   Detail: ${item.analysisDetail || '(kosong)'}`);
        parts.push(`   Solution: ${item.analysisSolution || '(kosong)'}`);
      }
    } else {
      parts.push('   Hasil AI Analyzer: belum tersedia (analisis individual gagal/belum sempat jalan)');
    }
    return parts.join('\n');
  });
  return `Daftar seluruh test case yang dijalankan dalam satu suite run:\n\n${lines.join('\n\n')}`;
}

/**
 * Keterangan: Mengambil JSON object dari response model, termasuk yang
 * terbungkus markdown code fence. Duplikat kecil dari helper serupa di
 * generator (bukan diimpor lintas modul) supaya analyzer tetap berdiri
 * sendiri tanpa bergantung ke layer generate.
 */
function extractJsonPayload(rawResponse: string): unknown {
  const trimmed = rawResponse.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
    }
    throw new Error('JSON tidak ditemukan pada response AI');
  }
}

export function parseSuiteAnalysisOutput(rawResponse: string): {
  summary: string;
  findings: SuiteAnalysisFinding[];
} {
  const payload = extractJsonPayload(rawResponse);
  const parsed = suiteAnalysisOutputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error('Output AI tidak sesuai format suite analysis');
  }
  return {
    summary: parsed.data.summary ?? '',
    findings: (parsed.data.findings ?? []).map((finding) => ({
      category: finding.category,
      title: finding.title,
      detail: finding.detail,
      relatedTestCases: finding.relatedTestCases ?? [],
    })),
  };
}

function normalizeRawResponse(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

/**
 * Keterangan: Mencoba provider sesuai urutan fallback, memakai LLMClient
 * generik (bukan AnalyzerProvider) karena bentuk output Suite Analysis
 * (summary+findings) beda dari AnalysisResult (status/reason/detail/solution)
 * — pola yang sama seperti generator.service.ts memakai LLMClient untuk
 * kebutuhan di luar klasifikasi Fase 2.
 */
async function callSuiteAnalysisLLM(
  systemPrompt: string,
  userPrompt: string,
  providerOrder: ProviderName[],
  providerConfigs: Record<ProviderName, ProviderConfig>,
): Promise<{
  provider: ProviderName;
  raw: string;
  parsed: { summary: string; findings: SuiteAnalysisFinding[] };
} | null> {
  for (const providerName of providerOrder) {
    const providerConfig = providerConfigs[providerName];
    if (!providerConfig.apiKey || !providerConfig.defaultModel) {
      continue;
    }
    try {
      const client = createLLMClient(providerName, providerConfig.apiKey, providerConfig.defaultModel);
      const raw = await client.complete(systemPrompt, [userPrompt]);
      try {
        return { provider: providerName, raw, parsed: parseSuiteAnalysisOutput(raw) };
      } catch {
        continue;
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        continue;
      }
      throw error;
    }
  }
  return null;
}

/**
 * Keterangan: Entry point Suite Analysis — dipanggil countdown-latch di
 * queue.ts tepat saat SEMUA test run dalam satu suite selesai dianalisis
 * individual. Berbeda dari analyzeTestRun (Fase 2): input di sini adalah
 * SELURUH test case dalam suite sekaligus, mencari inkonsistensi/coverage
 * gap/pola kegagalan yang cuma terlihat lintas-fitur, bukan per test case.
 * Tidak melempar error ke pemanggil (failure boundary sudah dijaga
 * handleSuiteAnalysisJob di queue.ts) — mengembalikan null bila tidak ada
 * yang bisa/perlu dianalisis.
 */
export async function analyzeSuiteRun(
  input: AnalyzeSuiteRunInput,
): Promise<SuiteAnalysisResultRecord | null> {
  const { suiteRunId, projectId, testRunIds } = input;
  if (testRunIds.length === 0) {
    return null;
  }

  const items: SuiteAnalysisItem[] = [];
  let missingCount = 0;

  for (const testRunId of testRunIds) {
    const testRun = await testRunRepository.findById(testRunId);
    if (!testRun) {
      continue;
    }
    const testCase = await testCaseRepository.findById(testRun.testCaseId);
    if (!testCase) {
      continue;
    }
    const analysis = await analysisResultRepository.findLatestByTestRunId(testRunId);
    if (!analysis) {
      missingCount += 1;
    }
    items.push({
      testCaseTitle: testCase.title,
      testCaseDescription: testCase.description,
      testRunStatus: testRun.status,
      analysisStatus: analysis?.status ?? null,
      analysisReason: analysis?.reason ?? null,
      analysisDetail: analysis?.detail ?? null,
      analysisSolution: analysis?.solution ?? null,
    });
  }

  if (items.length === 0) {
    console.warn(
      `[suite-analysis] Suite "${suiteRunId}" tidak punya test case valid untuk dianalisis.`,
    );
    return null;
  }

  const project = await projectRepository.findById(projectId);
  const projectSecrets = await projectProviderRepository.findSecretsByProjectId(projectId);
  const providerConfigs = mergeProviderConfigs(config.providers, projectSecrets);
  const providerOrder = buildProviderOrder(
    project?.defaultProvider ?? 'claude',
    providerConfigs,
    projectSecrets.map((secret) => secret.provider),
  );

  const outcome = await callSuiteAnalysisLLM(
    buildSuiteAnalysisSystemPrompt(),
    buildSuiteAnalysisUserPrompt(items),
    providerOrder,
    providerConfigs,
  );

  if (!outcome) {
    console.error(`[suite-analysis] Semua provider gagal untuk suite "${suiteRunId}".`);
    broadcastToRun(suiteRunId, {
      type: 'suite:analysis-error',
      runId: suiteRunId,
      message: 'Analisis lintas fitur gagal di semua provider AI.',
    });
    return null;
  }

  const status: SuiteAnalysisStatus =
    missingCount > 0
      ? 'incomplete'
      : outcome.parsed.findings.length > 0
        ? 'issues_found'
        : 'consistent';

  const summary =
    missingCount > 0
      ? `${outcome.parsed.summary} (Catatan: ${missingCount} dari ${items.length} test case tidak punya hasil analisis individual, jadi Suite Analysis ini tidak lengkap.)`.trim()
      : outcome.parsed.summary || null;

  const record = await suiteAnalysisResultRepository.create({
    projectId,
    suiteRunId,
    testRunIds,
    status,
    summary,
    findings: outcome.parsed.findings,
    provider: outcome.provider,
    rawResponse: normalizeRawResponse(outcome.raw),
  });

  broadcastToRun(suiteRunId, {
    type: 'suite:analysis',
    runId: suiteRunId,
    result: record,
  });

  return record;
}
