import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  explorePage,
  extractTopNavLinks,
  formatExplorationForPrompt,
  formatPageSummariesForPrompt,
  PageExplorationError,
  summarizePageForPrompt,
  type PageElementSnapshot,
  type PageExplorationResult,
} from '../page-explorer';

const FIXTURE_URL = pathToFileURL(
  path.join(__dirname, 'fixtures', 'sample-ui.html'),
).href;

/**
 * Keterangan: Memverifikasi explorer membuka fixture HTML dan mengekstrak
 * id/selector/letak elemen interaktif untuk prompt generate test case.
 */
test('explorePage memetakan id tombol, input, dan letak dari halaman nyata', async () => {
  const snapshot = await explorePage(FIXTURE_URL);

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

test('explorePage menolak URL kosong', async () => {
  await expect(explorePage('')).rejects.toBeInstanceOf(PageExplorationError);
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
    href: null,
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
    buildElement({ text: 'Detail transaksi', href: '/transactions/1', y: 300 }),
  ],
};

test('extractTopNavLinks memilih link menu atas dan mengabaikan logout/hapus/hash/beda origin', () => {
  const links = extractTopNavLinks(DASHBOARD_SNAPSHOT, 6);
  expect(links).toEqual([
    { text: 'Pelanggan', href: 'https://app.test/customers' },
    { text: 'Sparepart', href: 'https://app.test/parts' },
  ]);
});

test('extractTopNavLinks membatasi jumlah sesuai maxLinks', () => {
  const links = extractTopNavLinks(DASHBOARD_SNAPSHOT, 1);
  expect(links).toHaveLength(1);
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
