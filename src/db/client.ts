import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { config } from '../config/env';

/**
 * Keterangan: Connection pool tunggal ke PostgreSQL yang dipakai bersama
 * di seluruh aplikasi (repositories, migration runner, dsb), supaya koneksi
 * di-reuse dan tidak membuka koneksi baru di tiap query.
 */
export const pool = new Pool({
  host: config.DB_HOST,
  database: config.DB_NAME,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASS || undefined,
});

pool.on('error', (err) => {
  console.error('Error tak terduga pada idle client PostgreSQL:', err);
});

/**
 * Keterangan: Menjalankan kerja database di dalam satu transaction. Commit
 * jika callback sukses; rollback jika melempar error.
 */
export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default pool;
