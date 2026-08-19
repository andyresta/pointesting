import type { ExplorationDriver } from './exploration-driver';
import {
  collectInteractionCandidates,
  collectPageSnapshot,
  countInteractionCandidates,
  dismissOpenModal,
  snapshotShowsFormOverlay,
} from './page-explorer';
import type { PageExplorationResult } from './page-explorer';
import { classifyPageKind, looksLikeAuthWall, normalizeUrlForZone, type SiteModel } from './site-model';

export type InteractionExploreHandler = {
  emit: (phase: string, message: string) => void;
  handleAuthOverlay: (
    snapshot: PageExplorationResult,
  ) => Promise<'none' | 'handled' | 'gated'>;
  canRegisterMorePages: () => boolean;
};

/**
 * Keterangan: Mengeksplorasi tombol/aksi interaktif pada halaman saat ini
 * (bukan hanya navigasi href): klik, amati modal/form, auth vs form umum.
 * Dialog native (confirm/alert/prompt) yang muncul akibat klik otomatis
 * di-dismiss oleh driver sendiri (lihat exploration-driver.ts/mcp-client.ts)
 * — tidak perlu listener terpisah di sini seperti sebelumnya.
 */
export async function explorePageInteractions(
  driver: ExplorationDriver,
  pageSnapshot: PageExplorationResult,
  model: SiteModel,
  interactionVisited: Set<string>,
  handlers: InteractionExploreHandler,
  maxInteractions: number,
): Promise<void> {
  const candidates = collectInteractionCandidates(pageSnapshot, maxInteractions);
  if (candidates.length === 0) {
    return;
  }

  // Laporan cakupan yang terlewat (Prioritas 5) — kalau halaman ini punya
  // lebih banyak kandidat interaksi valid daripada kuota per-halaman, JANGAN
  // diam-diam memotongnya tanpa jejak.
  const totalCandidates = countInteractionCandidates(pageSnapshot);
  if (totalCandidates > candidates.length) {
    handlers.emit(
      'coverage',
      `Kuota interaksi per halaman (${maxInteractions}) tercapai di "${pageSnapshot.title || pageSnapshot.url}" — ${totalCandidates - candidates.length} kandidat tombol/aksi lain TIDAK dicoba.`,
    );
  }

  const beforeSnapshot = pageSnapshot;
  const pageKey = normalizeUrlForZone(pageSnapshot.url);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (!handlers.canRegisterMorePages()) {
      const remaining = candidates.slice(index).map((item) => item.label);
      handlers.emit(
        'coverage',
        `Kuota total halaman situs tercapai — eksplorasi interaksi di "${pageSnapshot.title || pageSnapshot.url}" dihentikan, ${remaining.length} kandidat belum dicoba: ${remaining.join(', ')}.`,
      );
      break;
    }

    const interactionKey = `${pageKey}::${candidate.selector}`;
    if (interactionVisited.has(interactionKey)) {
      continue;
    }
    interactionVisited.add(interactionKey);

    handlers.emit('explore', `AI mencoba tombol "${candidate.label}"…`);

    const urlBefore = await driver.currentUrl();
    try {
      await driver.click(candidate.selector);
      await new Promise((resolve) => setTimeout(resolve, 350));
    } catch {
      continue;
    }

    const urlAfter = await driver.currentUrl();
    if (urlAfter !== urlBefore && normalizePathOnly(urlAfter) !== normalizePathOnly(urlBefore)) {
      // Klik ternyata navigasi halaman sungguhan (bukan modal) — kembali ke
      // URL semula, biarkan flow nav-link biasa yang menanganinya nanti.
      await driver.goto(urlBefore, { timeoutMs: 5_000 }).catch(() => undefined);
      continue;
    }

    const overlaySnapshot = await collectPageSnapshot(driver);
    const showsForm = snapshotShowsFormOverlay(beforeSnapshot, overlaySnapshot);

    if (!showsForm) {
      await dismissOpenModal(driver);
      continue;
    }

    if (looksLikeAuthWall(overlaySnapshot)) {
      handlers.emit('explore', `Form "${candidate.label}" terdeteksi auth — menilai…`);
      const authResult = await handlers.handleAuthOverlay(overlaySnapshot);
      await dismissOpenModal(driver);
      if (authResult === 'gated' || authResult === 'handled') {
        continue;
      }
    }

    if (!handlers.canRegisterMorePages()) {
      await dismissOpenModal(driver);
      const remaining = candidates.slice(index + 1).map((item) => item.label);
      handlers.emit(
        'coverage',
        `Kuota total halaman situs tercapai — form "${candidate.label}" di "${pageSnapshot.title || pageSnapshot.url}" ditemukan tapi TIDAK dicatat untuk authoring${remaining.length > 0 ? `, ${remaining.length} kandidat lain juga belum dicoba: ${remaining.join(', ')}` : ''}.`,
      );
      break;
    }

    const contextLabel = `${pageSnapshot.title || 'Halaman'} › ${candidate.label}`;
    const duplicate = model.pages.some(
      (entry) =>
        entry.interactionContext === contextLabel &&
        entry.snapshot.url === overlaySnapshot.url,
    );
    if (!duplicate) {
      model.pages.push({
        snapshot: overlaySnapshot,
        kind: classifyPageKind(overlaySnapshot),
        gated: false,
        interactionContext: contextLabel,
        interactionParentUrl: pageSnapshot.url,
      });
      handlers.emit(
        'explore',
        `Form "${candidate.label}" tercatat untuk authoring test case`,
      );
    }

    await dismissOpenModal(driver);
  }
}

function normalizePathOnly(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
