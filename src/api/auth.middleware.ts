import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { ApiError } from './errors';

const TOKEN_EXPIRY = '7d';

export interface AuthTokenPayload {
  username: string;
}

/**
 * Route yang tidak memerlukan token JWT — health check dan login itu sendiri.
 * Dicocokkan berdasarkan method + path (tanpa query string).
 */
const PUBLIC_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'GET', path: '/health' },
  { method: 'POST', path: '/auth/login' },
];

/**
 * Keterangan: Mengecek apakah request menuju salah satu route publik
 * (tidak butuh autentikasi) berdasarkan method dan path.
 */
function isPublicRoute(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0];
  return PUBLIC_ROUTES.some(
    (route) => route.method === request.method && route.path === path,
  );
}

/**
 * Keterangan: Membuat JWT baru untuk username yang berhasil login, signed
 * dengan AUTH_SECRET, masa berlaku 7 hari sesuai spesifikasi.
 */
export function signAuthToken(username: string): string {
  const payload: AuthTokenPayload = { username };
  return jwt.sign(payload, config.AUTH_SECRET, { expiresIn: TOKEN_EXPIRY });
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthTokenPayload;
  }
}

/**
 * Keterangan: Fastify preHandler hook global — memvalidasi JWT dari header
 * "Authorization: Bearer <token>" untuk semua route KECUALI /health dan
 * /auth/login. Melempar ApiError 401 kalau header tidak ada, format salah,
 * atau token invalid/kedaluwarsa. Payload yang valid disimpan di
 * request.authUser untuk dipakai handler berikutnya bila perlu.
 */
export async function authMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (isPublicRoute(request)) {
    return;
  }

  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiError(401, 'Header "Authorization: Bearer <token>" wajib diisi');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new ApiError(401, 'Token JWT tidak boleh kosong');
  }

  try {
    request.authUser = jwt.verify(token, config.AUTH_SECRET) as AuthTokenPayload;
  } catch {
    throw new ApiError(401, 'Token JWT tidak valid atau sudah kedaluwarsa');
  }
}
