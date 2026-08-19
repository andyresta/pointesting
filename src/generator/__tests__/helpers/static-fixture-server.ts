import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

export interface FixtureServer {
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Keterangan: Server HTTP statis lokal (port acak) untuk menyajikan fixture
 * HTML ke test yang memakai @playwright/mcp — MCP memblokir protokol
 * "file:" demi keamanan (terverifikasi lewat POC), jadi fixture untuk test
 * berbasis MCP wajib disajikan lewat http, tidak bisa file:// seperti test
 * Playwright biasa.
 */
export async function startFixtureServer(rootDir: string): Promise<FixtureServer> {
  const server = http.createServer((req, res) => {
    const filePath = path.join(rootDir, decodeURIComponent(req.url ?? '/'));
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  });

  // Keterangan: `server.close()` bawaan Node menunggu semua koneksi
  // keep-alive tertutup sendiri — kalau Chromium (via MCP) meninggalkan
  // koneksi terbuka (mis. sesi gagal ditutup bersih), close() bisa
  // menggantung sampai timeout. Lacak socket aktif dan paksa hancurkan
  // saat close() dipanggil supaya test afterAll tidak pernah hang.
  const sockets = new Set<import('node:net').Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  };
}
