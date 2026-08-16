import Fastify, { type FastifyInstance } from 'fastify';
import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import { signAuthToken } from '../../api/auth.middleware';
import { config } from '../../config/env';
import { broadcastToRun, registerWebSocketGateway } from '../gateway';

/**
 * Keterangan: Membuat Fastify + gateway pada port acak untuk isolasi test.
 */
async function createGatewayServer(): Promise<{
  app: FastifyInstance;
  wsUrl: string;
}> {
  const app = Fastify();
  registerWebSocketGateway(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, wsUrl: `${address.replace('http', 'ws')}/ws` };
}

/**
 * Keterangan: Membuka WebSocket dan resolve setelah handshake berhasil.
 */
async function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

/**
 * Keterangan: Memberi gateway waktu singkat untuk memproses pesan subscribe.
 */
async function waitForSubscription(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

test('menutup koneksi tanpa JWT valid memakai code 4001', async () => {
  const { app, wsUrl } = await createGatewayServer();

  try {
    const closeCode = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`${wsUrl}?token=invalid`);
      socket.once('close', resolve);
      socket.once('error', reject);
    });

    expect(closeCode).toBe(4001);
  } finally {
    await app.close();
  }
});

test('broadcast hanya diterima subscriber runId yang sesuai', async () => {
  const { app, wsUrl } = await createGatewayServer();
  const token = signAuthToken(config.AUTH_USERNAME);
  const runASocket = await openSocket(
    `${wsUrl}?token=${encodeURIComponent(token)}`,
  );
  const runBSocket = await openSocket(
    `${wsUrl}?token=${encodeURIComponent(token)}`,
  );

  try {
    let runBReceived = false;
    runBSocket.on('message', () => {
      runBReceived = true;
    });
    runASocket.send(JSON.stringify({ type: 'subscribe:run', runId: 'run-a' }));
    runBSocket.send(JSON.stringify({ type: 'subscribe:run', runId: 'run-b' }));
    await waitForSubscription();

    const runAEvent = new Promise<{ runId: string }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Event run-a tidak diterima')),
        500,
      );
      runASocket.once('message', (rawMessage) => {
        clearTimeout(timeout);
        resolve(JSON.parse(rawMessage.toString()) as { runId: string });
      });
    });

    broadcastToRun('run-a', {
      type: 'run:status',
      runId: 'run-a',
      status: 'running',
    });

    await expect(runAEvent).resolves.toMatchObject({ runId: 'run-a' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(runBReceived).toBe(false);
  } finally {
    runASocket.close();
    runBSocket.close();
    await app.close();
  }
});
