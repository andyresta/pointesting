import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

/**
 * Keterangan: Utilitas CLI untuk generate bcrypt hash dari password plain
 * text, dipakai untuk mengisi env AUTH_PASSWORD_HASH. Jalankan dengan:
 * npm run hash-password -- "password-anda"
 */
async function main(): Promise<void> {
  const password = process.argv[2];

  if (!password) {
    console.error('Penggunaan: npm run hash-password -- "password-anda"');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
