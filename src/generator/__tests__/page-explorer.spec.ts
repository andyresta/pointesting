import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { PlaywrightExplorationDriver } from '../exploration-driver';
import {
  collectInteractionCandidates,
  collectNavLinkCandidates,
  collectPageSnapshot,
  countInteractionCandidates,
  crawlAdditionalPages,
  explorePage,
  extractTopNavLinks,
  formatExplorationForPrompt,
  formatPageSummariesForPrompt,
  PageExplorationError,
  snapshotShowsFormOverlay,
  summarizePageForPrompt,
  type PageElementSnapshot,
  type PageExplorationResult,
} from '../page-explorer';
import { normalizeUrlForZone } from '../site-model';
import { startFixtureServer, type FixtureServer } from './helpers/static-fixture-server';

let fixtureServer: FixtureServer;

test.beforeAll(async () => {
  // Keterangan: explorePage()/withExploredPage() sekarang selalu lewat MCP
  // (@playwright/mcp) yang memblokir protokol "file:" demi keamanan
  // (terverifikasi lewat POC) — fixture untuk test yang memanggil
  // explorePage() harus disajikan lewat http, bukan file:// seperti test
  // lain yang membuka browser Playwright langsung.
  fixtureServer = await startFixtureServer(path.join(__dirname, 'fixtures'));
});

test.afterAll(async () => {
  await fixtureServer.close();
});

const NAV_APP_MAIN_URL = pathToFileURL(
  path.join(__dirname, 'fixtures', 'nav-app', 'main.html'),
).href;
const BACKDROP_APP_MAIN_URL = pathToFileURL(
  path.join(__dirname, 'fixtures', 'backdrop-app', 'main.html'),
).href;
const NO_ID_LOGIN_URL = pathToFileURL(
  path.join(__dirname, 'fixtures', 'no-id-login.html'),
).href;
const DROPDOWN_APP_MAIN_URL = pathToFileURL(
  path.join(__dirname, 'fixtures', 'dropdown-app', 'main.html'),
).href;
const MODAL_FORM_URL = pathToFileURL(
  path.join(__dirname, 'fixtures', 'modal-form-app', 'customers.html'),
).href;
const CHROME_HEADER_SALES_URL = pathToFileURL(
  path.join(__dirname, 'fixtures', 'chrome-header-app', 'sales.html'),
).href;
const INTERACTION_QUOTA_APP_URL = pathToFileURL(
  path.join(__dirname, 'fixtures', 'interaction-quota-app.html'),
).href;

test('normalizeUrlForZone membedakan query page= pada pathname sama', () => {
  const login = normalizeUrlForZone('https://app.test/index.php?page=login');
  const dashboard = normalizeUrlForZone('https://app.test/index.php?page=dashboard');
  const customers = normalizeUrlForZone('https://app.test/index.php?page=customers');
  expect(login).not.toBe(dashboard);
  expect(dashboard).not.toBe(customers);
  expect(login).toContain('page=login');
  expect(customers).toContain('page=customers');
});

/**
 * Keterangan: Memverifikasi explorer membuka fixture HTML dan mengekstrak
 * id/selector/letak elemen interaktif untuk prompt generate test case.
 */
test('explorePage memetakan id tombol, input, dan letak dari halaman nyata', async () => {
  const snapshot = await explorePage(`${fixtureServer.baseUrl}/sample-ui.html`);

  expect(snapshot.title).toBe('Portal Login');
  expect(snapshot.headings.some((item) => item.includes('Masuk ke Portal'))).toBe(
    true,
  );
  const ids = snapshot.elements.map((item) => item.id);
  expect(ids).toEqual(expect.arrayContaining(['email', 'password', 'login-btn']));
  const login = snapshot.elements.find((item) => item.id === 'login-btn');
  expect(login?.selector).toBe('#login-btn');
  expect(login?.text).toContain('Masuk');
  expect(login?.width).toBeGreaterThan(0);

  const prompt = formatExplorationForPrompt(snapshot);
  expect(prompt).toContain('selector=#email');
  expect(prompt).toContain('selector=#login-btn');
  expect(prompt).toContain('letak=');
});

/**
 * Keterangan: Memverifikasi elemen tanpa identitas apa pun (fixture punya
 * `<a href="#" class="icon-wrap">` tanpa id/name/testid/label/text/
 * placeholder) tidak ikut masuk snapshot — supaya prompt generate tidak
 * membengkak dengan elemen yang selector-nya toh tidak unik/berguna.
 */
test('explorePage mengabaikan elemen tanpa id/name/testid/label/text/placeholder', async () => {
  const snapshot = await explorePage(`${fixtureServer.baseUrl}/sample-ui.html`);
  const noiseElement = snapshot.elements.find(
    (item) => item.tag === 'a' && item.href === '#',
  );
  expect(noiseElement).toBeUndefined();
});

test('explorePage menolak URL kosong', async () => {
  await expect(explorePage('')).rejects.toBeInstanceOf(PageExplorationError);
});

/**
 * Keterangan: Memverifikasi constraint validasi form (required/maxlength/
 * minlength/pattern/min/max) ikut ditangkap snapshot dan muncul di teks
 * prompt — dipakai authoring untuk negative/boundary testing (Prioritas 3).
 * Field tanpa constraint (nickname) harus tetap default aman (false/null).
 */
test('explorePage menangkap constraint validasi form dan menuliskannya di prompt', async () => {
  const snapshot = await explorePage(`${fixtureServer.baseUrl}/form-constraints.html`);

  const username = snapshot.elements.find((item) => item.id === 'username');
  expect(username?.required).toBe(true);
  expect(username?.minLength).toBe(3);
  expect(username?.maxLength).toBe(20);
  expect(username?.pattern).toBeNull();

  const email = snapshot.elements.find((item) => item.id === 'email');
  expect(email?.required).toBe(true);
  expect(email?.pattern).toBe('^[^@]+@[^@]+\\.[^@]+$');

  const age = snapshot.elements.find((item) => item.id === 'age');
  expect(age?.required).toBe(false);
  expect(age?.min).toBe('18');
  expect(age?.max).toBe('65');

  const nickname = snapshot.elements.find((item) => item.id === 'nickname');
  expect(nickname?.required).toBe(false);
  expect(nickname?.maxLength).toBeNull();
  expect(nickname?.minLength).toBeNull();
  expect(nickname?.pattern).toBeNull();
  expect(nickname?.min).toBeNull();
  expect(nickname?.max).toBeNull();

  const prompt = formatExplorationForPrompt(snapshot);
  expect(prompt).toContain('required');
  expect(prompt).toContain('minlength=3');
  expect(prompt).toContain('maxlength=20');
  expect(prompt).toContain('pattern=^[^@]+@[^@]+\\.[^@]+$');
  expect(prompt).toContain('min=18');
  expect(prompt).toContain('max=65');
});

/**
 * Keterangan: Memverifikasi tombol tanpa id/name/testid/aria-label (cuma
 * punya teks/value, seperti <button>Login</button> atau
 * <input type="submit" value="Kirim"> — pola umum di app PHP lawas) tidak
 * jatuh ke selector tag polos ("button"/"input") yang ambigu (bisa cocok >1
 * elemen dan gagal diklik strict-mode). Selector harus tetap spesifik lewat
 * :has-text()/[value=...] dan benar-benar resolve ke SATU elemen saja di
 * halaman nyata, walau ada tombol lain dengan tag sama di halaman itu.
 */
test('explorePage memberi selector spesifik (bukan tag polos) untuk tombol tanpa id yang cuma punya teks/value', async () => {
  test.setTimeout(45_000);
  const snapshot = await explorePage(`${fixtureServer.baseUrl}/no-id-login.html`);

  const loginButton = snapshot.elements.find((item) => item.text === 'Login');
  expect(loginButton?.selector).not.toBe('button');
  expect(loginButton?.selector).toContain(':has-text(');
  expect(loginButton?.selector).toContain('Login');

  const submitInput = snapshot.elements.find((item) => item.value === 'Kirim');
  expect(submitInput?.selector).not.toBe('input');
  expect(submitInput?.selector).toContain('[value=');
  expect(submitInput?.selector).toContain('Kirim');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(NO_ID_LOGIN_URL, { waitUntil: 'domcontentloaded' });
    expect(await page.locator(loginButton!.selector).count()).toBe(1);
    expect(await page.locator(submitInput!.selector).count()).toBe(1);
  } finally {
    await browser.close();
  }
});

/**
 * Keterangan: Membuat elemen snapshot minimal dengan default aman supaya test
 * extractTopNavLinks/summarizePageForPrompt fokus ke field yang relevan.
 */
function buildElement(
  overrides: Partial<PageElementSnapshot>,
): PageElementSnapshot {
  return {
    tag: 'a',
    role: null,
    type: null,
    id: null,
    nameAttr: null,
    testId: null,
    label: null,
    placeholder: null,
    text: null,
    value: null,
    href: null,
    classAttr: null,
    inNavLandmark: false,
    required: false,
    maxLength: null,
    minLength: null,
    pattern: null,
    min: null,
    max: null,
    selector: 'a',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...overrides,
  };
}

const DASHBOARD_SNAPSHOT: PageExplorationResult = {
  url: 'https://app.test/dashboard',
  title: 'Dashboard',
  headings: ['h1: Dashboard'],
  elements: [
    buildElement({ text: 'Pelanggan', href: '/customers', y: 30 }),
    buildElement({ text: 'Sparepart', href: '/parts', y: 30 }),
    buildElement({ text: 'Dashboard', href: '/dashboard', y: 30 }),
    buildElement({ text: 'Logout', href: '/logout', y: 30 }),
    buildElement({ text: 'Hapus Akun', href: '/account/delete', y: 30 }),
    buildElement({ text: 'Bantuan', href: '#', y: 30 }),
    buildElement({ text: 'Eksternal', href: 'https://other.test/x', y: 30 }),
    buildElement({ text: 'Detail transaksi', href: '/transactions/1', y: 300, x: 400 }),
  ],
};

test('extractTopNavLinks memilih link menu atas dan mengabaikan logout/hapus/hash/beda origin', () => {
  const links = extractTopNavLinks(DASHBOARD_SNAPSHOT, 6);
  expect(links).toEqual([
    { text: 'Pelanggan', href: 'https://app.test/customers', selector: 'a' },
    { text: 'Sparepart', href: 'https://app.test/parts', selector: 'a' },
  ]);
});

/**
 * Keterangan: Memverifikasi link aksi per-baris data (mis. "Detail
 * transaksi" untuk tiap baris tabel dengan id berbeda) hanya diambil SATU
 * representatif — bukan menu baru per baris, jadi tidak menghabiskan kuota
 * crawl. Juga memverifikasi anchor sesama halaman ("#foo") diabaikan tapi
 * rute hash-router SPA ("#/laporan") tetap dianggap kandidat.
 */
test('extractTopNavLinks mengambil satu representatif untuk link berpola sama (id beda) dan membedakan anchor vs hash-router', () => {
  const snapshot: PageExplorationResult = {
    url: 'https://app.test/dashboard',
    title: 'Dashboard',
    headings: [],
    elements: [
      buildElement({ text: 'Detail transaksi', href: '/transactions/1', y: 20 }),
      buildElement({ text: 'Detail transaksi', href: '/transactions/2', y: 20 }),
      buildElement({ text: 'Detail transaksi', href: '/transactions/3', y: 20 }),
      buildElement({ text: 'Lihat', href: '/index.php?page=detail&id=99', y: 20 }),
      buildElement({ text: 'Anchor halaman ini', href: '#tentang', y: 20 }),
      buildElement({ text: 'Laporan (SPA)', href: '#/laporan', y: 20 }),
    ],
  };
  const links = extractTopNavLinks(snapshot, 10);
  expect(links).toEqual([
    { text: 'Detail transaksi', href: 'https://app.test/transactions/1', selector: 'a' },
    {
      text: 'Lihat',
      href: 'https://app.test/index.php?page=detail&id=99',
      selector: 'a',
    },
    { text: 'Laporan (SPA)', href: 'https://app.test/dashboard#/laporan', selector: 'a' },
  ]);
});

test('extractTopNavLinks membatasi jumlah sesuai maxLinks', () => {
  const links = extractTopNavLinks(DASHBOARD_SNAPSHOT, 1);
  expect(links).toHaveLength(1);
});

/**
 * Keterangan: Memverifikasi menu sidebar (posisi y jauh di bawah navbar,
 * seperti aplikasi admin panel kebanyakan) tetap terdeteksi lewat landmark
 * nav/aside/class sidebar ATAU lewat posisi x sempit di sisi kiri — bukan
 * cuma navbar horizontal di atas (y<=140).
 */
const SIDEBAR_SNAPSHOT: PageExplorationResult = {
  url: 'https://app.test/dashboard',
  title: 'Dashboard Bengkel',
  headings: ['h1: Dashboard'],
  elements: [
    buildElement({
      text: 'Kendaraan',
      href: '/kendaraan',
      y: 250,
      x: 20,
      inNavLandmark: true,
    }),
    buildElement({
      text: 'Pelanggan',
      href: '/pelanggan',
      y: 300,
      x: 20,
      inNavLandmark: true,
    }),
    buildElement({
      text: 'Detail transaksi #123',
      href: '/transactions/123',
      y: 280,
      x: 400,
      inNavLandmark: false,
    }),
  ],
};

test('extractTopNavLinks mendeteksi menu sidebar lewat landmark walau y jauh dari atas', () => {
  const links = extractTopNavLinks(SIDEBAR_SNAPSHOT, 10);
  expect(links).toEqual([
    { text: 'Kendaraan', href: 'https://app.test/kendaraan', selector: 'a' },
    { text: 'Pelanggan', href: 'https://app.test/pelanggan', selector: 'a' },
  ]);
});

test('collectInteractionCandidates memilih tombol aksi non-destruktif', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const driver = new PlaywrightExplorationDriver(page);
    await page.goto(MODAL_FORM_URL, { waitUntil: 'domcontentloaded' });
    const snapshot = await collectPageSnapshot(driver);
    const actions = collectInteractionCandidates(snapshot, 10);
    expect(actions.some((item) => item.label === 'Tambah Pelanggan')).toBe(true);
    expect(actions.some((item) => /simpan|hapus/i.test(item.label))).toBe(false);
  } finally {
    await browser.close();
  }
});

test('collectInteractionCandidates mengabaikan dropdown navbar dan memprioritaskan aksi konten', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const driver = new PlaywrightExplorationDriver(page);
    await page.goto(CHROME_HEADER_SALES_URL, { waitUntil: 'domcontentloaded' });
    const snapshot = await collectPageSnapshot(driver);
    const actions = collectInteractionCandidates(snapshot, 10);
    const labels = actions.map((item) => item.label);
    expect(labels.some((item) => /pelanggan|sparepart|admin|laporan/i.test(item))).toBe(false);
    expect(labels).toEqual(
      expect.arrayContaining(['Tambah Penjualan', 'Filter', 'Export Excel']),
    );
    expect(labels.length).toBe(3);
  } finally {
    await browser.close();
  }
});

/**
 * Keterangan: Memverifikasi Prioritas 5 (laporan cakupan) —
 * `countInteractionCandidates` melaporkan jumlah TOTAL kandidat yang lolos
 * filter (sebelum dipotong kuota), supaya pemanggil (interaction-explorer.ts)
 * bisa tahu berapa kandidat terlewat saat `maxActions` lebih kecil dari
 * total yang ditemukan — tanpa itu, pemotongan kuota terjadi diam-diam.
 */
test('countInteractionCandidates melaporkan total kandidat sebelum dipotong kuota maxActions', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const driver = new PlaywrightExplorationDriver(page);
    await page.goto(INTERACTION_QUOTA_APP_URL, { waitUntil: 'domcontentloaded' });
    const snapshot = await collectPageSnapshot(driver);

    const total = countInteractionCandidates(snapshot);
    expect(total).toBe(4);

    const truncated = collectInteractionCandidates(snapshot, 2);
    expect(truncated).toHaveLength(2);

    const notTruncated = collectInteractionCandidates(snapshot, 10);
    expect(notTruncated).toHaveLength(total);
  } finally {
    await browser.close();
  }
});

test('snapshotShowsFormOverlay mendeteksi modal form setelah klik', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const driver = new PlaywrightExplorationDriver(page);
    await page.goto(MODAL_FORM_URL, { waitUntil: 'domcontentloaded' });
    const before = await collectPageSnapshot(driver);
    await page.locator('#btn-add').click();
    await page.waitForTimeout(200);
    const after = await collectPageSnapshot(driver);
    expect(snapshotShowsFormOverlay(before, after)).toBe(true);
  } finally {
    await browser.close();
  }
});

test('collectNavLinkCandidates menemukan link di dropdown menu tersembunyi', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const driver = new PlaywrightExplorationDriver(page);
    await page.goto(DROPDOWN_APP_MAIN_URL, { waitUntil: 'domcontentloaded' });
    const snapshot = await collectPageSnapshot(driver);
    const links = await collectNavLinkCandidates(driver, snapshot, 10);
    expect(links.some((item) => item.text === 'Daftar Pelanggan')).toBe(true);
    expect(links.some((item) => item.text === 'Tambah Pelanggan')).toBe(true);
    expect(links.some((item) => item.text === 'Penjualan')).toBe(true);
  } finally {
    await browser.close();
  }
});

test('summarizePageForPrompt meringkas judul, heading, dan label tombol/link tanpa selector', () => {
  const summary = summarizePageForPrompt({
    url: 'https://app.test/customers',
    title: 'Data Pelanggan',
    headings: ['h1: Data Pelanggan', 'h2: Ringkasan'],
    elements: [
      buildElement({ tag: 'button', text: 'Tambah Pelanggan' }),
      buildElement({ tag: 'button', text: 'Tambah Pelanggan' }),
      buildElement({ tag: 'a', text: 'Export' }),
      buildElement({ tag: 'input', text: null }),
    ],
  });

  expect(summary.title).toBe('Data Pelanggan');
  expect(summary.headings).toEqual(['h1: Data Pelanggan', 'h2: Ringkasan']);
  expect(summary.actionLabels).toEqual(['Tambah Pelanggan', 'Export']);
});

test('formatPageSummariesForPrompt menyusun teks ringkas tanpa data selector', () => {
  const text = formatPageSummariesForPrompt([
    {
      url: 'https://app.test/customers',
      title: 'Data Pelanggan',
      headings: ['h1: Data Pelanggan'],
      actionLabels: ['Tambah Pelanggan'],
    },
  ]);
  expect(text).toContain('Data Pelanggan (https://app.test/customers)');
  expect(text).toContain('Tambah Pelanggan');
  expect(text).not.toContain('selector=');
});

test('formatPageSummariesForPrompt mengembalikan string kosong bila tidak ada halaman', () => {
  expect(formatPageSummariesForPrompt([])).toBe('');
});

/**
 * Keterangan: Memverifikasi crawlAdditionalPages tetap menemukan menu yang
 * disembunyikan di balik tombol hamburger/drawer (nav baru terlihat setelah
 * diklik) — bukan cuma menu yang langsung terlihat di snapshot awal. Ini
 * pola umum di banyak aplikasi web modern, bukan cuma navbar/sidebar statis.
 */
test('crawlAdditionalPages membuka menu di balik tombol hamburger lalu menjelajahi tiap halamannya', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const driver = new PlaywrightExplorationDriver(page);
    await page.goto(NAV_APP_MAIN_URL, { waitUntil: 'domcontentloaded' });
    const mainSnapshot = await collectPageSnapshot(driver);

    // Sanity check: nav masih tersembunyi, jadi belum ada kandidat menu.
    expect(extractTopNavLinks(mainSnapshot, 10)).toHaveLength(0);

    const pages = await crawlAdditionalPages(driver, mainSnapshot, 10);
    expect(pages.map((item) => item.title).sort()).toEqual([
      'Halaman Kendaraan',
      'Halaman Pelanggan',
    ]);
    expect(
      pages.some((item) => item.headings.some((heading) => heading.includes('Daftar Kendaraan'))),
    ).toBe(true);

    // Page harus balik ke URL semula setelah crawl selesai.
    expect(page.url()).toBe(NAV_APP_MAIN_URL);
  } finally {
    await browser.close();
  }
});

/**
 * Keterangan: Memverifikasi backdrop/overlay (mis. promo/modal) yang
 * menutupi seluruh viewport dan mencegat klik ke link menu di baliknya
 * berhasil dihilangkan otomatis sebelum crawl mengklik menu — supaya menu
 * tetap terjelajahi walau tertutup elemen lain.
 */
test('crawlAdditionalPages menghilangkan backdrop yang menutupi menu sebelum mengklik', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const driver = new PlaywrightExplorationDriver(page);
    await page.goto(BACKDROP_APP_MAIN_URL, { waitUntil: 'domcontentloaded' });

    // Sanity check: backdrop benar-benar ada dan menutupi seluruh viewport
    // sebelum crawl dijalankan.
    await expect(page.locator('#promo-backdrop')).toBeVisible();

    const mainSnapshot = await collectPageSnapshot(driver);
    const candidates = extractTopNavLinks(mainSnapshot, 10);
    expect(candidates.map((item) => item.text)).toEqual(['Kendaraan', 'Pelanggan']);

    const pages = await crawlAdditionalPages(driver, mainSnapshot, 10);
    expect(pages.map((item) => item.title).sort()).toEqual([
      'Halaman Kendaraan',
      'Halaman Pelanggan',
    ]);
  } finally {
    await browser.close();
  }
});
