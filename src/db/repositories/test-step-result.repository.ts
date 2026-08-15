import { pool } from '../client';
import { buildUpdateQuery } from './query-utils';
import type {
  TestStepResult,
  TestStepResultCreateData,
  TestStepResultStatus,
  TestStepResultUpdateData,
} from './types';

const TEST_STEP_RESULT_COLUMNS = `
  id,
  test_run_id AS "testRunId",
  step_index AS "stepIndex",
  action,
  status,
  error_message AS "errorMessage",
  duration_ms AS "durationMs",
  created_at AS "createdAt"
`;

export interface TestStepResultFilter {
  testRunId?: string;
  status?: TestStepResultStatus;
}

export class TestStepResultRepository {
  /**
   * Keterangan: Membuat hasil eksekusi satu test step dan mengembalikan
   * row yang baru dibuat.
   */
  async create(data: TestStepResultCreateData): Promise<TestStepResult> {
    const result = await pool.query<TestStepResult>(
      `INSERT INTO test_step_result
         (test_run_id, step_index, action, status, error_message, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${TEST_STEP_RESULT_COLUMNS}`,
      [
        data.testRunId,
        data.stepIndex,
        data.action,
        data.status,
        data.errorMessage ?? null,
        data.durationMs ?? null,
      ],
    );

    return result.rows[0]!;
  }

  /**
   * Keterangan: Mencari satu test step result berdasarkan UUID,
   * atau null jika tidak ada.
   */
  async findById(id: string): Promise<TestStepResult | null> {
    const result = await pool.query<TestStepResult>(
      `SELECT ${TEST_STEP_RESULT_COLUMNS} FROM test_step_result WHERE id = $1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  /**
   * Keterangan: Mengambil hasil step dengan filter testRunId dan status opsional,
   * diurutkan berdasarkan indeks step.
   */
  async findAll(filter: TestStepResultFilter = {}): Promise<TestStepResult[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.testRunId !== undefined) {
      values.push(filter.testRunId);
      conditions.push(`test_run_id = $${values.length}`);
    }
    if (filter.status !== undefined) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query<TestStepResult>(
      `SELECT ${TEST_STEP_RESULT_COLUMNS}
       FROM test_step_result ${where}
       ORDER BY step_index ASC`,
      values,
    );

    return result.rows;
  }

  /**
   * Keterangan: Memperbarui sebagian field hasil test step dan mengembalikan
   * row terbaru atau null jika UUID tidak ditemukan.
   */
  async update(
    id: string,
    data: TestStepResultUpdateData,
  ): Promise<TestStepResult | null> {
    const query = buildUpdateQuery(data, {
      testRunId: 'test_run_id',
      stepIndex: 'step_index',
      action: 'action',
      status: 'status',
      errorMessage: 'error_message',
      durationMs: 'duration_ms',
    });
    query.values.push(id);

    const result = await pool.query<TestStepResult>(
      `UPDATE test_step_result
       SET ${query.setClause}
       WHERE id = $${query.values.length}
       RETURNING ${TEST_STEP_RESULT_COLUMNS}`,
      query.values,
    );

    return result.rows[0] ?? null;
  }
}

export const testStepResultRepository = new TestStepResultRepository();
