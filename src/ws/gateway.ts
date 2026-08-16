import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { verifyAuthToken } from '../api/auth.middleware';
import type { RunClientEvent, RunServerEvent } from './events';

const subscribersByRun = new Map<string, Set<WebSocket>>();
const subscriptionsBySocket = new Map<WebSocket, Set<string>>();

/**
 * Keterangan: Menambahkan socket ke subscription run tertentu dan mencatat
 * relasi balik agar seluruh subscription bisa dibersihkan saat socket tutup.
 */
function subscribeSocket(socket: WebSocket, runId: string): void {
  const runSubscribers = subscribersByRun.get(runId) ?? new Set<WebSocket>();
  runSubscribers.add(socket);
  subscribersByRun.set(runId, runSubscribers);

  const socketSubscriptions =
    subscriptionsBySocket.get(socket) ?? new Set<string>();
  socketSubscriptions.add(runId);
  subscriptionsBySocket.set(socket, socketSubscriptions);
}

/**
 * Keterangan: Menghapus socket dari satu subscription run dan membuang Set
 * kosong supaya Map pub/sub tidak bertumbuh setelah run selesai.
 */
function unsubscribeSocket(socket: WebSocket, runId: string): void {
  const runSubscribers = subscribersByRun.get(runId);
  runSubscribers?.delete(socket);
  if (runSubscribers?.size === 0) {
    subscribersByRun.delete(runId);
  }

  const socketSubscriptions = subscriptionsBySocket.get(socket);
  socketSubscriptions?.delete(runId);
  if (socketSubscriptions?.size === 0) {
    subscriptionsBySocket.delete(socket);
  }
}

/**
 * Keterangan: Membersihkan seluruh subscription milik socket yang ditutup.
 */
function cleanupSocket(socket: WebSocket): void {
  const runIds = subscriptionsBySocket.get(socket);
  if (!runIds) {
    return;
  }

  for (const runId of [...runIds]) {
    unsubscribeSocket(socket, runId);
  }
}

/**
 * Keterangan: Memvalidasi dan menangani pesan subscribe/unsubscribe dari
 * client. Pesan malformed diabaikan tanpa menjatuhkan gateway.
 */
function handleClientMessage(socket: WebSocket, rawMessage: WebSocket.RawData): void {
  let event: RunClientEvent;
  try {
    event = JSON.parse(rawMessage.toString()) as RunClientEvent;
  } catch {
    return;
  }

  if (typeof event.runId !== 'string' || event.runId.trim() === '') {
    return;
  }

  if (event.type === 'subscribe:run') {
    subscribeSocket(socket, event.runId);
  } else if (event.type === 'unsubscribe:run') {
    unsubscribeSocket(socket, event.runId);
  }
}

/**
 * Keterangan: Menyelesaikan handshake WebSocket yang tokennya invalid lalu
 * langsung menutup socket dengan code 4001 sebelum listener message dipasang.
 */
function rejectUnauthorizedSocket(
  webSocketServer: WebSocketServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocket.close(4001, 'Token JWT WebSocket tidak valid');
  });
}

/**
 * Keterangan: Attach WebSocket gateway path `/ws` ke HTTP server Fastify yang
 * sama. JWT wajib berasal dari query `?token=...`; koneksi tanpa token/invalid
 * ditutup code 4001 sebelum bisa subscribe.
 */
export function registerWebSocketGateway(app: FastifyInstance): void {
  const webSocketServer = new WebSocketServer({ noServer: true });

  webSocketServer.on('connection', (socket) => {
    socket.on('message', (message) => handleClientMessage(socket, message));
    socket.on('close', () => cleanupSocket(socket));
    socket.on('error', () => cleanupSocket(socket));
  });

  app.server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? 'localhost'}`,
    );

    if (requestUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const token = requestUrl.searchParams.get('token');
    try {
      if (!token) {
        throw new Error('Token kosong');
      }
      verifyAuthToken(token);
    } catch {
      rejectUnauthorizedSocket(webSocketServer, request, socket, head);
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });
}

/**
 * Keterangan: Mengirim event hanya ke client yang subscribe pada runId
 * tersebut; socket run lain tidak menerima event.
 */
export function broadcastToRun(runId: string, event: RunServerEvent): void {
  const subscribers = subscribersByRun.get(runId);
  if (!subscribers) {
    return;
  }

  const payload = JSON.stringify(event);
  for (const socket of subscribers) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}
