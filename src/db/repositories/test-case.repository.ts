import type { PoolClient } from 'pg';
import { pool } from '../client';
import { buildUpdateQuery } from './query-utils';
import type {
  AnalysisStatus,
  TestCase,
  TestCaseCreateData,
  TestCaseUpdateData,
  TestCaseWithLatestAnalysis,
} from './types';
import type { ProviderName } from '../../config/env';

const TEST_CASE_COLUMNS = `
  id,
  project_id AS "projectId",
  title,
  description,
  steps,
  expected,
  source,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

interface TestCaseLatestAnalysisRow extends TestCase {
  analysisId: string | null;
  analysisTestRunId: string | null;
  analysisStatus: AnalysisStatus | null;
  analysisReason: string | null;
  analysisDetail: string | null;
  analysisSolution: string | null;
  analysisProvider: ProviderName | null;
  analysisCreatedAt: Date | null;
}

/**
 * Keterangan: Mengubah row LEFT JOIN latest analysis menjadi response test
 * case dengan object latestAnalysisResult yang null-safe.
 */
function mapLatestAnalysisRow(
  row: TestCaseLatestAnalysisRow,
): TestCaseWithLatestAnalysis {
  const {
    analysisId,
    analysisTestRunId,
    analysisStatus,
    analysisReason,
    analysisDetail,
    analysisSolution,
    analysisProvider,
    analysisCreatedAt,
    ...testCase
  } = row;

  return {
    ...testCase,
    latestAnalysisResult:
      analysisId &&
      analysisTestRunId &&
      analysisStatus &&
      analysisProvider
        ? {
            id: analysisId,
            testRunId: analysisTestRunId,
            status: analysisStatus,
            reason: analysisReason,
            detail: analysisDetail,
            solution: analysisSolution,
            provider: analysisProvider,
            createdAt: analysisCreatedAt,
          }
        : null,
  };
}

export interface TestCaseFilter {
  projectId?: string;
  source?: string;
}

export class TestCaseRepository {
  /**
   * Keterangan: Membuat test case baru beserta steps dan expected JSONB,
   * lalu mengembalikan row yang baru dibuat.
   */
  async create(data: TestCaseCreateData, client?: PoolClient): Promise<TestCase> {
    const db = client ?? pool;
    const result = await db.query<TestCase>(
      `INSERT INTO test_case (project_id, title, description, steps, expected, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${TEST_CASE_COLUMNS}`,
      [
        data.projectId,
        data.title,
        data.description?.trim() || null,
        JSON.stringify(data.steps),
        JSON.stringify(data.expected),
        data.source === undefined ? 'manual' : data.source,
      ],
    );

    return result.rows[0]!;
  }

  /**
   * Keterangan: Mencari satu test case berdasarkan UUID, atau null jika tidak ada.
   */
  async findById(id: string): Promise<TestCase | null> {
    const result = await pool.query<TestCase>(
      `SELECT ${TEST_CASE_COLUMNS} FROM test_case WHERE id = $1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  /**
   * Keterangan: Mengambil test case dengan filter project dan source opsional.
   */
  async findAll(filter: TestCaseFilter = {}): Promise<TestCase[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.projectId !== undefined) {
      values.push(filter.projectId);
      conditions.push(`project_id = $${values.length}`);
    }
    if (filter.source !== undefined) {
      values.push(filter.source);
      conditions.push(`source = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query<TestCase>(
      `SELECT ${TEST_CASE_COLUMNS} FROM test_case ${where} ORDER BY created_at DESC`,
      values,
    );

    return result.rows;
  }

  /**
   * Keterangan: Mengambil seluruh test case satu project beserta satu hasil
   * analysis terbaru lintas run menggunakan LEFT JOIN LATERAL tanpa N+1 query.
   */
  async findAllWithLatestAnalysis(
    projectId: string,
  ): Promise<TestCaseWithLatestAnalysis[]> {
    const result = await pool.query<TestCaseLatestAnalysisRow>(
      `SELECT
         test_case_row.*,
         latest_analysis.id AS "analysisId",
         latest_analysis.test_run_id AS "analysisTestRunId",
         latest_analysis.status AS "analysisStatus",
         latest_analysis.reason AS "analysisReason",
         latest_analysis.detail AS "analysisDetail",
         latest_analysis.solution AS "analysisSolution",
         latest_analysis.provider AS "analysisProvider",
         latest_analysis.created_at AS "analysisCreatedAt"
       FROM (
         SELECT ${TEST_CASE_COLUMNS}
         FROM test_case
         WHERE project_id = $1
       ) AS test_case_row
       LEFT JOIN LATERAL (
         SELECT analysis_result.*
         FROM test_run
         JOIN analysis_result
           ON analysis_result.test_run_id = test_run.id
         WHERE test_run.test_case_id = test_case_row.id
         ORDER BY analysis_result.created_at DESC, analysis_result.id DESC
         LIMIT 1
       ) AS latest_analysis ON TRUE
       ORDER BY test_case_row."createdAt" DESC`,
      [projectId],
    );

    return result.rows.map(mapLatestAnalysisRow);
  }

  /**
   * Keterangan: Memperbarui sebagian field test case, termasuk serialisasi
   * field JSONB dan pembaruan timestamp updated_at.
   */
  async update(id: string, data: TestCaseUpdateData): Promise<TestCase | null> {
    const query = buildUpdateQuery(
      data,
      {
        projectId: 'project_id',
        title: 'title',
        description: 'description',
        steps: 'steps',
        expected: 'expected',
        source: 'source',
      },
      {
        steps: (value) => JSON.stringify(value),
        expected: (value) => JSON.stringify(value),
      },
    );
    query.values.push(id);

    const result = await pool.query<TestCase>(
      `UPDATE test_case
       SET ${query.setClause}, updated_at = now()
       WHERE id = $${query.values.length}
       RETURNING ${TEST_CASE_COLUMNS}`,
      query.values,
    );

    return result.rows[0] ?? null;
  }
}

export const testCaseRepository = new TestCaseRepository();
