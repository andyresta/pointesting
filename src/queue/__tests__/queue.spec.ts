import { expect, test } from '@playwright/test';
import { handleAnalysisJob } from '../queue';

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
