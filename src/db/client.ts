import { Pool } from 'pg';
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

export default pool;
