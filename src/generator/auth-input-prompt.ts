import type { AuthZone } from './site-model';

/** Payload field untuk UI form dinamis (tanpa nilai secret). */
export interface AuthInputFieldPrompt {
  key: string;
  label: string;
  selectorHint: string;
  secret?: boolean;
  inputType?: string;
}

/** Request pause menunggu input user untuk satu AuthZone. */
export interface PendingAuthInputRequest {
  zone: AuthZone;
  resolve: (result: AuthInputResolution) => void;
}

export type AuthInputResolution =
  | { type: 'submitted'; values: Record<string, string> }
  | { type: 'skipped' };

const pendingByGenerateId = new Map<string, Map<string, PendingAuthInputRequest>>();

/**
 * Keterangan: Menyusun daftar field untuk event WS generate:need-input
 * (tanpa menyertakan nilai secret).
 */
export function buildAuthInputFieldPrompts(zone: AuthZone): AuthInputFieldPrompt[] {
  return zone.fields.map((field) => ({
    key: field.key,
    label: field.label,
    selectorHint: field.selector,
    secret: field.secret,
    inputType: field.inputType,
  }));
}

/**
 * Keterangan: Mendaftarkan job generate yang sedang menunggu input auth
 * untuk satu zona — Promise resolve saat user submit atau skip (tanpa timeout).
 */
export function waitForAuthInput(
  generateId: string,
  zone: AuthZone,
): Promise<AuthInputResolution> {
  let zones = pendingByGenerateId.get(generateId);
  if (!zones) {
    zones = new Map();
    pendingByGenerateId.set(generateId, zones);
  }

  const existing = zones.get(zone.zoneId);
  if (existing) {
    return new Promise((resolve) => {
      existing.resolve = resolve;
    });
  }

  return new Promise((resolve) => {
    zones!.set(zone.zoneId, { zone, resolve });
  });
}

/**
 * Keterangan: Menerima nilai input user untuk zona auth yang sedang pause.
 * Mengembalikan false jika generateId/zoneId tidak sedang menunggu.
 */
export function submitAuthInput(
  generateId: string,
  zoneId: string,
  values: Record<string, string>,
): boolean {
  const zones = pendingByGenerateId.get(generateId);
  const pending = zones?.get(zoneId);
  if (!pending) {
    return false;
  }
  zones!.delete(zoneId);
  if (zones!.size === 0) {
    pendingByGenerateId.delete(generateId);
  }
  pending.resolve({ type: 'submitted', values });
  return true;
}

/**
 * Keterangan: User memilih lewati zona auth — crawl lanjut tanpa autentikasi
 * di area gated tersebut.
 */
export function skipAuthZone(generateId: string, zoneId: string): boolean {
  const zones = pendingByGenerateId.get(generateId);
  const pending = zones?.get(zoneId);
  if (!pending) {
    return false;
  }
  zones!.delete(zoneId);
  if (zones!.size === 0) {
    pendingByGenerateId.delete(generateId);
  }
  pending.resolve({ type: 'skipped' });
  return true;
}

/**
 * Keterangan: Membersihkan registry pause saat job generate selesai/gagal
 * agar tidak bocor memory.
 */
export function clearAuthInputSession(generateId: string): void {
  pendingByGenerateId.delete(generateId);
}

/**
 * Keterangan: Mengecek apakah job generate sedang menunggu input untuk zona.
 */
export function isWaitingForAuthInput(generateId: string, zoneId: string): boolean {
  return pendingByGenerateId.get(generateId)?.has(zoneId) ?? false;
}
