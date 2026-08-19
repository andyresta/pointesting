import { config, type ProviderName } from '../config/env';
import {
  AllProvidersFailedError,
  buildProviderOrder,
  mergeProviderConfigs,
} from '../analyzer/analyzer.service';
import { createLLMClient } from '../analyzer/provider-factory';
import { ProviderError } from '../analyzer/provider.error';
import type { CreateTestCaseBody } from '../api/schemas/testcase.schema';
import { projectProviderRepository } from '../db/repositories/project-provider.repository';
import { projectRepository } from '../db/repositories/project.repository';
import { testCaseRepository } from '../db/repositories/test-case.repository';
import type { Project, ProjectProviderSecret, TestCase } from '../db/repositories/types';
import { withSessionPage } from '../runner/run-session';
import { broadcastToRun } from '../ws/gateway';
import {
  describeProviderError,
  emitGenerateStatus,
  executeInstructionOnPage,
  handleAuthAtPage,
  withHeartbeat,
  type GenerateStatusFn,
  type MappingContext,
} from './generator.service';
import { PlaywrightExplorationDriver, type ExplorationDriver } from './exploration-driver';
import {
  collectPageSnapshot,
  navigateForExploration,
  PageExplorationError,
  type PageExplorationResult,
} from './page-explorer';
import {
  buildGuidedCompileSystemPrompt,
  buildGuidedCompileUserPrompt,
  buildGuidedNextActionSystemPrompt,
  buildGuidedNextActionUserPrompt,
  GuidedActionValidationError,
  parseGeneratedTestCases,
  parseGuidedNextAction,
  type ExistingTestCaseContext,
  type GuidedActionRecord,
  type GuidedNextActionDecision,
} from './prompt-generation';
import type { SiteModel } from './site-model';

/**
 * Keterangan: Batas jumlah aksi (klik/isi form/dst.) yang boleh dicoba AI
 * untuk satu prompt guided flow sebelum dianggap gagal — konsisten dengan
 * pola MAX_SITE_PAGES/MAX_INTERACTIONS_PER_PAGE di generator.service.ts:
 * eksplisit dan dilaporkan sebagai error, bukan diam-diam menyimpan hasil
 * parsial atau berputar tanpa henti.
 */
const MAX_GUIDED_STEPS = 25;
/** Kalau LLM 2x berturut-turut mengusulkan selector yang tidak ada di snapshot, hentikan lebih awal (lebih murah daripada menghabiskan seluruh kuota langkah). */
const MAX_CONSECUTIVE_INVALID_DECISIONS = 2;
const EFFECTIVE_ACTIONS = new Set(['fill', 'click', 'check', 'select']);

export class GuidedFlowBudgetExceededError extends Error {
  constructor(maxSteps: number) {
    super(
      `Batas ${maxSteps} langkah tercapai sebelum AI menyatakan selesai — alur belum tersimpan sebagai test case. Coba deskripsi yang lebih spesifik atau lebih singkat.`,
    );
    this.name = 'GuidedFlowBudgetExceededError';
  }
}

export class GuidedFlowAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuidedFlowAbortedError';
  }
}

/**
 * Keterangan: sessionId WAJIB — guided flow ini SELALU mengendalikan sesi
 * Playwright persisten yang sudah terbuka di panel "Live run" (kanan), BUKAN
 * membuka browser baru. Cookie/login sesi ikut kepakai karena page baru
 * dibuka di BrowserContext yang sama (lihat withSessionPage). `testCaseId`
 * opsional — kalau diisi, ini mode EDIT test case yang sudah ada (hasil
 * akhir meng-UPDATE baris itu, bukan membuat baru), dan test case lama
 * dipakai sebagai KONTEKS REFERENSI saja di prompt (tetap wajib re-run
 * browser sungguhan, tidak sekadar rewrite JSON tanpa verifikasi ulang).
 */
export interface GuidedGenerateInput {
  projectId: string;
  prompt: string;
  generateId: string;
  sessionId: string;
  testCaseId?: string;
}

export interface GuidedFlowDependencies {
  projects: { findById(id: string): Promise<Project | null> };
  loadProjectProviderSecrets(projectId: string): Promise<ProjectProviderSecret[]>;
  createClient: typeof createLLMClient;
  runInSessionPage: typeof withSessionPage;
  findTestCase(testCaseId: string): Promise<TestCase | null>;
  persistTestCase(item: CreateTestCaseBody & { projectId: string; source: string }): Promise<TestCase>;
  updateTestCase(
    testCaseId: string,
    item: CreateTestCaseBody & { source: string },
  ): Promise<TestCase | null>;
}

const defaultDependencies: GuidedFlowDependencies = {
  projects: projectRepository,
  loadProjectProviderSecrets: (projectId) =>
    projectProviderRepository.findSecretsByProjectId(projectId),
  createClient: createLLMClient,
  runInSessionPage: withSessionPage,
  findTestCase: (testCaseId) => testCaseRepository.findById(testCaseId),
  persistTestCase: (item) =>
    testCaseRepository.create({
      projectId: item.projectId,
      title: item.title,
      description: item.description?.trim() || null,
      steps: item.steps,
      expected: item.expected,
      source: item.source,
    }),
  updateTestCase: (testCaseId, item) =>
    testCaseRepository.update(testCaseId, {
      title: item.title,
      description: item.description?.trim() || null,
      steps: item.steps,
      expected: item.expected,
      source: item.source,
    }),
};

interface DecisionContext {
  providerOrder: ProviderName[];
  providerConfigs: ReturnType<typeof mergeProviderConfigs>;
  createClient: typeof createLLMClient;
  attempted: ProviderName[];
  emit: GenerateStatusFn;
  existingTestCase?: ExistingTestCaseContext;
}

/**
 * Keterangan: Satu panggilan LLM "aksi berikutnya" — snapshot kecil, SATU
 * keputusan, sesuai disiplin arsitektur guided flow (kode kita yang
 * mengendalikan loop, LLM cuma memutuskan satu langkah). Error validasi
 * (format salah/selector halusinasi) dilempar apa adanya ke caller supaya
 * bisa dicatat sebagai kegagalan sintetis di history — TIDAK dicoba ulang ke
 * provider lain di sini (masalahnya ada di konten keputusan, bukan koneksi).
 */
async function decideNextAction(
  params: {
    instruction: string;
    snapshot: PageExplorationResult;
    history: GuidedActionRecord[];
    remainingBudget: number;
  },
  ctx: DecisionContext,
): Promise<GuidedNextActionDecision> {
  const systemPrompt = buildGuidedNextActionSystemPrompt();
  const userPrompt = buildGuidedNextActionUserPrompt({
    ...params,
    existingTestCase: ctx.existingTestCase,
  });

  for (const providerName of ctx.providerOrder) {
    const providerConfig = ctx.providerConfigs[providerName];
    if (!providerConfig.apiKey || !providerConfig.defaultModel) {
      continue;
    }
    if (!ctx.attempted.includes(providerName)) {
      ctx.attempted.push(providerName);
    }
    let raw: string;
    try {
      const client = ctx.createClient(providerName, providerConfig.apiKey, providerConfig.defaultModel);
      raw = await withHeartbeat(client.complete(systemPrompt, [userPrompt]), () =>
        ctx.emit('decide', `AI (${providerName}) memutuskan langkah berikutnya…`),
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        ctx.emit(
          'decide',
          `Provider ${providerName} gagal (${describeProviderError(error)}), mencoba provider lain…`,
        );
        continue;
      }
      throw error;
    }
    return parseGuidedNextAction(raw, params.snapshot);
  }

  throw new AllProvidersFailedError(ctx.attempted);
}

/**
 * Keterangan: Satu panggilan LLM compile akhir — mengubah seluruh riwayat
 * aksi yang berhasil jadi SATU test case tersimpan lengkap dengan assertion.
 */
async function compileGuidedHistory(
  instruction: string,
  history: GuidedActionRecord[],
  finalSnapshot: PageExplorationResult,
  ctx: DecisionContext,
): Promise<{ provider: ProviderName; testCase: CreateTestCaseBody }> {
  const systemPrompt = buildGuidedCompileSystemPrompt();
  const userPrompt = buildGuidedCompileUserPrompt({
    instruction,
    history,
    finalSnapshot,
    existingTestCase: ctx.existingTestCase,
  });

  for (const providerName of ctx.providerOrder) {
    const providerConfig = ctx.providerConfigs[providerName];
    if (!providerConfig.apiKey || !providerConfig.defaultModel) {
      continue;
    }
    if (!ctx.attempted.includes(providerName)) {
      ctx.attempted.push(providerName);
    }
    try {
      const client = ctx.createClient(providerName, providerConfig.apiKey, providerConfig.defaultModel);
      const raw = await withHeartbeat(client.complete(systemPrompt, [userPrompt]), () =>
        ctx.emit('generate', `AI (${providerName}) menyusun test case akhir…`),
      );
      try {
        const [testCase] = parseGeneratedTestCases(raw);
        if (!testCase) {
          throw new Error('Output compile kosong');
        }
        return { provider: providerName, testCase };
      } catch {
        ctx.emit(
          'generate',
          `Output test case akhir dari ${providerName} tidak sesuai format, mencoba provider lain…`,
        );
        continue;
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        ctx.emit('generate', `Provider ${providerName} gagal (${describeProviderError(error)})…`);
        continue;
      }
      throw error;
    }
  }

  throw new AllProvidersFailedError(ctx.attempted);
}

/**
 * Keterangan: Guided single-flow generate — versi scoped dari
 * generateTestCasesFromPrompt untuk "Tambah Test Case via prompt AI": bukan
 * crawl seluruh situs, tapi satu alur spesifik yang dijelaskan bahasa
 * natural, dijalankan di DALAM sesi Playwright persisten yang sudah ada
 * (panel "Live run" kanan) lewat withSessionPage — bukan browser baru. Loop
 * utamanya SELALU: snapshot → satu keputusan LLM → satu eksekusi Playwright
 * → snapshot lagi (kode kita yang mengendalikan setiap langkah, bukan model
 * yang bernavigasi otonom).
 */
export async function generateGuidedTestCase(
  input: GuidedGenerateInput,
  dependencies: GuidedFlowDependencies = defaultDependencies,
): Promise<{ provider: ProviderName; testCase: TestCase }> {
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

  let existingTestCase: ExistingTestCaseContext | undefined;
  if (input.testCaseId) {
    const current = await dependencies.findTestCase(input.testCaseId);
    if (!current || current.projectId !== input.projectId) {
      throw new Error(`Test case "${input.testCaseId}" tidak ditemukan pada project ini`);
    }
    existingTestCase = {
      title: current.title,
      steps: current.steps,
      expected: current.expected,
    };
  }

  const emit: GenerateStatusFn = (phase, message) =>
    emitGenerateStatus(input.generateId, phase, message);

  const runPipeline = async (
    driver: ExplorationDriver,
  ): Promise<{ provider: ProviderName; testCase: TestCase }> => {
    const secrets = await dependencies.loadProjectProviderSecrets(input.projectId);
    const providerConfigs = mergeProviderConfigs(config.providers, secrets);
    const providerOrder = buildProviderOrder(
      project.defaultProvider,
      providerConfigs,
      secrets.map((secret) => secret.provider),
    );
    const attempted: ProviderName[] = [];
    const decisionCtx: DecisionContext = {
      providerOrder,
      providerConfigs,
      createClient: dependencies.createClient,
      attempted,
      emit,
      existingTestCase,
    };

    // Model minimal cuma untuk menampung authZones — handleAuthAtPage hanya
    // menyentuh authZones, tidak pernah menyentuh pages (guided flow tidak
    // membangun SiteModel penuh seperti crawl Fase A).
    const model: SiteModel = { pages: [], authZones: [] };
    const mappingCtx: MappingContext = {
      generateId: input.generateId,
      projectId: input.projectId,
      prompt: input.prompt,
      baseUrl,
      // Tidak ada input kredensial dari UI panel/modal guided-generate —
      // kalau sesi belum login, generate:need-input tetap dipause seperti
      // biasa lewat handleAuthAtPage di bawah.
      authPrefill: undefined,
      emit,
      providerOrder,
      providerConfigs,
      createClient: dependencies.createClient,
      attempted,
    };

    emit('open', 'AI membuka aplikasi di sesi browser yang sedang berjalan…');
    await navigateForExploration(driver, baseUrl);
    let snapshot = await collectPageSnapshot(driver);

    const initialAuth = await handleAuthAtPage(driver, snapshot, model, mappingCtx, true);
    if (initialAuth.gated) {
      throw new GuidedFlowAbortedError(
        'Halaman memerlukan login tapi input autentikasi dilewati/tidak lengkap — alur tidak bisa dilanjutkan.',
      );
    }
    snapshot = initialAuth.snapshot;

    const history: GuidedActionRecord[] = [];
    let hasEffectiveAction = false;
    let consecutiveInvalidDecisions = 0;
    let done = false;

    for (let stepIndex = 0; stepIndex < MAX_GUIDED_STEPS && !done; stepIndex += 1) {
      snapshot = await collectPageSnapshot(driver);

      const midAuth = await handleAuthAtPage(driver, snapshot, model, mappingCtx, false);
      if (midAuth.gated) {
        throw new GuidedFlowAbortedError(
          'Alur berhenti di halaman yang memerlukan login (session berakhir/gate baru) dan input autentikasi tidak tersedia.',
        );
      }
      snapshot = midAuth.snapshot;

      let decision: GuidedNextActionDecision;
      try {
        decision = await decideNextAction(
          {
            instruction: input.prompt,
            snapshot,
            history,
            remainingBudget: MAX_GUIDED_STEPS - stepIndex,
          },
          decisionCtx,
        );
      } catch (error) {
        if (error instanceof GuidedActionValidationError) {
          consecutiveInvalidDecisions += 1;
          history.push({
            step: error.attemptedStep,
            status: 'failed',
            errorMessage: error.message,
            snapshotBefore: snapshot,
          });
          if (consecutiveInvalidDecisions >= MAX_CONSECUTIVE_INVALID_DECISIONS) {
            throw new GuidedFlowAbortedError(
              `AI 2x berturut-turut mengusulkan langkah tidak valid (${error.message}) — alur dihentikan.`,
            );
          }
          continue;
        }
        throw error;
      }
      consecutiveInvalidDecisions = 0;

      if (decision.done) {
        if (!hasEffectiveAction) {
          // Guard "premature done": jangan percaya klaim selesai dari LLM
          // tanpa bukti struktural minimal satu aksi nyata sudah berhasil.
          history.push({
            status: 'failed',
            errorMessage:
              'AI menyatakan selesai padahal belum ada aksi nyata (fill/click/check/select) yang berhasil — instruksi belum terpenuhi',
            snapshotBefore: snapshot,
          });
          continue;
        }
        done = true;
        break;
      }

      emit('act', `AI sedang menyiapkan langkah: ${decision.reasoning ?? decision.step.action}…`);
      let stepStatus: 'passed' | 'failed' = 'passed';
      let stepError: string | null = null;
      try {
        await executeInstructionOnPage(driver, [decision.step], emit);
      } catch (error) {
        stepStatus = 'failed';
        stepError = error instanceof Error ? error.message : String(error);
      }
      history.push({
        step: decision.step,
        reasoning: decision.reasoning,
        status: stepStatus,
        errorMessage: stepError,
        snapshotBefore: snapshot,
      });
      if (stepStatus === 'passed' && EFFECTIVE_ACTIONS.has(decision.step.action)) {
        hasEffectiveAction = true;
      }
    }

    if (!done) {
      throw new GuidedFlowBudgetExceededError(MAX_GUIDED_STEPS);
    }

    emit('generate', 'AI sedang menyusun test case akhir…');
    const compiled = await compileGuidedHistory(input.prompt, history, snapshot, decisionCtx);

    // Keterangan: history TIDAK PERNAH mencatat navigasi awal (goto baseUrl
    // terjadi sebelum loop dimulai, di luar history) — kalau dibiarkan,
    // compile akhir sering lupa menyertakan goto sama sekali, membuat test
    // case gagal total saat dijalankan ulang dari halaman kosong (step
    // pertama langsung click/fill tanpa pernah membuka aplikasi). Ditambahkan
    // di kode (bukan diserahkan ke LLM) supaya SELALU benar, bukan
    // tergantung kepatuhan model pada instruksi prompt.
    const firstStep = compiled.testCase.steps[0];
    const alreadyStartsWithGoto =
      firstStep?.action === 'goto' && firstStep.url === baseUrl;
    const steps = alreadyStartsWithGoto
      ? compiled.testCase.steps
      : [{ action: 'goto' as const, url: baseUrl }, ...compiled.testCase.steps];

    emit('save', input.testCaseId ? 'AI sedang memperbarui test case…' : 'AI sedang menyimpan test case…');
    const testCase = input.testCaseId
      ? await dependencies.updateTestCase(input.testCaseId, {
          ...compiled.testCase,
          steps,
          source: 'ai_guided',
        })
      : await dependencies.persistTestCase({
          ...compiled.testCase,
          steps,
          projectId: input.projectId,
          source: 'ai_guided',
        });
    if (!testCase) {
      throw new Error(`Test case "${input.testCaseId}" gagal diperbarui (mungkin sudah dihapus)`);
    }

    emit('done', 'Test case siap.');
    broadcastToRun(input.generateId, {
      type: 'generate:done',
      runId: input.generateId,
      testCases: [{ id: testCase.id, title: testCase.title, description: testCase.description }],
    });

    return { provider: compiled.provider, testCase };
  };

  return dependencies.runInSessionPage(input.sessionId, async (page) => {
    const driver = new PlaywrightExplorationDriver(page);
    return runPipeline(driver);
  });
}
