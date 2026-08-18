import type { PoolClient } from 'pg';
import { PROVIDER_NAMES, type ProviderName } from '../../config/env';
import { decryptSecret, encryptSecret, maskSecret } from '../../security/secret-box';
import { pool } from '../client';
import type {
  ProjectProviderPublic,
  ProjectProviderSecret,
} from './types';

interface ProjectProviderRow {
  id: string;
  projectId: string;
  provider: string;
  apiKeyCipher: string;
  defaultModel: string | null;
  sortOrder: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

const COLUMNS = `
  id,
  project_id AS "projectId",
  provider,
  api_key_cipher AS "apiKeyCipher",
  default_model AS "defaultModel",
  sort_order AS "sortOrder",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

/**
 * Keterangan: Memastikan nama provider dari DB termasuk daftar yang didukung.
 */
function asProviderName(value: string): ProviderName | null {
  return PROVIDER_NAMES.includes(value as ProviderName)
    ? (value as ProviderName)
    : null;
}

export class ProjectProviderRepository {
  /**
   * Keterangan: Mengambil kredensial publik (tanpa API key utuh) milik satu
   * project, diurutkan untuk fallback.
   */
  async findPublicByProjectId(projectId: string): Promise<ProjectProviderPublic[]> {
    const rows = await this.findRows(projectId);
    return rows.flatMap((row) => {
      const provider = asProviderName(row.provider);
      if (!provider) {
        return [];
      }
      let masked = '••••';
      try {
        masked = maskSecret(decryptSecret(row.apiKeyCipher));
      } catch {
        masked = '••••';
      }
      return [
        {
          provider,
          hasApiKey: true,
          apiKeyMasked: masked,
          defaultModel: row.defaultModel,
          sortOrder: row.sortOrder,
        },
      ];
    });
  }

  /**
   * Keterangan: Mengambil API key terdekripsi untuk runtime analyzer. Hanya
   * dipanggil di backend, tidak untuk response HTTP.
   */
  async findSecretsByProjectId(projectId: string): Promise<ProjectProviderSecret[]> {
    const rows = await this.findRows(projectId);
    const secrets: ProjectProviderSecret[] = [];
    for (const row of rows) {
      const provider = asProviderName(row.provider);
      if (!provider) {
        continue;
      }
      secrets.push({
        provider,
        apiKey: decryptSecret(row.apiKeyCipher),
        defaultModel: row.defaultModel,
        sortOrder: row.sortOrder,
      });
    }
    return secrets;
  }

  /**
   * Keterangan: Mengganti seluruh set provider sebuah project di dalam
   * transaction: hapus yang tidak ada di daftar, upsert yang punya API key
   * baru, pertahankan cipher lama jika apiKey kosong.
   */
  async replaceForProject(
    projectId: string,
    entries: Array<{
      provider: ProviderName;
      apiKey?: string;
      defaultModel?: string | null;
    }>,
    client: PoolClient,
  ): Promise<void> {
    const existing = await this.findRows(projectId, client);
    const existingByProvider = new Map(
      existing.map((row) => [row.provider, row] as const),
    );
    const keep = new Set(entries.map((entry) => entry.provider));

    for (const row of existing) {
      if (!keep.has(row.provider as ProviderName)) {
        await client.query(
          'DELETE FROM project_provider WHERE id = $1',
          [row.id],
        );
      }
    }

    for (const [index, entry] of entries.entries()) {
      const previous = existingByProvider.get(entry.provider);
      const nextKey = entry.apiKey?.trim() ?? '';
      if (!nextKey && !previous) {
        continue;
      }
      const cipher = nextKey ? encryptSecret(nextKey) : previous!.apiKeyCipher;
      const defaultModel =
        entry.defaultModel === undefined
          ? (previous?.defaultModel ?? null)
          : entry.defaultModel;

      await client.query(
        `INSERT INTO project_provider
           (project_id, provider, api_key_cipher, default_model, sort_order, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (project_id, provider)
         DO UPDATE SET
           api_key_cipher = EXCLUDED.api_key_cipher,
           default_model = EXCLUDED.default_model,
           sort_order = EXCLUDED.sort_order,
           updated_at = now()`,
        [projectId, entry.provider, cipher, defaultModel, index],
      );
    }
  }

  /**
   * Keterangan: Membaca row mentah project_provider tanpa mendekripsi, untuk
   * operasi replace dan mapping publik/rahasia.
   */
  private async findRows(
    projectId: string,
    client?: PoolClient,
  ): Promise<ProjectProviderRow[]> {
    const db = client ?? pool;
    const result = await db.query<ProjectProviderRow>(
      `SELECT ${COLUMNS}
       FROM project_provider
       WHERE project_id = $1
       ORDER BY sort_order ASC, provider ASC`,
      [projectId],
    );
    return result.rows;
  }
}

export const projectProviderRepository = new ProjectProviderRepository();
