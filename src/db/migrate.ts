import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from './client';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Keterangan: Memastikan tabel `_migrations` ada. Tabel ini dipakai untuk
 * mencatat file migration mana saja yang sudah pernah dijalankan, supaya
 * migration yang sama tidak dieksekusi berulang kali.
 */
async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL UNIQUE,
      executed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/**
 * Keterangan: Mengambil daftar nama file migration (*.sql) yang sudah pernah
 * dieksekusi sebelumnya, dibaca dari tabel `_migrations`.
 */
async function getExecutedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ name: string }>('SELECT name FROM _migrations');
  return new Set(result.rows.map((row) => row.name));
}

/**
 * Keterangan: Membaca semua file `.sql` di folder migrations, diurutkan
 * berdasarkan nama file (nomor urut prefix, misal 001_init.sql, 002_xxx.sql),
 * supaya migration selalu dijalankan sesuai urutan yang benar.
 */
async function getMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((file) => file.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
}

/**
 * Keterangan: Menjalankan satu file migration di dalam transaction — isi SQL
 * file dieksekusi, lalu nama file dicatat ke `_migrations`. Kalau salah satu
 * gagal, transaction di-rollback supaya state database tidak setengah jalan.
 */
async function runMigration(fileName: string): Promise<void> {
  const filePath = path.join(MIGRATIONS_DIR, fileName);
  const sql = await readFile(filePath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO _migrations (name) VALUES ($1)', [fileName]);
    await client.query('COMMIT');
    console.log(`Migration berhasil dijalankan: ${fileName}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Migration gagal (${fileName}): ${(err as Error).message}`);
  } finally {
    client.release();
  }
}

/**
 * Keterangan: Entry point migration runner — memastikan tabel tracking ada,
 * lalu menjalankan berurutan setiap file migration yang belum pernah
 * tercatat sebagai sudah dieksekusi.
 */
async function migrate(): Promise<void> {
  await ensureMigrationsTable();

  const executed = await getExecutedMigrations();
  const files = await getMigrationFiles();
  const pending = files.filter((file) => !executed.has(file));

  if (pending.length === 0) {
    console.log('Tidak ada migration baru yang perlu dijalankan.');
    return;
  }

  console.log(`Menjalankan ${pending.length} migration: ${pending.join(', ')}`);

  for (const fileName of pending) {
    await runMigration(fileName);
  }

  console.log('Semua migration selesai dijalankan.');
}

migrate()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
