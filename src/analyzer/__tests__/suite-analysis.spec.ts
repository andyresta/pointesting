import { expect, test } from '@playwright/test';
import { parseSuiteAnalysisOutput } from '../suite-analysis.service';

test.describe('parseSuiteAnalysisOutput', () => {
  test('menerima JSON valid lengkap dengan findings', () => {
    const raw = JSON.stringify({
      summary: 'Semua fitur konsisten.',
      findings: [
        {
          category: 'inconsistency',
          title: 'Data pelanggan tidak diverifikasi lintas fitur',
          detail: 'Tambah pelanggan tidak dicek muncul di halaman list pelanggan.',
          relatedTestCases: ['Tambah Pelanggan Baru', 'Lihat Daftar Pelanggan'],
        },
      ],
    });

    const result = parseSuiteAnalysisOutput(raw);

    expect(result.summary).toBe('Semua fitur konsisten.');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual({
      category: 'inconsistency',
      title: 'Data pelanggan tidak diverifikasi lintas fitur',
      detail: 'Tambah pelanggan tidak dicek muncul di halaman list pelanggan.',
      relatedTestCases: ['Tambah Pelanggan Baru', 'Lihat Daftar Pelanggan'],
    });
  });

  test('menerima JSON terbungkus markdown code fence', () => {
    const raw = '```json\n{"summary":"ok","findings":[]}\n```';

    const result = parseSuiteAnalysisOutput(raw);

    expect(result.summary).toBe('ok');
    expect(result.findings).toEqual([]);
  });

  test('findings kosong/tidak ada tetap valid (default array kosong)', () => {
    const result = parseSuiteAnalysisOutput('{"summary":"Tidak ada temuan"}');

    expect(result.summary).toBe('Tidak ada temuan');
    expect(result.findings).toEqual([]);
  });

  test('relatedTestCases opsional default ke array kosong', () => {
    const raw = JSON.stringify({
      findings: [{ category: 'other', title: 'X', detail: 'Y' }],
    });

    const result = parseSuiteAnalysisOutput(raw);

    expect(result.findings[0]?.relatedTestCases).toEqual([]);
  });

  test('category tidak dikenal jatuh ke "other", bukan gagal parse', () => {
    const raw = JSON.stringify({
      findings: [{ category: 'tidak_ada_di_enum', title: 'X', detail: 'Y' }],
    });

    const result = parseSuiteAnalysisOutput(raw);

    expect(result.findings[0]?.category).toBe('other');
  });

  test('response bukan JSON melempar error jelas', () => {
    expect(() => parseSuiteAnalysisOutput('bukan json sama sekali')).toThrow();
  });

  test('finding tanpa title/detail (field wajib kosong) melempar error format', () => {
    const raw = JSON.stringify({ findings: [{ category: 'other' }] });

    expect(() => parseSuiteAnalysisOutput(raw)).toThrow(
      'Output AI tidak sesuai format suite analysis',
    );
  });
});
