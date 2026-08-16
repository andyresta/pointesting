import { createInterface } from 'node:readline';
import * as path from 'node:path';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import type { TraceActionSummary, TraceSummary } from './types';

const MAX_SUMMARY_ACTIONS = 20;
const MAX_ACTION_NAME_LENGTH = 120;
const MAX_ERROR_LENGTH = 240;
const MAX_EVENT_LINE_LENGTH = 512 * 1024;

interface RawTraceEvent {
  type?: unknown;
  callId?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  apiName?: unknown;
  class?: unknown;
  method?: unknown;
  error?: unknown;
}

interface PendingAction {
  name: string;
  startTime: number;
}

interface ParsedAction extends TraceActionSummary {
  absoluteStartTime: number;
}

interface TraceAccumulator {
  pendingActions: Map<string, PendingAction>;
  actions: ParsedAction[];
  firstStartTime?: number;
  lastEndTime?: number;
  totalActions: number;
  failedActions: number;
  traceFileCount: number;
  malformedEventCount: number;
  oversizedEventCount: number;
}

/**
 * Keterangan: Memotong teks trace yang berpotensi panjang agar ringkasan tetap
 * aman dikirim ke LLM tanpa membawa stack/snapshot mentah berukuran besar.
 */
function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

/**
 * Keterangan: Mengambil nama action publik Playwright, dengan fallback ke
 * pasangan class.method untuk trace yang tidak memiliki field apiName.
 */
function getActionName(event: RawTraceEvent): string {
  if (typeof event.apiName === 'string' && event.apiName.trim() !== '') {
    return truncateText(event.apiName, MAX_ACTION_NAME_LENGTH);
  }

  const className =
    typeof event.class === 'string' && event.class.trim() !== ''
      ? event.class
      : 'playwright';
  const method =
    typeof event.method === 'string' && event.method.trim() !== ''
      ? event.method
      : 'action';
  return truncateText(`${className}.${method}`, MAX_ACTION_NAME_LENGTH);
}

/**
 * Keterangan: Menormalkan berbagai bentuk error event Playwright menjadi satu
 * pesan pendek; raw stack tidak disertakan ke TraceSummary.
 */
function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string' && error.trim() !== '') {
    return truncateText(error, MAX_ERROR_LENGTH);
  }
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim() !== '') {
    return truncateText(message, MAX_ERROR_LENGTH);
  }
  return undefined;
}

/**
 * Keterangan: Memproses event before/after Playwright, memasangkan berdasarkan
 * callId, lalu menyimpan hanya metadata action dan timing yang ringkas.
 */
function processTraceEvent(
  event: RawTraceEvent,
  accumulator: TraceAccumulator,
): void {
  if (event.type === 'before') {
    if (
      typeof event.callId !== 'string' ||
      typeof event.startTime !== 'number' ||
      !Number.isFinite(event.startTime)
    ) {
      return;
    }

    accumulator.pendingActions.set(event.callId, {
      name: getActionName(event),
      startTime: event.startTime,
    });
    accumulator.firstStartTime =
      accumulator.firstStartTime === undefined
        ? event.startTime
        : Math.min(accumulator.firstStartTime, event.startTime);
    return;
  }

  if (
    event.type !== 'after' ||
    typeof event.callId !== 'string' ||
    typeof event.endTime !== 'number' ||
    !Number.isFinite(event.endTime)
  ) {
    return;
  }

  const pending = accumulator.pendingActions.get(event.callId);
  if (!pending) {
    return;
  }
  accumulator.pendingActions.delete(event.callId);

  const error = getErrorMessage(event.error);
  accumulator.totalActions += 1;
  accumulator.failedActions += error ? 1 : 0;
  accumulator.lastEndTime =
    accumulator.lastEndTime === undefined
      ? event.endTime
      : Math.max(accumulator.lastEndTime, event.endTime);

  if (accumulator.actions.length < MAX_SUMMARY_ACTIONS) {
    accumulator.actions.push({
      name: pending.name,
      absoluteStartTime: pending.startTime,
      startOffsetMs: 0,
      durationMs: Math.max(0, Math.round(event.endTime - pending.startTime)),
      status: error ? 'failed' : 'passed',
      ...(error ? { error } : {}),
    });
  }
}

/**
 * Keterangan: Membuka satu entry .trace sebagai stream tanpa mengekstrak ZIP
 * ke filesystem, sehingga resources/snapshot besar tidak disalin ke disk.
 */
async function openEntryStream(zipFile: ZipFile, entry: Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`Gagal membaca entry trace "${entry.fileName}"`));
        return;
      }
      resolve(stream);
    });
  });
}

/**
 * Keterangan: Membaca JSONL satu entry trace baris demi baris. Event snapshot
 * sangat besar dilewati karena tidak dibutuhkan untuk ringkasan action/timing.
 */
async function parseTraceEntry(
  zipFile: ZipFile,
  entry: Entry,
  accumulator: TraceAccumulator,
): Promise<void> {
  const stream = await openEntryStream(zipFile, entry);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.length > MAX_EVENT_LINE_LENGTH) {
      accumulator.oversizedEventCount += 1;
      continue;
    }

    try {
      processTraceEvent(JSON.parse(line) as RawTraceEvent, accumulator);
    } catch {
      accumulator.malformedEventCount += 1;
    }
  }
}

/**
 * Keterangan: Membuka ZIP Playwright secara lazy agar hanya entry berakhiran
 * `.trace` yang diproses; file resource dan network tidak dimuat karena network
 * summary sudah dikumpulkan terpisah oleh Step 10.
 */
async function parseTraceZip(
  traceZipPath: string,
  accumulator: TraceAccumulator,
): Promise<void> {
  const zipFile = await new Promise<ZipFile>((resolve, reject) => {
    yauzl.open(
      path.resolve(traceZipPath),
      { lazyEntries: true, autoClose: true },
      (error, openedZip) => {
        if (error || !openedZip) {
          reject(error ?? new Error('Gagal membuka trace ZIP'));
          return;
        }
        resolve(openedZip);
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    /**
     * Keterangan: Menutup ZIP dan menolak promise tepat sekali jika stream ZIP
     * atau parser entry mengalami error.
     */
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on('error', fail);
    zipFile.on('end', () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    zipFile.on('entry', (entry) => {
      if (!entry.fileName.endsWith('.trace')) {
        zipFile.readEntry();
        return;
      }

      accumulator.traceFileCount += 1;
      void parseTraceEntry(zipFile, entry, accumulator)
        .then(() => zipFile.readEntry())
        .catch((error: unknown) =>
          fail(error instanceof Error ? error : new Error(String(error))),
        );
    });

    zipFile.readEntry();
  });
}

/**
 * Keterangan: Mengubah trace.zip Playwright menjadi ringkasan action/timing
 * bounded yang siap dipakai AnalyzerInput. Snapshot HTML dan network mentah
 * sengaja tidak disertakan agar output tetap sekitar <2000 token.
 */
export async function parseTrace(traceZipPath: string): Promise<TraceSummary> {
  const accumulator: TraceAccumulator = {
    pendingActions: new Map(),
    actions: [],
    totalActions: 0,
    failedActions: 0,
    traceFileCount: 0,
    malformedEventCount: 0,
    oversizedEventCount: 0,
  };

  await parseTraceZip(traceZipPath, accumulator);
  if (accumulator.traceFileCount === 0) {
    throw new Error('File ZIP tidak berisi entry trace Playwright');
  }

  const firstStartTime = accumulator.firstStartTime ?? 0;
  const lastEndTime = accumulator.lastEndTime ?? firstStartTime;
  const actions = accumulator.actions.map(
    ({ absoluteStartTime, ...action }) => ({
      ...action,
      startOffsetMs: Math.max(0, Math.round(absoluteStartTime - firstStartTime)),
    }),
  );

  return {
    totalDurationMs: Math.max(0, Math.round(lastEndTime - firstStartTime)),
    totalActions: accumulator.totalActions,
    failedActions: accumulator.failedActions,
    actions,
    truncated:
      accumulator.totalActions > actions.length ||
      accumulator.oversizedEventCount > 0,
    traceFileCount: accumulator.traceFileCount,
    malformedEventCount: accumulator.malformedEventCount,
  };
}
