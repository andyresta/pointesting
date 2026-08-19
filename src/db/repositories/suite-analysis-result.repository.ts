import { pool } from '../client';
import type {
  SuiteAnalysisFinding,
  SuiteAnalysisResultCreateData,
  SuiteAnalysisResultRecord,
} from './types';

const SUITE_ANALYSIS_RESULT_COLUMNS = `
  id,
  project_id AS "projectId",
  suite_run_id AS "suiteRunId",
  test_run_ids AS "testRunIds",
  status,
  summary,
  findings,
  provider,
  raw_response AS "rawResponse",
  created_at AS "createdAt"
`;

interface SuiteAnalysisResultRow
  extends Omit<SuiteAnalysisResultRecord, 'testRunIds' | 'findings'> {
  testRunIds: unknown;
  findings: unknown;
}

/**
 * Keterangan: JSONB pulang sebagai object/array dari driver `pg`, tapi tetap
 * dinormalisasi eksplisit di sini supaya tipe kembalian repository ini
 * konsisten walau kolom kosong/null.
 */
function mapRow(row: SuiteAnalysisResultRow): SuiteAnalysisResultRecord {
  return {
    ...row,
    testRunIds: Array.isArray(row.testRunIds) ? (row.testRunIds as string[]) : [],
    findings: Array.isArray(row.findings) ? (row.findings as SuiteAnalysisFinding[]) : [],
  };
}

export class SuiteAnalysisResultRepository {
  /**
   * Keterangan: Menyimpan hasil Suite Analysis satu kali eksekusi suite run.
   */
  async create(
    data: SuiteAnalysisResultCreateData,
  ): Promise<SuiteAnalysisResultRecord> {
    const result = await pool.query<SuiteAnalysisResultRow>(
      `INSERT INTO suite_analysis_result
         (project_id, suite_run_id, test_run_ids, status, summary, findings, provider, raw_response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SUITE_ANALYSIS_RESULT_COLUMNS}`,
      [
        data.projectId,
        data.suiteRunId,
        JSON.stringify(data.testRunIds),
        data.status,
        data.summary ?? null,
        JSON.stringify(data.findings),
        data.provider,
        data.rawResponse === undefined ? null : JSON.stringify(data.rawResponse),
      ],
    );

    return mapRow(result.rows[0]!);
  }

  /**
   * Keterangan: Mengambil hasil Suite Analysis terbaru untuk satu project,
   * atau null bila belum pernah ada suite run yang dianalisis.
   */
  async findLatestByProjectId(
    projectId: string,
  ): Promise<SuiteAnalysisResultRecord | null> {
    const result = await pool.query<SuiteAnalysisResultRow>(
      `SELECT ${SUITE_ANALYSIS_RESULT_COLUMNS}
       FROM suite_analysis_result
       WHERE project_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [projectId],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /**
   * Keterangan: Mengambil satu hasil Suite Analysis berdasarkan suiteRunId
   * (dipakai resync bila client tahu suiteRunId spesifik yang sedang ditonton).
   */
  async findBySuiteRunId(
    suiteRunId: string,
  ): Promise<SuiteAnalysisResultRecord | null> {
    const result = await pool.query<SuiteAnalysisResultRow>(
      `SELECT ${SUITE_ANALYSIS_RESULT_COLUMNS}
       FROM suite_analysis_result
       WHERE suite_run_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [suiteRunId],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }
}

export const suiteAnalysisResultRepository = new SuiteAnalysisResultRepository();
