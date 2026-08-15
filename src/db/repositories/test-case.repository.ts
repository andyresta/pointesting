import { pool } from '../client';
import { buildUpdateQuery } from './query-utils';
import type {
  TestCase,
  TestCaseCreateData,
  TestCaseUpdateData,
} from './types';

const TEST_CASE_COLUMNS = `
  id,
  project_id AS "projectId",
  title,
  steps,
  expected,
  source,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export interface TestCaseFilter {
  projectId?: string;
  source?: string;
}

export class TestCaseRepository {
  /**
   * Keterangan: Membuat test case baru beserta steps dan expected JSONB,
   * lalu mengembalikan row yang baru dibuat.
   */
  async create(data: TestCaseCreateData): Promise<TestCase> {
    const result = await pool.query<TestCase>(
      `INSERT INTO test_case (project_id, title, steps, expected, source)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${TEST_CASE_COLUMNS}`,
      [
        data.projectId,
        data.title,
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
   * Keterangan: Memperbarui sebagian field test case, termasuk serialisasi
   * field JSONB dan pembaruan timestamp updated_at.
   */
  async update(id: string, data: TestCaseUpdateData): Promise<TestCase | null> {
    const query = buildUpdateQuery(
      data,
      {
        projectId: 'project_id',
        title: 'title',
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
