/**
 * Keterangan: Error terkontrol yang dilempar dari route handler untuk
 * menghasilkan response HTTP dengan status code tertentu (400, 404, 501, dst.).
 * Ditangkap oleh global error handler di error-handler.ts.
 */
export class ApiError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}
