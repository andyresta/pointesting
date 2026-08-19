import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { enqueueGenerate } from '../../queue/queue';
import { projectRepository } from '../../db/repositories/project.repository';
import { skipAuthZone, submitAuthInput } from '../../generator/auth-input-prompt';
import { ApiError } from '../errors';

const authPrefillBodySchema = z.object({
  values: z.record(z.string(), z.string().min(1)).refine(
    (values) => Object.keys(values).length > 0,
    'Field "authPrefill.values" wajib berisi minimal 1 key',
  ),
});

/** Legacy alias — dinormalisasi ke authPrefill.values di route handler. */
const credentialsBodySchema = z.object({
  username: z.string().min(1, 'Field "credentials.username" wajib diisi'),
  password: z.string().min(1, 'Field "credentials.password" wajib diisi'),
  usernameSelectorHint: z.string().trim().optional().nullable(),
  passwordSelectorHint: z.string().trim().optional().nullable(),
});

const generatePromptBodySchema = z.object({
  prompt: z.string().trim().optional(),
  extraData: z.string().optional(),
  authPrefill: authPrefillBodySchema.optional().nullable(),
  credentials: credentialsBodySchema.optional().nullable(),
  replaceExisting: z.boolean().optional(),
});

const authInputBodySchema = z.object({
  zoneId: z.string().min(1, 'Field "zoneId" wajib diisi'),
  values: z.record(z.string(), z.string()),
  skip: z.boolean().optional(),
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

    let authPrefill = parsed.data.authPrefill ?? undefined;
    if (!authPrefill && parsed.data.credentials) {
      authPrefill = {
        values: {
          username: parsed.data.credentials.username,
          password: parsed.data.credentials.password,
        },
      };
    }

    const generateId = randomUUID();
    enqueueGenerate({
      generateId,
      projectId,
      prompt,
      extraData,
      authPrefill,
      replaceExisting: parsed.data.replaceExisting === true,
    });
    reply.status(202);
    return { generateId, status: 'queued' };
  });

  /**
   * Keterangan: Menerima input auth dinamis (key/value) atau skip zona saat
   * job generate pause menunggu user. Password hanya di memory — tidak di-log.
   */
  app.post('/projects/:id/generate/:generateId/auth-input', async (request) => {
    const { generateId } = request.params as { id: string; generateId: string };
    const parsed = authInputBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new ApiError(400, message);
    }

    if (parsed.data.skip) {
      const skipped = skipAuthZone(generateId, parsed.data.zoneId);
      if (!skipped) {
        throw new ApiError(404, 'Tidak ada job generate yang menunggu input untuk zona ini');
      }
      return { ok: true, action: 'skipped' };
    }

    const submitted = submitAuthInput(generateId, parsed.data.zoneId, parsed.data.values);
    if (!submitted) {
      throw new ApiError(404, 'Tidak ada job generate yang menunggu input untuk zona ini');
    }
    return { ok: true, action: 'submitted' };
  });
}
