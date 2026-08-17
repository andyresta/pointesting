import { pool } from '../client';
import { buildUpdateQuery } from './query-utils';
import type {
  AnalysisResultCreateData,
  AnalysisResultRecord,
  AnalysisResultUpdateData,
  AnalysisStatus,
} from './types';

const ANALYSIS_RESULT_COLUMNS = `
  id,
  test_run_id AS "testRunId",
  status,
  reason,
  detail,
  solution,
  provider,
  raw_response AS "rawResponse",
  created_at AS "createdAt"
`;

export interface AnalysisResultFilter {
  testRunId?: string;
  status?: AnalysisStatus;
  provider?: string;
}

export class AnalysisResultRepository {
  /**
   * Keterangan: Menyimpan hasil klasifikasi provider beserta response mentah
   * untuk audit, lalu mengembalikan row analysis_result yang dibuat.
   */
  async create(data: AnalysisResultCreateData): Promise<AnalysisResultRecord> {
    const result = await pool.query<AnalysisResultRecord>(
      `INSERT INTO analysis_result
         (test_run_id, status, reason, detail, solution, provider, raw_response)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${ANALYSIS_RESULT_COLUMNS}`,
      [
        data.testRunId,
        data.status,
        data.reason ?? null,
        data.detail ?? null,
        data.solution ?? null,
        data.provider,
        data.rawResponse === undefined
          ? null
          : JSON.stringify(data.rawResponse),
      ],
    );

    return result.rows[0]!;
  }

  /**
   * Keterangan: Mencari satu hasil analisis berdasarkan UUID, atau null jika
   * tidak ditemukan.
   */
  async findById(id: string): Promise<AnalysisResultRecord | null> {
    const result = await pool.query<AnalysisResultRecord>(
      `SELECT ${ANALYSIS_RESULT_COLUMNS}
       FROM analysis_result
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Keterangan: Mengambil hasil analisis dengan filter run, status, dan
   * provider opsional; hasil terbaru selalu berada di urutan pertama.
   */
  async findAll(
    filter: AnalysisResultFilter = {},
  ): Promise<AnalysisResultRecord[]> {
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
    if (filter.provider !== undefined) {
      values.push(filter.provider);
      conditions.push(`provider = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query<AnalysisResultRecord>(
      `SELECT ${ANALYSIS_RESULT_COLUMNS}
       FROM analysis_result
       ${where}
       ORDER BY created_at DESC, id DESC`,
      values,
    );
    return result.rows;
  }

  /**
   * Keterangan: Mengambil hasil analisis terbaru untuk satu test run, atau
   * null bila run tersebut belum dianalisis.
   */
  async findLatestByTestRunId(
    testRunId: string,
  ): Promise<AnalysisResultRecord | null> {
    const result = await pool.query<AnalysisResultRecord>(
      `SELECT ${ANALYSIS_RESULT_COLUMNS}
       FROM analysis_result
       WHERE test_run_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [testRunId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Keterangan: Memperbarui field hasil analisis melalui whitelist kolom dan
   * mengembalikan row terbaru atau null jika UUID tidak ditemukan.
   */
  async update(
    id: string,
    data: AnalysisResultUpdateData,
  ): Promise<AnalysisResultRecord | null> {
    const query = buildUpdateQuery(
      data,
      {
        testRunId: 'test_run_id',
        status: 'status',
        reason: 'reason',
        detail: 'detail',
        solution: 'solution',
        provider: 'provider',
        rawResponse: 'raw_response',
      },
      {
        rawResponse: (value) => JSON.stringify(value),
      },
    );
    query.values.push(id);

    const result = await pool.query<AnalysisResultRecord>(
      `UPDATE analysis_result
       SET ${query.setClause}
       WHERE id = $${query.values.length}
       RETURNING ${ANALYSIS_RESULT_COLUMNS}`,
      query.values,
    );
    return result.rows[0] ?? null;
  }
}

export const analysisResultRepository = new AnalysisResultRepository();
