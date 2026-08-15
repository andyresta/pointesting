import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getAllProviderModelCatalogs,
  getProviderModelCatalog,
} from '../../analyzer/model-catalog';
import type { ProviderName } from '../../config/env';
import { ApiError } from '../errors';

const modelCatalogBodySchema = z.object({
  provider: z
    .enum(['claude', 'openai', 'deepseek', 'kimi', 'opencode'])
    .optional(),
  forceRefresh: z.boolean().optional().default(false),
});

/**
 * Keterangan: Memvalidasi body endpoint katalog model. `provider` opsional;
 * tanpa provider, endpoint mengembalikan katalog kelima provider sekaligus.
 */
function parseModelCatalogBody(data: unknown): {
  provider?: ProviderName;
  forceRefresh: boolean;
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
      return getProviderModelCatalog(body.provider, body.forceRefresh);
    }

    return {
      providers: await getAllProviderModelCatalogs(body.forceRefresh),
    };
  });
}
