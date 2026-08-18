import { expect, test } from '@playwright/test';
import { decryptSecret, encryptSecret, maskSecret } from '../secret-box';

test('encrypt/decrypt API key dan mask tidak menampilkan nilai utuh', () => {
  const plain = 'key-placeholder-abcd';
  const cipher = encryptSecret(plain);
  expect(cipher).not.toContain(plain);
  expect(decryptSecret(cipher)).toBe(plain);
  expect(maskSecret(plain)).toBe('••••abcd');
  expect(maskSecret(plain)).not.toContain('placeholder');
});
