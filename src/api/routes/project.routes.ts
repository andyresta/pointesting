import type { FastifyInstance } from 'fastify';
import { PROVIDER_NAMES, type ProviderName } from '../../config/env';
import { withTransaction } from '../../db/client';
import { projectProviderRepository } from '../../db/repositories/project-provider.repository';
import { projectRepository } from '../../db/repositories/project.repository';
import type { Project } from '../../db/repositories/types';
import { ApiError } from '../errors';

interface ProjectBody {
  name?: unknown;
  baseUrl?: unknown;
  defaultProvider?: unknown;
  providers?: unknown;
}

interface ParsedProviderEntry {
  provider: ProviderName;
  apiKey?: string;
  defaultModel?: string | null;
}

/**
 * Keterangan: Memvalidasi defaultProvider terhadap daftar provider yang
 * dikenali aplikasi, termasuk OpenCode Zen (`opencode`) dan OpenCode Go.
 */
function parseDefaultProvider(value: unknown): ProviderName | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !PROVIDER_NAMES.includes(value as ProviderName)) {
    throw new ApiError(
      400,
      `Field "defaultProvider" tidak valid. Pilihan: ${PROVIDER_NAMES.join(', ')}`,
    );
  }
  return value as ProviderName;
}

/**
 * Keterangan: Memvalidasi array providers dari body create/edit project.
 * API key kosong pada edit berarti pertahankan key lama, bukan hapus.
 */
function parseProviderEntries(value: unknown): ParsedProviderEntry[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'Field "providers" wajib berupa array');
  }

  const seen = new Set<ProviderName>();
  const entries: ParsedProviderEntry[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') {
      throw new ApiError(400, `providers.${index} tidak valid`);
    }
    const row = item as Record<string, unknown>;
    const provider = parseDefaultProvider(row.provider);
    if (!provider) {
      throw new ApiError(400, `providers.${index}.provider wajib diisi`);
    }
    if (seen.has(provider)) {
      throw new ApiError(400, `Provider "${provider}" duplikat pada daftar API key`);
    }
    seen.add(provider);
    const apiKey = typeof row.apiKey === 'string' ? row.apiKey.trim() : undefined;
    const defaultModel =
      typeof row.defaultModel === 'string' ? row.defaultModel.trim() || null : undefined;
    entries.push({
      provider,
      ...(apiKey ? { apiKey } : {}),
      ...(defaultModel !== undefined ? { defaultModel } : {}),
    });
  }
  return entries;
}

/**
 * Keterangan: Membungkus project dengan daftar provider publik (key ter-mask)
 * supaya UI bisa edit tanpa pernah menerima API key utuh.
 */
async function withPublicProviders(project: Project) {
  return {
    ...project,
    providers: await projectProviderRepository.findPublicByProjectId(project.id),
  };
}

/**
 * Keterangan: Mendaftarkan route resource project — POST /projects (buat),
 * GET /projects/:id (detail), PATCH /projects/:id (edit), dan
 * POST /projects/:id/delete (hapus dari dashboard).
 */
export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.post('/projects', async (request, reply) => {
    const body = request.body as ProjectBody | undefined;

    if (typeof body?.name !== 'string' || body.name.trim() === '') {
      throw new ApiError(400, 'Field "name" wajib diisi (string)');
    }

    const defaultProvider = parseDefaultProvider(body.defaultProvider) ?? 'claude';
    const providers = parseProviderEntries(body.providers) ?? [];
    const defaultEntry = providers.find((entry) => entry.provider === defaultProvider);
    if (!defaultEntry?.apiKey) {
      throw new ApiError(
        400,
        `API key untuk provider default "${defaultProvider}" wajib diisi`,
      );
    }

    const project = await withTransaction(async (client) => {
      const created = await projectRepository.create(
        {
          name: body.name as string,
          baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : null,
          defaultProvider,
        },
        client,
      );
      await projectProviderRepository.replaceForProject(
        created.id,
        providers,
        client,
      );
      return created;
    });

    reply.status(201);
    return withPublicProviders(project);
  });

  app.get('/projects/:id', async (request) => {
    const { id } = request.params as { id: string };

    const project = await projectRepository.findById(id);
    if (!project) {
      throw new ApiError(404, `Project dengan id "${id}" tidak ditemukan`);
    }

    return withPublicProviders(project);
  });

  app.patch('/projects/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as ProjectBody | undefined;
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
    if (name === '') {
      throw new ApiError(400, 'Field "name" wajib diisi (string)');
    }

    const defaultProvider = parseDefaultProvider(body?.defaultProvider);
    const providers = parseProviderEntries(body?.providers);

    if (providers && defaultProvider) {
      const defaultEntry = providers.find((entry) => entry.provider === defaultProvider);
      const existing = await projectProviderRepository.findPublicByProjectId(id);
      const hadDefault = existing.some((entry) => entry.provider === defaultProvider);
      if (!defaultEntry?.apiKey && !hadDefault) {
        throw new ApiError(
          400,
          `API key untuk provider default "${defaultProvider}" wajib diisi`,
        );
      }
    }

    const updated = await withTransaction(async (client) => {
      const next = await projectRepository
        .update(
          id,
          {
            ...(name !== undefined ? { name } : {}),
            ...(typeof body?.baseUrl === 'string' || body?.baseUrl === null
              ? {
                  baseUrl:
                    body.baseUrl === '' ? null : (body.baseUrl as string | null),
                }
              : {}),
            ...(defaultProvider !== undefined ? { defaultProvider } : {}),
          },
          client,
        )
        .catch((error) => {
          if (
            error instanceof Error &&
            error.message === 'Tidak ada field yang diberikan untuk update'
          ) {
            return projectRepository.findById(id);
          }
          throw error;
        });
      if (!next) {
        throw new ApiError(404, `Project dengan id "${id}" tidak ditemukan`);
      }
      if (providers) {
        await projectProviderRepository.replaceForProject(id, providers, client);
      }
      return next;
    });

    return withPublicProviders(updated);
  });

  app.post('/projects/:id/delete', async (request) => {
    const { id } = request.params as { id: string };
    const deleted = await projectRepository.delete(id);
    if (!deleted) {
      throw new ApiError(404, `Project dengan id "${id}" tidak ditemukan`);
    }
    return { ok: true };
  });
}
