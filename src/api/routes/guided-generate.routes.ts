import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { enqueueGuidedGenerate } from '../../queue/queue';
import { projectRepository } from '../../db/repositories/project.repository';
import { testCaseRepository } from '../../db/repositories/test-case.repository';
import { getRunSession, isRunSessionBusy } from '../../runner/run-session';
import { ApiError } from '../errors';

const generateGuidedBodySchema = z.object({
  prompt: z.string().trim().min(1, 'Field "prompt" wajib diisi'),
  sessionId: z.string().min(1, 'Field "sessionId" wajib diisi'),
  /** Kalau diisi: mode edit — AI menjalankan alur baru lalu meng-update test case ini (bukan membuat baru). */
  testCaseId: z.string().min(1).optional(),
});

/**
 * Keterangan: Endpoint "Tambah Test Case via prompt AI" — guided single-flow,
 * beda dari /generate/prompt (crawl seluruh situs): scope satu alur/satu
 * test case yang dideskripsikan bahasa natural, DIJALANKAN di dalam sesi
 * Playwright persisten yang sudah dibuka lewat POST /test-runs/session
 * (panel "Live run" kanan) — bukan browser baru. Validasi sesi mengikuti
 * pola yang sama seperti endpoint session lain (testrun.routes.ts): 404
 * kalau sesi tidak ada/beda project, 409 kalau sedang sibuk. Auth-input
 * pause memakai ulang endpoint /generate/:generateId/auth-input yang sudah
 * ada (generator.routes.ts) karena mekanismenya generic per generateId.
 */
export async function guidedGenerateRoutes(app: FastifyInstance): Promise<void> {
  app.post('/projects/:id/test-cases/generate-guided', async (request, reply) => {
    const { id: projectId } = request.params as { id: string };
    const parsed = generateGuidedBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new ApiError(400, message);
    }

    const project = await projectRepository.findById(projectId);
    if (!project) {
      throw new ApiError(404, `Project dengan id "${projectId}" tidak ditemukan`);
    }
    if (!project.baseUrl?.trim()) {
      throw new ApiError(
        400,
        'Base URL project wajib diisi supaya AI dapat menganalisis tampilan halaman',
      );
    }

    const { sessionId, testCaseId } = parsed.data;
    const session = getRunSession(sessionId);
    if (!session || session.projectId !== projectId) {
      throw new ApiError(404, `Sesi run "${sessionId}" tidak ditemukan`);
    }
    if (isRunSessionBusy(sessionId)) {
      throw new ApiError(409, 'Sesi masih sibuk — tunggu proses lain selesai');
    }

    if (testCaseId) {
      const existing = await testCaseRepository.findById(testCaseId);
      if (!existing || existing.projectId !== projectId) {
        throw new ApiError(404, `Test case dengan id "${testCaseId}" tidak ditemukan pada project ini`);
      }
    }

    const generateId = randomUUID();
    enqueueGuidedGenerate({
      generateId,
      projectId,
      prompt: parsed.data.prompt,
      sessionId,
      testCaseId,
    });
    reply.status(202);
    return { generateId, status: 'queued' };
  });
}
