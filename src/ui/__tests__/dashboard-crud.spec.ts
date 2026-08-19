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
  return `<!doctype html>
    <html lang="id">
      <body>
        <div id="page-loading">Loading</div>
        <main id="dashboard-content" hidden>
          <button id="new-project-button" type="button">Buat Project</button>
          <section
            class="project-card"
            data-project-id="project-1"
            data-project='${JSON.stringify({
              id: 'project-1',
              name: 'Portal Internal',
              baseUrl: 'https://portal.example.test',
              defaultProvider: 'claude',
              instruction: 'Uji login valid',
              extraData: 'selector #email',
              providers: [
                {
                  provider: 'claude',
                  hasApiKey: true,
                  apiKeyMasked: '••••test',
                  defaultModel: null,
                  sortOrder: 0,
                },
              ],
            })}'
          >
            <button
              class="icon-button edit-project-button"
              type="button"
              aria-label="Edit project"
            ></button>
            <button
              class="icon-button delete-project-button"
              type="button"
              aria-label="Hapus project"
              data-project-id="project-1"
              data-project-name="Portal Internal"
            ></button>
            <button
              class="secondary-button instruction-button compact-icon-action"
              type="button"
              data-project-id="project-1"
              title="Instruction"
            >Instruction</button>
            <span class="count">2 test case</span>
            <div class="project-card-footer">
              <div class="project-quick-actions">
                <button
                  class="primary-button compact-action ai-test-script-button"
                  type="button"
                  data-project-id="project-1"
                  data-generate-url="/dashboard/projects/project-1/generate"
                  data-test-case-count="2"
                >
                  <span class="button-label">Ai Test Script</span>
                  <span class="spinner" hidden></span>
                </button>
                <a
                  class="secondary-button compact-action test-cases-link"
                  href="/dashboard/projects/project-1/test-cases"
                >Test Case</a>
              </div>
            </div>
          </section>
        </main>

        <dialog id="project-dialog">
          <form id="project-form">
            <input name="projectId" type="hidden" />
            <h2 id="project-dialog-title"></h2>
            <input name="name" required />
            <input name="baseUrl" type="url" required />
            <p id="provider-model-hint"></p>
            <button id="add-provider-key-button" type="button">Tambah cadangan</button>
            <div id="provider-key-list"></div>
            <p class="form-error" hidden></p>
            <button class="submit-button" type="submit">
              <span class="button-label">Simpan Project</span>
              <span class="spinner" hidden></span>
            </button>
          </form>
        </dialog>

        <dialog id="instruction-dialog">
          <form id="instruction-form">
            <input name="projectId" type="hidden" />
            <h2 id="instruction-dialog-title">Instruction</h2>
            <textarea name="prompt" required></textarea>
            <textarea name="extraData"></textarea>
            <p class="form-error" hidden></p>
            <button class="submit-button" type="submit">
              <span class="button-label">Simpan Instruction</span>
              <span class="spinner" hidden></span>
            </button>
          </form>
        </dialog>

        <dialog id="generate-replace-dialog">
          <div class="dialog-form">
            <strong id="generate-replace-count">0</strong>
            <button id="generate-replace-confirm-button" type="button">
              <span class="button-label">Ganti &amp; Generate</span>
              <span class="spinner" hidden></span>
            </button>
          </div>
        </dialog>
      </body>
    </html>`;
}

/**
 * Keterangan: Fixture halaman test case full-width untuk builder dan run UI.
 */
function createTestCasesPageFixture(): string {
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
      <body class="generate-layout-page">
        <div id="page-loading">Loading</div>
        <div id="dashboard-content" class="generate-shell" hidden>
          <main id="testcases-workspace" data-project-id="project-1">
            <section class="generate-panel generate-panel-page run-workspace-panel">
              <aside class="test-case-sidebar">
                <ol class="test-case-list">
                  <li
                    class="test-case test-case-item"
                    data-project-id="project-1"
                    data-test-case-id="case-1"
                    data-test-case='${testCase}'
                  >
                    <button class="edit-test-case-button" type="button">Edit</button>
                  </li>
                </ol>
              </aside>
              <div class="generate-view run-view-panel">
                <div class="live-placeholder"></div>
              </div>
            </section>
          </main>
        </div>

        <dialog id="test-case-dialog">
          <form id="test-case-form">
            <input name="projectId" type="hidden" />
            <input name="testCaseId" type="hidden" />
            <h2 id="test-case-dialog-title"></h2>
            <input name="title" required />
            <textarea name="description"></textarea>
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
    const catalogs = [
      {
        provider: 'claude',
        defaultModel: 'claude-test',
        models: ['claude-test'],
        source: 'provider',
        configured: true,
      },
      {
        provider: 'openai',
        defaultModel: 'openai-test',
        models: ['openai-test'],
        source: 'provider',
        configured: false,
      },
      {
        provider: 'opencode',
        defaultModel: 'claude-sonnet-4-5',
        models: ['claude-sonnet-4-5'],
        source: 'provider',
        configured: true,
      },
      {
        provider: 'opencode-go',
        defaultModel: 'gpt-5',
        models: ['gpt-5'],
        source: 'provider',
        configured: true,
      },
    ];
    const posted = route.request().postDataJSON() as { provider?: string } | null;
    const payload = posted?.provider
      ? (catalogs.find((item) => item.provider === posted.provider) ?? {
          provider: posted.provider,
          defaultModel: '',
          models: [],
          source: 'env_fallback',
          configured: false,
        })
      : { providers: catalogs };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('http://dashboard.test/');
  await page.addScriptTag({ path: DASHBOARD_SCRIPT });
  await expect(page.locator('#dashboard-content')).toBeVisible();
}

async function prepareTestCasesPage(page: Page, pathSuffix = ''): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('pointestingToken', 'token-placeholder');
  });
  await page.route(
    `http://dashboard.test/dashboard/projects/project-1/test-cases${pathSuffix}`,
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: createTestCasesPageFixture(),
      });
    },
  );
  await page.goto(
    `http://dashboard.test/dashboard/projects/project-1/test-cases${pathSuffix}`,
  );
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
  await expect(page.locator('#provider-key-list [name="defaultModel"]')).toHaveValue(
    'claude-test',
  );
  await expect(page.locator('#provider-key-list [name="isDefault"]')).toBeChecked();
  await page.locator('#project-form [name="name"]').fill('Portal Internal');
  await page
    .locator('#project-form [name="baseUrl"]')
    .fill('https://portal.example.test');
  await page.locator('#provider-key-list [name="apiKey"]').fill('key-placeholder');
  await expect(page.locator('#provider-key-list [name="defaultModel"]')).toHaveValue(
    'claude-test',
  );

  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/projects') && request.method() === 'POST',
  );
  await page.locator('#project-form .submit-button').click();
  const request = await requestPromise;

  expect(request.postDataJSON()).toMatchObject({
    name: 'Portal Internal',
    baseUrl: 'https://portal.example.test',
    defaultProvider: 'claude',
    providers: [
      {
        provider: 'claude',
        apiKey: 'key-placeholder',
        defaultModel: 'claude-test',
      },
    ],
  });
});

test('project lama dapat diedit termasuk pilih OpenCode Go', async ({ page }) => {
  await prepareCrudPage(page);
  await page.route('http://dashboard.test/projects/project-1', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: 'project-1' }),
    });
  });

  await page.getByRole('button', { name: 'Edit project' }).click();
  await expect(page.locator('#project-dialog-title')).toHaveText('Edit Project');
  await expect(page.locator('#project-form [name="name"]')).toHaveValue(
    'Portal Internal',
  );
  await page.getByRole('button', { name: 'Tambah cadangan' }).click();
  const goRow = page.locator('#provider-key-list .provider-key-row').nth(1);
  await goRow.locator('[name="providerName"]').selectOption('opencode-go');
  await goRow.locator('[name="apiKey"]').fill('key-placeholder');
  await goRow.locator('[name="isDefault"]').check();

  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith('/projects/project-1') &&
      request.method() === 'PATCH',
  );
  await page.locator('#project-form .submit-button').click();
  const request = await requestPromise;
  const payload = request.postDataJSON();

  expect(payload.name).toBe('Portal Internal');
  expect(payload.baseUrl).toBe('https://portal.example.test');
  expect(payload.defaultProvider).toBe('opencode-go');
  expect(payload.providers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ provider: 'claude' }),
      expect.objectContaining({
        provider: 'opencode-go',
        apiKey: 'key-placeholder',
      }),
    ]),
  );
});

test('project dapat dihapus dari ikon kartu', async ({ page }) => {
  await prepareCrudPage(page);
  await page.route('http://dashboard.test/projects/project-1/delete', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
  page.on('dialog', (dialog) => dialog.accept());

  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith('/projects/project-1/delete') &&
      request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Hapus project' }).click();
  await requestPromise;
});

test('instruction menyimpan prompt ke project tanpa generate', async ({ page }) => {
  await prepareCrudPage(page);
  await page.route(
    'http://dashboard.test/projects/project-1/instruction',
    async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          instruction: 'Uji login valid',
          extraData: 'selector #email',
        }),
      });
    },
  );

  await page.getByRole('button', { name: 'Instruction' }).click();
  await page.locator('#instruction-form [name="prompt"]').fill('Uji login valid');
  await page
    .locator('#instruction-form [name="extraData"]')
    .fill('selector #email');

  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith('/projects/project-1/instruction') &&
      request.method() === 'POST',
  );
  await page.locator('#instruction-form .submit-button').click();
  const request = await requestPromise;

  expect(request.postDataJSON()).toEqual({
    prompt: 'Uji login valid',
    extraData: 'selector #email',
  });
  await expect(page.locator('.generate-panel')).toBeHidden();
});

test('generate test script membuka halaman generate full-width', async ({ page }) => {
  await prepareCrudPage(page);
  await expect(page.locator('.ai-test-script-button')).toHaveAttribute(
    'data-generate-url',
    '/dashboard/projects/project-1/generate',
  );
});

test('test case dibuka di halaman terpisah dari dashboard', async ({ page }) => {
  await prepareCrudPage(page);
  await expect(page.getByRole('link', { name: 'Test Case', exact: true })).toHaveAttribute(
    'href',
    '/dashboard/projects/project-1/test-cases',
  );
});

test('generate tanpa instruction membuka dialog instruction', async ({ page }) => {
  await prepareCrudPage(page);
  await page.locator('.project-card').evaluate((card) => {
    const project = JSON.parse(card.getAttribute('data-project') || '{}');
    project.instruction = '';
    card.setAttribute('data-project', JSON.stringify(project));
  });

  await page.getByRole('button', { name: 'Ai Test Script' }).click();
  await expect(page.locator('#instruction-dialog')).toBeVisible();
  await expect(page).toHaveURL('http://dashboard.test/');
});

test('generate dengan test case existing membuka modal konfirmasi replace', async ({ page }) => {
  await prepareCrudPage(page);
  await page.getByRole('button', { name: 'Ai Test Script' }).click();
  await expect(page.locator('#generate-replace-dialog[open]')).toBeVisible();
  await expect(page.locator('#generate-replace-count')).toHaveText('2');
  await expect(page).toHaveURL('http://dashboard.test/');
});

/**
 * Keterangan: Fixture halaman generate full-width untuk menguji boot job
 * tanpa merender dashboard CRUD.
 */
function createGeneratePageFixture(): string {
  return `<!doctype html>
    <html lang="id">
      <body class="generate-layout-page">
        <div id="page-loading">Loading</div>
        <div id="dashboard-content" class="generate-shell" hidden>
          <span class="user-avatar" id="user-avatar"></span>
          <span class="user-name" id="user-name"></span>
          <button id="logout-button" type="button">
            <span class="button-label">Logout</span>
            <span class="spinner" hidden></span>
          </button>
          <main id="generate-workspace" data-project-id="project-1">
            <section class="generate-panel">
              <div class="run-panel-header">
                <strong>Live generate</strong>
                <span class="status-badge status-queued">queued</span>
              </div>
              <ol class="generate-log-list"></ol>
              <div class="live-placeholder"></div>
              <img class="live-frame" hidden />
            </section>
          </main>
        </div>
      </body>
    </html>`;
}

test('halaman generate memulai job dari instruction tersimpan', async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('pointestingToken', 'token-placeholder');
  });
  await page.route(
    'http://dashboard.test/dashboard/projects/project-1/generate',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: createGeneratePageFixture(),
      });
    },
  );
  await page.route(
    'http://dashboard.test/projects/project-1/generate/prompt',
    async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ generateId: 'gen-1', status: 'queued' }),
      });
    },
  );

  await page.goto('http://dashboard.test/dashboard/projects/project-1/generate');
  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith('/projects/project-1/generate/prompt') &&
      request.method() === 'POST',
  );
  await page.addScriptTag({ path: DASHBOARD_SCRIPT });
  const request = await requestPromise;

  expect(request.postDataJSON()).toEqual({ replaceExisting: false });
  await expect(page.locator('#dashboard-content')).toBeVisible();
  await expect(page.locator('.generate-log-list')).toContainText(
    'Menunggu Playwright',
  );
});

test('test case dapat dibuat dengan dynamic step builder', async ({ page }) => {
  await prepareTestCasesPage(page, '?create=1');
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

  await expect(page.locator('#test-case-dialog')).toBeVisible();
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
    description: '',
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
  await prepareTestCasesPage(page);
  await page.route('http://dashboard.test/test-cases/case-1', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: 'case-1' }),
    });
  });

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
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
    description: '',
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
