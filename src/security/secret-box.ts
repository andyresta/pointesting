import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config/env';

const KEY_LENGTH = 32;
const IV_LENGTH = 12;

let derivedKey: Buffer | undefined;

/**
 * Keterangan: Menurunkan kunci AES-256 dari AUTH_SECRET (bukan dari API key
 * user). Hasil di-cache di memori proses agar scrypt tidak diulang tiap request.
 */
function getEncryptionKey(): Buffer {
  if (!derivedKey) {
    derivedKey = scryptSync(config.AUTH_SECRET, 'pointesting-project-provider', KEY_LENGTH);
  }
  return derivedKey;
}

/**
 * Keterangan: Mengenkripsi rahasia (API key) dengan AES-256-GCM. Format simpan
 * di DB: iv.tag.ciphertext (masing-masing base64).
 */
export function encryptSecret(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

/**
 * Keterangan: Mendekripsi nilai dari encryptSecret. Gagal bila ciphertext
 * rusak atau AUTH_SECRET berbeda dari saat data disimpan.
 */
export function decryptSecret(payload: string): string {
  const [ivPart, tagPart, dataPart] = payload.split('.');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Ciphertext API key tidak valid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivPart, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Keterangan: Menyembunyikan API key untuk tampilan UI (hanya 4 karakter
 * terakhir), tanpa pernah menampilkan nilai penuh.
 */
export function maskSecret(plainText: string): string {
  const trimmed = plainText.trim();
  if (trimmed.length === 0) {
    return '';
  }
  if (trimmed.length <= 4) {
    return '••••';
  }
  return `••••${trimmed.slice(-4)}`;
}
