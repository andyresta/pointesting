import type { CDPSession, Page } from '@playwright/test';
import { broadcastToRun } from '../ws/gateway';

interface ScreencastFramePayload {
  data: string;
  sessionId: number;
}

export interface ScreencastController {
  stop(): Promise<void>;
}

/**
 * Keterangan: Memulai screencast Chromium melalui CDP karena Playwright yang
 * terpasang belum mengekspos `page.screencast` pada API publik/types. Frame
 * JPEG diperkecil (maks. 640x360, quality 50) lalu dibroadcast hanya ke
 * subscriber run terkait. Setiap frame langsung di-ack agar CDP lanjut kirim.
 */
export async function startScreencast(
  page: Page,
  runId: string,
): Promise<ScreencastController> {
  const client: CDPSession = await page.context().newCDPSession(page);
  let stopped = false;

  client.on('Page.screencastFrame', (payload: ScreencastFramePayload) => {
    broadcastToRun(runId, {
      type: 'run:frame',
      runId,
      frame: payload.data,
      timestamp: new Date().toISOString(),
    });

    void client
      .send('Page.screencastFrameAck', { sessionId: payload.sessionId })
      .catch(() => undefined);
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 50,
    maxWidth: 640,
    maxHeight: 360,
    everyNthFrame: 1,
  });

  return {
    /**
     * Keterangan: Menghentikan screencast dan melepas CDP session secara
     * idempotent sebelum context/browser ditutup.
     */
    async stop(): Promise<void> {
      if (stopped) {
        return;
      }
      stopped = true;
      await client.send('Page.stopScreencast').catch(() => undefined);
      await client.detach().catch(() => undefined);
    },
  };
}
