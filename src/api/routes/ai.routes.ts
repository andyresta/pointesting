import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getAllProviderModelCatalogs,
  getProviderModelCatalog,
} from '../../analyzer/model-catalog';
import { PROVIDER_NAMES, type ProviderName } from '../../config/env';
import { projectProviderRepository } from '../../db/repositories/project-provider.repository';
import { ApiError } from '../errors';

const modelCatalogBodySchema = z.object({
  provider: z.enum(PROVIDER_NAMES).optional(),
  forceRefresh: z.boolean().optional().default(false),
  apiKey: z.string().optional(),
  projectId: z.string().uuid().optional(),
});

/**
 * Keterangan: Memvalidasi body endpoint katalog model. `provider` opsional;
 * tanpa provider, endpoint mengembalikan katalog semua provider sekaligus.
 */
function parseModelCatalogBody(data: unknown): {
  provider?: ProviderName;
  forceRefresh: boolean;
  apiKey?: string;
  projectId?: string;
} {
  const parsed = modelCatalogBodySchema.safeParse(data ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ApiError(400, message);
  }

  return parsed.data;
}

/**
 * Keterangan: Mendaftarkan endpoint POST /ai/models untuk pilihan model UI.
 * API key tetap berada di backend; UI hanya menerima ID model, default model,
 * status konfigurasi, dan sumber data (provider atau fallback env).
 */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ai/models', async (request) => {
    const body = parseModelCatalogBody(request.body);

    if (body.provider) {
      let apiKey = body.apiKey?.trim();
      if (!apiKey && body.projectId) {
        const secrets = await projectProviderRepository.findSecretsByProjectId(
          body.projectId,
        );
        apiKey = secrets.find((secret) => secret.provider === body.provider)?.apiKey;
      }
      return getProviderModelCatalog(
        body.provider,
        body.forceRefresh,
        apiKey,
      );
    }

    return {
      providers: await getAllProviderModelCatalogs(body.forceRefresh),
    };
  });
}
