import type { FastifyInstance } from 'fastify';
import { artifactRepository } from '../../db/repositories/artifact.repository';
import { testRunRepository } from '../../db/repositories/test-run.repository';
import { ApiError } from '../errors';

/**
 * Keterangan: Mendaftarkan route resource test run sesuai spesifikasi API
 * bagian 5 — detail run beserta daftar artifact (analysis_result belum ada
 * repository-nya, baru dibuat di Fase 2), dan download artifact (placeholder,
 * menunggu artifact-storage.ts di Step 11).
 */
export async function testRunRoutes(app: FastifyInstance): Promise<void> {
  app.get('/test-runs/:id', async (request) => {
    const { id } = request.params as { id: string };

    const testRun = await testRunRepository.findById(id);
    if (!testRun) {
      throw new ApiError(404, `Test run dengan id "${id}" tidak ditemukan`);
    }

    const artifacts = await artifactRepository.findAll({ testRunId: id });

    return {
      ...testRun,
      artifacts,
      // analysis_result belum punya repository (Fase 2 / Step 16-19)
      analysisResult: null,
    };
  });

  app.get('/test-runs/:id/artifacts/:artifactId', async (request) => {
    const { id, artifactId } = request.params as { id: string; artifactId: string };

    const testRun = await testRunRepository.findById(id);
    if (!testRun) {
      throw new ApiError(404, `Test run dengan id "${id}" tidak ditemukan`);
    }

    const artifact = await artifactRepository.findById(artifactId);
    if (!artifact || artifact.testRunId !== id) {
      throw new ApiError(
        404,
        `Artifact dengan id "${artifactId}" tidak ditemukan pada test run "${id}"`,
      );
    }

    throw new ApiError(
      501,
      'Belum diimplementasikan: download/stream artifact dari filesystem akan diimplementasikan di Step 11 (artifact-storage.ts)',
    );
  });
}
