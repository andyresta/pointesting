import { z } from 'zod';
import {
  createTestCaseBodySchema,
  testCaseStepSchema,
  type CreateTestCaseBody,
  type TestCaseStep,
} from '../api/schemas/testcase.schema';
import {
  formatExplorationForPrompt,
  type PageExplorationResult,
} from './page-explorer';
import type { AuthFieldDefinition, AuthZone, PageKind, SiteModel, SitePage } from './site-model';
import { buildAuthZoneId, buildSiteMapToc, normalizeUrlForZone } from './site-model';

/**
 * Keterangan: Schema hasil generate AI — sama dengan create test case,
 * tetapi description/keterangan wajib 1–2 kalimat.
 */
const generatedTestCaseSchema = createTestCaseBodySchema.extend({
  description: z.string().trim().min(1, 'Field "description" wajib diisi'),
});

const generatedListSchema = z.object({
  testCases: z.array(generatedTestCaseSchema).min(1),
});

const authFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  selector: z.string().min(1),
  action: z.enum(['fill', 'check', 'select']).optional(),
  secret: z.boolean().optional(),
  inputType: z.string().optional(),
});

const authAssessmentSchema = z.object({
  isAuthWall: z.boolean(),
  fields: z.array(authFieldSchema).optional(),
  submit: z
    .object({
      selector: z.string().min(1),
      label: z.string().optional(),
    })
    .optional(),
});

export interface AuthAssessmentResult {
  isAuthWall: boolean;
  zone: AuthZone | null;
}

export interface AuthoringPromptInput {
  prompt: string;
  extraData?: string;
  baseUrl?: string | null;
  siteModel: SiteModel;
  batchSitePages: SitePage[];
  existingTitles?: string[];
}

/**
 * Keterangan: Menyusun system prompt authoring test case (Map-then-Author).
 * LLM selalu melihat ToC global + detail batch halaman saat ini.
 */
export function buildAuthoringSystemPrompt(): string {
  return [
    'Anda menyusun test case automated web testing dari peta situs nyata yang sudah dieksplorasi browser.',
    'Balas JSON saja, tanpa markdown dan tanpa teks lain.',
    'Format: {"testCases":[{"title":"...","description":"...","steps":[...],"expected":["..."]}]}',
    'steps memakai action: goto, fill, click, check, select, waitFor, assertVisible, assertHidden, assertChecked, assertText, assertValue, assertCount, assertUrl.',
    'goto wajib field "url" (bukan "value"). fill/select wajib selector+value. click/check/waitFor wajib selector.',
    'assertVisible/assertHidden/assertChecked wajib selector saja (tanpa value). assertText/assertValue/assertCount wajib selector+value: assertText value=potongan teks yang harus muncul di elemen itu; assertValue value=isi persis input; assertCount value=jumlah elemen yang cocok selector itu, angka sebagai string. assertUrl wajib value saja (potongan URL yang harus ada di alamat halaman saat itu), TANPA selector.',
    'WAJIB: setiap klaim di "expected" harus dibuktikan oleh minimal satu step assertion (assertVisible/assertHidden/assertChecked/assertText/assertValue/assertCount/assertUrl) yang ditaruh di "steps" tepat setelah aksi yang memicunya. JANGAN hanya menulis klaim di "expected" tanpa step assertion nyata yang memverifikasinya — "expected" adalah ringkasan naratif dari assertion yang ada di "steps", bukan pengganti assertion.',
    'Assertion WAJIB memakai selector yang benar-benar ada di detail snapshot halaman batch ini, sama seperti step aksi lain — JANGAN mengarang selector elemen yang belum pernah terlihat di snapshot (misal notifikasi/toast dinamis yang baru muncul setelah submit). Kalau ingin memverifikasi hasil yang elemennya belum terlihat di snapshot (misal redirect setelah login/submit), gunakan assertUrl karena tidak butuh selector.',
    'Wajib memakai selector dari detail halaman batch ini. Jangan mengarang id/selector yang tidak ada di snapshot.',
    'Peta situs (ToC) menunjukkan SEMUA halaman aplikasi — gunakan untuk konteks navigasi antar halaman bila perlu.',
    'JANGAN buat test case untuk halaman bertanda GATED di ToC (tidak terjangkau saat eksplorasi).',
    'Prioritas UTAMA: uji mendalam DI DALAM setiap halaman detail batch — bukan hanya "buka menu X" atau goto ke URL.',
    'Setiap batch = SATU halaman spesifik (judul + URL ada di prompt), KECUALI batch ditandai eksplisit "GRUP CRUD ROUND-TRIP" — pada kasus itu batch sengaja berisi halaman list_crud + form/modal turunannya sendiri (lihat aturan round-trip di bawah). Buat test case yang majority steps-nya fill/click/waitFor di halaman batch tersebut.',
    'JANGAN menggabungkan banyak halaman/menu dalam satu test case panjang (mis. klik semua dropdown navigasi sekaligus) KECUALI untuk test case round-trip CRUD yang memang diwajibkan menghubungkan list_crud dengan form turunannya sendiri. Satu test case = satu skenario fokus.',
    'WAJIB CRUD ROUND-TRIP kalau batch ditandai "GRUP CRUD ROUND-TRIP": buat MINIMAL SATU test case yang menyambungkan create→verifikasi→ubah/hapus dalam SATU test case (bukan test case terpisah-pisah yang berdiri sendiri): (1) isi form tambah dengan nilai TEKS YANG KHAS/UNIK (mis. tempel kata acak atau angka di salah satu field teks supaya gampang dicari lagi di list — jangan pakai nilai generik seperti "Test" yang mungkin sudah ada), (2) submit form itu, (3) WAJIB assertText/assertVisible pada elemen tabel/list di halaman list_crud untuk MEMBUKTIKAN nilai unik itu benar-benar muncul — JANGAN cuma asumsikan submit sukses tanpa verifikasi ini, (4) kalau ada aksi edit/hapus yang selector-nya ADA di snapshot batch ini, lanjutkan: edit lalu assert list menampilkan nilai baru, ATAU hapus lalu assertHidden/assertCount untuk membuktikan item itu benar-benar hilang dari list. Assertion tetap WAJIB pakai selector yang benar-benar ada di snapshot batch ini (baik dari halaman list maupun form) — kalau tidak ada elemen tabel yang cocok untuk assertText di snapshot, gunakan assertCount pada selector baris/list sebagai alternatif (hitungan bertambah setelah create).',
    'Untuk halaman list_crud: buat beberapa test case yang menguji fitur nyata di halaman itu, misalnya tampilan daftar/data ter-load, tombol tambah/buat, filter/pencarian, aksi baris (detail/edit/hapus), pagination bila ada — selama selector ada di snapshot. Test case round-trip CRUD (di atas) DITAMBAHKAN ke test case lain ini, bukan pengganti.',
    'Untuk halaman form: uji isi field wajib + submit sukses, dan skenario validasi (field kosong/salah format) bila elemennya terlihat.',
    'WAJIB negative/boundary testing berbasis constraint yang tertulis di snapshot elemen (jangan cuma improvisasi bebas): field bertanda "required" → wajib ada test case submit dengan field itu dikosongkan, verifikasi form TIDAK lolos (assertion tetap di halaman sama / muncul pesan error, JANGAN assert redirect sukses). Field ber-"maxlength=N" → wajib ada test case mengisi nilai lebih dari N karakter, verifikasi input terpotong/ditolak (assertValue boleh dipakai untuk cek nilai aktual field itu setelah diisi). Field ber-"pattern=..." atau type email/number/tel/url → wajib ada test case mengisi format yang TIDAK cocok pola/type itu (mis. email tanpa "@", angka diisi huruf), verifikasi ditolak/muncul pesan error. Field ber-"min=" atau "max=" → wajib ada test case dengan nilai di luar batas (kurang dari min, lebih dari max). Kalau tidak ada elemen bersangkutan di batch ini yang punya constraint tersebut, LEWATI aturan ini untuk field itu — jangan mengarang constraint yang tidak tertulis di snapshot.',
    'Untuk modal/form hasil klik tombol (ada konteks interaksi di prompt): uji buka form, isi field, batal/tutup — JANGAN klik konfirmasi hapus/OK destruktif.',
    'Untuk halaman generic/dashboard: uji widget/tombol/filter/dropdown yang terlihat, bukan cuma verifikasi halaman terbuka.',
    'Target jumlah: 2–5 test case per halaman list_crud/form yang punya cukup elemen interaktif (boleh sampai 7 kalau form itu punya banyak field dengan constraint validasi yang wajib diuji sesuai aturan negative/boundary testing di atas — validasi field sejenis TIDAK PERLU satu test case per field, boleh digabung jadi satu test case "validasi field wajib kosong" yang menguji beberapa field sekaligus); 1–2 untuk halaman generic sederhana.',
    'Hindari test case duplikat yang hanya berbeda menu tujuan tanpa aksi di halaman tujuan.',
    'Maksimal 1 test case bertema login/gate auth untuk seluruh batch (kecuali halaman auth itu sendiri).',
    'JANGAN sertakan langkah login di test case fitur — login ditangani terpisah sebagai satu test case mandiri; asumsikan sesi sudah aktif.',
    'Setiap test case wajib punya description: 1–2 kalimat keterangan tujuan uji.',
    'Jangan pakai data produksi sungguhan; credential hanya dummy uji.',
  ].join(' ');
}

/**
 * Keterangan: Menyusun petunjuk authoring berdasarkan jenis halaman batch.
 */
function describeAuthoringKindHints(kinds: PageKind[]): string {
  const unique = [...new Set(kinds)];
  if (unique.length === 0) {
    return '';
  }
  const lines = unique.map((kind) => {
    switch (kind) {
      case 'list_crud':
        return '- list_crud: fokus CRUD/list — daftar, tambah, filter, aksi baris (bukan navigasi menu saja).';
      case 'form':
        return '- form: fokus isi field, submit, validasi error bila memungkinkan.';
      case 'generic':
        return '- generic: uji elemen interaktif yang terlihat (tombol, dropdown, filter).';
      default:
        return `- ${kind}: uji elemen interaktif yang ada di snapshot.`;
    }
  });
  return `Jenis halaman batch ini:\n${lines.join('\n')}`;
}

function findInteractionContext(_model: SiteModel, sitePage: SitePage): string | undefined {
  return sitePage.interactionContext;
}

/**
 * Keterangan: Mendeteksi apakah batch ini adalah "GRUP CRUD ROUND-TRIP" —
 * halaman pertama list_crud, DAN semua halaman lain di batch adalah
 * form/modal yang interactionParentUrl-nya benar-benar mengarah balik ke
 * halaman list_crud itu (bukan gabungan halaman tak terkait). Dipakai untuk
 * menandai batch secara eksplisit ke LLM karena ini pengecualian dari aturan
 * umum "satu batch = satu halaman" (Prioritas 4, audit QA generate).
 */
function isCrudRoundTripBatch(batchSitePages: SitePage[]): boolean {
  if (batchSitePages.length < 2) {
    return false;
  }
  const [main, ...rest] = batchSitePages;
  if (main!.kind !== 'list_crud') {
    return false;
  }
  const mainKey = normalizeUrlForZone(main!.snapshot.url);
  return rest.every(
    (page) => page.interactionParentUrl && normalizeUrlForZone(page.interactionParentUrl) === mainKey,
  );
}

/**
 * Keterangan: Menyusun user prompt authoring dengan ToC global SiteModel
 * dan detail penuh halaman batch saat ini.
 */
export function buildAuthoringUserPrompt(input: AuthoringPromptInput): string {
  const parts = [
    `Instruction:\n${input.prompt.trim()}`,
    `Base URL project: ${input.baseUrl?.trim() || '(tidak diisi)'}`,
    `Peta situs (semua halaman yang ditemukan):\n${buildSiteMapToc(input.siteModel)}`,
  ];

  if (input.batchSitePages.length > 0) {
    const kinds = input.batchSitePages.map((page) => page.kind);
    const isCrudBundle = isCrudRoundTripBatch(input.batchSitePages);
    const sections = input.batchSitePages.map((page, index) => {
      const context = findInteractionContext(input.siteModel, page);
      const contextLine = context ? `\nKonteks interaksi: ${context}` : '';
      return `Detail halaman batch ${index + 1} (jenis: ${kinds[index]})${contextLine}:\n${formatExplorationForPrompt(page.snapshot)}`;
    });
    parts.push(describeAuthoringKindHints(kinds));
    if (isCrudBundle) {
      const mainPage = input.batchSitePages[0]!.snapshot;
      parts.push(
        `GRUP CRUD ROUND-TRIP: halaman list "${mainPage.title}" (${mainPage.url}) digabung dengan ${input.batchSitePages.length - 1} form/modal turunannya sendiri (lihat "Konteks interaksi" tiap halaman di bawah). WAJIB buat minimal satu test case round-trip yang menghubungkan create/edit/hapus di form dengan verifikasi di tabel/list halaman ini — lihat aturan "WAJIB CRUD ROUND-TRIP" di instruksi sistem. Selain itu, tetap buat test case lain seperti biasa untuk fitur list_crud (filter, pagination, dst.) yang tidak butuh round-trip.`,
      );
    } else if (input.batchSitePages.length === 1) {
      const focusPage = input.batchSitePages[0]!.snapshot;
      const focusContext = input.batchSitePages[0]!.interactionContext;
      parts.push(
        `FOKUS WAJIB: Halaman "${focusPage.title}" (${focusPage.url})${focusContext ? ` — ${focusContext}` : ''}. Buat 3–6 test case yang menguji fitur DI HALAMAN INI (tombol, form, tabel, filter). Navigasi dari menu/dashboard boleh 1–3 langkah awal saja, sisanya harus aksi di halaman ini.`,
      );
    }
    parts.push(
      'Detail halaman untuk batch ini (heading + elemen dengan selector — wajib dipakai untuk steps fill/click, bukan hanya goto):\n\n' +
        sections.join('\n\n'),
    );
  }

  if (input.extraData?.trim()) {
    parts.push(`Data tambahan:\n${input.extraData.trim()}`);
  }
  if (input.existingTitles && input.existingTitles.length > 0) {
    parts.push(
      `Test case yang sudah ada (jangan diduplikasi):\n- ${input.existingTitles.join('\n- ')}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * Keterangan: Menyusun system prompt auth assessment — field form dinamis
 * (bukan hardcoded username/password).
 */
export function buildAuthAssessmentSystemPrompt(): string {
  return [
    'Anda menilai apakah snapshot halaman adalah authentication wall (form login/signin/gate yang menghalangi akses).',
    'Balas JSON saja, tanpa markdown dan tanpa teks lain.',
    'Format: {"isAuthWall":boolean,"fields":[{"key":"...","label":"...","selector":"...","action":"fill","secret":true,"inputType":"password"}],"submit":{"selector":"...","label":"..."}}',
    'Kalau isAuthWall true: fields = SEMUA field isian yang wajib diisi sebelum submit (email, username, NIK, PIN, OTP, kode cabang, dll.) — key stabil lowercase snake_case; secret true untuk password/PIN/OTP; action fill/check/select.',
    'submit = tombol submit/login/verifikasi. Kalau isAuthWall false: fields dan submit boleh diabaikan.',
    'Wajib memakai selector persis dari snapshot elemen; jangan mengarang selector yang tidak ada.',
  ].join(' ');
}

/**
 * Keterangan: Menyusun user prompt penilaian auth wall dari snapshot halaman.
 */
export function buildAuthAssessmentUserPrompt(input: {
  pageSnapshot: PageExplorationResult;
}): string {
  return `Snapshot halaman saat ini:\n${formatExplorationForPrompt(input.pageSnapshot)}`;
}

/**
 * Keterangan: Mem-parsing output LLM auth assessment menjadi AuthZone
 * dengan field dinamis, siap validasi terhadap snapshot.
 */
export function parseAuthAssessment(
  rawResponse: string,
  snapshot: PageExplorationResult,
): AuthAssessmentResult {
  const payload = extractGeneratedJson(rawResponse);
  const parsed = authAssessmentSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error('Output AI tidak sesuai format auth assessment');
  }
  if (!parsed.data.isAuthWall) {
    return { isAuthWall: false, zone: null };
  }

  const fields: AuthFieldDefinition[] = (parsed.data.fields ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    selector: field.selector,
    action: field.action ?? 'fill',
    secret: field.secret,
    inputType: field.inputType,
  }));

  const submit = parsed.data.submit;
  if (!submit || fields.length === 0) {
    throw new Error('Auth wall terdeteksi tapi fields/submit tidak lengkap');
  }

  const zone: AuthZone = {
    zoneId: buildAuthZoneId(snapshot.url, fields, submit.selector),
    loginUrl: snapshot.url,
    fields,
    submit: { selector: submit.selector, label: submit.label },
    status: 'pending',
  };

  return { isAuthWall: true, zone };
}

/**
 * Keterangan: Mengambil JSON object/array dari response model, termasuk yang
 * terbungkus markdown code fence.
 */
export function extractGeneratedJson(rawResponse: string): unknown {
  const trimmed = rawResponse.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const objectStart = withoutFence.indexOf('{');
    const objectEnd = withoutFence.lastIndexOf('}');
    const arrayStart = withoutFence.indexOf('[');
    const arrayEnd = withoutFence.lastIndexOf(']');
    if (
      arrayStart >= 0 &&
      arrayEnd > arrayStart &&
      (objectStart < 0 || arrayStart < objectStart)
    ) {
      return JSON.parse(withoutFence.slice(arrayStart, arrayEnd + 1)) as unknown;
    }
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(withoutFence.slice(objectStart, objectEnd + 1)) as unknown;
    }
    throw new Error('JSON tidak ditemukan pada response AI');
  }
}

/**
 * Keterangan: Membenarkan kesalahan umum AI pada step goto (value → url).
 */
function normalizeGotoStepValue(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      normalizeGotoStepValue(item);
    }
    return;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (
      record.action === 'goto' &&
      typeof record.url !== 'string' &&
      typeof record.value === 'string'
    ) {
      record.url = record.value;
    }
    for (const value of Object.values(record)) {
      normalizeGotoStepValue(value);
    }
  }
}

const ASSERTION_ACTIONS_NEEDING_VALUE = ['assertText', 'assertValue', 'assertCount', 'assertUrl'];

/**
 * Keterangan: Membenarkan kesalahan umum AI pada step assertion — field yang
 * seharusnya "value" kadang ditulis dengan nama lain yang lebih "semantik"
 * (expectedValue/expected/expectedText untuk assertText/assertValue/
 * assertCount, url/expectedUrl untuk assertUrl karena rancu dengan step
 * goto). Terverifikasi nyata terjadi di compile guided-flow (bukan cuma
 * teori) — tanpa normalisasi ini, step tersebut gagal validasi schema dan
 * MEMAKSA fallback ke provider lain yang bisa saja lagi rate-limited,
 * padahal output aslinya sudah benar secara semantik, cuma nama field-nya
 * yang meleset.
 */
function normalizeAssertionStepValue(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      normalizeAssertionStepValue(item);
    }
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  const record = node as Record<string, unknown>;
  if (
    typeof record.action === 'string' &&
    ASSERTION_ACTIONS_NEEDING_VALUE.includes(record.action) &&
    typeof record.value !== 'string'
  ) {
    const aliasCandidates =
      record.action === 'assertUrl'
        ? [record.url, record.expectedUrl]
        : record.action === 'assertCount'
          ? [record.count, record.expectedCount]
          : [record.expectedValue, record.expectedText, record.expected, record.text];
    const alias = aliasCandidates.find(
      (candidate) => typeof candidate === 'string' || typeof candidate === 'number',
    );
    if (alias !== undefined) {
      record.value = String(alias);
    }
  }
  for (const value of Object.values(record)) {
    normalizeAssertionStepValue(value);
  }
}

/**
 * Keterangan: Menormalkan output LLM menjadi daftar test case yang lolos schema.
 */
export function parseGeneratedTestCases(rawResponse: string): CreateTestCaseBody[] {
  const payload = extractGeneratedJson(rawResponse);
  normalizeGotoStepValue(payload);
  normalizeAssertionStepValue(payload);
  const wrapped = generatedListSchema.safeParse(payload);
  if (wrapped.success) {
    return wrapped.data.testCases;
  }

  const single = generatedTestCaseSchema.safeParse(payload);
  if (single.success) {
    return [single.data];
  }

  const list = z.array(generatedTestCaseSchema).min(1).safeParse(payload);
  if (list.success) {
    return list.data;
  }

  throw new Error(
    'Output AI tidak sesuai format test case (title, description, steps, expected)',
  );
}

/**
 * Keterangan: Satu catatan aksi dalam guided single-flow (Tambah Test Case
 * via prompt AI) — dipakai baik untuk konteks keputusan langkah berikutnya
 * maupun untuk compile akhir jadi test case. `snapshotBefore` disimpan per
 * langkah (bukan cuma snapshot terakhir) supaya compile akhir bisa memilih
 * selector dari halaman mana pun yang pernah muncul di sepanjang alur.
 */
export interface GuidedActionRecord {
  /** Kosong hanya untuk kegagalan sintetis (mis. output AI gagal di-parse sama sekali, tidak ada step yang bisa diusulkan). */
  step?: TestCaseStep;
  reasoning?: string;
  status: 'passed' | 'failed';
  errorMessage?: string | null;
  snapshotBefore: PageExplorationResult;
}

/**
 * Keterangan: Error khusus dipakai guided-flow.service.ts untuk membedakan
 * "keputusan LLM tidak valid" (format salah / selector halusinasi — layak
 * di-retry dengan feedback) dari error provider/jaringan biasa.
 */
export class GuidedActionValidationError extends Error {
  /** Step yang diusulkan LLM tapi ditolak (mis. selector halusinasi) — dipakai caller untuk mencatat kegagalan sintetis di history tanpa perlu re-parse. */
  readonly attemptedStep?: TestCaseStep;

  constructor(message: string, attemptedStep?: TestCaseStep) {
    super(message);
    this.name = 'GuidedActionValidationError';
    this.attemptedStep = attemptedStep;
  }
}

const guidedNextActionDoneSchema = z.object({
  done: z.literal(true),
  reasoning: z.string().optional(),
});

const guidedNextActionStepSchema = z.object({
  done: z.literal(false),
  reasoning: z.string().optional(),
  step: testCaseStepSchema,
});

const guidedNextActionSchema = z.union([
  guidedNextActionDoneSchema,
  guidedNextActionStepSchema,
]);

export type GuidedNextActionDecision =
  | { done: true; reasoning?: string }
  | { done: false; reasoning?: string; step: TestCaseStep };

/**
 * Keterangan: Konteks test case yang SEDANG DIEDIT (mode edit-via-AI) —
 * dikirim ke prompt sebagai REFERENSI SAJA (apa yang SEBELUMNYA diuji),
 * TIDAK dieksekusi otomatis. Guided flow tetap WAJIB menjalankan browser
 * sungguhan dari awal dan memverifikasi ulang setiap langkah — konteks ini
 * cuma membantu AI memahami MAKSUD perubahan yang diminta user relatif
 * terhadap alur lama, bukan pengganti verifikasi live.
 */
export interface ExistingTestCaseContext {
  title: string;
  steps: unknown;
  expected: unknown;
}

function formatExistingTestCaseContext(existingTestCase?: ExistingTestCaseContext): string {
  if (!existingTestCase) {
    return '';
  }
  return `\n\nTest case yang SEDANG DIEDIT (referensi konteks SAJA — ini alur LAMA sebelum perubahan, JANGAN dieksekusi ulang secara membabi buta, tetap putuskan aksi berdasarkan snapshot LIVE dan instruksi di atas):\nJudul lama: ${existingTestCase.title}\nSteps lama: ${JSON.stringify(existingTestCase.steps)}\nExpected lama: ${JSON.stringify(existingTestCase.expected)}`;
}

export interface GuidedNextActionInput {
  instruction: string;
  snapshot: PageExplorationResult;
  history: GuidedActionRecord[];
  remainingBudget: number;
  existingTestCase?: ExistingTestCaseContext;
}

/**
 * Keterangan: System prompt "aksi berikutnya" untuk guided single-flow —
 * SATU keputusan per panggilan (disiplin arsitektur: kode kita yang
 * mengendalikan loop, LLM cuma memutuskan satu langkah, MCP cuma eksekutor).
 */
export function buildGuidedNextActionSystemPrompt(): string {
  return [
    'Anda mengendalikan browser step-by-step untuk menyusun SATU test case automated web testing dari instruksi bahasa natural pengguna.',
    'Balas JSON saja, tanpa markdown dan tanpa teks lain.',
    'Format kalau instruksi BELUM selesai: {"done":false,"reasoning":"...","step":{<satu TestCaseStep>}}',
    'Format kalau instruksi SUDAH selesai (aksi terakhir berhasil dan tujuan instruksi tercapai): {"done":true,"reasoning":"..."}',
    'WAJIB hanya SATU step per balasan — jangan pernah balas array/list langkah.',
    'step memakai action: goto, fill, click, check, select, waitFor, assertVisible, assertHidden, assertChecked, assertText, assertValue, assertCount, assertUrl. goto wajib "url". fill/select wajib selector+value. click/check/waitFor wajib selector.',
    'selector WAJIB persis dari snapshot elemen di bawah — JANGAN mengarang selector yang tidak ada di snapshot.',
    'Perhatikan riwayat aksi: JANGAN mengulang step yang sama persis dengan yang sudah berstatus "passed" (berarti sudah tercapai). Kalau step terakhir berstatus "failed", coba pendekatan/selector lain yang berbeda, jangan ulangi identik.',
    'Jangan balas done:true sebelum ada minimal satu aksi nyata (fill/click/check/select) yang berhasil dieksekusi sesuai instruksi — cuma membuka halaman (goto) belum cukup dianggap selesai.',
    'Kalau sisa kuota langkah tinggal sedikit, prioritaskan menyelesaikan aksi inti instruksi (mis. submit) daripada eksplorasi tambahan.',
    'Fokus HANYA pada apa yang diminta instruksi pengguna — jangan menambah aksi di luar itu.',
    'Kalau ada "Test case yang SEDANG DIEDIT" di bawah, itu HANYA konteks alur LAMA untuk membantu memahami maksud perubahan yang diminta instruksi — JANGAN mengulang step lama begitu saja tanpa verifikasi, karena selector/state halaman bisa sudah berubah. Tetap putuskan aksi SATU PER SATU berdasarkan snapshot halaman LIVE saat ini.',
  ].join(' ');
}

function formatGuidedHistory(history: GuidedActionRecord[]): string {
  if (history.length === 0) {
    return '(belum ada aksi)';
  }
  return history
    .map((record, index) => {
      const stepDescription = record.step
        ? JSON.stringify(record.step)
        : '(keputusan AI sebelumnya tidak valid/tidak bisa diusulkan)';
      const statusLine =
        record.status === 'passed'
          ? 'berhasil'
          : `GAGAL${record.errorMessage ? ` (${record.errorMessage})` : ''}`;
      return `${index + 1}. ${stepDescription} → ${statusLine}`;
    })
    .join('\n');
}

/**
 * Keterangan: User prompt "aksi berikutnya" — instruksi asli + riwayat aksi
 * + snapshot halaman TERKINI (bukan snapshot lama) supaya keputusan selalu
 * berbasis state browser yang sungguhan.
 */
export function buildGuidedNextActionUserPrompt(input: GuidedNextActionInput): string {
  return [
    `Instruksi pengguna:\n${input.instruction.trim()}${formatExistingTestCaseContext(input.existingTestCase)}`,
    `Riwayat aksi sejauh ini:\n${formatGuidedHistory(input.history)}`,
    `Sisa kuota langkah: ${input.remainingBudget}`,
    `Snapshot halaman saat ini:\n${formatExplorationForPrompt(input.snapshot)}`,
  ].join('\n\n');
}

/**
 * Keterangan: Mem-parsing + memvalidasi keputusan "aksi berikutnya" —
 * cross-check selector terhadap snapshot TERKINI supaya selector halusinasi
 * tertangkap sebelum sempat dieksekusi ke browser sungguhan.
 */
export function parseGuidedNextAction(
  rawResponse: string,
  snapshot: PageExplorationResult,
): GuidedNextActionDecision {
  const payload = extractGeneratedJson(rawResponse);
  const parsed = guidedNextActionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GuidedActionValidationError(
      'Output AI tidak sesuai format keputusan aksi berikutnya (done/step)',
    );
  }
  if (parsed.data.done) {
    return { done: true, reasoning: parsed.data.reasoning };
  }

  const step = parsed.data.step;
  const selector = 'selector' in step ? step.selector : undefined;
  if (selector && !snapshot.elements.some((element) => element.selector === selector)) {
    throw new GuidedActionValidationError(
      `Selector "${selector}" tidak ditemukan di snapshot halaman saat ini`,
      step,
    );
  }

  return { done: false, reasoning: parsed.data.reasoning, step };
}

export interface GuidedCompileInput {
  instruction: string;
  history: GuidedActionRecord[];
  /**
   * Snapshot halaman setelah aksi TERAKHIR di history (biasanya submit) —
   * history sendiri tidak pernah mencatat state SETELAH aksi terakhirnya
   * sendiri, cuma state SEBELUM tiap aksi. Tanpa ini, compile tidak tahu
   * elemen apa yang benar-benar ada pasca-submit untuk assertion yang aman
   * (assertText/assertVisible pada halaman baru), sehingga cenderung
   * mengarang assertValue pada field form lama yang sudah hilang karena
   * redirect — bug nyata yang pernah menyebabkan test case timeout.
   */
  finalSnapshot?: PageExplorationResult;
  existingTestCase?: ExistingTestCaseContext;
}

/**
 * Keterangan: System prompt compile akhir — mengubah riwayat aksi guided
 * flow menjadi SATU test case tersimpan lengkap dengan assertion, memakai
 * aturan yang sama (assertion wajib untuk tiap klaim expected, selector
 * wajib dari snapshot) seperti authoring batch biasa.
 */
export function buildGuidedCompileSystemPrompt(): string {
  return [
    'Anda menyusun SATU test case automated web testing dari riwayat aksi nyata yang sudah dijalankan browser step-by-step.',
    'Balas JSON saja, tanpa markdown dan tanpa teks lain.',
    'Format: {"title":"...","description":"...","steps":[...],"expected":["..."]}',
    'steps memakai action: goto, fill, click, check, select, waitFor, assertVisible, assertHidden, assertChecked, assertText, assertValue, assertCount, assertUrl.',
    'PENTING soal nama field — WAJIB PERSIS seperti ini, JANGAN pakai nama lain yang "kedengaran lebih jelas" (mis. "expectedValue"/"expected"/"url" pada step assertion SELALU DITOLAK, field yang benar SELALU bernama "value"): goto→url. fill/select→selector+value. click/check/waitFor→selector saja. assertVisible/assertHidden/assertChecked→selector saja (TANPA value). assertText/assertValue/assertCount→selector+value (assertText: value=potongan teks yang harus muncul; assertValue: value=isi persis input; assertCount: value=jumlah elemen sebagai STRING angka, mis. "3"). assertUrl→value SAJA (potongan URL yang harus ada di alamat halaman), TANPA selector — field-nya "value", BUKAN "url".',
    'steps WAJIB berisi urutan aksi yang BERHASIL ("passed") dari riwayat, dalam urutan yang sama — jangan sertakan aksi yang gagal.',
    'WAJIB: setiap klaim di "expected" harus dibuktikan oleh minimal satu step assertion (assertVisible/assertHidden/assertChecked/assertText/assertValue/assertCount/assertUrl) di "steps". Riwayat aksi kemungkinan besar TIDAK punya assertion (fokus riwayat adalah eksekusi aksi) — TAMBAHKAN 1-2 step assertion yang relevan (mis. setelah submit, verifikasi hasil via assertText/assertVisible pada elemen yang benar-benar ada di snapshot langkah itu, atau assertUrl kalau ada redirect).',
    'PENTING soal PENEMPATAN assertion (bug nyata yang pernah terjadi): kalau ingin memverifikasi ISI FIELD FORM (assertValue/assertText pada input/textarea yang baru diisi), taruh step assertion itu SEGERA SETELAH step fill terkait DAN SEBELUM step submit/klik simpan — JANGAN taruh assertValue pada field form SETELAH step submit, karena submit biasanya memicu navigasi/redirect yang membuat field itu HILANG dari halaman, sehingga assertValue timeout menunggu elemen yang sudah tidak ada. Assertion yang ditaruh SETELAH step submit HANYA boleh assertUrl (kalau ada redirect) atau assertText/assertVisible pada elemen milik HALAMAN BARU (mis. notifikasi sukses, baris tabel) yang benar-benar tercatat di "Snapshot akhir setelah aksi terakhir" di bawah — JANGAN assertValue pada selector form lama setelah submit.',
    'Selector assertion yang ditambahkan WAJIB memakai selector yang benar-benar tercatat di salah satu snapshot riwayat (atau snapshot akhir) — JANGAN mengarang selector baru. Kalau tidak ada elemen yang cocok untuk diverifikasi pasca-submit, gunakan assertUrl (tidak butuh selector).',
    'title singkat mendeskripsikan alur (dari instruksi pengguna). description 1-2 kalimat tujuan uji.',
    'Jangan pakai data produksi sungguhan; hanya deskripsikan alur, jangan mengarang data baru di luar yang sudah dipakai riwayat.',
    'Kalau ada "Test case yang SEDANG DIEDIT" di bawah, hasil akhir MENGGANTIKAN SELURUH ISI test case itu (title/description/steps/expected) mengikuti alur BARU yang BENAR-BENAR baru saja dijalankan di riwayat — title/description boleh dipertahankan kalau masih relevan, atau disesuaikan kalau instruksi mengubah maksud alurnya. JANGAN sekadar menggabungkan steps lama+baru tanpa dasar dari riwayat aksi yang sungguhan dijalankan.',
  ].join(' ');
}

/**
 * Keterangan: User prompt compile akhir — instruksi asli + seluruh riwayat
 * aksi beserta snapshot per langkah (supaya LLM bisa memilih selector
 * assertion dari halaman mana pun di sepanjang alur, bukan cuma halaman
 * terakhir).
 */
export function buildGuidedCompileUserPrompt(input: GuidedCompileInput): string {
  const successfulSteps = input.history.filter((record) => record.status === 'passed');
  const stepsSection = successfulSteps
    .map((record, index) => {
      return `Langkah ${index + 1}: ${JSON.stringify(record.step)}\nSnapshot halaman saat langkah ini dijalankan:\n${formatExplorationForPrompt(record.snapshotBefore)}`;
    })
    .join('\n\n');
  const parts = [
    `Instruksi pengguna:\n${input.instruction.trim()}${formatExistingTestCaseContext(input.existingTestCase)}`,
    `Riwayat aksi yang berhasil dijalankan (urutan sesuai eksekusi nyata):\n\n${stepsSection || '(tidak ada aksi berhasil)'}`,
  ];
  if (input.finalSnapshot) {
    parts.push(
      `Snapshot akhir setelah aksi terakhir (state akhir alur — PAKAI INI untuk assertion yang ditaruh SETELAH step submit, JANGAN pakai selector form dari langkah sebelumnya):\n${formatExplorationForPrompt(input.finalSnapshot)}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * Keterangan: Alias backward-compatible untuk test lama yang masih import
 * buildGenerationSystemPrompt / buildGenerationUserPrompt.
 */
export const buildGenerationSystemPrompt = buildAuthoringSystemPrompt;

export function buildGenerationUserPrompt(input: {
  prompt: string;
  extraData?: string;
  baseUrl?: string | null;
  existingTitles?: string[];
  pageSnapshot?: PageExplorationResult;
  additionalPages?: PageExplorationResult[];
  siteModel?: SiteModel;
}): string {
  const batchPages = [
    ...(input.pageSnapshot ? [input.pageSnapshot] : []),
    ...(input.additionalPages ?? []),
  ];
  const siteModel: SiteModel = input.siteModel ?? {
    pages: batchPages.map((snapshot) => ({
      snapshot,
      kind: 'generic' as const,
      gated: false,
    })),
    authZones: [],
  };
  return buildAuthoringUserPrompt({
    prompt: input.prompt,
    extraData: input.extraData,
    baseUrl: input.baseUrl,
    siteModel,
    batchSitePages: siteModel.pages.filter((page) =>
      batchPages.some((snapshot) => snapshot.url === page.snapshot.url),
    ),
    existingTitles: input.existingTitles,
  });
}
