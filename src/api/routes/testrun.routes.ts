import type { FastifyInstance } from 'fastify';
import * as path from 'node:path';
import { analysisResultRepository } from '../../db/repositories/analysis-result.repository';
import { artifactRepository } from '../../db/repositories/artifact.repository';
import { testRunRepository } from '../../db/repositories/test-run.repository';
import type { ArtifactType } from '../../db/repositories/types';
import { getArtifactStream } from '../../storage/artifact-storage';
import { ApiError } from '../errors';

/**
 * Keterangan: Memetakan tipe artifact database ke Content-Type HTTP yang
 * sesuai untuk streaming/download file.
 */
function getArtifactContentType(type: ArtifactType): string {
  switch (type) {
    case 'video':
      return 'video/webm';
    case 'trace':
      return 'application/zip';
    case 'console_log':
    case 'network_log':
      return 'application/json';
    case 'screenshot':
      return 'image/png';
  }
}

/**
 * Keterangan: Mendaftarkan route resource test run sesuai spesifikasi API
 * bagian 5 — detail run beserta artifact dan hasil analisis terbaru, serta
 * streaming/download artifact dari filesystem melalui artifact-storage.
 */
export async function testRunRoutes(app: FastifyInstance): Promise<void> {
  app.get('/test-runs/:id', async (request) => {
    const { id } = request.params as { id: string };

    const testRun = await testRunRepository.findById(id);
    if (!testRun) {
      throw new ApiError(404, `Test run dengan id "${id}" tidak ditemukan`);
    }

    const [artifacts, analysisResult] = await Promise.all([
      artifactRepository.findAll({ testRunId: id }),
      analysisResultRepository.findLatestByTestRunId(id),
    ]);

    return {
      ...testRun,
      artifacts,
      analysisResult,
    };
  });

  app.get('/test-runs/:id/artifacts/:artifactId', async (request, reply) => {
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

    const stream = getArtifactStream(artifact.filePath);
    const filename = path.basename(artifact.filePath);

    reply.type(getArtifactContentType(artifact.type));
    reply.header('Content-Disposition', `inline; filename="${filename}"`);
    return reply.send(stream);
  });
}
