import type { FastifyInstance } from 'fastify';
import { projectRepository } from '../../db/repositories/project.repository';
import { testCaseRepository } from '../../db/repositories/test-case.repository';
import { testRunRepository } from '../../db/repositories/test-run.repository';
import type { JsonValue } from '../../db/repositories/types';
import { enqueueTestRun } from '../../queue/queue';
import { broadcastToRun } from '../../ws/gateway';
import { ApiError } from '../errors';
import {
  createTestCaseBodySchema,
  parseOrThrow,
  updateTestCaseBodySchema,
} from '../schemas/testcase.schema';

/**
 * Keterangan: Mendaftarkan route resource test case sesuai spesifikasi API
 * bagian 5 — create/list/edit memakai Zod schema bagian 4.1, trigger run
 * (insert test_run + push ke in-memory queue), list dengan hasil analysis
 * terbaru, dan riwayat run per test case.
 */
export async function testCaseRoutes(app: FastifyInstance): Promise<void> {
  app.post('/projects/:id/test-cases', async (request, reply) => {
    const { id: projectId } = request.params as { id: string };
    const body = parseOrThrow(createTestCaseBodySchema, request.body);

    const project = await projectRepository.findById(projectId);
    if (!project) {
      throw new ApiError(404, `Project dengan id "${projectId}" tidak ditemukan`);
    }

    const testCase = await testCaseRepository.create({
      projectId,
      title: body.title,
      steps: body.steps as JsonValue,
      expected: body.expected as JsonValue,
      source: body.source,
    });

    reply.status(201);
    return testCase;
  });

  app.get('/projects/:id/test-cases', async (request) => {
    const { id: projectId } = request.params as { id: string };

    const project = await projectRepository.findById(projectId);
    if (!project) {
      throw new ApiError(404, `Project dengan id "${projectId}" tidak ditemukan`);
    }

    return testCaseRepository.findAllWithLatestAnalysis(projectId);
  });

  app.patch('/test-cases/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(updateTestCaseBodySchema, request.body);

    const testCase = await testCaseRepository.update(id, {
      title: body.title,
      steps: body.steps as JsonValue | undefined,
      expected: body.expected as JsonValue | undefined,
      source: body.source,
    });

    if (!testCase) {
      throw new ApiError(404, `Test case dengan id "${id}" tidak ditemukan`);
    }

    return testCase;
  });

  app.post('/test-cases/:id/run', async (request, reply) => {
    const { id } = request.params as { id: string };

    const testCase = await testCaseRepository.findById(id);
    if (!testCase) {
      throw new ApiError(404, `Test case dengan id "${id}" tidak ditemukan`);
    }

    const testRun = await testRunRepository.create({
      testCaseId: id,
      status: 'queued',
    });

    // Fire-and-forget: job dipush ke queue, response API tidak menunggu
    // eksekusi Playwright dan analysis selesai.
    enqueueTestRun(testRun.id);
    broadcastToRun(testRun.id, {
      type: 'run:status',
      runId: testRun.id,
      status: 'queued',
    });

    reply.status(202);
    return { runId: testRun.id, status: testRun.status };
  });

  app.get('/test-cases/:id/runs', async (request) => {
    const { id } = request.params as { id: string };

    const testCase = await testCaseRepository.findById(id);
    if (!testCase) {
      throw new ApiError(404, `Test case dengan id "${id}" tidak ditemukan`);
    }

    return testRunRepository.findAll({ testCaseId: id });
  });
}
