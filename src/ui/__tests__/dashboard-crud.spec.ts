import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const DASHBOARD_SCRIPT = path.resolve(
  __dirname,
  '../public/dashboard.js',
);

/**
 * Keterangan: Membuat fixture DOM CRUD dashboard yang cukup lengkap untuk
 * menguji dialog, step builder, dan payload tanpa database atau server nyata.
 */
function createDashboardFixture(): string {
  const testCase = JSON.stringify({
    id: 'case-1',
    title: 'Login berhasil',
    steps: [
      { action: 'goto', url: '/login' },
      { action: 'fill', selector: '#email', value: 'tester@example.test' },
    ],
    expected: ['Dashboard tampil'],
  });

  return `<!doctype html>
    <html lang="id">
      <body>
        <div id="page-loading">Loading</div>
        <main id="dashboard-content" hidden>
          <button id="new-project-button" type="button">Buat Project</button>
          <button class="add-test-case-button" data-project-id="project-1">Tambah Test Case</button>
          <article
            class="test-case"
            data-project-id="project-1"
            data-test-case-id="case-1"
            data-test-case='${testCase}'
          >
            <button class="edit-test-case-button" type="button">Edit</button>
          </article>
        </main>

        <dialog id="project-dialog">
          <form id="project-form">
            <input name="name" required />
            <input name="baseUrl" type="url" required />
            <select id="project-provider" name="defaultProvider" required>
              <option value="claude">Claude</option>
              <option value="openai">OpenAI</option>
            </select>
            <p id="provider-model-hint"></p>
            <p class="form-error" hidden></p>
            <button class="submit-button" type="submit">
              <span class="button-label">Simpan Project</span>
              <span class="spinner" hidden></span>
            </button>
          </form>
        </dialog>

        <dialog id="test-case-dialog">
          <form id="test-case-form">
            <input name="projectId" type="hidden" />
            <input name="testCaseId" type="hidden" />
            <h2 id="test-case-dialog-title"></h2>
            <input name="title" required />
            <button id="add-step-button" type="button">Tambah Step</button>
            <div id="step-list"></div>
            <textarea name="expected" required></textarea>
            <p class="form-error" hidden></p>
            <button class="submit-button" type="submit">
              <span class="button-label">Simpan Test Case</span>
              <span class="spinner" hidden></span>
            </button>
          </form>
        </dialog>
      </body>
    </html>`;
}

/**
 * Keterangan: Menyiapkan token, response katalog provider, fixture dashboard,
 * dan script produksi agar test berinteraksi melalui UI yang sama.
 */
async function prepareCrudPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('pointestingToken', 'token-placeholder');
  });
  await page.route('http://dashboard.test/', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: createDashboardFixture(),
    });
  });
  await page.route('http://dashboard.test/ai/models', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        providers: [
          {
            provider: 'claude',
            defaultModel: 'claude-test',
            models: ['claude-test'],
            source: 'env_fallback',
            configured: true,
          },
          {
            provider: 'openai',
            defaultModel: 'openai-test',
            models: ['openai-test'],
            source: 'env_fallback',
            configured: false,
          },
        ],
      }),
    });
  });
  await page.goto('http://dashboard.test/');
  await page.addScriptTag({ path: DASHBOARD_SCRIPT });
  await expect(page.locator('#dashboard-content')).toBeVisible();
}

test('project dapat dibuat sepenuhnya dari dialog dashboard', async ({ page }) => {
  await prepareCrudPage(page);
  await page.route('http://dashboard.test/projects', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'project-new' }),
    });
  });

  await page.getByRole('button', { name: 'Buat Project' }).click();
  await page.locator('#project-form [name="name"]').fill('Portal Internal');
  await page
    .locator('#project-form [name="baseUrl"]')
    .fill('https://portal.example.test');
  await page
    .locator('#project-form [name="defaultProvider"]')
    .selectOption('claude');
  await expect(page.locator('#provider-model-hint')).toContainText(
    'claude-test',
  );

  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/projects') && request.method() === 'POST',
  );
  await page.locator('#project-form .submit-button').click();
  const request = await requestPromise;

  expect(request.postDataJSON()).toEqual({
    name: 'Portal Internal',
    baseUrl: 'https://portal.example.test',
    defaultProvider: 'claude',
  });
});

test('test case dapat dibuat dengan dynamic step builder', async ({ page }) => {
  await prepareCrudPage(page);
  await page.route(
    'http://dashboard.test/projects/project-1/test-cases',
    async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'case-new' }),
      });
    },
  );

  await page.getByRole('button', { name: 'Tambah Test Case' }).click();
  await page.locator('#test-case-form [name="title"]').fill('Checkout produk');
  await page.locator('#step-list [name="url"]').fill('/products');
  await page.locator('#add-step-button').click();
  const secondStep = page.locator('.step-builder-row').nth(1);
  await secondStep.locator('[name="action"]').selectOption('click');
  await secondStep.locator('[name="selector"]').fill('[data-testid="buy"]');
  await page
    .locator('#test-case-form [name="expected"]')
    .fill('Keranjang tampil\nProduk masuk keranjang');

  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith('/projects/project-1/test-cases') &&
      request.method() === 'POST',
  );
  await page.locator('#test-case-form .submit-button').click();
  const request = await requestPromise;

  expect(request.postDataJSON()).toEqual({
    title: 'Checkout produk',
    steps: [
      { action: 'goto', url: '/products' },
      { action: 'click', selector: '[data-testid="buy"]' },
    ],
    expected: ['Keranjang tampil', 'Produk masuk keranjang'],
  });
});

test('test case lama dapat diedit dari builder tanpa JSON manual', async ({
  page,
}) => {
  await prepareCrudPage(page);
  await page.route('http://dashboard.test/test-cases/case-1', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: 'case-1' }),
    });
  });

  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#test-case-dialog-title')).toHaveText(
    'Edit Test Case',
  );
  await expect(page.locator('#test-case-form [name="title"]')).toHaveValue(
    'Login berhasil',
  );
  await expect(page.locator('.step-builder-row')).toHaveCount(2);
  await page
    .locator('#test-case-form [name="expected"]')
    .fill('Dashboard dan profil tampil');

  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith('/test-cases/case-1') &&
      request.method() === 'PATCH',
  );
  await page.locator('#test-case-form .submit-button').click();
  const request = await requestPromise;

  expect(request.postDataJSON()).toEqual({
    title: 'Login berhasil',
    steps: [
      { action: 'goto', url: '/login' },
      {
        action: 'fill',
        selector: '#email',
        value: 'tester@example.test',
      },
    ],
    expected: ['Dashboard dan profil tampil'],
  });
});
