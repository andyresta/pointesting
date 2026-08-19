import type { ExplorationDriver } from './exploration-driver';
import { McpBrowserSession, McpExplorationDriver } from './mcp-client';

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
  value: string | null;
  href: string | null;
  classAttr: string | null;
  inNavLandmark: boolean;
  /** Constraint validasi form — dipakai prompt authoring untuk skenario negatif/boundary (Prioritas 3). */
  required: boolean;
  maxLength: number | null;
  minLength: number | null;
  pattern: string | null;
  min: string | null;
  max: string | null;
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
  selector: string;
}

/** Kandidat klik tombol/aksi untuk eksplorasi interaktif (bukan navigasi href). */
export interface InteractionCandidate {
  label: string;
  selector: string;
  tag: string;
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
// Fallback untuk layout sidebar kiri/kanan (bukan navbar atas) — banyak
// admin panel (termasuk aplikasi bengkel yang dites user) menaruh menu di
// sidebar vertikal, jadi link menu-nya bisa berada jauh di bawah y=140.
// Dihitung relatif ke lebar viewport (bukan angka mati) supaya tetap wajar
// dipakai lintas aplikasi walau viewport berubah.
const NAV_LINK_SIDEBAR_X_THRESHOLD = Math.round(VIEWPORT.width * 0.22);
const NAV_LINK_SIDEBAR_RIGHT_X_THRESHOLD = VIEWPORT.width - NAV_LINK_SIDEBAR_X_THRESHOLD;
// Selector landmark navigasi (elemen umum yang dipakai template admin untuk
// membungkus menu, terlepas dari posisi/koordinat): <nav>/<aside>,
// role="navigation", atau class/id yang mengandung kata sidebar/navbar/menu.
const NAV_LANDMARK_SELECTOR =
  'nav, aside, header, [role="navigation"], [role="banner"], [class*="sidebar" i], [class*="side-menu" i], [class*="sidenav" i], [class*="navbar" i], [class*="nav-menu" i], [class*="topbar" i], [class*="top-bar" i], [class*="menu-bar" i], [class*="app-menu" i]';
// Pola tombol pembuka menu (hamburger/drawer) yang menyembunyikan nav sampai
// diklik — dicek dari id/data-testid/class/aria-label/text elemen.
const HAMBURGER_TOGGLE_PATTERN =
  /menu[-_ ]?toggle|navbar[-_ ]?toggler|hamburger|burger|sidebar[-_ ]?toggle|nav[-_ ]?toggle|toggle[-_ ]?(menu|nav|sidebar)/i;
const CRAWL_NAV_TIMEOUT_MS = 10_000;
const MAX_SUMMARY_HEADINGS = 5;
const MAX_SUMMARY_ACTIONS = 15;
export const DESTRUCTIVE_OR_LOGOUT_PATTERN =
  /log\s*-?out|keluar|sign\s*-?out|hapus|delete|nonaktifkan|remove/i;

/** Pola tombol/aksi yang tidak boleh diklik saat observasi (konfirmasi/destruktif). */
export const SKIP_INTERACTION_PATTERN =
  /^(ok|ya|yes|confirm|setuju|submit|simpan|save|kirim|send|hapus|delete|remove|nonaktifkan)$/i;

const MODAL_TRIGGER_PATTERN =
  /tambah|add|buat|baru|new|filter|cari|search|export|import|detail|edit|ubah|setting|pengaturan|modal|popup|form/i;

/** Pola aksi konten halaman (bukan menu navigasi) — diprioritaskan saat eksplorasi. */
const PAGE_ACTION_PATTERN =
  /lihat|view|detail|status|cetak|print|pdf|excel|refresh|reset|sync|unduh|download|upload|approve|reject|aktifkan|nonaktifkan|proses|bayar|invoice|nota|stok|transaksi/i;

const CHROME_CLASS_PATTERN =
  /dropdown-toggle|nav-link|navbar-nav|nav-item|menu-item|sidenav|side-menu|topbar|top-bar|menu-bar|app-menu|main-menu|sidebar-menu|header-menu/i;
// Selector generik elemen backdrop/overlay (modal, offcanvas, drawer, cookie
// consent, dsb.) yang biasa menutupi seluruh/sebagian besar viewport dan
// mencegat klik ke menu/link di baliknya — nama class/id-nya bervariasi
// antar-app, jadi dicocokkan lewat kata kunci umum, bukan hardcode satu app.
const BLOCKING_OVERLAY_SELECTOR =
  '.modal-backdrop, .offcanvas-backdrop, [class*="backdrop" i], [class*="overlay" i]:not(nav):not(aside), [class*="scrim" i], [class*="dimmer" i]';
// Overlay dianggap "menutupi/menghalangi" kalau ukurannya mencakup sebagian
// besar viewport (bukan sekadar tooltip/badge kecil yang class-nya kebetulan
// mengandung kata overlay).
const BLOCKING_OVERLAY_MIN_COVERAGE = 0.5;
const DROPDOWN_TOGGLE_SELECTOR =
  '[data-bs-toggle="dropdown"], [data-toggle="dropdown"], .dropdown-toggle, [id$="Dropdown"], a.nav-link.dropdown-toggle, button.dropdown-toggle';
const DROPDOWN_MARKER_ATTR = 'data-ai-dropdown-idx';
const MODAL_DISMISS_MARKER_ATTR = 'data-ai-modal-dismiss-target';
const MODAL_CANCEL_TEXT_PATTERN_SOURCE = 'batal|cancel|tutup|close|kembali';

/**
 * Keterangan: Membangun selector CSS yang paling stabil dari atribut elemen
 * (id, data-testid, name, aria-label, placeholder). Kalau elemen tidak punya
 * satu pun atribut identitas itu (umum untuk tombol seperti
 * `<button>Login</button>` atau `<input type="submit" value="Login">` tanpa
 * id), jatuh ke teks/value-nya lewat pseudo `:has-text()`/`[value=...]`
 * (didukung selector engine Playwright, dan tetap didukung lewat MCP karena
 * MCP meneruskan selector persis ke `page.locator()` Playwright yang sama)
 * supaya TETAP spesifik — bukan tag polos yang bisa cocok banyak elemen
 * sekaligus dan membuat klik gagal (strict-mode violation) atau salah sasaran.
 */
function preferSelector(element: {
  id: string | null;
  testId: string | null;
  nameAttr: string | null;
  label: string | null;
  placeholder: string | null;
  text: string | null;
  value: string | null;
  type: string | null;
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
  if (element.placeholder) {
    return `${element.tag}[placeholder=${JSON.stringify(element.placeholder)}]`;
  }
  const typeQualifier = element.type ? `[type=${JSON.stringify(element.type)}]` : '';
  if (element.text) {
    return `${element.tag}${typeQualifier}:has-text(${JSON.stringify(element.text)})`;
  }
  if (element.value) {
    return `${element.tag}${typeQualifier}[value=${JSON.stringify(element.value)}]`;
  }
  return element.tag;
}

/**
 * Keterangan: Fragmen JS (dijalankan via driver.evaluate) yang mencari
 * elemen backdrop/overlay pertama yang benar-benar terlihat DAN menutupi
 * sebagian besar viewport — dipakai bersama oleh cari/klik/paksa-sembunyikan
 * supaya logika deteksi hanya ditulis sekali.
 */
function buildFindOverlayExpression(): string {
  return `
    const candidates = document.querySelectorAll(${JSON.stringify(BLOCKING_OVERLAY_SELECTOR)});
    let found = null;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.width >= window.innerWidth * ${BLOCKING_OVERLAY_MIN_COVERAGE} && rect.height >= window.innerHeight * ${BLOCKING_OVERLAY_MIN_COVERAGE}) {
        found = el;
        break;
      }
    }
  `;
}

/**
 * Keterangan: Menghilangkan backdrop/overlay yang menutupi menu/link supaya
 * elemen di baliknya bisa diklik saat eksplorasi. Dicoba berurutan: klik
 * backdrop-nya sendiri (umum menutup modal/drawer) lewat DOM click() native
 * (bukan driver.click() — backdrop biasanya menutupi elemen lain sehingga
 * butuh klik "paksa" yang tidak melalui actionability check normal), lalu
 * tombol Escape, lalu — kalau masih ada — dipaksa disembunyikan lewat DOM
 * (khusus untuk kebutuhan eksplorasi/crawl, bukan eksekusi test case
 * sungguhan).
 */
async function dismissBlockingOverlay(driver: ExplorationDriver): Promise<boolean> {
  const findExpr = buildFindOverlayExpression();
  const clicked = await driver
    .evaluate<boolean>(`() => { ${findExpr} if (found) { found.click(); return true; } return false; }`)
    .catch(() => false);
  if (!clicked) {
    return false;
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  let remaining = await driver
    .evaluate<boolean>(`() => { ${findExpr} return Boolean(found); }`)
    .catch(() => false);
  if (remaining) {
    await driver.pressKey('Escape').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));
    remaining = await driver
      .evaluate<boolean>(`() => { ${findExpr} return Boolean(found); }`)
      .catch(() => false);
  }
  if (remaining) {
    await driver
      .evaluate(
        `() => { ${findExpr} if (found) { found.style.setProperty('display', 'none', 'important'); } return null; }`,
      )
      .catch(() => undefined);
  }
  return true;
}

/**
 * Keterangan: Memvalidasi Base URL project sebelum browser diluncurkan.
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
 * Keterangan: Membuka sesi browser via MCP (@playwright/mcp, in-process —
 * lihat mcp-client.ts) dan menyediakan ExplorationDriver ke pemanggil, lalu
 * selalu menutup sesi (termasuk saat LLM masih memakai snapshot terakhir).
 * Mengganti mekanisme lama (`chromium.launch()` langsung) sesuai keputusan
 * memindahkan mesin eksplorasi/generate ke MCP — eksekusi test case
 * TERSIMPAN tidak terpengaruh, tetap Playwright asli (lihat page-driver.ts).
 */
export async function withExploredPage<T>(
  targetUrl: string,
  work: (driver: ExplorationDriver) => Promise<T>,
): Promise<T> {
  parseTargetUrl(targetUrl);
  const session = new McpBrowserSession();
  await session.connect(VIEWPORT);
  try {
    return await work(new McpExplorationDriver(session));
  } finally {
    await session.disconnect();
  }
}

/**
 * Keterangan: Membuka URL target dan menunggu halaman relatif siap sebelum
 * snapshot elemen diambil.
 */
export async function navigateForExploration(
  driver: ExplorationDriver,
  targetUrl: string,
): Promise<void> {
  const parsed = parseTargetUrl(targetUrl);
  try {
    await driver.goto(parsed.toString(), { timeoutMs: NAV_TIMEOUT_MS });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'navigasi gagal';
    throw new PageExplorationError(
      `Gagal membuka halaman "${parsed.toString()}" untuk dianalisis: ${detail}`,
    );
  }
  await driver.waitForIdle(5_000);
  await dismissBlockingOverlay(driver);
}

/**
 * Keterangan: Fragmen JS tunggal yang mengekstrak heading + elemen
 * interaktif (id/name/testid/label/placeholder/text/value/href/class/
 * constraint validasi/posisi) dalam SATU evaluate call — dijalankan lewat
 * driver (Playwright asli ATAU MCP), bukan loop locator per-elemen seperti
 * sebelumnya, supaya jumlah round-trip tetap kecil terlepas dari backend.
 * Field constraint (required/maxLength/minLength/pattern/min/max) dipakai
 * prompt authoring untuk negative/boundary testing (Prioritas 3); posisi
 * (x/y/width/height) dipakai heuristik deteksi menu (extractTopNavLinks dkk).
 */
function buildSnapshotEvaluateFn(): string {
  return `() => {
    const MAX_HEADINGS = ${MAX_HEADINGS};
    const MAX_ELEMENTS = ${MAX_ELEMENTS};
    const NAV_LANDMARK_SELECTOR = ${JSON.stringify(NAV_LANDMARK_SELECTOR)};

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none';
    }

    const headings = [];
    for (const h of document.querySelectorAll('h1, h2, h3')) {
      if (headings.length >= MAX_HEADINGS) break;
      if (!isVisible(h)) continue;
      const text = (h.innerText || '').trim();
      if (text) headings.push(h.tagName.toLowerCase() + ': ' + text);
    }

    const elements = [];
    const candidates = document.querySelectorAll(
      'a, button, input, select, textarea, [role="button"], [role="link"], [role="textbox"]',
    );
    for (const el of candidates) {
      if (elements.length >= MAX_ELEMENTS) break;
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const text = (el.innerText || '').trim().slice(0, 80) || null;
      const id = el.getAttribute('id') || null;
      const nameAttr = el.getAttribute('name') || null;
      const testId = el.getAttribute('data-testid') || null;
      const label = el.getAttribute('aria-label') || null;
      const placeholder = el.getAttribute('placeholder') || null;
      const value = el.getAttribute('value') || null;
      if (!id && !nameAttr && !testId && !label && !text && !placeholder && !value) {
        continue;
      }
      const inNavLandmark = Boolean(el.closest(NAV_LANDMARK_SELECTOR));
      const classAttr = el.getAttribute('class') || null;
      const requiredAttr = el.getAttribute('required');
      const ariaRequired = el.getAttribute('aria-required');
      const maxLengthAttr = el.getAttribute('maxlength');
      const minLengthAttr = el.getAttribute('minlength');
      const maxLength =
        maxLengthAttr !== null && Number.isFinite(Number(maxLengthAttr)) ? Number(maxLengthAttr) : null;
      const minLength =
        minLengthAttr !== null && Number.isFinite(Number(minLengthAttr)) ? Number(minLengthAttr) : null;
      elements.push({
        tag,
        role: el.getAttribute('role') || null,
        type: el.getAttribute('type') || null,
        id,
        nameAttr,
        testId,
        label,
        placeholder,
        href: el.getAttribute('href') || null,
        text,
        value,
        classAttr,
        inNavLandmark,
        required: requiredAttr !== null || ariaRequired === 'true',
        maxLength,
        minLength,
        pattern: el.getAttribute('pattern') || null,
        min: el.getAttribute('min') || null,
        max: el.getAttribute('max') || null,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }

    return { title: document.title, headings, elements };
  }`;
}

/**
 * Keterangan: Memetakan heading dan elemen interaktif dari halaman yang sudah
 * terbuka (id, name, letak, selector, constraint validasi) tanpa menutup
 * sesi browser.
 */
export async function collectPageSnapshot(driver: ExplorationDriver): Promise<PageExplorationResult> {
  const url = await driver.currentUrl();
  const raw = await driver.evaluate<{
    title: string;
    headings: string[];
    elements: Array<Omit<PageElementSnapshot, 'selector'>>;
  }>(buildSnapshotEvaluateFn());

  return {
    url,
    title: raw.title,
    headings: raw.headings,
    elements: raw.elements.map((element) => ({
      ...element,
      selector: preferSelector({
        id: element.id,
        testId: element.testId,
        nameAttr: element.nameAttr,
        label: element.label,
        placeholder: element.placeholder,
        text: element.text,
        value: element.value,
        type: element.type,
        tag: element.tag,
      }),
    })),
  };
}

/**
 * Keterangan: Membuka URL target di sesi browser MCP, menunggu halaman siap,
 * lalu memetakan heading dan elemen interaktif (id, name, letak, selector).
 */
export async function explorePage(targetUrl: string): Promise<PageExplorationResult> {
  return withExploredPage(targetUrl, async (driver) => {
    await navigateForExploration(driver, targetUrl);
    return collectPageSnapshot(driver);
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
      element.value ? `value=${JSON.stringify(element.value)}` : null,
      element.href ? `href=${element.href}` : null,
      element.required ? 'required' : null,
      element.maxLength !== null ? `maxlength=${element.maxLength}` : null,
      element.minLength !== null ? `minlength=${element.minLength}` : null,
      element.pattern ? `pattern=${element.pattern}` : null,
      element.min !== null ? `min=${element.min}` : null,
      element.max !== null ? `max=${element.max}` : null,
      `letak=${element.x},${element.y} ${element.width}x${element.height}`,
    ].filter(Boolean);
    lines.push(`- ${bits.join(' | ')}`);
  }
  return lines.join('\n');
}

/**
 * Keterangan: Menormalkan href jadi "pola" dengan mengganti segmen path
 * murni angka/hex-id serta value query param murni angka dengan placeholder
 * ":id". Dipakai untuk mendeteksi link aksi per-baris data (mis. "Detail
 * transaksi" yang diulang untuk tiap baris tabel dengan id berbeda) supaya
 * hanya satu representatif yang diambil — sisanya bukan menu baru, cuma
 * record berbeda dari fitur yang sama.
 */
function normalizeHrefPattern(absolute: URL): string {
  const isIdSegment = (segment: string): boolean =>
    /^\d+$/.test(segment) || /^[0-9a-f]{8,}$/i.test(segment);
  const pathPattern = absolute.pathname
    .split('/')
    .map((segment) => (isIdSegment(segment) ? ':id' : segment))
    .join('/');

  const normalizedParams = new URLSearchParams();
  const paramKeys = [...absolute.searchParams.keys()].sort();
  for (const key of paramKeys) {
    const value = absolute.searchParams.get(key) ?? '';
    normalizedParams.set(key, isIdSegment(value) ? ':id' : value);
  }
  return `${pathPattern}?${normalizedParams.toString()}`;
}

/**
 * Keterangan: Membedakan anchor sesama-halaman ("#", "#section") dari rute
 * client-side berbasis hash ("#/dashboard", "#!/page") — yang pertama harus
 * diabaikan (bukan navigasi baru), yang kedua tetap dianggap kandidat menu
 * karena banyak SPA lama memakai hash router.
 */
function isSameAppHashAnchor(href: string): boolean {
  return href.startsWith('#') && !href.slice(1).replace(/^!/, '').startsWith('/');
}

/**
 * Keterangan: Mengambil kandidat link menu navigasi (navbar atas, sidebar
 * kiri/kanan, ATAU hasil hash-router SPA) dari snapshot untuk dijelajahi
 * lebih lanjut. Link dianggap menu navigasi bila posisinya dekat atas
 * halaman (navbar), berada di dalam landmark nav/aside/sidebar, atau berada
 * di kolom sempit sisi kiri/kanan (fallback untuk sidebar tanpa markup
 * semantik). Mengabaikan link kosong/anchor sesama halaman/javascript,
 * logout, aksi destruktif (hapus/delete), beda origin, URL yang sama dengan
 * halaman saat ini, atau link dengan pola href sama (id berbeda) yang sudah
 * terwakili — supaya link aksi per-baris data tidak menghabiskan kuota
 * crawl dan menutupi menu asli.
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

  const isNavPositioned = (element: PageElementSnapshot): boolean =>
    element.y <= NAV_LINK_Y_THRESHOLD ||
    element.inNavLandmark ||
    element.x <= NAV_LINK_SIDEBAR_X_THRESHOLD ||
    element.x >= NAV_LINK_SIDEBAR_RIGHT_X_THRESHOLD;

  const seenPatterns = new Set<string>();
  const result: NavLinkCandidate[] = [];
  for (const element of snapshot.elements) {
    if (element.tag !== 'a' || !element.href || !isNavPositioned(element)) {
      continue;
    }
    const href = element.href.trim();
    if (!href || isSameAppHashAnchor(href) || /^(javascript|mailto|tel):/i.test(href)) {
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
    const pattern = normalizeHrefPattern(absolute);
    if (
      absolute.origin !== currentOrigin ||
      DESTRUCTIVE_OR_LOGOUT_PATTERN.test(absolute.pathname) ||
      absoluteHref === snapshot.url ||
      seenPatterns.has(pattern)
    ) {
      continue;
    }
    seenPatterns.add(pattern);
    result.push({ text, href: absoluteHref, selector: element.selector });
    if (result.length >= maxLinks) {
      break;
    }
  }
  return result;
}

/**
 * Keterangan: Menilai apakah elemen interaktif termasuk chrome navigasi
 * (navbar/header/sidebar/dropdown toggle) — bukan aksi fitur halaman.
 */
function isChromeInteractionElement(element: PageElementSnapshot, label: string): boolean {
  const normalized = label.trim();
  const isPageAction =
    MODAL_TRIGGER_PATTERN.test(normalized) || PAGE_ACTION_PATTERN.test(normalized);

  if (element.inNavLandmark && !isPageAction) {
    return true;
  }

  const cls = element.classAttr || '';
  if (CHROME_CLASS_PATTERN.test(cls) && !isPageAction) {
    return true;
  }
  if (/dropdown-toggle|data-bs-toggle|data-toggle/.test(cls)) {
    return true;
  }

  const href = (element.href || '').trim();
  if (
    element.tag === 'a' &&
    href &&
    (/^#/.test(href) || /^javascript:/i.test(href)) &&
    !isPageAction
  ) {
    return true;
  }

  const inChromeZone =
    element.y <= NAV_LINK_Y_THRESHOLD ||
    element.x <= NAV_LINK_SIDEBAR_X_THRESHOLD ||
    element.x >= NAV_LINK_SIDEBAR_RIGHT_X_THRESHOLD;
  if (inChromeZone && !isPageAction) {
    return true;
  }

  return false;
}

function scoreInteractionCandidate(element: PageElementSnapshot, label: string): number {
  if (isChromeInteractionElement(element, label)) {
    return -1;
  }
  let score = 1;
  if (MODAL_TRIGGER_PATTERN.test(label)) {
    score += 10;
  }
  if (PAGE_ACTION_PATTERN.test(label)) {
    score += 5;
  }
  if (element.tag === 'button') {
    score += 1;
  }
  if (
    element.y > NAV_LINK_Y_THRESHOLD + 16 &&
    element.x > NAV_LINK_SIDEBAR_X_THRESHOLD &&
    element.x < NAV_LINK_SIDEBAR_RIGHT_X_THRESHOLD
  ) {
    score += 3;
  }
  return score;
}

/**
 * Keterangan: Menghitung SEMUA kandidat tombol/aksi interaktif yang lolos
 * filter (bukan cuma top-N) beserta skornya — dipisah dari
 * `collectInteractionCandidates` supaya jumlah kandidat yang TERLEWAT karena
 * kuota `maxActions` bisa diketahui pemanggil (Prioritas 5, laporan
 * cakupan), tanpa mengubah signature/perilaku fungsi publik yang sudah ada.
 */
function scoreAllInteractionCandidates(
  snapshot: PageExplorationResult,
): Array<{ candidate: InteractionCandidate; score: number }> {
  const seen = new Set<string>();
  const scored: Array<{ candidate: InteractionCandidate; score: number }> = [];

  const shouldSkipLabel = (label: string): boolean => {
    const normalized = label.trim();
    if (!normalized) {
      return true;
    }
    if (DESTRUCTIVE_OR_LOGOUT_PATTERN.test(normalized)) {
      return true;
    }
    if (SKIP_INTERACTION_PATTERN.test(normalized)) {
      return true;
    }
    if (HAMBURGER_TOGGLE_PATTERN.test(normalized)) {
      return true;
    }
    if (/dropdown|toggle/i.test(normalized)) {
      return true;
    }
    return false;
  };

  const consider = (element: PageElementSnapshot, label: string): void => {
    if (shouldSkipLabel(label) || seen.has(element.selector)) {
      return;
    }
    const score = scoreInteractionCandidate(element, label);
    if (score < 0) {
      return;
    }
    seen.add(element.selector);
    scored.push({
      score,
      candidate: { label: label || element.selector, selector: element.selector, tag: element.tag },
    });
  };

  for (const element of snapshot.elements) {
    if (element.tag !== 'button' && element.role !== 'button') {
      continue;
    }
    if (element.type === 'submit') {
      continue;
    }
    const label = (element.text || element.label || element.value || element.placeholder || '').trim();
    consider(element, label);
  }

  for (const element of snapshot.elements) {
    if (element.tag !== 'a') {
      continue;
    }
    const href = (element.href || '').trim();
    const label = (element.text || element.label || '').trim();
    if (shouldSkipLabel(label)) {
      continue;
    }
    const isNavHref =
      href &&
      !isSameAppHashAnchor(href) &&
      !/^#/.test(href) &&
      !/^(javascript):/i.test(href);
    if (isNavHref && !MODAL_TRIGGER_PATTERN.test(label) && !PAGE_ACTION_PATTERN.test(label)) {
      continue;
    }
    if (
      !MODAL_TRIGGER_PATTERN.test(label) &&
      !PAGE_ACTION_PATTERN.test(label) &&
      !/modal|dialog|popup/i.test(element.classAttr || '')
    ) {
      continue;
    }
    consider(element, label);
  }

  scored.sort((left, right) => right.score - left.score);
  return scored;
}

/**
 * Keterangan: Mengumpulkan kandidat tombol/aksi interaktif pada halaman untuk
 * eksplorasi observasi (modal, form tambah, filter) — bukan link navigasi.
 */
export function collectInteractionCandidates(
  snapshot: PageExplorationResult,
  maxActions: number,
): InteractionCandidate[] {
  return scoreAllInteractionCandidates(snapshot)
    .slice(0, maxActions)
    .map((item) => item.candidate);
}

/**
 * Keterangan: Jumlah TOTAL kandidat interaksi yang lolos filter di halaman
 * ini (sebelum dipotong `maxActions`) — dipakai untuk melaporkan berapa
 * kandidat terlewat karena kuota `MAX_INTERACTIONS_PER_PAGE` (Prioritas 5).
 */
export function countInteractionCandidates(snapshot: PageExplorationResult): number {
  return scoreAllInteractionCandidates(snapshot).length;
}

/**
 * Keterangan: Mendeteksi munculnya form/modal baru setelah klik (input/dialog
 * tambahan dibanding snapshot sebelum klik).
 */
export function snapshotShowsFormOverlay(
  before: PageExplorationResult,
  after: PageExplorationResult,
): boolean {
  const countInputs = (snapshot: PageExplorationResult): number =>
    snapshot.elements.filter((element) => element.tag === 'input' || element.tag === 'textarea').length;
  const beforeInputs = countInputs(before);
  const afterInputs = countInputs(after);
  if (afterInputs >= beforeInputs + 2) {
    return true;
  }
  const modalHeading = after.headings.some((heading) =>
    /form|tambah|add|edit|ubah|filter|cari|input|data/i.test(heading),
  );
  if (modalHeading && afterInputs > beforeInputs) {
    return true;
  }
  const newButtons = after.elements.filter(
    (element) =>
      element.tag === 'button' &&
      !before.elements.some((prev) => prev.selector === element.selector),
  );
  return newButtons.length >= 2 && afterInputs > 0;
}

/**
 * Keterangan: Menutup modal/dialog terbuka tanpa submit — Batal/Tutup/Escape,
 * bukan konfirmasi OK/Ya (observasi generate saja). Tombol Batal/Tutup dicari
 * via evaluate (regex teks), ditandai atribut marker sementara, lalu diklik
 * lewat driver.click() (klik "asli" via MCP/Playwright, bukan DOM click()
 * sintetis) supaya event handler framework (React/Vue dkk.) tetap terpicu
 * normal.
 */
export async function dismissOpenModal(driver: ExplorationDriver): Promise<void> {
  const foundCancel = await driver
    .evaluate<boolean>(`() => {
      const pattern = new RegExp(${JSON.stringify(MODAL_CANCEL_TEXT_PATTERN_SOURCE)}, 'i');
      const candidates = document.querySelectorAll('button, a, [role="button"]');
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        if (rect.width <= 0 || rect.height <= 0) continue;
        const text = (el.innerText || el.textContent || '').trim();
        if (pattern.test(text)) {
          el.setAttribute(${JSON.stringify(MODAL_DISMISS_MARKER_ATTR)}, 'true');
          return true;
        }
      }
      return false;
    }`)
    .catch(() => false);

  if (foundCancel) {
    await driver.click(`[${MODAL_DISMISS_MARKER_ATTR}]`).catch(() => undefined);
    await driver
      .evaluate(
        `() => { const el = document.querySelector('[${MODAL_DISMISS_MARKER_ATTR}]'); if (el) el.removeAttribute(${JSON.stringify(MODAL_DISMISS_MARKER_ATTR)}); return null; }`,
      )
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));
  } else {
    await driver
      .click('[data-bs-dismiss="modal"], .btn-close, .modal-header button, [aria-label="Close"]')
      .catch(() => undefined);
  }
  await driver.pressKey('Escape').catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await dismissBlockingOverlay(driver);
}

/**
 * Keterangan: Membuka dropdown menu navigasi (Bootstrap/dll.) supaya link
 * tersembunyi di `.dropdown-menu` ikut terdeteksi saat crawl Fase A. Semua
 * toggle visible ditandai indeks sementara dalam satu evaluate, lalu diklik
 * satu-satu lewat driver.click() (bukan native DOM click, supaya event
 * handler dropdown library seperti Bootstrap benar-benar terpicu).
 */
export async function expandDropdownMenusForCrawl(driver: ExplorationDriver): Promise<void> {
  await dismissBlockingOverlay(driver);
  const count = await driver
    .evaluate<number>(`() => {
      const toggles = document.querySelectorAll(${JSON.stringify(DROPDOWN_TOGGLE_SELECTOR)});
      let idx = 0;
      for (const el of toggles) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        if (rect.width <= 0 || rect.height <= 0) continue;
        el.setAttribute(${JSON.stringify(DROPDOWN_MARKER_ATTR)}, String(idx));
        idx += 1;
      }
      return idx;
    }`)
    .catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    try {
      await driver.click(`[${DROPDOWN_MARKER_ATTR}="${index}"]`);
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch {
      // Dropdown individual gagal — lanjut toggle berikutnya.
    }
  }

  await driver
    .evaluate(
      `() => { document.querySelectorAll('[${DROPDOWN_MARKER_ATTR}]').forEach((el) => el.removeAttribute(${JSON.stringify(DROPDOWN_MARKER_ATTR)})); return null; }`,
    )
    .catch(() => undefined);
}

/**
 * Keterangan: Mengekstrak kandidat link menu dari DOM (termasuk isi
 * dropdown-menu) tanpa bergantung sepenuhnya pada elemen visible snapshot —
 * satu evaluate mengambil seluruh anchor sekaligus, filter/dedup/selector
 * tetap logika Node biasa (driver-agnostic).
 */
export async function extractNavLinksFromDom(
  driver: ExplorationDriver,
  snapshot: PageExplorationResult,
  maxLinks: number,
): Promise<NavLinkCandidate[]> {
  let currentOrigin = '';
  try {
    currentOrigin = new URL(snapshot.url).origin;
  } catch {
    return [];
  }

  const navSelector = `${NAV_LANDMARK_SELECTOR}, .dropdown-menu, .navbar, .topbar, header`;
  const rawAnchors = await driver
    .evaluate<
      Array<{
        href: string | null;
        text: string;
        id: string | null;
        testId: string | null;
        nameAttr: string | null;
        label: string | null;
      }>
    >(`() => {
      const anchors = document.querySelectorAll(${JSON.stringify(`${navSelector} a[href]`)});
      return Array.from(anchors).map((a) => ({
        href: a.getAttribute('href'),
        text: (a.innerText || '').trim().slice(0, 80),
        id: a.getAttribute('id'),
        testId: a.getAttribute('data-testid'),
        nameAttr: a.getAttribute('name'),
        label: a.getAttribute('aria-label'),
      }));
    }`)
    .catch(() => []);

  const seen = new Set<string>();
  const results: NavLinkCandidate[] = [];

  for (const anchor of rawAnchors) {
    if (results.length >= maxLinks) {
      break;
    }
    const hrefAttr = (anchor.href ?? '').trim();
    if (!hrefAttr || hrefAttr.startsWith('#') || /^(javascript|mailto|tel):/i.test(hrefAttr)) {
      continue;
    }
    const text = anchor.text.trim();
    if (!text || DESTRUCTIVE_OR_LOGOUT_PATTERN.test(text)) {
      continue;
    }
    let absoluteHref = '';
    try {
      absoluteHref = new URL(hrefAttr, snapshot.url).toString();
    } catch {
      continue;
    }
    if (
      !absoluteHref.startsWith(currentOrigin) ||
      DESTRUCTIVE_OR_LOGOUT_PATTERN.test(new URL(absoluteHref).pathname)
    ) {
      continue;
    }
    if (absoluteHref === snapshot.url || seen.has(absoluteHref)) {
      continue;
    }
    seen.add(absoluteHref);
    results.push({
      text,
      href: absoluteHref,
      selector: preferSelector({
        id: anchor.id,
        testId: anchor.testId,
        nameAttr: anchor.nameAttr,
        label: anchor.label,
        placeholder: null,
        text,
        value: null,
        type: null,
        tag: 'a',
      }),
    });
  }

  return results;
}

/**
 * Keterangan: Mengumpulkan kandidat link menu untuk crawl rekursif — buka
 * dropdown dulu, gabungkan snapshot + ekstraksi DOM, dedup per pola href.
 */
export async function collectNavLinkCandidates(
  driver: ExplorationDriver,
  snapshot: PageExplorationResult,
  maxLinks: number,
): Promise<NavLinkCandidate[]> {
  await expandDropdownMenusForCrawl(driver);
  const expandedSnapshot = await collectPageSnapshot(driver);
  const merged = new Map<string, NavLinkCandidate>();
  const addCandidate = (candidate: NavLinkCandidate): void => {
    try {
      const pattern = normalizeHrefPattern(new URL(candidate.href));
      if (merged.has(pattern)) {
        return;
      }
      merged.set(pattern, candidate);
    } catch {
      // href invalid diabaikan
    }
  };

  for (const candidate of extractTopNavLinks(expandedSnapshot, maxLinks)) {
    addCandidate(candidate);
  }
  for (const candidate of await extractNavLinksFromDom(driver, snapshot, maxLinks)) {
    addCandidate(candidate);
  }

  await driver.pressKey('Escape').catch(() => undefined);
  return [...merged.values()].slice(0, maxLinks);
}

/**
 * Keterangan: Navigasi ke kandidat menu — goto(href) diprioritaskan untuk
 * URL nyata (app PHP/legacy), fallback klik selector bila perlu. Catatan:
 * `driver.waitForIdle` adalah approksimasi networkidle (lihat
 * exploration-driver.ts) — untuk backend MCP dipoll via document.readyState,
 * bukan tracking network request asli seperti Playwright.
 */
export async function navigateToNavLink(
  driver: ExplorationDriver,
  candidate: NavLinkCandidate,
): Promise<void> {
  const urlBefore = await driver.currentUrl();
  let absolute: URL | null = null;
  try {
    absolute = new URL(candidate.href);
  } catch {
    absolute = null;
  }
  const canGotoDirect =
    absolute &&
    (absolute.protocol === 'http:' || absolute.protocol === 'https:') &&
    !isSameAppHashAnchor(candidate.href) &&
    candidate.href !== urlBefore;

  if (canGotoDirect) {
    try {
      await driver.goto(candidate.href, { timeoutMs: CRAWL_NAV_TIMEOUT_MS });
      if ((await driver.currentUrl()) !== urlBefore) {
        return;
      }
    } catch {
      // Lanjut coba klik selector.
    }
  }

  await dismissBlockingOverlay(driver);
  try {
    await driver.click(candidate.selector);
    await driver.waitForIdle(CRAWL_NAV_TIMEOUT_MS);
    if ((await driver.currentUrl()) !== urlBefore) {
      return;
    }
  } catch {
    // Selector tidak ketemu/tidak bisa diklik — coba goto(href) di bawah.
  }
  if (canGotoDirect) {
    await driver.goto(candidate.href, { timeoutMs: CRAWL_NAV_TIMEOUT_MS });
  }
}

/**
 * Keterangan: Mencari tombol pembuka menu (hamburger/drawer) yang biasa
 * menyembunyikan nav sampai diklik — dipakai sebagai fallback ketika tidak
 * ada kandidat menu ditemukan sama sekali dari snapshot awal (nav mungkin
 * belum terbuka). Fungsi pure di atas data snapshot — tidak menyentuh
 * browser sama sekali, tidak perlu driver.
 */
function findHamburgerToggle(
  snapshot: PageExplorationResult,
): PageElementSnapshot | null {
  return (
    snapshot.elements.find((element) => {
      if (element.tag !== 'button' && element.role !== 'button') {
        return false;
      }
      const haystack = [element.id, element.testId, element.classAttr, element.label, element.text]
        .filter(Boolean)
        .join(' ');
      return HAMBURGER_TOGGLE_PATTERN.test(haystack);
    }) ?? null
  );
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
 * Keterangan: Mengklik tombol toggle (kalau ada) untuk membuka menu yang
 * disembunyikan (drawer/hamburger). Kegagalan klik diabaikan — pemanggil
 * tetap punya fallback goto(href) langsung yang tidak butuh menu terbuka.
 */
async function ensureNavVisible(driver: ExplorationDriver, toggleSelector: string): Promise<void> {
  await dismissBlockingOverlay(driver);
  try {
    await driver.click(toggleSelector);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await dismissBlockingOverlay(driver);
  } catch {
    // Diabaikan — kandidat link tetap dicoba lewat goto(href) langsung.
  }
}

/**
 * Keterangan: Menavigasi ke kandidat menu dengan MENGKLIK elemen aslinya
 * dulu (supaya navigasi berbasis JavaScript/SPA yang mencegat klik tetap
 * berjalan seperti pengguna asli), baru fallback ke goto(href) langsung
 * kalau klik gagal atau tidak benar-benar berpindah URL.
 */
async function navigateToCandidate(driver: ExplorationDriver, candidate: NavLinkCandidate): Promise<void> {
  await navigateToNavLink(driver, candidate);
}

/**
 * Keterangan: Menjelajahi kandidat link menu navigasi utama (maksimal
 * maxPages) dari halaman yang sedang terbuka, mengambil snapshot DETAIL penuh
 * (heading + elemen dengan selector, sama seperti halaman utama) tiap
 * halaman, lalu mengembalikan browser ke URL semula. Detail penuh (bukan
 * cuma ringkasan) dipakai supaya AI bisa menyusun test case aksi (fill/click)
 * yang benar-benar lintas halaman/fitur, bukan cuma navigasi/verifikasi.
 * Kalau tidak ada kandidat menu terlihat sama sekali, dicoba dulu klik
 * tombol hamburger/drawer (kalau ada) untuk membuka menu yang tersembunyi
 * sebelum menyerah. Halaman yang gagal dibuka dilewati saja agar generate
 * tidak gagal total karena satu menu bermasalah.
 */
export async function crawlAdditionalPages(
  driver: ExplorationDriver,
  fromSnapshot: PageExplorationResult,
  maxPages: number,
  onPageStart?: (label: string) => void,
): Promise<PageExplorationResult[]> {
  let candidates = extractTopNavLinks(fromSnapshot, maxPages);
  let toggleSelector: string | null = null;
  let navOpenedForDetection = false;

  if (candidates.length === 0) {
    const toggle = findHamburgerToggle(fromSnapshot);
    if (toggle) {
      toggleSelector = toggle.selector;
      await ensureNavVisible(driver, toggleSelector);
      navOpenedForDetection = true;
      const revealedSnapshot = await collectPageSnapshot(driver);
      candidates = extractTopNavLinks(revealedSnapshot, maxPages);
    }
  }
  if (candidates.length === 0) {
    return [];
  }

  const originalUrl = await driver.currentUrl();
  const results: PageExplorationResult[] = [];
  for (const candidate of candidates) {
    onPageStart?.(candidate.text);
    try {
      if ((await driver.currentUrl()) !== originalUrl) {
        await driver.goto(originalUrl, { timeoutMs: CRAWL_NAV_TIMEOUT_MS });
        navOpenedForDetection = false;
      }
      if (toggleSelector && !navOpenedForDetection) {
        await ensureNavVisible(driver, toggleSelector);
      }
      navOpenedForDetection = false;
      await navigateToCandidate(driver, candidate);
      await driver.waitForIdle(4_000);
      await dismissBlockingOverlay(driver);
      results.push(await collectPageSnapshot(driver));
    } catch {
      continue;
    }
  }

  await driver.goto(originalUrl, { timeoutMs: CRAWL_NAV_TIMEOUT_MS }).catch(() => undefined);
  return results;
}

/**
 * Keterangan: Menyusun detail beberapa halaman tambahan hasil crawl (heading
 * + elemen dengan selector lengkap, format sama seperti halaman utama)
 * menjadi teks prompt, supaya AI dapat menyusun test case aksi (fill/click)
 * yang saling terhubung lintas halaman/fitur (misal: ubah data di satu
 * halaman, lalu verifikasi hasilnya di halaman lain yang terkait).
 */
export function formatAdditionalPagesForPrompt(pages: PageExplorationResult[]): string {
  if (pages.length === 0) {
    return '';
  }
  const sections = pages.map(
    (page, index) => `Halaman tambahan ${index + 1}:\n${formatExplorationForPrompt(page)}`,
  );
  return [
    'Detail halaman/menu lain pada aplikasi (heading + elemen dengan selector lengkap, boleh dipakai untuk fill/click/verifikasi, termasuk skenario lintas halaman):',
    ...sections,
  ].join('\n\n');
}
