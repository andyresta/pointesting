import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { PlaywrightExplorationDriver } from '../exploration-driver';
import { explorePageInteractions } from '../interaction-explorer';
import { collectPageSnapshot } from '../page-explorer';
import type { SiteModel } from '../site-model';

const INTERACTION_QUOTA_APP_URL = pathToFileURL(
  path.join(__dirname, 'fixtures', 'interaction-quota-app.html'),
).href;

/**
 * Keterangan: Test khusus Prioritas 5 (laporan cakupan yang terlewat) —
 * memverifikasi explorePageInteractions BENAR-BENAR emit status 'coverage'
 * (bukan diam-diam memotong) saat kuota per-halaman ATAU kuota total
 * halaman situs tercapai sebelum semua kandidat interaksi dicoba.
 */
test.describe('explorePageInteractions — laporan cakupan yang terlewat', () => {
  test('emit status coverage saat kuota interaksi per-halaman (maxInteractions) lebih kecil dari total kandidat', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const driver = new PlaywrightExplorationDriver(page);
      await page.goto(INTERACTION_QUOTA_APP_URL, { waitUntil: 'domcontentloaded' });
      const snapshot = await collectPageSnapshot(driver);

      const model: SiteModel = { pages: [], authZones: [] };
      const messages: Array<{ phase: string; message: string }> = [];

      await explorePageInteractions(
        driver,
        snapshot,
        model,
        new Set(),
        {
          emit: (phase, message) => messages.push({ phase, message }),
          handleAuthOverlay: async () => 'none',
          canRegisterMorePages: () => true,
        },
        2, // maxInteractions lebih kecil dari 4 kandidat yang tersedia di fixture
      );

      const coverageMessages = messages.filter((item) => item.phase === 'coverage');
      expect(coverageMessages.length).toBeGreaterThan(0);
      expect(coverageMessages.some((item) => item.message.includes('2 kandidat'))).toBe(true);
    } finally {
      await browser.close();
    }
  });

  test('emit status coverage saat kuota total halaman situs tercapai sebelum interaksi pertama dicoba', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const driver = new PlaywrightExplorationDriver(page);
      await page.goto(INTERACTION_QUOTA_APP_URL, { waitUntil: 'domcontentloaded' });
      const snapshot = await collectPageSnapshot(driver);

      const model: SiteModel = { pages: [], authZones: [] };
      const messages: Array<{ phase: string; message: string }> = [];

      await explorePageInteractions(
        driver,
        snapshot,
        model,
        new Set(),
        {
          emit: (phase, message) => messages.push({ phase, message }),
          handleAuthOverlay: async () => 'none',
          canRegisterMorePages: () => false,
        },
        10,
      );

      const coverageMessages = messages.filter((item) => item.phase === 'coverage');
      expect(coverageMessages.length).toBeGreaterThan(0);
      expect(coverageMessages.some((item) => /4 kandidat/.test(item.message))).toBe(true);
      // Tidak ada aksi "explore" yang sempat dicoba sama sekali karena
      // canRegisterMorePages() sudah false sejak awal.
      expect(messages.some((item) => item.phase === 'explore')).toBe(false);
    } finally {
      await browser.close();
    }
  });
});
