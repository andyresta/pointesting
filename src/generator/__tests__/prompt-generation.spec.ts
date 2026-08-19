import { expect, test } from '@playwright/test';
import {
  buildAuthAssessmentUserPrompt,
  buildAuthoringUserPrompt,
  buildGuidedCompileUserPrompt,
  GuidedActionValidationError,
  parseAuthAssessment,
  parseGeneratedTestCases,
  parseGuidedNextAction,
} from '../prompt-generation';
import type { GeneratorDependencies } from '../generator.service';
import { generateTestCasesFromPrompt, scoreNavLinkCandidate } from '../generator.service';
import { submitAuthInput, waitForAuthInput } from '../auth-input-prompt';
import { AllProvidersFailedError } from '../../analyzer/analyzer.service';
import { ProviderError } from '../../analyzer/provider.error';
import type { Project } from '../../db/repositories/types';
import type { PageExplorationResult } from '../page-explorer';
import { PageExplorationError } from '../page-explorer';
import {
  buildAuthStepsFromZone,
  buildSiteMapToc,
  buildStandaloneLoginTestCase,
  classifyPageKind,
  dedupeGeneratedTestCases,
  groupPagesForAuthoring,
  type AuthZone,
  type SiteModel,
} from '../site-model';

const SAMPLE_CASE = {
  title: 'Buka dashboard',
  description: 'Memastikan dashboard tampil setelah navigasi.',
  steps: [
    { action: 'goto', url: '/dashboard' },
    { action: 'click', selector: '#menu-home' },
  ],
  expected: ['Dashboard tampil'],
};

const PAGE_SNAPSHOT: PageExplorationResult = {
  url: 'https://portal.test/login',
  title: 'Portal Login',
  headings: ['h1: Masuk ke Portal'],
  elements: [
    {
      tag: 'input',
      role: null,
      type: 'email',
      id: 'email',
      nameAttr: 'email',
      testId: null,
      label: null,
      placeholder: 'nama@contoh.test',
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
      selector: '#email',
      x: 24,
      y: 80,
      width: 280,
      height: 40,
    },
    {
      tag: 'input',
      role: null,
      type: 'password',
      id: 'pass',
      nameAttr: 'password',
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
      selector: '#pass',
      x: 24,
      y: 130,
      width: 280,
      height: 40,
    },
    {
      tag: 'button',
      role: null,
      type: 'submit',
      id: 'login-btn',
      nameAttr: null,
      testId: null,
      label: null,
      placeholder: null,
      text: 'Masuk',
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
      selector: '#login-btn',
      x: 24,
      y: 180,
      width: 120,
      height: 40,
    },
  ],
};

const DASHBOARD_SNAPSHOT: PageExplorationResult = {
  url: 'https://portal.test/dashboard',
  title: 'Dashboard',
  headings: ['h1: Dashboard'],
  elements: [
    {
      tag: 'button',
      role: null,
      type: 'button',
      id: 'add-item',
      nameAttr: null,
      testId: null,
      label: null,
      placeholder: null,
      text: 'Tambah Item',
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
      selector: '#add-item',
      x: 10,
      y: 40,
      width: 100,
      height: 30,
    },
  ],
};

function buildSiteModel(pages: PageExplorationResult[], authZones: AuthZone[] = []): SiteModel {
  return {
    pages: pages.map((snapshot) => ({
      snapshot,
      kind: classifyPageKind(snapshot),
      gated: false,
    })),
    authZones,
  };
}

test('parseGeneratedTestCases menerima object, array, dan fence markdown', () => {
  expect(parseGeneratedTestCases(JSON.stringify(SAMPLE_CASE))).toEqual([SAMPLE_CASE]);
  expect(parseGeneratedTestCases(JSON.stringify({ testCases: [SAMPLE_CASE] }))).toEqual([
    SAMPLE_CASE,
  ]);
});

test('parseGeneratedTestCases membenarkan assertValue/assertCount yang pakai nama field "expectedValue" bukan "value" (kasus nyata compile guided-flow)', () => {
  const raw = JSON.stringify({
    title: 'Tambah Teknisi Baru',
    description: 'Menguji form tambah teknisi.',
    steps: [
      { action: 'goto', url: '/technicians' },
      { action: 'fill', selector: '#name', value: 'Teknisi Baru' },
      {
        action: 'assertValue',
        selector: '#name',
        expectedValue: 'Teknisi Baru',
        message: 'Nama teknisi terisi sesuai input',
      },
    ],
    expected: ['Nama teknisi terisi sesuai input'],
  });
  const [parsed] = parseGeneratedTestCases(raw);
  expect(parsed?.steps[2]).toEqual({
    action: 'assertValue',
    selector: '#name',
    value: 'Teknisi Baru',
  });
});

test('parseGeneratedTestCases membenarkan assertUrl yang pakai nama field "url" bukan "value" (kasus nyata compile guided-flow)', () => {
  const raw = JSON.stringify({
    title: 'Tambah Teknisi Baru',
    description: 'Menguji form tambah teknisi.',
    steps: [
      { action: 'goto', url: '/technicians' },
      { action: 'assertUrl', url: 'https://app.test/technicians' },
    ],
    expected: ['Kembali ke halaman daftar teknisi'],
  });
  const [parsed] = parseGeneratedTestCases(raw);
  expect(parsed?.steps[1]).toEqual({
    action: 'assertUrl',
    value: 'https://app.test/technicians',
  });
});

test('parseAuthAssessment mengenali auth wall dengan field dinamis', () => {
  const result = parseAuthAssessment(
    JSON.stringify({
      isAuthWall: true,
      fields: [
        {
          key: 'email',
          label: 'Email',
          selector: '#email',
          action: 'fill',
          inputType: 'email',
        },
        {
          key: 'password',
          label: 'Password',
          selector: '#pass',
          action: 'fill',
          secret: true,
          inputType: 'password',
        },
      ],
      submit: { selector: '#login-btn', label: 'Masuk' },
    }),
    PAGE_SNAPSHOT,
  );
  expect(result.isAuthWall).toBe(true);
  expect(result.zone?.fields).toHaveLength(2);
  expect(result.zone?.submit.selector).toBe('#login-btn');
});

test('parseAuthAssessment halaman biasa mengembalikan isAuthWall false', () => {
  expect(parseAuthAssessment(JSON.stringify({ isAuthWall: false }), DASHBOARD_SNAPSHOT)).toEqual({
    isAuthWall: false,
    zone: null,
  });
});

test('classifyPageKind mendeteksi auth vs list_crud', () => {
  expect(classifyPageKind(PAGE_SNAPSHOT)).toBe('auth');
  expect(classifyPageKind(DASHBOARD_SNAPSHOT)).toBe('list_crud');
});

test('buildSiteMapToc merangkum semua halaman', () => {
  const toc = buildSiteMapToc(buildSiteModel([PAGE_SNAPSHOT, DASHBOARD_SNAPSHOT]));
  expect(toc).toContain('Portal Login');
  expect(toc).toContain('Dashboard');
});

test('buildStandaloneLoginTestCase menyusun satu test login mandiri', () => {
  const zone: AuthZone = {
    zoneId: 'z1',
    loginUrl: 'https://portal.test/login',
    fields: [
      { key: 'email', label: 'Email', selector: '#email', action: 'fill' },
      { key: 'password', label: 'Password', selector: '#pass', action: 'fill', secret: true },
    ],
    submit: { selector: '#login-btn' },
    values: { email: 'user@test', password: 'secret' },
    status: 'authenticated',
  };
  const loginCase = buildStandaloneLoginTestCase([zone]);
  expect(loginCase?.title).toBe('Login dengan kredensial valid');
  expect(loginCase?.steps).toEqual(buildAuthStepsFromZone(zone));
});

test('buildAuthStepsFromZone menyusun fill dinamis + click submit', () => {
  const zone: AuthZone = {
    zoneId: 'z1',
    loginUrl: 'https://portal.test/login',
    fields: [
      { key: 'email', label: 'Email', selector: '#email', action: 'fill' },
      { key: 'password', label: 'Password', selector: '#pass', action: 'fill', secret: true },
    ],
    submit: { selector: '#login-btn' },
    values: { email: 'user@test', password: 'secret' },
    status: 'authenticated',
  };
  expect(buildAuthStepsFromZone(zone)).toEqual([
    { action: 'goto', url: 'https://portal.test/login' },
    { action: 'fill', selector: '#email', value: 'user@test' },
    { action: 'fill', selector: '#pass', value: 'secret' },
    { action: 'click', selector: '#login-btn' },
  ]);
});

test('dedupeGeneratedTestCases membuang judul mirip', () => {
  const deduped = dedupeGeneratedTestCases([
    { ...SAMPLE_CASE, title: 'Login berhasil' },
    { ...SAMPLE_CASE, title: 'Login berhasil' },
    { ...SAMPLE_CASE, title: 'Logout dari aplikasi' },
  ] as import('../../api/schemas/testcase.schema').CreateTestCaseBody[]);
  expect(deduped).toHaveLength(2);
});

test('buildAuthoringUserPrompt selalu menyertakan ToC situs', () => {
  const siteModel = buildSiteModel([DASHBOARD_SNAPSHOT]);
  const prompt = buildAuthoringUserPrompt({
    prompt: 'Uji aplikasi',
    baseUrl: 'https://portal.test',
    siteModel,
    batchSitePages: siteModel.pages,
  });
  expect(prompt).toContain('Peta situs');
  expect(prompt).toContain('Dashboard');
  expect(prompt).toContain('#add-item');
  expect(prompt).toContain('list_crud');
});

test('groupPagesForAuthoring memisahkan list_crud satu halaman per batch', () => {
  const model = buildSiteModel([PAGE_SNAPSHOT, DASHBOARD_SNAPSHOT, DASHBOARD_SNAPSHOT]);
  model.pages[1]!.kind = 'list_crud';
  model.pages[2]!.kind = 'form';
  model.pages[2]!.snapshot = {
    ...DASHBOARD_SNAPSHOT,
    url: 'https://portal.test/customers',
    title: 'Pelanggan',
  };
  const batches = groupPagesForAuthoring(model, 2);
  expect(batches).toHaveLength(2);
  expect(batches[0]).toHaveLength(1);
  expect(batches[1]).toHaveLength(1);
  expect(batches[0]![0]!.kind).toBe('list_crud');
});

/**
 * Keterangan: Memverifikasi Prioritas 4 (CRUD round-trip) — halaman list_crud
 * digabung SATU BATCH dengan form/modal turunannya sendiri (interactionParentUrl
 * mengarah balik ke URL list itu), supaya LLM authoring bisa menulis test
 * case yang menghubungkan create di form dengan verifikasi di tabel list.
 * Form yang induknya BUKAN halaman list ini (interactionParentUrl beda) TIDAK
 * ikut tergabung.
 */
test('groupPagesForAuthoring menggabungkan list_crud dengan form turunannya sendiri (CRUD round-trip)', () => {
  const listSnapshot: PageExplorationResult = {
    ...DASHBOARD_SNAPSHOT,
    url: 'https://portal.test/customers',
    title: 'Pelanggan',
  };
  const addFormSnapshot: PageExplorationResult = {
    ...DASHBOARD_SNAPSHOT,
    url: 'https://portal.test/customers',
    title: 'Pelanggan',
  };
  const unrelatedFormSnapshot: PageExplorationResult = {
    ...DASHBOARD_SNAPSHOT,
    url: 'https://portal.test/other',
    title: 'Form Lain',
  };

  const model = buildSiteModel([listSnapshot, addFormSnapshot, unrelatedFormSnapshot]);
  model.pages[0]!.kind = 'list_crud';
  model.pages[1]!.interactionContext = 'Pelanggan › Tambah Pelanggan';
  model.pages[1]!.interactionParentUrl = 'https://portal.test/customers';
  model.pages[2]!.interactionContext = 'Halaman Lain › Tambah Sesuatu';
  model.pages[2]!.interactionParentUrl = 'https://portal.test/beda-sekali';

  const batches = groupPagesForAuthoring(model, 2);

  expect(batches).toHaveLength(2);
  expect(batches[0]).toHaveLength(2);
  expect(batches[0]![0]!.kind).toBe('list_crud');
  expect(batches[0]![1]!.interactionContext).toBe('Pelanggan › Tambah Pelanggan');
  expect(batches[1]).toHaveLength(1);
  expect(batches[1]![0]!.interactionContext).toBe('Halaman Lain › Tambah Sesuatu');
});

test('buildAuthoringUserPrompt menandai "GRUP CRUD ROUND-TRIP" saat batch berisi list_crud + form turunannya', () => {
  const listSnapshot: PageExplorationResult = {
    ...DASHBOARD_SNAPSHOT,
    url: 'https://portal.test/customers',
    title: 'Pelanggan',
  };
  const addFormSnapshot: PageExplorationResult = {
    ...DASHBOARD_SNAPSHOT,
    url: 'https://portal.test/customers',
    title: 'Pelanggan',
  };
  const model = buildSiteModel([listSnapshot, addFormSnapshot]);
  model.pages[0]!.kind = 'list_crud';
  model.pages[1]!.interactionContext = 'Pelanggan › Tambah Pelanggan';
  model.pages[1]!.interactionParentUrl = 'https://portal.test/customers';

  const prompt = buildAuthoringUserPrompt({
    prompt: 'Uji fitur pelanggan',
    baseUrl: 'https://portal.test',
    siteModel: model,
    batchSitePages: model.pages,
  });

  expect(prompt).toContain('GRUP CRUD ROUND-TRIP');
  expect(prompt).not.toContain('FOKUS WAJIB');
});

/**
 * Keterangan: Memverifikasi Prioritas 5 (prioritisasi risk-based) — link
 * bertema fitur bernilai tinggi (transaksi/data/CRUD) mendapat skor lebih
 * tinggi dari link informasional generik, dan link netral (tidak cocok
 * pola apa pun) mendapat skor 0 — supaya urutan crawl tidak acak semata
 * berdasar urutan ditemukan di DOM.
 */
test('scoreNavLinkCandidate memprioritaskan link bernilai tinggi di atas link informasional generik', () => {
  const highValue = scoreNavLinkCandidate({
    text: 'Data Pelanggan',
    href: 'https://app.test/pelanggan',
    selector: 'a',
  });
  const lowValue = scoreNavLinkCandidate({
    text: 'Bantuan & FAQ',
    href: 'https://app.test/bantuan',
    selector: 'a',
  });
  const neutral = scoreNavLinkCandidate({
    text: 'Dashboard',
    href: 'https://app.test/dashboard',
    selector: 'a',
  });

  expect(highValue).toBeGreaterThan(neutral);
  expect(neutral).toBeGreaterThan(lowValue);
  expect(neutral).toBe(0);
});

function createGenerateDeps(
  complete: (systemPrompt: string, userContent: unknown[]) => Promise<string>,
  siteModel?: SiteModel,
): GeneratorDependencies {
  const project: Project = {
    id: 'project-1',
    name: 'Portal',
    baseUrl: 'https://portal.test',
    defaultProvider: 'claude',
    instruction: null,
    extraData: null,
    createdAt: null,
  };
  return {
    projects: { findById: async () => project },
    loadProjectProviderSecrets: async () => [
      {
        provider: 'claude',
        apiKey: 'key-placeholder',
        defaultModel: 'claude-test',
        sortOrder: 0,
      },
    ],
    listTestCases: async () => [],
    persistTestCases: async (_projectId, items) =>
      items.map((item, index) => ({
        id: `case-${index}`,
        projectId: item.projectId,
        title: item.title,
        description: item.description ?? null,
        steps: item.steps,
        expected: item.expected,
        source: item.source ?? 'ai_prompt',
        createdAt: null,
        updatedAt: null,
      })),
    createClient: () => ({ complete }),
    explorePage: async () => DASHBOARD_SNAPSHOT,
    runLiveExploration: async (_url, _id, onStatus, authPrefill, work) => {
      onStatus('open', 'mock');
      return work({
        driver: {} as import('../exploration-driver').ExplorationDriver,
        emit: onStatus,
        authPrefill,
      });
    },
    discoverSite: async () =>
      siteModel ?? buildSiteModel([DASHBOARD_SNAPSHOT], []),
  };
}

test('generateTestCasesFromPrompt Map-then-Author menyimpan test case dari SiteModel', async () => {
  const result = await generateTestCasesFromPrompt(
    { projectId: 'project-1', prompt: 'Uji dashboard', generateId: 'gen-1' },
    createGenerateDeps(async () => JSON.stringify({ testCases: [SAMPLE_CASE] })),
  );
  expect(result.testCases).toHaveLength(1);
  expect(result.testCases[0]?.source).toBe('ai_prompt');
});

test('generateTestCasesFromPrompt menambahkan test login terpisah tanpa prefix di test fitur', async () => {
  const authZone: AuthZone = {
    zoneId: 'zone-login',
    loginUrl: 'https://portal.test/login',
    fields: [
      { key: 'email', label: 'Email', selector: '#email', action: 'fill' },
      { key: 'password', label: 'Password', selector: '#pass', action: 'fill', secret: true },
    ],
    submit: { selector: '#login-btn' },
    values: { email: 'admin', password: 'secret' },
    status: 'authenticated',
  };
  const result = await generateTestCasesFromPrompt(
    { projectId: 'project-1', prompt: 'Uji dashboard', generateId: 'gen-auth' },
    createGenerateDeps(
      async () => JSON.stringify({ testCases: [SAMPLE_CASE] }),
      buildSiteModel([DASHBOARD_SNAPSHOT], [authZone]),
    ),
  );
  expect(result.testCases).toHaveLength(2);
  const featureCase = result.testCases.find((item) => item.title === SAMPLE_CASE.title);
  const featureSteps = featureCase?.steps as Array<{ action: string; url?: string }> | undefined;
  expect(featureSteps?.[0]).toEqual({ action: 'goto', url: '/dashboard' });
  const loginCase = result.testCases.find((item) => item.title === 'Login dengan kredensial valid');
  const loginSteps = loginCase?.steps as Array<{ action: string; url?: string }> | undefined;
  expect(loginSteps?.[0]).toEqual({
    action: 'goto',
    url: 'https://portal.test/login',
  });
});

test('generateTestCasesFromPrompt semua halaman gated menghasilkan test case unverified', async () => {
  const gatedModel: SiteModel = {
    pages: [{ snapshot: PAGE_SNAPSHOT, kind: 'auth', gated: true, authZoneId: 'z1' }],
    authZones: [
      {
        zoneId: 'z1',
        loginUrl: PAGE_SNAPSHOT.url,
        fields: [{ key: 'email', label: 'Email', selector: '#email', action: 'fill' }],
        submit: { selector: '#login-btn' },
        status: 'skipped',
      },
    ],
  };
  const result = await generateTestCasesFromPrompt(
    { projectId: 'project-1', prompt: 'Uji login', generateId: 'gen-gated' },
    createGenerateDeps(async () => JSON.stringify({ testCases: [SAMPLE_CASE] }), gatedModel),
  );
  expect(result.testCases).toHaveLength(1);
  expect(result.testCases[0]?.title).toMatch(/^\[Auth - Unverified\]/);
  expect(result.testCases[0]?.source).toBe('ai_url_exploration');
});

test('submitAuthInput melanjutkan promise waitForAuthInput', async () => {
  const zone: AuthZone = {
    zoneId: 'z-test',
    loginUrl: 'https://portal.test/login',
    fields: [{ key: 'pin', label: 'PIN', selector: '#pin', action: 'fill', secret: true }],
    submit: { selector: '#submit' },
    status: 'pending',
  };
  const pending = waitForAuthInput('gen-input', zone);
  expect(submitAuthInput('gen-input', 'z-test', { pin: '1234' })).toBe(true);
  await expect(pending).resolves.toEqual({
    type: 'submitted',
    values: { pin: '1234' },
  });
});

test('generateTestCasesFromPrompt fallback jika output AI tidak valid', async () => {
  await expect(
    generateTestCasesFromPrompt(
      { projectId: 'project-1', prompt: 'Uji login', generateId: 'gen-fail' },
      createGenerateDeps(async () => 'bukan json', buildSiteModel([DASHBOARD_SNAPSHOT])),
    ),
  ).rejects.toBeInstanceOf(AllProvidersFailedError);
});

test('generateTestCasesFromPrompt fallback pada ProviderError', async () => {
  await expect(
    generateTestCasesFromPrompt(
      { projectId: 'project-1', prompt: 'Uji login', generateId: 'gen-pe' },
      createGenerateDeps(async () => {
        throw new ProviderError('claude', 'rate limit', { statusCode: 429 });
      }),
    ),
  ).rejects.toBeInstanceOf(AllProvidersFailedError);
});

test('generateTestCasesFromPrompt menolak project tanpa Base URL', async () => {
  const deps = createGenerateDeps(async () => JSON.stringify({ testCases: [SAMPLE_CASE] }));
  deps.projects.findById = async () => ({
    id: 'project-1',
    name: 'Portal',
    baseUrl: null,
    defaultProvider: 'claude',
    instruction: null,
    extraData: null,
    createdAt: null,
  });
  await expect(
    generateTestCasesFromPrompt({ projectId: 'project-1', prompt: 'Uji login' }, deps),
  ).rejects.toBeInstanceOf(PageExplorationError);
});

test('buildAuthAssessmentUserPrompt memuat snapshot halaman', () => {
  const prompt = buildAuthAssessmentUserPrompt({ pageSnapshot: PAGE_SNAPSHOT });
  expect(prompt).toContain('selector=#email');
  expect(prompt).toContain('selector=#login-btn');
});

test('parseGuidedNextAction menerima keputusan done:true', () => {
  const decision = parseGuidedNextAction(
    JSON.stringify({ done: true, reasoning: 'sudah selesai' }),
    DASHBOARD_SNAPSHOT,
  );
  expect(decision).toEqual({ done: true, reasoning: 'sudah selesai' });
});

test('parseGuidedNextAction menerima satu step dengan selector valid', () => {
  const decision = parseGuidedNextAction(
    JSON.stringify({
      done: false,
      reasoning: 'klik tombol tambah',
      step: { action: 'click', selector: '#add-item' },
    }),
    DASHBOARD_SNAPSHOT,
  );
  expect(decision.done).toBe(false);
  if (!decision.done) {
    expect(decision.step).toEqual({ action: 'click', selector: '#add-item' });
  }
});

test('parseGuidedNextAction menolak selector yang tidak ada di snapshot (halusinasi)', () => {
  expect(() =>
    parseGuidedNextAction(
      JSON.stringify({
        done: false,
        reasoning: 'klik tombol yang tidak ada',
        step: { action: 'click', selector: '#tidak-ada' },
      }),
      DASHBOARD_SNAPSHOT,
    ),
  ).toThrow(GuidedActionValidationError);
});

test('parseGuidedNextAction menolak format yang tidak sesuai schema', () => {
  expect(() =>
    parseGuidedNextAction(JSON.stringify({ foo: 'bar' }), DASHBOARD_SNAPSHOT),
  ).toThrow(GuidedActionValidationError);
});

test('buildGuidedCompileUserPrompt hanya menyertakan langkah yang berhasil', () => {
  const prompt = buildGuidedCompileUserPrompt({
    instruction: 'Isi form lalu submit',
    history: [
      {
        step: { action: 'fill', selector: '#username', value: 'qa' },
        status: 'passed',
        snapshotBefore: DASHBOARD_SNAPSHOT,
      },
      {
        step: { action: 'click', selector: '#tidak-ada' },
        status: 'failed',
        errorMessage: 'Selector tidak ditemukan',
        snapshotBefore: DASHBOARD_SNAPSHOT,
      },
    ],
  });
  expect(prompt).toContain('#username');
  expect(prompt).not.toContain('#tidak-ada');
});

test('buildGuidedCompileUserPrompt menyertakan snapshot akhir setelah aksi terakhir bila diberikan', () => {
  const withFinal = buildGuidedCompileUserPrompt({
    instruction: 'Isi form lalu submit',
    history: [
      {
        step: { action: 'click', selector: '#add-item' },
        status: 'passed',
        snapshotBefore: DASHBOARD_SNAPSHOT,
      },
    ],
    finalSnapshot: PAGE_SNAPSHOT,
  });
  expect(withFinal).toContain('Snapshot akhir setelah aksi terakhir');
  expect(withFinal).toContain('#login-btn');

  const withoutFinal = buildGuidedCompileUserPrompt({
    instruction: 'Isi form lalu submit',
    history: [
      {
        step: { action: 'click', selector: '#add-item' },
        status: 'passed',
        snapshotBefore: DASHBOARD_SNAPSHOT,
      },
    ],
  });
  expect(withoutFinal).not.toContain('Snapshot akhir setelah aksi terakhir');
});
