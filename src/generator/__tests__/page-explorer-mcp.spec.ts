import path from 'node:path';
import { expect, test } from '@playwright/test';
import { McpBrowserSession, McpExplorationDriver } from '../mcp-client';
import {
  collectNavLinkCandidates,
  collectPageSnapshot,
  crawlAdditionalPages,
  extractTopNavLinks,
} from '../page-explorer';
import { startFixtureServer, type FixtureServer } from './helpers/static-fixture-server';

/**
 * Keterangan: Test ini KHUSUS memverifikasi fungsi crawl KOMPLEKS
 * (backdrop dismissal, hamburger/nav tersembunyi, dropdown menu) benar-benar
 * berjalan di atas McpExplorationDriver — bukan cuma PlaywrightExplorationDriver
 * (page-explorer.spec.ts) atau plumbing dasar McpBrowserSession
 * (mcp-client.spec.ts). Gap ini eksplisit dicatat sebagai "belum dikerjakan"
 * di docs/memory.md sampai sesi ini.
 */

let fixtureServer: FixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer(path.join(__dirname, 'fixtures'));
});

test.afterAll(async () => {
  await fixtureServer.close();
});

test.describe('Crawl kompleks di atas McpExplorationDriver', () => {
  test('crawlAdditionalPages menghilangkan backdrop yang menutupi menu sebelum mengklik (via MCP)', async () => {
    test.setTimeout(45_000);
    const session = new McpBrowserSession();
    try {
      await session.connect({ width: 1280, height: 720 });
      const driver = new McpExplorationDriver(session);

      await driver.goto(`${fixtureServer.baseUrl}/backdrop-app/main.html`);

      // Sanity check: backdrop benar-benar ada dan menutupi seluruh viewport
      // sebelum crawl dijalankan.
      const backdropCovers = await driver.evaluate<boolean>(
        `() => {
          const el = document.getElementById('promo-backdrop');
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
        }`,
      );
      expect(backdropCovers).toBe(true);

      const mainSnapshot = await collectPageSnapshot(driver);
      const candidates = extractTopNavLinks(mainSnapshot, 10);
      expect(candidates.map((item) => item.text)).toEqual(['Kendaraan', 'Pelanggan']);

      const pages = await crawlAdditionalPages(driver, mainSnapshot, 10);
      expect(pages.map((item) => item.title).sort()).toEqual([
        'Halaman Kendaraan',
        'Halaman Pelanggan',
      ]);
    } finally {
      await session.disconnect();
    }
  });

  test('crawlAdditionalPages membuka menu di balik tombol hamburger lalu menjelajahi tiap halamannya (via MCP)', async () => {
    test.setTimeout(45_000);
    const session = new McpBrowserSession();
    try {
      await session.connect({ width: 1280, height: 720 });
      const driver = new McpExplorationDriver(session);

      await driver.goto(`${fixtureServer.baseUrl}/nav-app/main.html`);
      const mainSnapshot = await collectPageSnapshot(driver);

      // Sanity check: nav masih tersembunyi, jadi belum ada kandidat menu.
      expect(extractTopNavLinks(mainSnapshot, 10)).toHaveLength(0);

      const pages = await crawlAdditionalPages(driver, mainSnapshot, 10);
      expect(pages.map((item) => item.title).sort()).toEqual([
        'Halaman Kendaraan',
        'Halaman Pelanggan',
      ]);
      expect(
        pages.some((item) => item.headings.some((heading) => heading.includes('Daftar Kendaraan'))),
      ).toBe(true);

      // Browser harus balik ke URL semula setelah crawl selesai.
      const finalUrl = await driver.currentUrl();
      expect(finalUrl).toBe(`${fixtureServer.baseUrl}/nav-app/main.html`);
    } finally {
      await session.disconnect();
    }
  });

  test('collectNavLinkCandidates menemukan link di dropdown menu tersembunyi (via MCP)', async () => {
    test.setTimeout(45_000);
    const session = new McpBrowserSession();
    try {
      await session.connect({ width: 1280, height: 720 });
      const driver = new McpExplorationDriver(session);

      await driver.goto(`${fixtureServer.baseUrl}/dropdown-app/main.html`);
      const snapshot = await collectPageSnapshot(driver);
      const links = await collectNavLinkCandidates(driver, snapshot, 10);

      expect(links.some((item) => item.text === 'Daftar Pelanggan')).toBe(true);
      expect(links.some((item) => item.text === 'Tambah Pelanggan')).toBe(true);
      expect(links.some((item) => item.text === 'Penjualan')).toBe(true);
    } finally {
      await session.disconnect();
    }
  });
});
