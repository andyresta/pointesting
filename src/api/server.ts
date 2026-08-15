import Fastify from 'fastify';
import { authMiddleware } from './auth.middleware';
import { config } from '../config/env';
import { registerErrorHandler } from './error-handler';
import { recoverStaleRunningTestRuns } from '../queue/queue';
import { aiRoutes } from './routes/ai.routes';
import { authRoutes } from './routes/auth.routes';
import { projectRoutes } from './routes/project.routes';
import { testCaseRoutes } from './routes/testcase.routes';
import { testRunRoutes } from './routes/testrun.routes';

/**
 * Keterangan: Membuat dan mengonfigurasi instance Fastify server — global
 * error handler, autentikasi JWT global (kecuali /health & /auth/login),
 * endpoint health check, dan seluruh route resource sesuai
 * docs/arsitektur-spesifikasi-teknis.md bagian "5. Spesifikasi API (REST)".
 */
function buildServer() {
  const app = Fastify({ logger: true });

  registerErrorHandler(app);
  app.addHook('preHandler', authMiddleware);

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.register(projectRoutes);
  app.register(testCaseRoutes);
  app.register(testRunRoutes);
  app.register(aiRoutes);
  app.register(authRoutes);

  return app;
}

/**
 * Keterangan: Menjalankan server Fastify pada PORT dari config yang
 * sudah divalidasi Zod. Sebelum menerima request, recovery test_run yang
 * masih 'running' dari sesi sebelumnya dijalankan dulu (server restart),
 * lalu proses dihentikan jika terjadi error saat listen.
 */
async function start() {
  const app = buildServer();

  try {
    await recoverStaleRunningTestRuns();
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
