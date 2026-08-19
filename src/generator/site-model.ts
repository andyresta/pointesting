import { createHash } from 'node:crypto';
import type { TestCaseStep } from '../api/schemas/testcase.schema';
import type { CreateTestCaseBody } from '../api/schemas/testcase.schema';
import type { PageElementSnapshot, PageExplorationResult } from './page-explorer';

/** Jenis halaman hasil heuristik — dipakai untuk batching authoring LLM. */
export type PageKind = 'auth' | 'list_crud' | 'form' | 'generic';

/** Satu field isian yang harus diisi user untuk melewati zona auth. */
export interface AuthFieldDefinition {
  key: string;
  label: string;
  selector: string;
  action: 'fill' | 'check' | 'select';
  secret?: boolean;
  inputType?: string;
}

/** Zona autentikasi (form gate) dengan field dinamis dari assessment halaman. */
export interface AuthZone {
  zoneId: string;
  loginUrl: string;
  fields: AuthFieldDefinition[];
  submit: { selector: string; label?: string };
  values?: Record<string, string>;
  status: 'pending' | 'authenticated' | 'skipped';
}

/** Satu halaman dalam peta situs hasil crawl. */
export interface SitePage {
  snapshot: PageExplorationResult;
  kind: PageKind;
  /** true jika halaman berada di balik auth zone yang di-skip user. */
  gated: boolean;
  authZoneId?: string;
  /** Konteks interaksi (mis. modal "Tambah Pelanggan") bila bukan navigasi URL baru. */
  interactionContext?: string;
  /**
   * Keterangan: URL halaman TEMPAT interaksi ini dipicu (mis. modal "Tambah
   * Pelanggan" dipicu dari halaman list `/pelanggan`) — dipakai
   * `groupPagesForAuthoring` untuk menggabungkan halaman list_crud dengan
   * form turunannya sendiri dalam satu batch (CRUD round-trip, Prioritas 4).
   * Kosong untuk halaman hasil navigasi URL biasa (bukan interaksi).
   */
  interactionParentUrl?: string;
}

/** Peta situs lengkap untuk fase authoring. */
export interface SiteModel {
  pages: SitePage[];
  authZones: AuthZone[];
}

const AUTH_UNVERIFIED_TITLE_PREFIX = '[Auth - Unverified] ';

/**
 * Keterangan: Heuristik cepat — apakah snapshot kemungkinan auth wall
 * (form login/gate) sebelum memanggil LLM assessment.
 */
export function looksLikeAuthWall(snapshot: PageExplorationResult): boolean {
  const hasPassword = snapshot.elements.some(
    (element) =>
      element.tag === 'input' &&
      (element.type === 'password' ||
        /password|pass|pin|otp/i.test(
          [element.nameAttr, element.id, element.placeholder, element.label]
            .filter(Boolean)
            .join(' '),
        )),
  );
  const hasSubmit =
    snapshot.elements.some(
      (element) =>
        (element.tag === 'button' || element.type === 'submit') &&
        /login|masuk|sign\s*in|submit|verifikasi|verify/i.test(
          (element.text || element.value || element.label || '').trim(),
        ),
    ) || snapshot.elements.some((element) => element.type === 'submit');
  const loginHeading = snapshot.headings.some((heading) =>
    /login|masuk|sign\s*in|autentikasi|auth/i.test(heading),
  );
  return hasPassword && (hasSubmit || loginHeading);
}

/**
 * Keterangan: Mengklasifikasikan jenis halaman dari elemen snapshot
 * (tanpa LLM) untuk pengelompokan batch authoring.
 */
export function classifyPageKind(snapshot: PageExplorationResult): PageKind {
  if (looksLikeAuthWall(snapshot)) {
    return 'auth';
  }

  const buttons = snapshot.elements.filter((element) => element.tag === 'button');
  const inputs = snapshot.elements.filter((element) => element.tag === 'input');
  const hasPasswordInput = inputs.some((element) => element.type === 'password');
  const addPattern = /tambah|add|create|baru|new/i;
  const hasAddAction = buttons.some((element) =>
    addPattern.test((element.text || element.label || '').trim()),
  );
  const tableLike = snapshot.elements.some((element) =>
    /table|grid|datatable|list/i.test(element.classAttr || ''),
  );
  const manyInputs = inputs.length >= 3;

  if (hasAddAction && (tableLike || buttons.length >= 1)) {
    return 'list_crud';
  }
  if (manyInputs && !hasPasswordInput) {
    return 'form';
  }
  return 'generic';
}

/**
 * Keterangan: Menyusun ringkasan 1 baris per halaman (ToC) untuk selalu
 * disertakan ke setiap panggilan authoring LLM — murah token, global context.
 */
export function buildSiteMapToc(model: SiteModel): string {
  if (model.pages.length === 0) {
    return '(belum ada halaman terpetakan)';
  }
  return model.pages
    .map((page, index) => {
      const topActions = page.snapshot.elements
        .filter((element) => element.tag === 'button' || element.tag === 'a')
        .slice(0, 3)
        .map((element) => (element.text || element.label || element.selector).trim())
        .filter(Boolean)
        .join(', ');
      const gatedLabel = page.gated ? ' [GATED — tidak terjangkau]' : '';
      const contextLabel = page.interactionContext ? ` [${page.interactionContext}]` : '';
      return `${index + 1}. "${page.snapshot.title}" (${page.kind}) — ${page.snapshot.url}${contextLabel}${gatedLabel}${topActions ? ` — aksi: ${topActions}` : ''}`;
    })
    .join('\n');
}

/**
 * Keterangan: Menghasilkan zoneId stabil dari URL login + selector field.
 */
export function buildAuthZoneId(
  loginUrl: string,
  fields: AuthFieldDefinition[],
  submitSelector: string,
): string {
  const normalized = normalizeUrlForZone(loginUrl);
  const fingerprint = [
    normalized,
    ...fields.map((field) => field.selector).sort(),
    submitSelector,
  ].join('|');
  return createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
}

/**
 * Keterangan: Menormalkan URL untuk dedup crawl/fingerprint zona — termasuk
 * query string (urut) karena banyak app PHP/legacy memakai satu pathname
 * (mis. index.php?page=dashboard vs index.php?page=customers).
 */
export function normalizeUrlForZone(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const params = new URLSearchParams(parsed.search);
    const keys = [...params.keys()].sort();
    const normalizedParams = new URLSearchParams();
    for (const key of keys) {
      normalizedParams.set(key, params.get(key) ?? '');
    }
    const search = normalizedParams.toString();
    return search
      ? `${parsed.origin}${parsed.pathname}?${search}`
      : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Keterangan: Memeriksa apakah semua field wajib zona sudah punya nilai.
 */
export function isAuthZoneComplete(zone: AuthZone): boolean {
  if (zone.status === 'skipped') {
    return false;
  }
  if (!zone.values) {
    return false;
  }
  return zone.fields.every((field) => {
    const value = zone.values?.[field.key];
    return typeof value === 'string' && value.length > 0;
  });
}

/**
 * Keterangan: Menerapkan prefill values ke zona — hanya key yang cocok dengan
 * field definition zona (key dinamis, bukan hardcoded username/password).
 */
export function applyPrefillToZone(
  zone: AuthZone,
  prefill: Record<string, string> | undefined,
): AuthZone {
  if (!prefill || Object.keys(prefill).length === 0) {
    return zone;
  }
  const values: Record<string, string> = { ...(zone.values ?? {}) };
  for (const field of zone.fields) {
    const direct = prefill[field.key];
    if (direct) {
      values[field.key] = direct;
    }
  }
  return { ...zone, values };
}

/**
 * Keterangan: Menyusun langkah Playwright generik untuk melewati satu AuthZone
 * (goto + fill/check/select per field + click submit). Parameter skipGoto
 * dipakai bila browser sudah berada di halaman login.
 */
export function buildAuthStepsFromZone(
  zone: AuthZone,
  options?: { skipGoto?: boolean },
): TestCaseStep[] {
  const steps: TestCaseStep[] = [];
  if (!options?.skipGoto) {
    steps.push({ action: 'goto', url: zone.loginUrl });
  }
  for (const field of zone.fields) {
    const value = zone.values?.[field.key];
    if (!value) {
      throw new Error(`Field auth "${field.key}" belum diisi untuk zona ${zone.zoneId}`);
    }
    if (field.action === 'fill') {
      steps.push({ action: 'fill', selector: field.selector, value });
    } else if (field.action === 'check') {
      steps.push({ action: 'check', selector: field.selector });
    } else if (field.action === 'select') {
      steps.push({ action: 'select', selector: field.selector, value });
    }
  }
  steps.push({ action: 'click', selector: zone.submit.selector });
  return steps;
}

/**
 * Keterangan: Fallback heuristik bila LLM auth assessment gagal — deteksi
 * input password + submit + field teks/email/username dari snapshot.
 */
export function buildAuthZoneFromHeuristic(snapshot: PageExplorationResult): AuthZone | null {
  if (!looksLikeAuthWall(snapshot)) {
    return null;
  }

  const passwordField = snapshot.elements.find(
    (element) => element.tag === 'input' && element.type === 'password',
  );
  const textFields = snapshot.elements.filter(
    (element) =>
      element.tag === 'input' &&
      element.type !== 'password' &&
      element.type !== 'hidden' &&
      element.type !== 'submit',
  );
  const submitElement =
    snapshot.elements.find(
      (element) =>
        (element.tag === 'button' || element.type === 'submit') &&
        /login|masuk|sign|submit|kirim|verifikasi|verify/i.test(
          (element.text || element.value || element.label || '').trim(),
        ),
    ) ??
    snapshot.elements.find((element) => element.type === 'submit') ??
    snapshot.elements.find((element) => element.tag === 'button');

  if (!passwordField || !submitElement) {
    return null;
  }

  const primaryField = textFields[0];
  const fields: AuthFieldDefinition[] = [];

  if (primaryField) {
    fields.push({
      key: inferFieldKey(primaryField, 'username'),
      label: primaryField.label || primaryField.placeholder || 'Username',
      selector: primaryField.selector,
      action: 'fill',
      inputType: primaryField.type || 'text',
    });
  }

  fields.push({
    key: 'password',
    label: passwordField.label || passwordField.placeholder || 'Password',
    selector: passwordField.selector,
    action: 'fill',
    secret: true,
    inputType: 'password',
  });

  const submit = { selector: submitElement.selector, label: submitElement.text || undefined };
  const zoneId = buildAuthZoneId(snapshot.url, fields, submit.selector);

  return {
    zoneId,
    loginUrl: snapshot.url,
    fields,
    submit,
    status: 'pending',
  };
}

/**
 * Keterangan: Menyusun key field stabil dari atribut elemen snapshot.
 */
function inferFieldKey(element: PageElementSnapshot, fallback: string): string {
  if (element.nameAttr) {
    return element.nameAttr.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  }
  if (element.id) {
    return element.id.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  }
  if (element.type === 'email') {
    return 'email';
  }
  return fallback;
}

/**
 * Keterangan: Memvalidasi selector field auth ada di snapshot halaman.
 */
export function validateAuthZoneAgainstSnapshot(
  zone: AuthZone,
  snapshot: PageExplorationResult,
): AuthZone | null {
  const selectors = new Set(snapshot.elements.map((element) => element.selector));
  if (!selectors.has(zone.submit.selector)) {
    return null;
  }
  for (const field of zone.fields) {
    if (!selectors.has(field.selector)) {
      return null;
    }
  }
  const keys = new Set<string>();
  for (const field of zone.fields) {
    if (keys.has(field.key)) {
      return null;
    }
    keys.add(field.key);
  }
  if (zone.fields.length === 0) {
    return null;
  }
  return zone;
}

/** Maksimum form/modal turunan yang digabung ke halaman list_crud induknya per batch (CRUD round-trip). */
const MAX_CRUD_CHILDREN_PER_BATCH = 2;

/**
 * Keterangan: Mengelompokkan halaman SiteModel untuk batch authoring.
 * Halaman list_crud/form selalu jadi ANCHOR satu batch tersendiri agar LLM
 * fokus menghasilkan banyak test case mendalam di dalam halaman tersebut —
 * TAPI kalau list_crud itu punya form/modal turunan sendiri (mis. "Tambah
 * Pelanggan" dipicu dari halaman list "Pelanggan"), form itu IKUT
 * digabung ke batch yang sama (bukan batch terpisah seperti sebelumnya).
 * Ini WAJIB supaya LLM bisa menulis test case CRUD round-trip (create →
 * verifikasi muncul di list → edit/hapus → verifikasi berubah/hilang) yang
 * butuh selector dari KEDUA halaman sekaligus — kalau dipisah batch, LLM
 * penulis test case list tidak pernah melihat selector field form, dan
 * sebaliknya (Prioritas 4, audit QA generate).
 * Halaman interaksi yang induknya BUKAN list_crud (atau induknya gated/tidak
 * ditemukan) tetap jadi batch sendiri seperti perilaku lama.
 */
export function groupPagesForAuthoring(
  model: SiteModel,
  batchSize: number,
): SitePage[][] {
  const eligible = model.pages.filter((page) => !page.gated && page.kind !== 'auth');
  const batches: SitePage[][] = [];
  let genericBuffer: SitePage[] = [];

  const flushGenericBuffer = (): void => {
    if (genericBuffer.length === 0) {
      return;
    }
    batches.push([...genericBuffer]);
    genericBuffer = [];
  };

  const assignedChildren = new Set<SitePage>();
  const findCrudChildren = (listPage: SitePage): SitePage[] => {
    const parentKey = normalizeUrlForZone(listPage.snapshot.url);
    return eligible
      .filter(
        (page) =>
          !assignedChildren.has(page) &&
          page.interactionParentUrl &&
          normalizeUrlForZone(page.interactionParentUrl) === parentKey,
      )
      .slice(0, MAX_CRUD_CHILDREN_PER_BATCH);
  };

  for (const page of eligible) {
    if (assignedChildren.has(page)) {
      // Sudah ikut digabung sebagai anak batch list_crud induknya di atas.
      continue;
    }
    if (page.kind === 'list_crud') {
      flushGenericBuffer();
      const children = findCrudChildren(page);
      children.forEach((child) => assignedChildren.add(child));
      batches.push([page, ...children]);
      continue;
    }
    if (page.kind === 'form' || page.interactionContext) {
      flushGenericBuffer();
      batches.push([page]);
      continue;
    }
    genericBuffer.push(page);
    if (genericBuffer.length >= Math.max(1, batchSize)) {
      flushGenericBuffer();
    }
  }
  flushGenericBuffer();
  return batches;
}

/**
 * Keterangan: Menyusun satu test case login mandiri (bukan prefix di setiap
 * test case) — dipakai saat eksplorasi sudah melewati auth; test lain
 * diasumsikan dijalankan dengan sesi aktif atau setelah login terpisah.
 */
export function buildStandaloneLoginTestCase(zones: AuthZone[]): CreateTestCaseBody | null {
  const authenticated = zones.filter((zone) => zone.status === 'authenticated');
  if (authenticated.length === 0) {
    return null;
  }

  const steps: TestCaseStep[] = [];
  const expected: string[] = [];
  for (const zone of authenticated) {
    steps.push(...buildAuthStepsFromZone(zone));
    expected.push(`Berhasil melewati gate autentikasi di ${zone.loginUrl}`);
  }
  expected.push('Halaman setelah login (dashboard/menu utama) tampil tanpa auth wall');

  return {
    title: 'Login dengan kredensial valid',
    description:
      'Menguji proses login sekali; test case lain diasumsikan dijalankan dengan sesi yang sudah aktif.',
    steps,
    expected,
  };
}

/**
 * @deprecated Tidak lagi menambahkan prefix login ke setiap test case.
 * Pakai buildStandaloneLoginTestCase() untuk satu test login terpisah.
 */
export function applyAuthPrefixesToTestCase(
  item: CreateTestCaseBody,
  _zones: AuthZone[],
): CreateTestCaseBody {
  return item;
}

/**
 * Keterangan: Membuang test case dengan judul mirip (>80% overlap kata)
 * sebagai safety net setelah beberapa batch authoring.
 */
export function dedupeGeneratedTestCases(items: CreateTestCaseBody[]): CreateTestCaseBody[] {
  const result: CreateTestCaseBody[] = [];
  for (const item of items) {
    const normalized = normalizeTitle(item.title);
    const duplicate = result.some((existing) => titlesSimilar(normalized, normalizeTitle(existing.title)));
    if (!duplicate) {
      result.push(item);
    }
  }
  return result;
}

function normalizeTitle(title: string): string {
  return title
    .replace(/^\[Auth(?: - Unverified)?\]\s*/i, '')
    .trim()
    .toLowerCase();
}

function titlesSimilar(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) {
    return false;
  }
  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      overlap += 1;
    }
  }
  const ratio = overlap / Math.min(wordsA.size, wordsB.size);
  return ratio >= 0.8;
}

export { AUTH_UNVERIFIED_TITLE_PREFIX };
