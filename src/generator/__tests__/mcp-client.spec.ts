import path from 'node:path';
import { expect, test } from '@playwright/test';
import { executeSteps } from '../../runner/testcase-compiler';
import type { Step } from '../../runner/types';
import { McpBrowserSession, McpPageDriver } from '../mcp-client';
import { startFixtureServer, type FixtureServer } from './helpers/static-fixture-server';

let fixtureServer: FixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer(path.join(__dirname, 'fixtures'));
});

test.afterAll(async () => {
  await fixtureServer.close();
});

test.describe('McpBrowserSession', () => {
  test('connect/navigate/evaluate mengembalikan data DOM nyata, lalu disconnect bersih', async () => {
    const session = new McpBrowserSession();
    try {
      await session.connect();
      await session.navigate(`${fixtureServer.baseUrl}/form-constraints.html`);
      const title = await session.evaluate<string>('() => document.title');
      expect(title).toBe('Form Registrasi');

      const required = await session.evaluate<boolean>(
        "() => document.getElementById('username').hasAttribute('required')",
      );
      expect(required).toBe(true);

      const maxLength = await session.evaluate<string | null>(
        "() => document.getElementById('username').getAttribute('maxlength')",
      );
      expect(maxLength).toBe('20');
    } finally {
      await session.disconnect();
    }
  });

  test('click by selector menghasilkan efek DOM nyata', async () => {
    const session = new McpBrowserSession();
    try {
      await session.connect();
      await session.navigate(`${fixtureServer.baseUrl}/mcp-actions.html`);
      await session.click('#submit-btn');
      const result = await session.evaluate<string>(
        "() => document.getElementById('result').textContent",
      );
      expect(result).toBe('clicked');
    } finally {
      await session.disconnect();
    }
  });

  test('dialog confirm() otomatis di-dismiss (accept:false), tool berikutnya tidak stuck', async () => {
    const session = new McpBrowserSession();
    try {
      await session.connect();
      await session.navigate(`${fixtureServer.baseUrl}/mcp-actions.html`);
      // Klik ini memicu window.confirm() — tanpa auto-dismiss, evaluate
      // berikutnya akan gagal dengan error "does not handle the modal state".
      await session.click('#confirm-btn');
      const afterConfirmText = await session.evaluate<string>(
        "() => document.getElementById('result').textContent",
      );
      expect(afterConfirmText).toBe('after-confirm');
      const confirmResult = await session.evaluate<boolean>('() => window.__confirmResult');
      expect(confirmResult).toBe(false);
    } finally {
      await session.disconnect();
    }
  });
});

test.describe('McpPageDriver via executeSteps', () => {
  test('menjalankan action goto/fill/click/check/select dan assertion checkpoint terhadap halaman nyata', async () => {
    const session = new McpBrowserSession();
    try {
      await session.connect();
      const driver = new McpPageDriver(session);
      const steps: Step[] = [
        { action: 'goto', url: `${fixtureServer.baseUrl}/mcp-actions.html` },
        { action: 'fill', selector: '#name-input', value: 'Budi' },
        { action: 'assertValue', selector: '#name-input', value: 'Budi' },
        { action: 'click', selector: '#submit-btn' },
        { action: 'assertText', selector: '#result', value: 'clicked' },
        { action: 'check', selector: '#agree-checkbox' },
        { action: 'assertChecked', selector: '#agree-checkbox' },
        { action: 'select', selector: '#color-select', value: 'blue' },
        { action: 'assertCount', selector: '#color-select option', value: '2' },
        { action: 'assertUrl', value: 'mcp-actions.html' },
      ];

      const results = await executeSteps(driver, steps);

      expect(results).toHaveLength(steps.length);
      for (const result of results) {
        expect(result.status).toBe('passed');
        expect(result.errorMessage).toBeNull();
      }
    } finally {
      await session.disconnect();
    }
  });

  test('step gagal (selector tidak ada) tetap fail-fast, errorMessage jelas', async () => {
    const session = new McpBrowserSession();
    try {
      await session.connect();
      const driver = new McpPageDriver(session);
      const steps: Step[] = [
        { action: 'goto', url: `${fixtureServer.baseUrl}/mcp-actions.html` },
        { action: 'click', selector: '#selector-tidak-ada' },
        { action: 'fill', selector: '#name-input', value: 'Tidak akan dijalankan' },
      ];

      const results = await executeSteps(driver, steps);

      expect(results).toHaveLength(2);
      expect(results[0]?.status).toBe('passed');
      expect(results[1]?.status).toBe('failed');
      expect(results[1]?.errorMessage).toBeTruthy();

      const nameValue = await driver.inputValue('#name-input');
      expect(nameValue).toBe('');
    } finally {
      await session.disconnect();
    }
  });
});
