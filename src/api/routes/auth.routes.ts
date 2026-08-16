import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { AUTH_COOKIE_NAME, signAuthToken } from '../auth.middleware';
import { config } from '../../config/env';
import { ApiError } from '../errors';

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

/**
 * Keterangan: Mendaftarkan route POST /auth/login sesuai spesifikasi API
 * bagian 5 & 7 — autentikasi personal/single-user. Credential (username +
 * hash password) dibaca dari env, bukan tabel user di database. Password
 * diverifikasi dengan bcrypt; kalau valid, keluarkan JWT (masa berlaku 7 hari)
 * yang dipakai untuk mengakses route lain lewat header Authorization.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    const body = request.body as LoginBody | undefined;

    if (typeof body?.username !== 'string' || body.username.trim() === '') {
      throw new ApiError(400, 'Field "username" wajib diisi (string)');
    }
    if (typeof body?.password !== 'string' || body.password === '') {
      throw new ApiError(400, 'Field "password" wajib diisi (string)');
    }

    // Bandingkan username dulu sebelum bcrypt.compare (hemat kerja), tapi
    // tetap balas pesan error yang sama supaya tidak bocorkan username valid.
    const usernameMatches = body.username === config.AUTH_USERNAME;
    const passwordMatches = usernameMatches
      ? await bcrypt.compare(body.password, config.AUTH_PASSWORD_HASH)
      : false;

    if (!usernameMatches || !passwordMatches) {
      throw new ApiError(401, 'Username atau password salah');
    }

    const token = signAuthToken(body.username);
    reply.header(
      'Set-Cookie',
      `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`,
    );

    return { token, tokenType: 'Bearer', expiresIn: '7d' };
  });
}
