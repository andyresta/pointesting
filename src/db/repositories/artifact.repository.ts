import { pool } from '../client';
import { buildUpdateQuery } from './query-utils';
import type {
  Artifact,
  ArtifactCreateData,
  ArtifactType,
  ArtifactUpdateData,
} from './types';

const ARTIFACT_COLUMNS = `
  id,
  test_run_id AS "testRunId",
  type,
  file_path AS "filePath",
  size_bytes AS "sizeBytes",
  created_at AS "createdAt"
`;

export interface ArtifactFilter {
  testRunId?: string;
  type?: ArtifactType;
}

export class ArtifactRepository {
  /**
   * Keterangan: Membuat metadata artifact baru dan mengembalikan row
   * yang baru dibuat.
   */
  async create(data: ArtifactCreateData): Promise<Artifact> {
    const result = await pool.query<Artifact>(
      `INSERT INTO artifact (test_run_id, type, file_path, size_bytes)
       VALUES ($1, $2, $3, $4)
       RETURNING ${ARTIFACT_COLUMNS}`,
      [data.testRunId, data.type, data.filePath, data.sizeBytes ?? null],
    );

    return result.rows[0]!;
  }

  /**
   * Keterangan: Mencari satu artifact berdasarkan UUID, atau null jika tidak ada.
   */
  async findById(id: string): Promise<Artifact | null> {
    const result = await pool.query<Artifact>(
      `SELECT ${ARTIFACT_COLUMNS} FROM artifact WHERE id = $1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  /**
   * Keterangan: Mengambil artifact dengan filter testRunId dan tipe opsional.
   */
  async findAll(filter: ArtifactFilter = {}): Promise<Artifact[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.testRunId !== undefined) {
      values.push(filter.testRunId);
      conditions.push(`test_run_id = $${values.length}`);
    }
    if (filter.type !== undefined) {
      values.push(filter.type);
      conditions.push(`type = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query<Artifact>(
      `SELECT ${ARTIFACT_COLUMNS} FROM artifact ${where} ORDER BY created_at DESC`,
      values,
    );

    return result.rows;
  }

  /**
   * Keterangan: Memperbarui sebagian metadata artifact dan mengembalikan
   * row terbaru atau null jika UUID tidak ditemukan.
   */
  async update(id: string, data: ArtifactUpdateData): Promise<Artifact | null> {
    const query = buildUpdateQuery(data, {
      testRunId: 'test_run_id',
      type: 'type',
      filePath: 'file_path',
      sizeBytes: 'size_bytes',
    });
    query.values.push(id);

    const result = await pool.query<Artifact>(
      `UPDATE artifact
       SET ${query.setClause}
       WHERE id = $${query.values.length}
       RETURNING ${ARTIFACT_COLUMNS}`,
      query.values,
    );

    return result.rows[0] ?? null;
  }
}

export const artifactRepository = new ArtifactRepository();
