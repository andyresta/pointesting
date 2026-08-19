import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { projectRepository } from '../../db/repositories/project.repository';
import { suiteAnalysisResultRepository } from '../../db/repositories/suite-analysis-result.repository';
import { testCaseRepository } from '../../db/repositories/test-case.repository';
import { testRunRepository } from '../../db/repositories/test-run.repository';
import type { JsonValue } from '../../db/repositories/types';
import { enqueueTestRun, enqueueTestSuiteRun } from '../../queue/queue';
import { abortTestRunSuite, registerTestRunSuite } from '../../runner/executor';
import { broadcastToRun } from '../../ws/gateway';
import { ApiError } from '../errors';
import {
  createTestCaseBodySchema,
  parseOrThrow,
  updateTestCaseBodySchema,
} from '../schemas/testcase.schema';

const runSuiteBodySchema = z.object({
  testCaseIds: z.array(z.string().uuid()).optional(),
});

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
      description: body.description?.trim() || null,
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

    return testCaseRepository.findAllWithLatestAnalysisUnordered(projectId);
  });

  app.patch('/test-cases/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = parseOrThrow(updateTestCaseBodySchema, request.body);

    const testCase = await testCaseRepository.update(id, {
      title: body.title,
      description:
        body.description === undefined ? undefined : body.description.trim() || null,
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

  app.post('/projects/:id/test-cases/run-suite', async (request, reply) => {
    const { id: projectId } = request.params as { id: string };
    const body = parseOrThrow(runSuiteBodySchema, request.body ?? {});

    const project = await projectRepository.findById(projectId);
    if (!project) {
      throw new ApiError(404, `Project dengan id "${projectId}" tidak ditemukan`);
    }

    const allCases =
      await testCaseRepository.findAllWithLatestAnalysisUnordered(projectId);
    const requestedIds = body.testCaseIds?.length
      ? body.testCaseIds
      : allCases.map((item) => item.id);

    if (requestedIds.length === 0) {
      throw new ApiError(400, 'Project belum punya test case untuk dijalankan');
    }

    const allowedIds = new Set(allCases.map((item) => item.id));
    for (const testCaseId of requestedIds) {
      if (!allowedIds.has(testCaseId)) {
        throw new ApiError(
          404,
          `Test case dengan id "${testCaseId}" tidak ditemukan pada project ini`,
        );
      }
    }

    const suiteRunId = randomUUID();
    registerTestRunSuite(suiteRunId);
    enqueueTestSuiteRun(suiteRunId, projectId, requestedIds);
    broadcastToRun(suiteRunId, {
      type: 'run:status',
      runId: suiteRunId,
      status: 'queued',
    });

    reply.status(202);
    return { suiteRunId, status: 'queued', testCaseIds: requestedIds };
  });

  app.post('/projects/:id/test-cases/suite/:suiteRunId/abort', async (request) => {
    const { id: projectId, suiteRunId } = request.params as {
      id: string;
      suiteRunId: string;
    };

    const project = await projectRepository.findById(projectId);
    if (!project) {
      throw new ApiError(404, `Project dengan id "${projectId}" tidak ditemukan`);
    }

    const aborted = abortTestRunSuite(suiteRunId);
    if (!aborted) {
      throw new ApiError(404, `Suite run "${suiteRunId}" tidak sedang berjalan`);
    }
    return { suiteRunId, status: 'aborting' };
  });

  app.get('/projects/:id/suite-analysis/latest', async (request) => {
    const { id: projectId } = request.params as { id: string };

    const project = await projectRepository.findById(projectId);
    if (!project) {
      throw new ApiError(404, `Project dengan id "${projectId}" tidak ditemukan`);
    }

    const result = await suiteAnalysisResultRepository.findLatestByProjectId(projectId);
    return { result };
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
