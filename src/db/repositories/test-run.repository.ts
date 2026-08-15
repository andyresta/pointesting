import { pool } from '../client';
import { buildUpdateQuery } from './query-utils';
import type {
  TestRun,
  TestRunCreateData,
  TestRunStatus,
  TestRunUpdateData,
} from './types';

const TEST_RUN_COLUMNS = `
  id,
  test_case_id AS "testCaseId",
  status,
  started_at AS "startedAt",
  finished_at AS "finishedAt",
  duration_ms AS "durationMs",
  created_at AS "createdAt"
`;

export interface TestRunFilter {
  testCaseId?: string;
  status?: TestRunStatus;
}

export class TestRunRepository {
  /**
   * Keterangan: Membuat test run baru dengan status default queued,
   * lalu mengembalikan row yang baru dibuat.
   */
  async create(data: TestRunCreateData): Promise<TestRun> {
    const result = await pool.query<TestRun>(
      `INSERT INTO test_run
         (test_case_id, status, started_at, finished_at, duration_ms)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${TEST_RUN_COLUMNS}`,
      [
        data.testCaseId,
        data.status ?? 'queued',
        data.startedAt ?? null,
        data.finishedAt ?? null,
        data.durationMs ?? null,
      ],
    );

    return result.rows[0]!;
  }

  /**
   * Keterangan: Mencari satu test run berdasarkan UUID, atau null jika tidak ada.
   */
  async findById(id: string): Promise<TestRun | null> {
    const result = await pool.query<TestRun>(
      `SELECT ${TEST_RUN_COLUMNS} FROM test_run WHERE id = $1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  /**
   * Keterangan: Mengambil test run dengan filter testCaseId dan status opsional.
   */
  async findAll(filter: TestRunFilter = {}): Promise<TestRun[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.testCaseId !== undefined) {
      values.push(filter.testCaseId);
      conditions.push(`test_case_id = $${values.length}`);
    }
    if (filter.status !== undefined) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query<TestRun>(
      `SELECT ${TEST_RUN_COLUMNS} FROM test_run ${where} ORDER BY created_at DESC`,
      values,
    );

    return result.rows;
  }

  /**
   * Keterangan: Memperbarui sebagian field test run dan mengembalikan
   * row terbaru atau null jika UUID tidak ditemukan.
   */
  async update(id: string, data: TestRunUpdateData): Promise<TestRun | null> {
    const query = buildUpdateQuery(data, {
      testCaseId: 'test_case_id',
      status: 'status',
      startedAt: 'started_at',
      finishedAt: 'finished_at',
      durationMs: 'duration_ms',
    });
    query.values.push(id);

    const result = await pool.query<TestRun>(
      `UPDATE test_run
       SET ${query.setClause}
       WHERE id = $${query.values.length}
       RETURNING ${TEST_RUN_COLUMNS}`,
      query.values,
    );

    return result.rows[0] ?? null;
  }
}

export const testRunRepository = new TestRunRepository();
