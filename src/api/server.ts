import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import Fastify from 'fastify';
import * as path from 'node:path';
import { authMiddleware } from './auth.middleware';
import { config } from '../config/env';
import { registerErrorHandler } from './error-handler';
import { recoverStaleRunningTestRuns } from '../queue/queue';
import { registerWebSocketGateway } from '../ws/gateway';
import { aiRoutes } from './routes/ai.routes';
import { authRoutes } from './routes/auth.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { generatorRoutes } from './routes/generator.routes';
import { projectRoutes } from './routes/project.routes';
import { testCaseRoutes } from './routes/testcase.routes';
import { testRunRoutes } from './routes/testrun.routes';

/**
 * Keterangan: Membuat dan mengonfigurasi instance Fastify server — global
 * error handler, autentikasi JWT global (kecuali /health & /auth/login),
 * endpoint health check, gerbang `/` (redirect login/dashboard), dan seluruh route resource sesuai
 * docs/arsitektur-spesifikasi-teknis.md bagian "5. Spesifikasi API (REST)".
 */
export function buildServer() {
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          'req.headers.authorization',
          'req.body.apiKey',
          'req.body.providers[*].apiKey',
        ],
        censor: '***',
      },
    },
  });
  const projectRoot = path.resolve(__dirname, '../..');

  registerErrorHandler(app);
  app.register(fastifyView, {
    engine: { ejs },
    root: path.join(projectRoot, 'src', 'ui', 'views'),
  });
  app.register(fastifyStatic, {
    root: path.join(projectRoot, 'src', 'ui', 'public'),
    prefix: '/assets/',
  });
  app.register(fastifyStatic, {
    root: path.join(projectRoot, 'node_modules', 'htmx.org', 'dist'),
    prefix: '/vendor/htmx/',
    decorateReply: false,
  });
  app.addHook('preHandler', authMiddleware);

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.register(projectRoutes);
  app.register(testCaseRoutes);
  app.register(testRunRoutes);
  app.register(aiRoutes);
  app.register(generatorRoutes);
  app.register(authRoutes);
  app.register(dashboardRoutes);
  registerWebSocketGateway(app);

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

if (require.main === module) {
  void start();
}
