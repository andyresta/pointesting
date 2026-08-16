import { readFile } from 'node:fs/promises';
import { artifactRepository } from '../db/repositories/artifact.repository';
import { testCaseRepository } from '../db/repositories/test-case.repository';
import { testRunRepository } from '../db/repositories/test-run.repository';
import type { Artifact } from '../db/repositories/types';
import { getArtifactPath } from '../storage/artifact-storage';
import type { AnalyzerInput } from './provider.interface';
import { parseTrace } from './trace-parser';

const NETWORK_SLOW_THRESHOLD_MS = 3_000;
const MAX_SUMMARY_ITEMS = 30;
const MAX_SUMMARY_TEXT_LENGTH = 300;

export const STATUS_DEFINITIONS = [
  'Gunakan tepat satu status berikut:',
  '- success: seluruh expected result terpenuhi dan tidak ada bukti kegagalan material.',
  '- fail: eksekusi test tidak mencapai expected result karena masalah test, data, selector, konfigurasi, atau environment; bukan bukti kuat defect aplikasi.',
  '- bug: bukti menunjukkan perilaku aplikasi bertentangan dengan expected result akibat defect pada aplikasi.',
  '- anomaly: test dapat berjalan tetapi timing, network, atau perilakunya menyimpang signifikan dari histori/baseline dan perlu investigasi.',
  'Untuk success isi reason. Untuk fail, bug, atau anomaly isi detail dan solution.',
].join('\n');

interface ConsoleLogEntry {
  type?: unknown;
  text?: unknown;
}

interface NetworkLogEntry {
  url?: unknown;
  method?: unknown;
  status?: unknown;
  responseTimeMs?: unknown;
}

/**
 * Keterangan: Memotong satu nilai log agar prompt tidak membengkak karena
 * pesan stack, URL, atau payload yang sangat panjang.
 */
function truncateSummaryText(value: string): string {
  if (value.length <= MAX_SUMMARY_TEXT_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_SUMMARY_TEXT_LENGTH - 1)}…`;
}

/**
 * Keterangan: Menghapus query/hash URL yang berpotensi memuat token atau data
 * sensitif sebelum network log dimasukkan ke prompt AI.
 */
function sanitizeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return truncateSummaryText(`${parsed.origin}${parsed.pathname}`);
  } catch {
    return truncateSummaryText(value.split(/[?#]/, 1)[0] ?? value);
  }
}

/**
 * Keterangan: Menggabungkan item log yang identik dan menambahkan jumlah
 * kemunculan agar noise berulang tidak memenuhi prompt.
 */
function formatDeduplicatedSummary(
  items: string[],
  emptyMessage: string,
): string {
  if (items.length === 0) {
    return emptyMessage;
  }

  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  return [...counts.entries()]
    .slice(0, MAX_SUMMARY_ITEMS)
    .map(([item, count]) => (count > 1 ? `${item} (x${count})` : item))
    .join('\n');
}

/**
 * Keterangan: Memfilter console log hanya error/warning, menormalkan tipe
 * `warn`, dan meringkas pesan duplikat menjadi baris pendek.
 */
export function summarizeConsoleLogs(entries: ConsoleLogEntry[]): string {
  const relevant = entries.flatMap((entry) => {
    const type = entry.type === 'warn' ? 'warning' : entry.type;
    if (
      (type !== 'error' && type !== 'warning') ||
      typeof entry.text !== 'string' ||
      entry.text.trim() === ''
    ) {
      return [];
    }
    return [`[${type}] ${truncateSummaryText(entry.text.trim())}`];
  });

  return formatDeduplicatedSummary(
    relevant,
    'Tidak ada error atau warning pada console.',
  );
}

/**
 * Keterangan: Memfilter network log hanya request gagal/status >=400 atau
 * response lambat di atas threshold, tanpa menyertakan query string URL.
 */
export function summarizeNetworkLogs(entries: NetworkLogEntry[]): string {
  const relevant = entries.flatMap((entry) => {
    const status =
      typeof entry.status === 'number' && Number.isFinite(entry.status)
        ? entry.status
        : undefined;
    const responseTimeMs =
      typeof entry.responseTimeMs === 'number' &&
      Number.isFinite(entry.responseTimeMs)
        ? entry.responseTimeMs
        : undefined;
    const isFailure = status === 0 || (status !== undefined && status >= 400);
    const isSlow =
      responseTimeMs !== undefined &&
      responseTimeMs > NETWORK_SLOW_THRESHOLD_MS;

    if ((!isFailure && !isSlow) || typeof entry.url !== 'string') {
      return [];
    }

    const method =
      typeof entry.method === 'string' ? entry.method.toUpperCase() : 'REQUEST';
    const reasons = [
      isFailure ? `status ${status}` : undefined,
      isSlow ? `${Math.round(responseTimeMs)}ms` : undefined,
    ].filter((value): value is string => Boolean(value));
    return [`[network] ${method} ${sanitizeUrl(entry.url)} — ${reasons.join(', ')}`];
  });

  return formatDeduplicatedSummary(
    relevant,
    'Tidak ada status error atau response network lambat.',
  );
}

/**
 * Keterangan: Membaca artifact JSON sebagai array dengan error jelas jika file
 * rusak, tanpa mengembalikan object non-array ke filter log.
 */
async function readJsonArrayArtifact(
  artifact: Artifact | undefined,
): Promise<unknown[]> {
  if (!artifact) {
    return [];
  }

  const content = await readFile(getArtifactPath(artifact.filePath), 'utf8');
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Artifact "${artifact.type}" harus berisi array JSON`);
  }
  return parsed;
}

/**
 * Keterangan: Memastikan expected JSONB test case benar-benar array string
 * sebelum dikirim ke provider.
 */
function parseExpected(expected: unknown): string[] {
  if (
    !Array.isArray(expected) ||
    !expected.every((item): item is string => typeof item === 'string')
  ) {
    throw new Error('Field expected test case bukan array string yang valid');
  }
  return expected;
}

/**
 * Keterangan: Mengambil maksimal dua screenshot terbaru sebagai Buffer.
 * Schema artifact belum menyimpan stepIndex, sehingga pilihan saat ini adalah
 * screenshot terbaru yang tersedia; field dihilangkan jika reporter belum
 * menghasilkan screenshot terpisah.
 */
async function readKeyScreenshots(artifacts: Artifact[]): Promise<Buffer[] | undefined> {
  const screenshots = artifacts
    .filter((artifact) => artifact.type === 'screenshot')
    .slice(0, 2);
  if (screenshots.length === 0) {
    return undefined;
  }

  return Promise.all(
    screenshots.map((artifact) => readFile(getArtifactPath(artifact.filePath))),
  );
}

/**
 * Keterangan: Menyusun AnalyzerInput dari test case dan artifact satu run:
 * expected, ringkasan console/network terfilter, trace terstruktur, serta
 * screenshot kunci opsional.
 */
export async function buildAnalyzerInput(
  testRunId: string,
): Promise<AnalyzerInput> {
  const testRun = await testRunRepository.findById(testRunId);
  if (!testRun) {
    throw new Error(`Test run "${testRunId}" tidak ditemukan`);
  }

  const testCase = await testCaseRepository.findById(testRun.testCaseId);
  if (!testCase) {
    throw new Error(
      `Test case "${testRun.testCaseId}" untuk run "${testRunId}" tidak ditemukan`,
    );
  }

  const artifacts = await artifactRepository.findAll({ testRunId });
  const consoleArtifact = artifacts.find(
    (artifact) => artifact.type === 'console_log',
  );
  const networkArtifact = artifacts.find(
    (artifact) => artifact.type === 'network_log',
  );
  const traceArtifact = artifacts.find((artifact) => artifact.type === 'trace');
  if (!traceArtifact) {
    throw new Error(`Artifact trace untuk test run "${testRunId}" tidak ditemukan`);
  }

  const [consoleEntries, networkEntries, traceSummary, screenshots] =
    await Promise.all([
      readJsonArrayArtifact(consoleArtifact),
      readJsonArrayArtifact(networkArtifact),
      parseTrace(getArtifactPath(traceArtifact.filePath)),
      readKeyScreenshots(artifacts),
    ]);

  return {
    expected: parseExpected(testCase.expected),
    consoleLogSummary: consoleArtifact
      ? summarizeConsoleLogs(consoleEntries as ConsoleLogEntry[])
      : 'Artifact console log tidak tersedia.',
    networkLogSummary: networkArtifact
      ? summarizeNetworkLogs(networkEntries as NetworkLogEntry[])
      : 'Artifact network log tidak tersedia.',
    traceSummary,
    ...(screenshots ? { screenshots } : {}),
  };
}
