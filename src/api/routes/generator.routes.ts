import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { enqueueGenerate } from '../../queue/queue';
import { projectRepository } from '../../db/repositories/project.repository';
import { ApiError } from '../errors';

const generatePromptBodySchema = z.object({
  prompt: z.string().trim().optional(),
  extraData: z.string().optional(),
});

const saveInstructionBodySchema = z.object({
  prompt: z.string().trim().min(1, 'Field "prompt" wajib diisi'),
  extraData: z.string().optional(),
});

/**
 * Keterangan: Menyimpan instruction project dan mengantrekan generate dari
 * instruction tersimpan (bukan dari modal).
 */
export async function generatorRoutes(app: FastifyInstance): Promise<void> {
  app.post('/projects/:id/instruction', async (request) => {
    const { id: projectId } = request.params as { id: string };
    const parsed = saveInstructionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new ApiError(400, message);
    }

    const extraData = parsed.data.extraData?.trim() || null;
    const updated = await projectRepository.update(projectId, {
      instruction: parsed.data.prompt,
      extraData,
    });
    if (!updated) {
      throw new ApiError(404, `Project dengan id "${projectId}" tidak ditemukan`);
    }

    return {
      instruction: updated.instruction,
      extraData: updated.extraData,
    };
  });

  app.post('/projects/:id/generate/prompt', async (request, reply) => {
    const { id: projectId } = request.params as { id: string };
    const parsed = generatePromptBodySchema.safeParse(request.body ?? {});
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

    const prompt = parsed.data.prompt?.trim() || project.instruction?.trim() || '';
    if (!prompt) {
      throw new ApiError(
        400,
        'Instruction project masih kosong. Simpan Instruction terlebih dahulu.',
      );
    }
    const extraData =
      parsed.data.extraData?.trim() || project.extraData?.trim() || undefined;

    const generateId = randomUUID();
    enqueueGenerate({
      generateId,
      projectId,
      prompt,
      extraData,
    });
    reply.status(202);
    return { generateId, status: 'queued' };
  });
}
