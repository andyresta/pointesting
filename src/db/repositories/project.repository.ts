import type { PoolClient } from 'pg';
import { pool } from '../client';
import { buildUpdateQuery } from './query-utils';
import type {
  Project,
  ProjectCreateData,
  ProjectUpdateData,
} from './types';

const PROJECT_COLUMNS = `
  id,
  name,
  base_url AS "baseUrl",
  default_provider AS "defaultProvider",
  instruction,
  extra_data AS "extraData",
  created_at AS "createdAt"
`;

export interface ProjectFilter {
  name?: string;
  defaultProvider?: string;
}

export class ProjectRepository {
  /**
   * Keterangan: Membuat project baru dan mengembalikan row yang baru dibuat.
   */
  async create(data: ProjectCreateData, client?: PoolClient): Promise<Project> {
    const db = client ?? pool;
    const result = await db.query<Project>(
      `INSERT INTO project (name, base_url, default_provider)
       VALUES ($1, $2, $3)
       RETURNING ${PROJECT_COLUMNS}`,
      [
        data.name,
        data.baseUrl ?? null,
        data.defaultProvider === undefined ? 'claude' : data.defaultProvider,
      ],
    );

    return result.rows[0]!;
  }

  /**
   * Keterangan: Mencari satu project berdasarkan UUID, atau null jika tidak ada.
   */
  async findById(id: string): Promise<Project | null> {
    const result = await pool.query<Project>(
      `SELECT ${PROJECT_COLUMNS} FROM project WHERE id = $1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  /**
   * Keterangan: Mengambil semua project dengan filter nama/provider opsional.
   */
  async findAll(filter: ProjectFilter = {}): Promise<Project[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.name !== undefined) {
      values.push(filter.name);
      conditions.push(`name = $${values.length}`);
    }
    if (filter.defaultProvider !== undefined) {
      values.push(filter.defaultProvider);
      conditions.push(`default_provider = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query<Project>(
      `SELECT ${PROJECT_COLUMNS} FROM project ${where} ORDER BY created_at DESC`,
      values,
    );

    return result.rows;
  }

  /**
   * Keterangan: Memperbarui sebagian field project menggunakan kolom whitelist,
   * lalu mengembalikan row terbaru atau null jika UUID tidak ditemukan.
   */
  async update(
    id: string,
    data: ProjectUpdateData,
    client?: PoolClient,
  ): Promise<Project | null> {
    const db = client ?? pool;
    const query = buildUpdateQuery(data, {
      name: 'name',
      baseUrl: 'base_url',
      defaultProvider: 'default_provider',
      instruction: 'instruction',
      extraData: 'extra_data',
    });
    query.values.push(id);

    const result = await db.query<Project>(
      `UPDATE project
       SET ${query.setClause}
       WHERE id = $${query.values.length}
       RETURNING ${PROJECT_COLUMNS}`,
      query.values,
    );

    return result.rows[0] ?? null;
  }

  /**
   * Keterangan: Menghapus project beserta data terkait (ON DELETE CASCADE).
   * Mengembalikan true jika row terhapus.
   */
  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM project WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const projectRepository = new ProjectRepository();
