import { chromium, type Page } from '@playwright/test';

export class PageExplorationError extends Error {
  readonly statusCode: number;

  /**
   * Keterangan: Menandai gagalnya analisis tampilan halaman (URL kosong,
   * navigasi timeout, atau browser error) agar generate tidak menebak selector.
   */
  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'PageExplorationError';
    this.statusCode = statusCode;
  }
}

export interface PageElementSnapshot {
  tag: string;
  role: string | null;
  type: string | null;
  id: string | null;
  nameAttr: string | null;
  testId: string | null;
  label: string | null;
  placeholder: string | null;
  text: string | null;
  href: string | null;
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageSummary {
  url: string;
  title: string;
  headings: string[];
  actionLabels: string[];
}

export interface NavLinkCandidate {
  text: string;
  href: string;
}

export interface PageExplorationResult {
  url: string;
  title: string;
  headings: string[];
  elements: PageElementSnapshot[];
}

const VIEWPORT = { width: 1280, height: 720 };
const NAV_TIMEOUT_MS = 20_000;
const MAX_ELEMENTS = 80;
const MAX_HEADINGS = 20;
const NAV_LINK_Y_THRESHOLD = 140;
const CRAWL_NAV_TIMEOUT_MS = 10_000;
const MAX_SUMMARY_HEADINGS = 5;
const MAX_SUMMARY_ACTIONS = 15;
const DESTRUCTIVE_OR_LOGOUT_PATTERN =
  /log\s*-?out|keluar|sign\s*-?out|hapus|delete|nonaktifkan|remove/i;

/**
 * Keterangan: Membangun selector CSS yang paling stabil dari atribut elemen
 * (id, data-testid, name, aria-label) supaya LLM tidak mengarang selector.
 */
function preferSelector(element: {
  id: string | null;
  testId: string | null;
  nameAttr: string | null;
  label: string | null;
  tag: string;
}): string {
  if (element.id && /^[A-Za-z_][\w-]*$/.test(element.id)) {
    return `#${element.id}`;
  }
  if (element.id) {
    return `[id=${JSON.stringify(element.id)}]`;
  }
  if (element.testId) {
    return `[data-testid=${JSON.stringify(element.testId)}]`;
  }
  if (element.nameAttr) {
    return `${element.tag}[name=${JSON.stringify(element.nameAttr)}]`;
  }
  if (element.label) {
    return `${element.tag}[aria-label=${JSON.stringify(element.label)}]`;
  }
  return element.tag;
}

/**
 * Keterangan: Memvalidasi Base URL project sebelum Chromium diluncurkan.
 */
export function parseTargetUrl(targetUrl: string): URL {
  const trimmed = targetUrl.trim();
  if (!trimmed) {
    throw new PageExplorationError(
      'Base URL project wajib diisi supaya AI dapat menganalisis tampilan halaman',
      400,
    );
  }

  try {
    return new URL(trimmed);
  } catch {
    throw new PageExplorationError(
      'Base URL project tidak valid. Isi URL lengkap (misal https://app.example.com)',
      400,
    );
  }
}

/**
 * Keterangan: Meluncurkan Chromium dan menyediakan page ke pemanggil, lalu
 * selalu menutup browser (termasuk saat LLM masih memakai snapshot).
 */
export async function withExploredPage<T>(
  targetUrl: string,
  work: (page: Page) => Promise<T>,
): Promise<T> {
  parseTargetUrl(targetUrl);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    return await work(page);
  } finally {
    await browser.close();
  }
}

/**
 * Keterangan: Membuka URL target dan menunggu halaman relatif siap sebelum
 * snapshot elemen diambil.
 */
export async function navigateForExploration(
  page: Page,
  targetUrl: string,
): Promise<void> {
  const parsed = parseTargetUrl(targetUrl);
  try {
    await page.goto(parsed.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'navigasi gagal';
    throw new PageExplorationError(
      `Gagal membuka halaman "${parsed.toString()}" untuk dianalisis: ${detail}`,
    );
  }
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
}

/**
 * Keterangan: Memetakan heading dan elemen interaktif dari halaman yang sudah
 * terbuka (id, name, letak, selector) tanpa menutup browser.
 */
export async function collectPageSnapshot(page: Page): Promise<PageExplorationResult> {
  const headingLocator = page.locator('h1, h2, h3');
  const headingCount = Math.min(await headingLocator.count(), MAX_HEADINGS);
  const headings: string[] = [];
  for (let index = 0; index < headingCount; index += 1) {
    const heading = headingLocator.nth(index);
    if (!(await heading.isVisible())) {
      continue;
    }
    const tag = await heading.evaluate((node) =>
      (node as { tagName: string }).tagName.toLowerCase(),
    );
    const text = (await heading.innerText()).trim();
    if (text) {
      headings.push(`${tag}: ${text}`);
    }
  }

  const interactive = page.locator(
    'a, button, input, select, textarea, [role="button"], [role="link"], [role="textbox"]',
  );
  const interactiveCount = await interactive.count();
  const rawElements: Array<Omit<PageElementSnapshot, 'selector'>> = [];
  for (let index = 0; index < interactiveCount && rawElements.length < MAX_ELEMENTS; index += 1) {
    const element = interactive.nth(index);
    if (!(await element.isVisible())) {
      continue;
    }
    const box = await element.boundingBox();
    if (!box || box.width === 0 || box.height === 0) {
      continue;
    }
    const tag = await element.evaluate((node) =>
      (node as { tagName: string }).tagName.toLowerCase(),
    );
    const text = (await element.innerText().catch(() => '')).trim().slice(0, 80) || null;
    rawElements.push({
      tag,
      role: (await element.getAttribute('role')) || null,
      type: (await element.getAttribute('type')) || null,
      id: (await element.getAttribute('id')) || null,
      nameAttr: (await element.getAttribute('name')) || null,
      testId: (await element.getAttribute('data-testid')) || null,
      label: (await element.getAttribute('aria-label')) || null,
      placeholder: (await element.getAttribute('placeholder')) || null,
      href: (await element.getAttribute('href')) || null,
      text,
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    });
  }

  return {
    url: page.url(),
    title: await page.title(),
    headings,
    elements: rawElements.map((element) => ({
      ...element,
      selector: preferSelector({
        id: element.id,
        testId: element.testId,
        nameAttr: element.nameAttr,
        label: element.label,
        tag: element.tag,
      }),
    })),
  };
}

/**
 * Keterangan: Membuka URL target di Chromium headless, menunggu halaman siap,
 * lalu memetakan heading dan elemen interaktif (id, name, letak, selector).
 */
export async function explorePage(targetUrl: string): Promise<PageExplorationResult> {
  return withExploredPage(targetUrl, async (page) => {
    await navigateForExploration(page, targetUrl);
    return collectPageSnapshot(page);
  });
}

/**
 * Keterangan: Mengubah hasil eksplorasi halaman menjadi teks ringkas untuk
 * prompt LLM: URL, heading, id/selector, dan letak elemen.
 */
export function formatExplorationForPrompt(result: PageExplorationResult): string {
  const lines = [
    `URL halaman: ${result.url}`,
    `Judul: ${result.title || '(tanpa title)'}`,
  ];
  if (result.headings.length > 0) {
    lines.push('Heading:', ...result.headings.map((item) => `- ${item}`));
  }
  lines.push(
    'Elemen interaktif (wajib pakai kolom selector; jangan mengarang id yang tidak ada):',
  );
  if (result.elements.length === 0) {
    lines.push('- (tidak ada tombol/input terlihat)');
    return lines.join('\n');
  }
  for (const element of result.elements) {
    const bits = [
      element.tag,
      `selector=${element.selector}`,
      element.type ? `type=${element.type}` : null,
      element.id ? `id=${element.id}` : null,
      element.nameAttr ? `name=${element.nameAttr}` : null,
      element.testId ? `data-testid=${element.testId}` : null,
      element.label ? `label=${element.label}` : null,
      element.placeholder ? `placeholder=${element.placeholder}` : null,
      element.text ? `text=${JSON.stringify(element.text)}` : null,
      element.href ? `href=${element.href}` : null,
      `letak=${element.x},${element.y} ${element.width}x${element.height}`,
    ].filter(Boolean);
    lines.push(`- ${bits.join(' | ')}`);
  }
  return lines.join('\n');
}

/**
 * Keterangan: Mengambil kandidat link menu navigasi utama (posisi dekat atas
 * halaman) dari snapshot untuk dijelajahi lebih lanjut. Mengabaikan link
 * kosong/hash/javascript, logout, aksi destruktif (hapus/delete), beda origin,
 * atau URL yang sama dengan halaman saat ini.
 */
export function extractTopNavLinks(
  snapshot: PageExplorationResult,
  maxLinks: number,
): NavLinkCandidate[] {
  let currentOrigin: string;
  try {
    currentOrigin = new URL(snapshot.url).origin;
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const result: NavLinkCandidate[] = [];
  for (const element of snapshot.elements) {
    if (element.tag !== 'a' || !element.href || element.y > NAV_LINK_Y_THRESHOLD) {
      continue;
    }
    const href = element.href.trim();
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) {
      continue;
    }
    const text = (element.text || '').trim();
    if (!text || DESTRUCTIVE_OR_LOGOUT_PATTERN.test(text)) {
      continue;
    }

    let absolute: URL;
    try {
      absolute = new URL(href, snapshot.url);
    } catch {
      continue;
    }
    const absoluteHref = absolute.toString();
    if (
      absolute.origin !== currentOrigin ||
      DESTRUCTIVE_OR_LOGOUT_PATTERN.test(absolute.pathname) ||
      absoluteHref === snapshot.url ||
      seen.has(absoluteHref)
    ) {
      continue;
    }
    seen.add(absoluteHref);
    result.push({ text, href: absoluteHref });
    if (result.length >= maxLinks) {
      break;
    }
  }
  return result;
}

/**
 * Keterangan: Meringkas snapshot halaman tambahan (judul, heading, label
 * tombol/menu) tanpa id/selector/letak, supaya prompt generate tidak
 * membengkak saat menggabungkan banyak halaman sekaligus.
 */
export function summarizePageForPrompt(result: PageExplorationResult): PageSummary {
  const actionLabels: string[] = [];
  const seen = new Set<string>();
  for (const element of result.elements) {
    if (element.tag !== 'a' && element.tag !== 'button') {
      continue;
    }
    const label = (element.text || element.label || '').trim();
    if (!label || seen.has(label)) {
      continue;
    }
    seen.add(label);
    actionLabels.push(label);
    if (actionLabels.length >= MAX_SUMMARY_ACTIONS) {
      break;
    }
  }
  return {
    url: result.url,
    title: result.title,
    headings: result.headings.slice(0, MAX_SUMMARY_HEADINGS),
    actionLabels,
  };
}

/**
 * Keterangan: Menyusun ringkasan multi-halaman menjadi teks prompt — hanya
 * konteks navigasi/verifikasi karena tidak memuat data selector detail.
 */
export function formatPageSummariesForPrompt(summaries: PageSummary[]): string {
  if (summaries.length === 0) {
    return '';
  }
  const lines = [
    'Ringkasan halaman/menu lain pada aplikasi (HANYA konteks eksplorasi; tidak ada selector detail — boleh dipakai untuk test case goto + verifikasi heading/teks saja, JANGAN fill/click di halaman ini):',
  ];
  for (const summary of summaries) {
    const bits = [`${summary.title || '(tanpa title)'} (${summary.url})`];
    if (summary.headings.length > 0) {
      bits.push(`heading: ${summary.headings.join('; ')}`);
    }
    if (summary.actionLabels.length > 0) {
      bits.push(`menu/tombol: ${summary.actionLabels.join(', ')}`);
    }
    lines.push(`- ${bits.join(' | ')}`);
  }
  return lines.join('\n');
}

/**
 * Keterangan: Menjelajahi kandidat link menu navigasi utama (maksimal
 * maxPages) dari halaman yang sedang terbuka, meringkas tiap halaman, lalu
 * mengembalikan Page ke URL semula. Halaman yang gagal dibuka dilewati saja
 * agar generate tidak gagal total karena satu menu bermasalah.
 */
export async function crawlAdditionalPages(
  page: Page,
  fromSnapshot: PageExplorationResult,
  maxPages: number,
  onPageStart?: (label: string) => void,
): Promise<PageSummary[]> {
  const candidates = extractTopNavLinks(fromSnapshot, maxPages);
  if (candidates.length === 0) {
    return [];
  }

  const originalUrl = page.url();
  const summaries: PageSummary[] = [];
  for (const candidate of candidates) {
    onPageStart?.(candidate.text);
    try {
      await page.goto(candidate.href, {
        waitUntil: 'domcontentloaded',
        timeout: CRAWL_NAV_TIMEOUT_MS,
      });
      await page
        .waitForLoadState('networkidle', { timeout: 4_000 })
        .catch(() => undefined);
      const snapshot = await collectPageSnapshot(page);
      summaries.push(summarizePageForPrompt(snapshot));
    } catch {
      continue;
    }
  }

  await page
    .goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: CRAWL_NAV_TIMEOUT_MS })
    .catch(() => undefined);
  return summaries;
}
