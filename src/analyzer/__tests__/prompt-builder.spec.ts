import { expect, test } from '@playwright/test';
import {
  STATUS_DEFINITIONS,
  summarizeConsoleLogs,
  summarizeNetworkLogs,
} from '../prompt-builder';

test('console summary hanya memuat error/warning dan menggabungkan duplikat', () => {
  const summary = summarizeConsoleLogs([
    { type: 'log', text: 'noise biasa' },
    { type: 'warning', text: 'resource lambat' },
    { type: 'warn', text: 'resource lambat' },
    { type: 'error', text: 'request gagal' },
  ]);

  expect(summary).toContain('[warning] resource lambat (x2)');
  expect(summary).toContain('[error] request gagal');
  expect(summary).not.toContain('noise biasa');
});

test('network summary hanya memuat status error/0 atau response lambat', () => {
  const summary = summarizeNetworkLogs([
    {
      method: 'GET',
      url: 'https://example.test/ok?token=rahasia',
      status: 200,
      responseTimeMs: 100,
    },
    {
      method: 'POST',
      url: 'https://example.test/fail?token=rahasia',
      status: 500,
      responseTimeMs: 200,
    },
    {
      method: 'GET',
      url: 'https://example.test/slow',
      status: 200,
      responseTimeMs: 4_500,
    },
    {
      method: 'GET',
      url: 'https://example.test/offline',
      status: 0,
      responseTimeMs: 5,
    },
  ]);

  expect(summary).not.toContain('/ok');
  expect(summary).toContain('POST https://example.test/fail — status 500');
  expect(summary).not.toContain('token=');
  expect(summary).toContain('GET https://example.test/slow — 4500ms');
  expect(summary).toContain('GET https://example.test/offline — status 0');
});

test('STATUS_DEFINITIONS memuat empat status dan aturan field hasil', () => {
  for (const status of ['success', 'fail', 'bug', 'anomaly']) {
    expect(STATUS_DEFINITIONS).toContain(status);
  }
  expect(STATUS_DEFINITIONS).toContain('reason');
  expect(STATUS_DEFINITIONS).toContain('detail');
  expect(STATUS_DEFINITIONS).toContain('solution');
});
