import type { FastifyInstance } from 'fastify';
import * as path from 'node:path';
import { z } from 'zod';
import { analysisResultRepository } from '../../db/repositories/analysis-result.repository';
import { artifactRepository } from '../../db/repositories/artifact.repository';
import { projectRepository } from '../../db/repositories/project.repository';
import { testCaseRepository } from '../../db/repositories/test-case.repository';
import { testRunRepository } from '../../db/repositories/test-run.repository';
import type { ArtifactType } from '../../db/repositories/types';
import { enqueueSessionTestRun } from '../../queue/queue';
import {
  abortRunSession,
  closeRunSession,
  createRunSession,
  getRunSession,
  isRunSessionBusy,
} from '../../runner/run-session';
import { getArtifactStream } from '../../storage/artifact-storage';
import { broadcastToRun } from '../../ws/gateway';
import { ApiError } from '../errors';
import { parseOrThrow } from '../schemas/testcase.schema';

const sessionRunBodySchema = z.object({
  testCaseId: z.string().uuid(),
});

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

  app.post('/projects/:id/test-runs/session', async (request, reply) => {
    const { id: projectId } = request.params as { id: string };

    const project = await projectRepository.findById(projectId);
    if (!project) {
      throw new ApiError(404, `Project dengan id "${projectId}" tidak ditemukan`);
    }

    const sessionId = await createRunSession(projectId);
    reply.status(201);
    return { sessionId };
  });

  app.post('/projects/:id/test-runs/session/:sessionId/run', async (request, reply) => {
    const { id: projectId, sessionId } = request.params as {
      id: string;
      sessionId: string;
    };
    const body = parseOrThrow(sessionRunBodySchema, request.body);

    const session = getRunSession(sessionId);
    if (!session || session.projectId !== projectId) {
      throw new ApiError(404, `Sesi run "${sessionId}" tidak ditemukan`);
    }
    if (isRunSessionBusy(sessionId)) {
      throw new ApiError(409, 'Sesi masih menjalankan test case — tunggu selesai');
    }

    const testCase = await testCaseRepository.findById(body.testCaseId);
    if (!testCase || testCase.projectId !== projectId) {
      throw new ApiError(
        404,
        `Test case dengan id "${body.testCaseId}" tidak ditemukan pada project ini`,
      );
    }

    const testRun = await testRunRepository.create({
      testCaseId: body.testCaseId,
      status: 'queued',
    });

    enqueueSessionTestRun(sessionId, body.testCaseId, testRun.id);
    broadcastToRun(testRun.id, {
      type: 'run:status',
      runId: testRun.id,
      status: 'queued',
    });

    reply.status(202);
    return { testRunId: testRun.id, sessionId, status: testRun.status };
  });

  app.post('/projects/:id/test-runs/session/:sessionId/stop', async (request) => {
    const { id: projectId, sessionId } = request.params as {
      id: string;
      sessionId: string;
    };

    const session = getRunSession(sessionId);
    if (!session || session.projectId !== projectId) {
      throw new ApiError(404, `Sesi run "${sessionId}" tidak ditemukan`);
    }

    await closeRunSession(sessionId);
    return { sessionId, status: 'stopped' };
  });

  app.post('/projects/:id/test-runs/session/:sessionId/abort', async (request) => {
    const { id: projectId, sessionId } = request.params as {
      id: string;
      sessionId: string;
    };

    const session = getRunSession(sessionId);
    if (!session || session.projectId !== projectId) {
      throw new ApiError(404, `Sesi run "${sessionId}" tidak ditemukan`);
    }

    const aborted = await abortRunSession(sessionId);
    return { sessionId, status: aborted ? 'aborting' : 'idle' };
  });
}
