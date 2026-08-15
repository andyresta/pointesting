import type { FastifyInstance } from 'fastify';
import { projectRepository } from '../../db/repositories/project.repository';
import { ApiError } from '../errors';

interface CreateProjectBody {
  name?: unknown;
  baseUrl?: unknown;
  defaultProvider?: unknown;
}

/**
 * Keterangan: Mendaftarkan route resource project — POST /projects (buat baru)
 * dan GET /projects/:id (detail) — sesuai spesifikasi API bagian 5, memakai
 * projectRepository dari Step 3.
 */
export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.post('/projects', async (request, reply) => {
    const body = request.body as CreateProjectBody | undefined;

    if (typeof body?.name !== 'string' || body.name.trim() === '') {
      throw new ApiError(400, 'Field "name" wajib diisi (string)');
    }

    const project = await projectRepository.create({
      name: body.name,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : null,
      defaultProvider:
        typeof body.defaultProvider === 'string' ? body.defaultProvider : undefined,
    });

    reply.status(201);
    return project;
  });

  app.get('/projects/:id', async (request) => {
    const { id } = request.params as { id: string };

    const project = await projectRepository.findById(id);
    if (!project) {
      throw new ApiError(404, `Project dengan id "${id}" tidak ditemukan`);
    }

    return project;
  });
}
