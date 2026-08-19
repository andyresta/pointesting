import { expect, test } from '@playwright/test';
import {
  addSuiteAnalysisTestRun,
  beginSuiteAnalysisTracking,
  discardSuiteAnalysisTracking,
  handleAnalysisJob,
  markSuiteAnalysisTestRunDone,
  sealSuiteAnalysisTracking,
} from '../queue';

test('kegagalan analyzer ditangkap handler dan tidak menolak job queue', async () => {
  const originalConsoleError = console.error;
  const messages: string[] = [];
  console.error = (...values: unknown[]) => {
    messages.push(values.map(String).join(' '));
  };

  try {
    await expect(
      handleAnalysisJob(
        { type: 'analysis', testRunId: 'run-error-test' },
        async () => {
          throw new Error('provider tidak tersedia');
        },
      ),
    ).resolves.toBeUndefined();
  } finally {
    console.error = originalConsoleError;
  }

  expect(messages.join('\n')).toContain('run-error-test');
  expect(messages.join('\n')).toContain('provider tidak tersedia');
});

test.describe('countdown-latch Suite Analysis', () => {
  test('final hanya setelah sealed DAN semua test run selesai — bukan saat completed lebih dulu', () => {
    beginSuiteAnalysisTracking('suite-A', 'project-A');
    addSuiteAnalysisTestRun('suite-A', 'run-1');
    addSuiteAnalysisTestRun('suite-A', 'run-2');

    // Selesai lebih dulu sebelum sealed — belum final walau semua id yang
    // SUDAH terdaftar sudah completed, karena loop mungkin masih menambah id baru.
    expect(markSuiteAnalysisTestRunDone('run-1')).toBeNull();
    expect(markSuiteAnalysisTestRunDone('run-2')).toBeNull();

    // Sealed, tapi sebenarnya sudah lengkap dari sebelumnya — final langsung di titik ini.
    const finalized = sealSuiteAnalysisTracking('suite-A');
    expect(finalized).toEqual({
      suiteRunId: 'suite-A',
      projectId: 'project-A',
      testRunIds: ['run-1', 'run-2'],
    });

    // Latch sudah dibuang setelah final — panggilan berikutnya tidak berefek.
    expect(sealSuiteAnalysisTracking('suite-A')).toBeNull();
    expect(markSuiteAnalysisTestRunDone('run-1')).toBeNull();
  });

  test('final dipicu oleh completion terakhir ketika sealing terjadi lebih dulu', () => {
    beginSuiteAnalysisTracking('suite-B', 'project-B');
    addSuiteAnalysisTestRun('suite-B', 'run-x');
    addSuiteAnalysisTestRun('suite-B', 'run-y');

    expect(markSuiteAnalysisTestRunDone('run-x')).toBeNull();

    // Sealed duluan sebelum run-y selesai — belum final.
    expect(sealSuiteAnalysisTracking('suite-B')).toBeNull();

    // run-y selesai belakangan — inilah yang memicu final.
    const finalized = markSuiteAnalysisTestRunDone('run-y');
    expect(finalized).toEqual({
      suiteRunId: 'suite-B',
      projectId: 'project-B',
      testRunIds: ['run-x', 'run-y'],
    });
  });

  test('sealing suite tanpa test run valid langsung dibuang, tidak pernah final', () => {
    beginSuiteAnalysisTracking('suite-empty', 'project-C');
    expect(sealSuiteAnalysisTracking('suite-empty')).toBeNull();
    expect(markSuiteAnalysisTestRunDone('siapa-saja')).toBeNull();
  });

  test('discard membuang tracking suite yang di-abort paksa, tidak menggantung selamanya', () => {
    beginSuiteAnalysisTracking('suite-abort', 'project-D');
    addSuiteAnalysisTestRun('suite-abort', 'run-only');
    discardSuiteAnalysisTracking('suite-abort');

    // Sealing setelah discard tidak menemukan entry apa pun.
    expect(sealSuiteAnalysisTracking('suite-abort')).toBeNull();
    expect(markSuiteAnalysisTestRunDone('run-only')).toBeNull();
  });

  test('handleAnalysisJob memicu markSuiteAnalysisTestRunDone walau analyze gagal', async () => {
    beginSuiteAnalysisTracking('suite-fail', 'project-E');
    addSuiteAnalysisTestRun('suite-fail', 'run-fail-1');
    sealSuiteAnalysisTracking('suite-fail');

    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      await handleAnalysisJob({ type: 'analysis', testRunId: 'run-fail-1' }, async () => {
        throw new Error('analisis individual gagal total');
      });
    } finally {
      console.error = originalConsoleError;
    }

    // Sudah final (dan terhapus) meski analyze() gagal — dibuktikan lewat
    // markSuiteAnalysisTestRunDone kedua kali tidak menemukan entry lagi.
    expect(markSuiteAnalysisTestRunDone('run-fail-1')).toBeNull();
  });
});
