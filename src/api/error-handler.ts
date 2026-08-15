import type { FastifyError, FastifyInstance } from 'fastify';
import { ApiError } from './errors';

/**
 * Keterangan: Mendaftarkan global error handler & not-found handler Fastify
 * supaya seluruh response error (baik error terkontrol via ApiError, error
 * validasi Fastify, maupun error tak terduga) selalu punya format konsisten:
 * { error: string, statusCode: number }.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError | ApiError>((error, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({
        error: error.message,
        statusCode: error.statusCode,
      });
      return;
    }

    if (error.validation) {
      reply.status(400).send({
        error: error.message,
        statusCode: 400,
      });
      return;
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error(error);
    }

    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
      statusCode,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: `Route ${request.method} ${request.url} tidak ditemukan`,
      statusCode: 404,
    });
  });
}
