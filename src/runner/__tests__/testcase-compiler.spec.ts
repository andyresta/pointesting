import path from 'node:path';
import { expect, test } from '@playwright/test';
import { PlaywrightPageDriver } from '../page-driver';
import { executeSteps } from '../testcase-compiler';
import type { Step } from '../types';

const FIXTURE_URL = `file://${path.join(__dirname, 'fixtures', 'sample.html')}`;

test.describe('executeSteps', () => {
  test('menjalankan tiap action type (goto/fill/click/check/select/waitFor) berurutan sampai berhasil', async ({
    page,
  }) => {
    const steps: Step[] = [
      { action: 'goto', url: FIXTURE_URL },
      { action: 'fill', selector: '#name-input', value: 'Budi' },
      { action: 'click', selector: '#submit-btn' },
      { action: 'check', selector: '#agree-checkbox' },
      { action: 'select', selector: '#color-select', value: 'blue' },
      { action: 'waitFor', selector: '#delayed-element' },
    ];

    const results = await executeSteps(new PlaywrightPageDriver(page), steps);

    expect(results).toHaveLength(steps.length);
    for (const [index, result] of results.entries()) {
      expect(result.index).toBe(index);
      expect(result.status).toBe('passed');
      expect(result.errorMessage).toBeNull();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }

    await expect(page.locator('#name-input')).toHaveValue('Budi');
    await expect(page.locator('#result')).toHaveText('clicked');
    await expect(page.locator('#agree-checkbox')).toBeChecked();
    await expect(page.locator('#color-select')).toHaveValue('blue');
  });

  test('step gagal (selector tidak ada) menghentikan step berikutnya (fail fast) tanpa throw', async ({
    page,
  }) => {
    const steps: Step[] = [
      { action: 'goto', url: FIXTURE_URL },
      { action: 'click', selector: '#selector-tidak-ada' },
      { action: 'fill', selector: '#name-input', value: 'Tidak akan dijalankan' },
    ];

    const results = await executeSteps(new PlaywrightPageDriver(page), steps);

    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('passed');
    expect(results[1]?.action).toBe('click');
    expect(results[1]?.status).toBe('failed');
    expect(results[1]?.errorMessage).toBeTruthy();

    await expect(page.locator('#name-input')).toHaveValue('');
  });

  test('waitFor gagal kalau elemen tidak pernah muncul', async ({ page }) => {
    const steps: Step[] = [
      { action: 'goto', url: FIXTURE_URL },
      { action: 'waitFor', selector: '#tidak-pernah-ada' },
    ];

    const results = await executeSteps(new PlaywrightPageDriver(page), steps);

    expect(results).toHaveLength(2);
    expect(results[1]?.status).toBe('failed');
    expect(results[1]?.errorMessage).toBeTruthy();
  });

  test('assertion actions (assertVisible/assertHidden/assertChecked/assertText/assertValue/assertCount/assertUrl) memverifikasi state nyata dan lolos saat sesuai', async ({
    page,
  }) => {
    const steps: Step[] = [
      { action: 'goto', url: FIXTURE_URL },
      { action: 'assertUrl', value: 'sample.html' },
      { action: 'assertVisible', selector: '#name-input' },
      { action: 'assertHidden', selector: '#elemen-yang-tidak-pernah-ada' },
      { action: 'fill', selector: '#name-input', value: 'Budi' },
      { action: 'assertValue', selector: '#name-input', value: 'Budi' },
      { action: 'click', selector: '#submit-btn' },
      { action: 'assertText', selector: '#result', value: 'clicked' },
      { action: 'check', selector: '#agree-checkbox' },
      { action: 'assertChecked', selector: '#agree-checkbox' },
      { action: 'assertCount', selector: '#color-select option', value: '2' },
    ];

    const results = await executeSteps(new PlaywrightPageDriver(page), steps);

    expect(results).toHaveLength(steps.length);
    for (const result of results) {
      expect(result.status).toBe('passed');
      expect(result.errorMessage).toBeNull();
    }
  });

  test('assertText gagal (fail fast) kalau teks tidak sesuai, errorMessage menyebut nilai aktual', async ({
    page,
  }) => {
    const steps: Step[] = [
      { action: 'goto', url: FIXTURE_URL },
      { action: 'click', selector: '#submit-btn' },
      { action: 'assertText', selector: '#result', value: 'tidak akan pernah cocok' },
      { action: 'fill', selector: '#name-input', value: 'Tidak akan dijalankan' },
    ];

    const results = await executeSteps(new PlaywrightPageDriver(page), steps);

    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe('passed');
    expect(results[1]?.status).toBe('passed');
    expect(results[2]?.status).toBe('failed');
    expect(results[2]?.errorMessage).toContain('clicked');

    await expect(page.locator('#name-input')).toHaveValue('');
  });
});
