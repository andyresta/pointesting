import { createHash } from 'node:crypto';
import { config, type ProviderName } from '../config/env';
import {
  AllProvidersFailedError,
  buildProviderOrder,
  mergeProviderConfigs,
} from '../analyzer/analyzer.service';
import type { LLMClient } from '../analyzer/llm-client.interface';
import { createLLMClient } from '../analyzer/provider-factory';
import { ProviderError } from '../analyzer/provider.error';
import type { CreateTestCaseBody, TestCaseStep } from '../api/schemas/testcase.schema';
import { withTransaction } from '../db/client';
import { projectProviderRepository } from '../db/repositories/project-provider.repository';
import { projectRepository } from '../db/repositories/project.repository';
import { testCaseRepository } from '../db/repositories/test-case.repository';
import type {
  Project,
  ProjectProviderSecret,
  TestCase,
  TestCaseCreateData,
} from '../db/repositories/types';
import { executeSteps } from '../runner/testcase-compiler';
import type { Step } from '../runner/types';
import { broadcastToRun } from '../ws/gateway';
import type { GenerateNeedInputEvent } from '../ws/events';
import {
  buildAuthInputFieldPrompts,
  clearAuthInputSession,
  waitForAuthInput,
} from './auth-input-prompt';
import type { ExplorationDriver } from './exploration-driver';
import { explorePageInteractions } from './interaction-explorer';
import {
  collectPageSnapshot,
  collectNavLinkCandidates,
  explorePage,
  navigateForExploration,
  navigateToNavLink,
  PageExplorationError,
  type NavLinkCandidate,
  type PageExplorationResult,
  withExploredPage,
} from './page-explorer';
import {
  buildAuthAssessmentSystemPrompt,
  buildAuthAssessmentUserPrompt,
  buildAuthoringSystemPrompt,
  buildAuthoringUserPrompt,
  parseAuthAssessment,
  parseGeneratedTestCases,
} from './prompt-generation';
import {
  applyPrefillToZone,
  AUTH_UNVERIFIED_TITLE_PREFIX,
  buildAuthStepsFromZone,
  buildAuthZoneFromHeuristic,
  buildStandaloneLoginTestCase,
  classifyPageKind,
  dedupeGeneratedTestCases,
  groupPagesForAuthoring,
  isAuthZoneComplete,
  looksLikeAuthWall,
  normalizeUrlForZone,
  type AuthZone,
  type SiteModel,
  type SitePage,
  validateAuthZoneAgainstSnapshot,
} from './site-model';

/** Prefill auth generik (key dinamis sesuai field form). */
export interface GenerateAuthPrefill {
  values: Record<string, string>;
}

/** @deprecated Alias legacy — dinormalisasi ke authPrefill.values */
export interface GenerateCredentials {
  username: string;
  password: string;
  usernameSelectorHint?: string | null;
  passwordSelectorHint?: string | null;
}

export interface GenerateFromPromptInput {
  projectId: string;
  prompt: string;
  extraData?: string;
  generateId?: string;
  authPrefill?: GenerateAuthPrefill | null;
  credentials?: GenerateCredentials | null;
  replaceExisting?: boolean;
}

export interface GenerateFromPromptResult {
  provider: ProviderName;
  testCases: TestCase[];
}

export type GenerateStatusFn = (phase: string, message: string) => void;

const MAX_SITE_PAGES = 20;
const MAX_INTERACTIONS_PER_PAGE = 10;
const AUTHORING_BATCH_SIZE = 1;
const HEARTBEAT_INTERVAL_MS = 20_000;
const CRAWL_NAV_TIMEOUT_MS = 10_000;

// Keterangan: Prioritisasi risk-based (Prioritas 5, audit QA generate) —
// kandidat link menu yang teksnya menunjukkan fitur bernilai tinggi
// (transaksi, data pelanggan/produk, form tambah/edit) dijelajahi LEBIH
// DULU daripada halaman informasional generik, supaya kalau kuota
// MAX_SITE_PAGES habis sebelum semua menu terjelajahi, yang terlewat adalah
// halaman bernilai rendah — bukan giliran acak sesuai urutan ditemukan.
const HIGH_VALUE_LINK_PATTERN =
  /transaksi|invoice|order|pesanan|pembayaran|payment|pelanggan|customer|pasien|patient|pegawai|karyawan|employee|produk|product|stok|inventory|penjualan|sales|pembelian|purchase|laporan|report|tambah|add|create|baru|new|edit|ubah|data|kendaraan|vehicle/i;
const LOW_VALUE_LINK_PATTERN =
  /bantuan|help|faq|tentang|about|kontak|contact|privasi|privacy|syarat|terms|tampilan|theme|bahasa|language/i;

/**
 * Keterangan: Skor kandidat link menu untuk urutan crawl — makin tinggi
 * makin diprioritaskan. Murni heuristik teks link (halaman belum
 * dikunjungi saat scoring ini dipakai, jadi belum tahu PageKind
 * sesungguhnya) — tetap lebih baik daripada urutan FIFO murni.
 */
export function scoreNavLinkCandidate(candidate: NavLinkCandidate): number {
  const text = candidate.text.trim();
  let score = 0;
  if (HIGH_VALUE_LINK_PATTERN.test(text)) {
    score += 5;
  }
  if (LOW_VALUE_LINK_PATTERN.test(text)) {
    score -= 3;
  }
  return score;
}

export interface LiveExplorationContext {
  driver: ExplorationDriver;
  emit: GenerateStatusFn;
  authPrefill?: Record<string, string>;
}

export interface GeneratorDependencies {
  projects: { findById(id: string): Promise<Project | null> };
  loadProjectProviderSecrets(
    projectId: string,
  ): Promise<ProjectProviderSecret[]>;
  listTestCases(filter: { projectId: string }): Promise<TestCase[]>;
  persistTestCases(
    projectId: string,
    items: TestCaseCreateData[],
    replaceExisting?: boolean,
  ): Promise<TestCase[]>;
  createClient: typeof createLLMClient;
  explorePage(targetUrl: string): Promise<PageExplorationResult>;
  runLiveExploration(
    targetUrl: string,
    generateId: string,
    onStatus: GenerateStatusFn,
    authPrefill: Record<string, string> | undefined,
    work: (context: LiveExplorationContext) => Promise<GenerateFromPromptResult>,
  ): Promise<GenerateFromPromptResult>;
  discoverSite?(
    driver: ExplorationDriver,
    baseUrl: string,
    ctx: MappingContext,
  ): Promise<SiteModel>;
}

export interface MappingContext {
  generateId: string;
  projectId: string;
  prompt: string;
  extraData?: string;
  baseUrl: string;
  authPrefill?: Record<string, string>;
  emit: GenerateStatusFn;
  providerOrder: ProviderName[];
  providerConfigs: ReturnType<typeof mergeProviderConfigs>;
  createClient: typeof createLLMClient;
  attempted: ProviderName[];
}

/**
 * Keterangan: Menormalisasi legacy credentials + authPrefill menjadi satu map values.
 */
export function resolveAuthPrefill(input: GenerateFromPromptInput): Record<string, string> | undefined {
  if (input.authPrefill?.values && Object.keys(input.authPrefill.values).length > 0) {
    return input.authPrefill.values;
  }
  if (input.credentials) {
    const values: Record<string, string> = {
      username: input.credentials.username,
      password: input.credentials.password,
    };
    if (input.credentials.usernameSelectorHint) {
      values.username = input.credentials.username;
    }
    return values;
  }
  return undefined;
}

/**
 * Keterangan: Menyimpan hasil generate dalam satu transaction.
 */
async function persistGeneratedTestCases(
  projectId: string,
  items: TestCaseCreateData[],
  replaceExisting = false,
): Promise<TestCase[]> {
  return withTransaction(async (client) => {
    if (replaceExisting) {
      await testCaseRepository.deleteAllByProjectId(projectId, client);
    }
    const created: TestCase[] = [];
    for (const item of items) {
      created.push(await testCaseRepository.create(item, client));
    }
    return created;
  });
}

export function describeProviderError(error: ProviderError): string {
  return error.message.replace(/^\[[^\]]+\]\s*/, '');
}

export async function withHeartbeat<T>(promise: Promise<T>, onTick: () => void): Promise<T> {
  const timer = setInterval(onTick, HEARTBEAT_INTERVAL_MS);
  try {
    return await promise;
  } finally {
    clearInterval(timer);
  }
}

export function describeInstructionStep(step: TestCaseStep): string {
  switch (step.action) {
    case 'fill':
      return `AI sedang mengisi ${step.selector}…`;
    case 'click':
      return `AI sedang klik ${step.selector}…`;
    case 'check':
      return `AI sedang mencentang ${step.selector}…`;
    case 'select':
      return `AI sedang memilih opsi pada ${step.selector}…`;
    case 'waitFor':
      return `AI menunggu ${step.selector}…`;
    case 'goto':
      return `AI membuka ${step.url}…`;
    case 'assertVisible':
      return `AI memverifikasi ${step.selector} terlihat…`;
    case 'assertHidden':
      return `AI memverifikasi ${step.selector} tersembunyi…`;
    case 'assertChecked':
      return `AI memverifikasi ${step.selector} tercentang…`;
    case 'assertText':
      return `AI memverifikasi teks pada ${step.selector}…`;
    case 'assertValue':
      return `AI memverifikasi nilai pada ${step.selector}…`;
    case 'assertCount':
      return `AI memverifikasi jumlah elemen ${step.selector}…`;
    case 'assertUrl':
      return `AI memverifikasi alamat halaman…`;
  }
}

export async function executeInstructionOnPage(
  driver: ExplorationDriver,
  steps: TestCaseStep[],
  onStatus: GenerateStatusFn,
): Promise<void> {
  if (steps.length === 0) {
    return;
  }
  onStatus('act', 'AI sedang mengisi form…');
  await executeSteps(driver.asPageDriver(), steps as Step[], async (result) => {
    const step = steps[result.index];
    if (step && result.status === 'passed') {
      onStatus('act', describeInstructionStep(step));
    }
  });
  await driver.waitForIdle(5_000);
}

/**
 * Keterangan: Navigasi ke kandidat menu (goto href nyata, fallback klik).
 */
async function navigateToLink(driver: ExplorationDriver, candidate: NavLinkCandidate): Promise<void> {
  await navigateToNavLink(driver, candidate);
}

export function emitGenerateStatus(
  generateId: string | undefined,
  phase: string,
  message: string,
): void {
  if (!generateId) {
    return;
  }
  broadcastToRun(generateId, {
    type: 'generate:status',
    runId: generateId,
    phase,
    message,
  });
}

export function emitNeedAuthInput(generateId: string, zone: AuthZone, snapshot: PageExplorationResult): void {
  const event: GenerateNeedInputEvent = {
    type: 'generate:need-input',
    runId: generateId,
    zoneId: zone.zoneId,
    pageUrl: snapshot.url,
    pageTitle: snapshot.title,
    message: 'Halaman ini memerlukan input autentikasi untuk melanjutkan eksplorasi.',
    fields: buildAuthInputFieldPrompts(zone),
    allowSkip: true,
  };
  broadcastToRun(generateId, event);
}

/**
 * Keterangan: Memanggil LLM auth assessment dengan fallback provider + heuristik.
 */
export async function assessAuthZone(
  snapshot: PageExplorationResult,
  ctx: MappingContext,
): Promise<AuthZone | null> {
  if (!looksLikeAuthWall(snapshot)) {
    return null;
  }

  for (const providerName of ctx.providerOrder) {
    const providerConfig = ctx.providerConfigs[providerName];
    if (!providerConfig.apiKey || !providerConfig.defaultModel) {
      continue;
    }
    if (!ctx.attempted.includes(providerName)) {
      ctx.attempted.push(providerName);
    }
    try {
      const client: LLMClient = ctx.createClient(
        providerName,
        providerConfig.apiKey,
        providerConfig.defaultModel,
      );
      const raw = await withHeartbeat(
        client.complete(buildAuthAssessmentSystemPrompt(), [
          buildAuthAssessmentUserPrompt({ pageSnapshot: snapshot }),
        ]),
        () => ctx.emit('analyze', `AI (${providerName}) menilai auth wall…`),
      );
      const result = parseAuthAssessment(raw, snapshot);
      if (result.isAuthWall && result.zone) {
        return validateAuthZoneAgainstSnapshot(result.zone, snapshot);
      }
      if (!result.isAuthWall) {
        return null;
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        continue;
      }
      break;
    }
  }

  return buildAuthZoneFromHeuristic(snapshot);
}

/**
 * Keterangan: Menangani auth wall di halaman saat ini — pause input user bila
 * perlu, eksekusi login, update SiteModel.authZones.
 */
export async function handleAuthAtPage(
  driver: ExplorationDriver,
  snapshot: PageExplorationResult,
  model: SiteModel,
  ctx: MappingContext,
  allowPrefill: boolean,
): Promise<{ snapshot: PageExplorationResult; gated: boolean; authZoneId?: string }> {
  const zoneCandidate = await assessAuthZone(snapshot, ctx);
  if (!zoneCandidate) {
    return { snapshot, gated: false };
  }

  let zone = model.authZones.find((item) => item.zoneId === zoneCandidate.zoneId) ?? zoneCandidate;
  if (!model.authZones.some((item) => item.zoneId === zone.zoneId)) {
    model.authZones.push(zone);
  }

  if (zone.status === 'authenticated') {
    return { snapshot, gated: false, authZoneId: zone.zoneId };
  }
  if (zone.status === 'skipped') {
    return { snapshot, gated: true, authZoneId: zone.zoneId };
  }

  if (allowPrefill && ctx.authPrefill) {
    zone = applyPrefillToZone(zone, ctx.authPrefill);
    updateZoneInModel(model, zone);
  }

  if (!isAuthZoneComplete(zone)) {
    ctx.emit('auth', `Menunggu input autentikasi untuk "${snapshot.title}"…`);
    emitNeedAuthInput(ctx.generateId, zone, snapshot);
    const resolution = await waitForAuthInput(ctx.generateId, zone);
    if (resolution.type === 'skipped') {
      zone = { ...zone, status: 'skipped' };
      updateZoneInModel(model, zone);
      return { snapshot, gated: true, authZoneId: zone.zoneId };
    }
    zone = { ...zone, values: resolution.values, status: 'pending' };
    updateZoneInModel(model, zone);
  }

  if (!isAuthZoneComplete(zone)) {
    zone = { ...zone, status: 'skipped' };
    updateZoneInModel(model, zone);
    return { snapshot, gated: true, authZoneId: zone.zoneId };
  }

  ctx.emit('act', `AI sedang login di "${snapshot.title}"…`);
  const steps = buildAuthStepsFromZone(zone, { skipGoto: true });
  await executeInstructionOnPage(driver, steps, ctx.emit);
  zone = { ...zone, status: 'authenticated' };
  updateZoneInModel(model, zone);

  const afterLogin = await collectPageSnapshot(driver);
  return { snapshot: afterLogin, gated: false, authZoneId: zone.zoneId };
}

export function updateZoneInModel(model: SiteModel, zone: AuthZone): void {
  const index = model.authZones.findIndex((item) => item.zoneId === zone.zoneId);
  if (index >= 0) {
    model.authZones[index] = zone;
  } else {
    model.authZones.push(zone);
  }
}

/**
 * Keterangan: Fase A — crawl rekursif BFS dengan auth assessment berulang
 * di setiap halaman baru (multi-zona login).
 */
async function discoverSite(
  driver: ExplorationDriver,
  baseUrl: string,
  ctx: MappingContext,
): Promise<SiteModel> {
  const model: SiteModel = { pages: [], authZones: [] };
  const visited = new Set<string>();
  const interactionVisited = new Set<string>();
  const queue: NavLinkCandidate[] = [];
  let prefillAvailable = Boolean(ctx.authPrefill && Object.keys(ctx.authPrefill).length > 0);

  const registerPage = async (): Promise<void> => {
    let snapshot = await collectPageSnapshot(driver);
    const urlKey = normalizeUrlForZone(snapshot.url);
    if (visited.has(urlKey)) {
      return;
    }
    visited.add(urlKey);

    const authResult = await handleAuthAtPage(
      driver,
      snapshot,
      model,
      ctx,
      prefillAvailable,
    );
    prefillAvailable = false;
    snapshot = authResult.snapshot;

    model.pages.push({
      snapshot,
      kind: classifyPageKind(snapshot),
      gated: authResult.gated,
      authZoneId: authResult.authZoneId,
    });

    if (authResult.gated) {
      return;
    }

    await explorePageInteractions(driver, snapshot, model, interactionVisited, {
      emit: ctx.emit,
      canRegisterMorePages: () => model.pages.length < MAX_SITE_PAGES,
      handleAuthOverlay: async (overlaySnapshot) => {
        const overlayAuth = await handleAuthAtPage(driver, overlaySnapshot, model, ctx, false);
        if (overlayAuth.gated) {
          return 'gated';
        }
        const zone = model.authZones.find((item) => item.zoneId === overlayAuth.authZoneId);
        if (zone?.status === 'authenticated') {
          return 'handled';
        }
        return 'none';
      },
    }, MAX_INTERACTIONS_PER_PAGE);

    const navLinks = await collectNavLinkCandidates(driver, snapshot, MAX_SITE_PAGES);
    let addedNew = false;
    for (const link of navLinks) {
      const linkKey = normalizeUrlForZone(link.href);
      if (!visited.has(linkKey) && !queue.some((item) => normalizeUrlForZone(item.href) === linkKey)) {
        queue.push(link);
        addedNew = true;
      }
    }
    if (addedNew) {
      // Prioritisasi risk-based: urutkan ulang seluruh antrian (bukan cuma
      // yang baru ditambah) supaya kandidat bernilai tinggi yang baru
      // ditemukan tetap didahulukan dari kandidat lama bernilai rendah yang
      // belum diproses. Array kecil (dibatasi MAX_SITE_PAGES), sort ulang
      // murah.
      queue.sort((a, b) => scoreNavLinkCandidate(b) - scoreNavLinkCandidate(a));
    }
  };

  ctx.emit('open', 'AI sedang membuka aplikasi…');
  await navigateForExploration(driver, baseUrl);
  ctx.emit('analyze', 'AI sedang memetakan situs (Fase A)…');
  await registerPage();

  while (queue.length > 0 && model.pages.length < MAX_SITE_PAGES) {
    const candidate = queue.shift()!;
    const linkKey = normalizeUrlForZone(candidate.href);
    if (visited.has(linkKey)) {
      continue;
    }
    ctx.emit('crawl', `AI sedang menjelajahi "${candidate.text}"…`);
    try {
      await navigateToLink(driver, candidate);
      await driver.waitForIdle(4_000);
      await registerPage();
    } catch {
      continue;
    }
  }

  // Laporan cakupan yang terlewat (Prioritas 5) — kalau kuota MAX_SITE_PAGES
  // tercapai sebelum antrian kosong, JANGAN diam-diam berhenti: user wajib
  // tahu halaman mana yang tidak sempat dijelajahi, supaya tidak menyangka
  // seluruh situs sudah tercover.
  const skippedPages = queue.filter(
    (candidate) => !visited.has(normalizeUrlForZone(candidate.href)),
  );
  if (skippedPages.length > 0) {
    const skippedTitles = skippedPages.map((item) => item.text).join(', ');
    ctx.emit(
      'coverage',
      `Kuota halaman (${MAX_SITE_PAGES}) tercapai — ${skippedPages.length} halaman BELUM dijelajahi: ${skippedTitles}. Cakupan test case yang di-generate tidak mencakup halaman ini.`,
    );
  }

  const pageTitles = model.pages.map((item) => item.snapshot.title).join(', ');
  ctx.emit(
    'map-done',
    `Peta situs selesai — ${model.pages.length} halaman: ${pageTitles || '(kosong)'}${
      skippedPages.length > 0 ? ` (${skippedPages.length} halaman lain terlewat karena kuota)` : ''
    }`,
  );

  return model;
}

/**
 * Keterangan: Fase B — authoring test case dari SiteModel via LLM batch per kind.
 */
async function authorFromSiteModel(
  input: GenerateFromPromptInput,
  model: SiteModel,
  ctx: MappingContext,
  existingTitles: string[],
): Promise<{ provider: ProviderName; parsed: CreateTestCaseBody[] }> {
  const batches = groupPagesForAuthoring(model, AUTHORING_BATCH_SIZE);
  const eligibleCount = model.pages.filter((page) => !page.gated && page.kind !== 'auth').length;

  if (eligibleCount === 0) {
    return {
      provider: ctx.attempted[0] ?? ctx.providerOrder[0] ?? 'claude',
      parsed: [],
    };
  }

  const authenticatedZones = model.authZones.filter((zone) => zone.status === 'authenticated');
  const allParsed: CreateTestCaseBody[] = [];
  let primaryProvider: ProviderName | null = null;
  const knownTitles = [...existingTitles];

  const runBatch = async (
    batchSitePages: SitePage[],
    label: string,
  ): Promise<{ provider: ProviderName; testCases: CreateTestCaseBody[] } | null> => {
    const userPrompt = buildAuthoringUserPrompt({
      prompt: input.prompt,
      extraData: input.extraData,
      baseUrl: ctx.baseUrl,
      siteModel: model,
      batchSitePages,
      existingTitles: knownTitles,
    });
    const systemPrompt = buildAuthoringSystemPrompt();

    for (const providerName of ctx.providerOrder) {
      const providerConfig = ctx.providerConfigs[providerName];
      if (!providerConfig.apiKey || !providerConfig.defaultModel) {
        continue;
      }
      if (!ctx.attempted.includes(providerName)) {
        ctx.attempted.push(providerName);
      }
      try {
        const client = ctx.createClient(
          providerName,
          providerConfig.apiKey,
          providerConfig.defaultModel,
        );
        const raw = await withHeartbeat(client.complete(systemPrompt, [userPrompt]), () =>
          ctx.emit('generate', `AI (${providerName}) authoring ${label}…`),
        );
        try {
          return { provider: providerName, testCases: parseGeneratedTestCases(raw) };
        } catch {
          ctx.emit(
            'generate',
            `Output test case dari ${providerName} (${label}) tidak sesuai format, mencoba provider lain…`,
          );
          continue;
        }
      } catch (error) {
        if (error instanceof ProviderError) {
          ctx.emit(
            'generate',
            `Provider ${providerName} gagal (${describeProviderError(error)}) untuk ${label}…`,
          );
          continue;
        }
        throw error;
      }
    }
    return null;
  };

  if (batches.length === 0) {
    const fallbackPages = model.pages.filter((page) => !page.gated).slice(0, 1);
    if (fallbackPages.length > 0) {
      batches.push(fallbackPages);
    }
  }

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const batchLabel =
      batch.length === 1
        ? batch[0]?.interactionContext ||
          batch[0]?.snapshot.title ||
          batch[0]?.snapshot.url ||
          `batch ${index + 1}`
        : `batch ${index + 1}`;
    ctx.emit('generate', `AI authoring halaman "${batchLabel}" (${index + 1}/${batches.length})…`);
    const result = await runBatch(batch, batchLabel);
    if (!result) {
      ctx.emit('generate', `Batch ${index + 1} gagal di semua provider, dilewati.`);
      continue;
    }
    if (!primaryProvider) {
      primaryProvider = result.provider;
    }
    allParsed.push(...result.testCases);
    knownTitles.push(...result.testCases.map((item) => item.title));
  }

  if (!primaryProvider) {
    throw new AllProvidersFailedError(ctx.attempted);
  }

  const deduped = dedupeGeneratedTestCases(allParsed);
  const loginCase = buildStandaloneLoginTestCase(authenticatedZones);
  if (loginCase) {
    const loginDuplicate = deduped.some(
      (item) => item.title.trim().toLowerCase() === loginCase.title.trim().toLowerCase(),
    );
    if (!loginDuplicate) {
      deduped.unshift(loginCase);
    }
  }

  return { provider: primaryProvider, parsed: deduped };
}

const LIVE_VIEW_POLL_INTERVAL_MS = 400;

/**
 * Keterangan: Live view generate diganti dari CDP screencast (push, khusus
 * Playwright — tidak tersedia di balik MCP) menjadi polling
 * `driver.screenshot()` berkala, dibroadcast sebagai event `run:frame` yang
 * sama seperti sebelumnya (kontrak WS tidak berubah, dashboard tidak perlu
 * diubah). Interval 400ms adalah kompromi antara kelancaran live view dan
 * jumlah round-trip MCP — jauh lebih jarang dari frame CDP asli (yang bisa
 * puluhan fps), tapi cukup untuk menonton AI menjelajah.
 */
export function startScreenshotPolling(driver: ExplorationDriver, runId: string): () => void {
  let stopped = false;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      const shot = await driver.screenshot().catch(() => null);
      if (shot && !stopped) {
        broadcastToRun(runId, {
          type: 'run:frame',
          runId,
          frame: shot.data,
          timestamp: new Date().toISOString(),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, LIVE_VIEW_POLL_INTERVAL_MS));
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}

export async function defaultRunLiveExploration(
  targetUrl: string,
  generateId: string,
  onStatus: GenerateStatusFn,
  authPrefill: Record<string, string> | undefined,
  work: (context: LiveExplorationContext) => Promise<GenerateFromPromptResult>,
): Promise<GenerateFromPromptResult> {
  return withExploredPage(targetUrl, async (driver) => {
    const stopPolling = startScreenshotPolling(driver, generateId);
    try {
      return await work({ driver, emit: onStatus, authPrefill });
    } finally {
      stopPolling();
      clearAuthInputSession(generateId);
    }
  });
}

const defaultDependencies: GeneratorDependencies = {
  projects: projectRepository,
  loadProjectProviderSecrets: (projectId) =>
    projectProviderRepository.findSecretsByProjectId(projectId),
  listTestCases: (filter) => testCaseRepository.findAll(filter),
  persistTestCases: persistGeneratedTestCases,
  createClient: createLLMClient,
  explorePage,
  runLiveExploration: defaultRunLiveExploration,
};

/**
 * Keterangan: Orkestrasi Map-then-Author — pemetaan situs rekursif multi-zona
 * auth, lalu authoring test case dari SiteModel lengkap.
 */
export async function generateTestCasesFromPrompt(
  input: GenerateFromPromptInput,
  dependencies: GeneratorDependencies = defaultDependencies,
): Promise<GenerateFromPromptResult> {
  const project = await dependencies.projects.findById(input.projectId);
  if (!project) {
    throw new Error(`Project "${input.projectId}" tidak ditemukan`);
  }
  if (!project.baseUrl?.trim()) {
    throw new PageExplorationError(
      'Base URL project wajib diisi supaya AI dapat menganalisis tampilan halaman',
      400,
    );
  }
  const baseUrl = project.baseUrl;
  const authPrefill = resolveAuthPrefill(input);
  const generateId = input.generateId ?? createHash('sha256').update(`${Date.now()}`).digest('hex').slice(0, 12);

  const emit: GenerateStatusFn = (phase, message) =>
    emitGenerateStatus(input.generateId, phase, message);

  const runPipeline = async (live: LiveExplorationContext): Promise<GenerateFromPromptResult> => {
    const secrets = await dependencies.loadProjectProviderSecrets(input.projectId);
    const providerConfigs = mergeProviderConfigs(config.providers, secrets);
    const providerOrder = buildProviderOrder(
      project.defaultProvider,
      providerConfigs,
      secrets.map((secret) => secret.provider),
    );
    const attempted: ProviderName[] = [];
    const existing = await dependencies.listTestCases({ projectId: input.projectId });
    const existingTitles = input.replaceExisting
      ? []
      : existing.map((item) => item.title);

    const mappingCtx: MappingContext = {
      generateId: input.generateId ?? generateId,
      projectId: input.projectId,
      prompt: input.prompt,
      extraData: input.extraData,
      baseUrl,
      authPrefill: live.authPrefill,
      emit,
      providerOrder,
      providerConfigs,
      createClient: dependencies.createClient,
      attempted,
    };

    const siteModel = dependencies.discoverSite
      ? await dependencies.discoverSite(live.driver, baseUrl, mappingCtx)
      : await discoverSite(live.driver, baseUrl, mappingCtx);
    const authored = await authorFromSiteModel(input, siteModel, mappingCtx, existingTitles);

    let parsed = authored.parsed;
    if (parsed.length === 0 && siteModel.pages.every((page) => page.gated)) {
      parsed = [
        {
          title: `${AUTH_UNVERIFIED_TITLE_PREFIX}${baseUrl}`,
          description:
            'Semua area aplikasi memerlukan autentikasi yang belum dapat diisi saat eksplorasi.',
          steps: [{ action: 'goto', url: baseUrl }],
          expected: [
            'Halaman menolak akses tanpa login yang valid (redirect ke halaman login / auth wall tetap tampil)',
          ],
        },
      ];
    }

    if (parsed.length === 0) {
      throw new AllProvidersFailedError(attempted);
    }

    emit('save', 'AI sedang menyimpan test case…');
    const source =
      parsed.length === 1 && parsed[0]?.title.startsWith(AUTH_UNVERIFIED_TITLE_PREFIX)
        ? 'ai_url_exploration'
        : 'ai_prompt';

    const testCases = await dependencies.persistTestCases(
      input.projectId,
      parsed.map((item) => ({
        projectId: input.projectId,
        title: item.title,
        description: item.description?.trim() || null,
        steps: item.steps,
        expected: item.expected,
        source,
      })),
      input.replaceExisting === true,
    );

    emit('done', 'Test case siap.');
    if (input.generateId) {
      broadcastToRun(input.generateId, {
        type: 'generate:done',
        runId: input.generateId,
        testCases: testCases.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
        })),
      });
    }

    return { provider: authored.provider, testCases };
  };

  if (input.generateId) {
    return dependencies.runLiveExploration(
      baseUrl,
      input.generateId,
      emit,
      authPrefill,
      runPipeline,
    );
  }

  return withExploredPage(baseUrl, async (driver) => {
    await navigateForExploration(driver, baseUrl);
    try {
      return await runPipeline({ driver, emit, authPrefill });
    } finally {
      clearAuthInputSession(generateId);
    }
  });
}
