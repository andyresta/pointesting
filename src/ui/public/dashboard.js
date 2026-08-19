const token = sessionStorage.getItem('pointestingToken');
const activeSockets = new Map();
const pollTimers = new Map();
const pendingAnalysisByRun = new Map();
const suiteAnalysisTimers = new Map();
let activeRunSessionId = null;
let activeRunSessionProjectId = null;
const TERMINAL_STATUSES = ['passed', 'failed', 'error'];
const MAX_ANALYSIS_POLL_ATTEMPTS = 30;

/**
 * Keterangan: Mengambil container live view/replay dari panel run workspace
 * (halaman test case) atau panel run inline lama bila masih ada.
 */
function getRunContentElement(panel) {
  return panel.querySelector('.run-content') ?? panel.querySelector('.generate-view');
}

/**
 * Keterangan: Mengambil elemen test case aktif di sidebar halaman test case.
 */
function findTestCaseItem(testCaseId) {
  if (!testCaseId) {
    return null;
  }
  return document.querySelector(`.test-case-item[data-test-case-id="${testCaseId}"]`);
}

/**
 * Keterangan: Memperbarui badge status run per baris test case di sidebar.
 */
function updateTestCaseRunBadge(testCaseId, status) {
  const item = findTestCaseItem(testCaseId);
  const badge = item?.querySelector('.test-case-run-badge');
  if (!badge) {
    return;
  }
  badge.hidden = false;
  badge.className = `status-badge test-case-run-badge status-${status}`;
  badge.textContent = status;
}
const providerCatalogs = new Map();
const STEP_ACTIONS = [
  'goto',
  'fill',
  'click',
  'check',
  'select',
  'waitFor',
  'assertVisible',
  'assertHidden',
  'assertChecked',
  'assertText',
  'assertValue',
  'assertCount',
  'assertUrl',
];
const PROVIDER_LABELS = {
  claude: 'Claude',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
};
const ICON_TRASH = [
  'M3 6h18',
  'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
  'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
];

/**
 * Keterangan: Membuat SVG ikon stroke untuk tombol aksi tanpa library ikon.
 */
function createIconSvg(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('button-icon');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * Keterangan: Menampilkan spinner di tombol ikon (edit/hapus) selama request.
 */
function setIconButtonLoading(button, isLoading) {
  button.disabled = isLoading;
  const icon = button.querySelector('.button-icon');
  const spinner = button.querySelector('.spinner');
  if (icon) {
    icon.hidden = isLoading;
  }
  if (spinner) {
    spinner.hidden = !isLoading;
  }
}

/**
 * Keterangan: Menampilkan atau menyembunyikan spinner di tombol Run serta
 * menjaga tombol disable selama test masih diproses.
 */
function setRunButtonLoading(button, isLoading) {
  if (!button) {
    return;
  }
  button.disabled = isLoading;
  const label = button.querySelector('.button-label');
  const spinner = button.querySelector('.spinner');
  if (label) {
    label.hidden = isLoading;
  }
  if (spinner) {
    spinner.hidden = !isLoading;
  }
}

/**
 * Keterangan: Mengaktifkan tombol Stop hanya saat ada run Playwright yang
 * sedang berjalan di halaman test case.
 */
function setStopRunEnabled(enabled) {
  const button = document.querySelector('#stop-run-button');
  if (!button) {
    return;
  }
  button.disabled = !enabled;
  if (!enabled) {
    setRunButtonLoading(button, false);
  }
}

/**
 * Keterangan: Mengambil panel HASIL RUN gabungan (bukti/video/log + AI
 * Analysis jadi SATU panel, satu header, SATU tombol collapse) di bawah
 * panel live Playwright — DIPISAH dari panel live view itu sendiri supaya
 * selesai run tidak mengganti/reset live-frame yang sedang tampil (lihat
 * resetRunEvidencePanel). Sebelumnya ini 2 aside terpisah (masing-masing
 * header+toggle sendiri) — digabung jadi 1 supaya saat di-collapse, tinggi
 * panel yang tersisa cuma SATU baris header, bukan dua, dan tidak menutupi
 * panel live Playwright.
 */
function getRunResultPanel(panel) {
  let panelEl = panel.querySelector('.run-result-panel');
  if (!panelEl) {
    panelEl = document.createElement('aside');
    panelEl.className = 'run-result-panel';
    panelEl.hidden = true;
    const view = getRunContentElement(panel);
    if (view?.parentElement) {
      view.parentElement.insertBefore(panelEl, view.nextSibling);
    } else {
      panel.append(panelEl);
    }
  }

  // Keterangan: testcases.ejs SUDAH merender `<aside class="run-result-panel"
  // hidden>` kosong secara statis (supaya urutan DOM-nya benar sejak awal) —
  // jadi cabang di atas sering menemukan elemen yang SUDAH ADA tapi belum
  // punya skeleton header/body/section sama sekali. Bangun skeleton-nya di
  // sini (idempoten, ditandai .panel-body) supaya kedua kasus (elemen baru
  // dibuat vs elemen statis kosong) sama-sama berakhir dengan struktur yang
  // sama.
  if (!panelEl.querySelector('.panel-body')) {
    const header = document.createElement('div');
    header.className = 'run-result-header';
    const title = document.createElement('strong');
    title.textContent = 'Hasil Run';
    const body = document.createElement('div');
    body.className = 'panel-body';
    const toggle = createPanelToggleButton(
      () => body.hidden,
      (collapsed) => {
        body.hidden = collapsed;
      },
    );
    header.append(title, toggle);

    const artifactsSection = document.createElement('div');
    artifactsSection.className = 'run-result-artifacts';
    const analysisSection = document.createElement('div');
    analysisSection.className = 'run-result-analysis';
    body.append(artifactsSection, analysisSection);
    panelEl.append(header, body);
  }
  return panelEl;
}

function getRunResultArtifactsSection(panel) {
  const panelEl = getRunResultPanel(panel);
  panelEl.hidden = false;
  return panelEl.querySelector('.run-result-artifacts');
}

function getRunResultAnalysisSection(panel) {
  const panelEl = getRunResultPanel(panel);
  panelEl.hidden = false;
  return panelEl.querySelector('.run-result-analysis');
}

/**
 * Keterangan: Menampilkan rekaman video run di modal terpisah — TIDAK pernah
 * menggantikan konten panel live Playwright (permintaan eksplisit: panel
 * live view harus tetap menampilkan kondisi terakhirnya, video hanya
 * ditonton lewat modal ini kalau user mau).
 */
function openVideoPreview(objectUrl) {
  const dialog = document.querySelector('#video-preview-dialog');
  const player = document.querySelector('#video-preview-player');
  if (!dialog || !player) {
    return;
  }
  player.src = objectUrl;
  dialog.showModal();
  dialog.addEventListener(
    'close',
    () => {
      player.pause();
      player.removeAttribute('src');
      player.load();
    },
    { once: true },
  );
}

/**
 * Keterangan: Mengubah teks dan warna indikator status run pada panel terkait.
 */
function updateStatus(panel, status) {
  const badge =
    panel.querySelector('.run-panel-header .status-badge') ??
    panel.querySelector(':scope > .run-panel-header .status-badge');
  if (!badge) {
    return;
  }
  badge.textContent = status;
  badge.className = `status-badge status-${status}`;
}

/**
 * Keterangan: Menambahkan event hasil step ke daftar progres pada panel run.
 */
function appendStepEvent(panel, event) {
  const host =
    findTestCaseItem(event.testCaseId) ??
    findTestCaseItem(panel.dataset.activeTestCaseId) ??
    panel.closest('.test-case') ??
    panel;
  const list = host.querySelector('.step-events');
  if (!list) {
    return;
  }
  const item = document.createElement('li');
  item.textContent = `Step ${event.stepIndex + 1} · ${event.action} · ${event.status}`;
  item.className = `step-${event.status}`;
  list.append(item);
}

/**
 * Keterangan: Membuat URL WebSocket same-origin dengan JWT pada query param
 * sesuai kontrak autentikasi gateway.
 */
function createWebSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Keterangan: Menghentikan polling status REST untuk satu run agar tidak
 * terus memanggil API setelah panel selesai atau diganti run baru.
 */
function stopPolling(runId) {
  const timer = pollTimers.get(runId);
  if (timer) {
    clearInterval(timer);
    pollTimers.delete(runId);
  }
}

/**
 * Keterangan: Menutup socket live view lama pada panel yang sama sebelum run
 * baru dimulai supaya event lama tidak menabrak panel aktif.
 */
function closeSocketForRun(runId) {
  stopPolling(runId);
  pendingAnalysisByRun.delete(runId);
  const socket = activeSockets.get(runId);
  if (!socket) {
    return;
  }
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'unsubscribe:run', runId }));
  }
  socket.close();
  activeSockets.delete(runId);
}

/**
 * Keterangan: Mengakhiri subscription/polling setelah hasil analysis tampil
 * atau batas tunggu tercapai, tanpa menyisakan socket dan timer.
 */
function finishRunWatch(runId, panel, socket) {
  panel.dataset.finished = 'true';
  stopPolling(runId);
  pendingAnalysisByRun.delete(runId);
  clearSuiteAnalysisTimer(runId);
  const currentSocket = socket ?? activeSockets.get(runId);
  if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
    currentSocket.send(JSON.stringify({ type: 'unsubscribe:run', runId }));
  }
  if (currentSocket) {
    currentSocket.close();
  }
  activeSockets.delete(runId);
}

/**
 * Keterangan: Mengakhiri watch satu test case dalam sesi persisten tanpa
 * menutup socket live view sessionId.
 */
function finishCaseWatch(testRunId, panel, socket) {
  panel.dataset.finished = 'true';
  stopPolling(testRunId);
  pendingAnalysisByRun.delete(testRunId);
  const sessionId = panel.dataset.activeRunId;
  const sessionSocket = socket ?? activeSockets.get(sessionId);
  if (sessionSocket?.readyState === WebSocket.OPEN && testRunId) {
    sessionSocket.send(JSON.stringify({ type: 'unsubscribe:run', runId: testRunId }));
  }
  panel.dataset.activeCaseRunId = '';
  setStopRunEnabled(false);
}

/**
 * Keterangan: Subscribe socket WS ke runId tambahan (testRunId dalam sesi).
 */
function subscribeSocketToRun(socket, runId) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !runId) {
    return;
  }
  socket.send(JSON.stringify({ type: 'subscribe:run', runId }));
}

/**
 * Keterangan: Menampilkan spinner area analysis selama worker AI masih
 * memproses artifact setelah status browser sudah terminal.
 */
function showAnalysisLoading(panel) {
  const analysisSection = getRunResultAnalysisSection(panel);
  if (!analysisSection) {
    return;
  }
  analysisSection.className = 'run-result-analysis analysis-loading';
  analysisSection.innerHTML =
    '<span class="spinner" aria-hidden="true"></span><span>Menunggu analisis AI…</span>';
}

/**
 * Keterangan: Menambahkan satu field label/value ke card analysis memakai
 * textContent agar output provider tidak dapat menyisipkan HTML.
 */
/**
 * Keterangan: Membuat tombol collapse/expand generik untuk panel bukti/
 * analysis di bawah panel live Playwright — supaya panel yang panjang
 * (video/log/analysis) bisa disembunyikan agar tidak menutupi live view,
 * tanpa kehilangan datanya (cuma disembunyikan, bukan dihapus).
 */
function createPanelToggleButton(getCollapsed, setCollapsed) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button panel-toggle-button';
  const sync = () => {
    const collapsed = getCollapsed();
    button.textContent = collapsed ? '▸' : '▾';
    button.setAttribute('aria-label', collapsed ? 'Tampilkan panel' : 'Sembunyikan panel');
    button.title = collapsed ? 'Tampilkan panel' : 'Sembunyikan panel';
  };
  button.addEventListener('click', () => {
    setCollapsed(!getCollapsed());
    sync();
  });
  sync();
  return button;
}

function appendAnalysisField(container, label, value) {
  const field = document.createElement('div');
  field.className = 'analysis-field';
  const heading = document.createElement('strong');
  heading.textContent = label;
  const content = document.createElement('p');
  content.textContent = value;
  field.append(heading, content);
  container.append(field);
}

/**
 * Keterangan: Memperbarui badge hasil analysis terbaru pada baris test case
 * tanpa reload setelah event run:analysis diterima.
 */
function updateLatestAnalysisSummary(panel, analysisResult) {
  const testCase =
    findTestCaseItem(panel.dataset.activeTestCaseId) ??
    panel.closest('.test-case');
  if (!testCase) {
    return;
  }
  const summary = testCase.querySelector('.latest-analysis-summary');
  if (!summary) {
    return;
  }
  summary.replaceChildren();

  const badge = document.createElement('span');
  badge.dataset.latestAnalysisBadge = '';
  badge.className = `analysis-badge analysis-status-${analysisResult.status}`;
  badge.textContent = analysisResult.status;

  const label = document.createElement('span');
  label.className = 'latest-analysis-label';
  label.textContent = `Analisis terakhir · ${analysisResult.provider}`;
  summary.append(badge, label);
  summary.hidden = false;
}

/**
 * Keterangan: Mengecek apakah runId masih relevan untuk panel (session vs run tunggal).
 */
function isActiveRunForPanel(runId, panel) {
  if (panel.dataset.replayMode === 'true' || panel.dataset.sessionMode === 'true') {
    return panel.dataset.activeCaseRunId === runId;
  }
  return panel.dataset.activeRunId === runId;
}

/**
 * Keterangan: Merender kesimpulan AI hanya setelah video/trace siap pada panel
 * yang sama; event lebih cepat disimpan sementara sampai bukti tersedia.
 */
function renderAnalysisResult(runId, panel, analysisResult, socket) {
  if (!isActiveRunForPanel(runId, panel) || panel.dataset.finished === 'true') {
    return;
  }
  if (panel.dataset.evidenceReady !== 'true') {
    pendingAnalysisByRun.set(runId, analysisResult);
    showAnalysisLoading(panel);
    return;
  }

  const analysisSection = getRunResultAnalysisSection(panel);
  if (!analysisSection) {
    return;
  }
  analysisSection.replaceChildren();
  analysisSection.className = 'run-result-analysis';

  const header = document.createElement('div');
  header.className = 'analysis-header';
  const title = document.createElement('strong');
  title.textContent = 'AI Analysis';
  const badge = document.createElement('span');
  badge.className = `analysis-badge analysis-status-${analysisResult.status}`;
  badge.textContent = analysisResult.status;
  header.append(title, badge);
  analysisSection.append(header);

  const provider = document.createElement('p');
  provider.className = 'analysis-provider';
  provider.textContent = `Provider: ${analysisResult.provider}`;
  analysisSection.append(provider);

  if (analysisResult.status === 'success') {
    appendAnalysisField(
      analysisSection,
      'Bukti keberhasilan',
      analysisResult.reason || 'Tidak ada reason dari provider.',
    );
  } else {
    appendAnalysisField(
      analysisSection,
      'Detail / root cause',
      analysisResult.detail || 'Tidak ada detail dari provider.',
    );
    appendAnalysisField(
      analysisSection,
      'Solusi',
      analysisResult.solution || 'Tidak ada solusi dari provider.',
    );
  }

  updateLatestAnalysisSummary(panel, analysisResult);
  if (panel.dataset.sessionMode === 'true') {
    finishCaseWatch(runId, panel, socket);
  } else {
    finishRunWatch(runId, panel, socket);
  }
}

/**
 * Keterangan: Menampilkan kondisi analysis belum tersedia setelah polling
 * terukur berhenti, tanpa menampilkan kesimpulan yang tidak punya bukti.
 */
function renderAnalysisUnavailable(runId, panel, socket, message) {
  const analysisSection = getRunResultAnalysisSection(panel);
  if (!analysisSection) {
    return;
  }
  analysisSection.className = 'run-result-analysis analysis-unavailable';
  analysisSection.textContent = message;
  if (panel.dataset.sessionMode === 'true') {
    finishCaseWatch(runId, panel, socket);
  } else {
    finishRunWatch(runId, panel, socket);
  }
}

const SUITE_ANALYSIS_WAIT_MS = 180000;

/**
 * Keterangan: Menghentikan timer tunggu Suite Analysis untuk satu suiteRunId
 * (dipanggil saat hasil/error datang lebih cepat, atau socket ditutup).
 */
function clearSuiteAnalysisTimer(runId) {
  const timer = suiteAnalysisTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    suiteAnalysisTimers.delete(runId);
  }
}

/**
 * Keterangan: Menampilkan spinner menunggu hasil Suite Analysis (analisis
 * lintas fitur) setelah suite run selesai, sebelum event suite:analysis tiba.
 */
function showSuiteAnalysisLoading() {
  const panel = document.querySelector('#suite-analysis-panel');
  if (!panel) {
    return;
  }
  panel.hidden = false;
  panel.className = 'suite-analysis-panel suite-analysis-loading';
  panel.innerHTML =
    '<span class="spinner" aria-hidden="true"></span><span>Menunggu analisis lintas fitur…</span>';
}

/**
 * Keterangan: Menampilkan pesan Suite Analysis tidak tersedia (semua provider
 * gagal, atau batas tunggu tercapai) tanpa membuat kesan analisis berhasil.
 */
function showSuiteAnalysisUnavailable(message) {
  const panel = document.querySelector('#suite-analysis-panel');
  if (!panel) {
    return;
  }
  panel.hidden = false;
  panel.className = 'suite-analysis-panel suite-analysis-unavailable';
  panel.textContent = message;
}

/**
 * Keterangan: Merender hasil Suite Analysis (ringkasan + daftar temuan
 * lintas-fitur) memakai textContent per field agar output AI tidak dapat
 * menyisipkan HTML.
 */
function renderSuiteAnalysisResult(result) {
  const panel = document.querySelector('#suite-analysis-panel');
  if (!panel || !result) {
    return;
  }
  panel.replaceChildren();
  panel.hidden = false;
  panel.className = 'suite-analysis-panel';

  const header = document.createElement('div');
  header.className = 'suite-analysis-header';
  const title = document.createElement('strong');
  title.textContent = 'Analisis Lintas Fitur';
  const badge = document.createElement('span');
  badge.className = `analysis-badge suite-analysis-status-${result.status}`;
  badge.textContent = result.status;
  header.append(title, badge);
  panel.append(header);

  const provider = document.createElement('p');
  provider.className = 'analysis-provider';
  provider.textContent = `Provider: ${result.provider}`;
  panel.append(provider);

  if (result.summary) {
    const summary = document.createElement('p');
    summary.className = 'suite-analysis-summary';
    summary.textContent = result.summary;
    panel.append(summary);
  }

  const findings = Array.isArray(result.findings) ? result.findings : [];
  if (findings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Tidak ada temuan lintas-fitur berarti untuk suite run ini.';
    panel.append(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'suite-analysis-findings';
  for (const finding of findings) {
    const item = document.createElement('li');
    item.className = 'suite-finding';
    const head = document.createElement('div');
    head.className = 'suite-finding-head';
    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'suite-finding-category';
    categoryBadge.textContent = finding.category;
    const titleEl = document.createElement('strong');
    titleEl.textContent = finding.title;
    head.append(categoryBadge, titleEl);
    const detail = document.createElement('p');
    detail.textContent = finding.detail;
    item.append(head, detail);
    if (Array.isArray(finding.relatedTestCases) && finding.relatedTestCases.length > 0) {
      const related = document.createElement('p');
      related.className = 'suite-finding-related';
      related.textContent = `Terkait: ${finding.relatedTestCases.join(', ')}`;
      item.append(related);
    }
    list.append(item);
  }
  panel.append(list);
}

/**
 * Keterangan: Mengambil hasil Suite Analysis terbaru project saat halaman
 * test case dimuat, supaya hasil sebelumnya tetap terlihat setelah reload
 * (resync REST, sama seperti pola analysis per test case).
 */
async function loadLatestSuiteAnalysis(projectId) {
  try {
    const response = await fetch(`/projects/${projectId}/suite-analysis/latest`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (response.ok && data.result) {
      renderSuiteAnalysisResult(data.result);
    }
  } catch {
    // Bukan bagian kritis alur halaman — diamkan bila gagal.
  }
}

/**
 * Keterangan: Membuat tautan unduhan artifact dengan Bearer lewat fetch+blob
 * agar media/log tidak bergantung hanya pada cookie HttpOnly.
 */
async function createAuthenticatedArtifactLink(runId, artifact, label, filename) {
  const response = await fetch(`/test-runs/${runId}/artifacts/${artifact.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Gagal mengunduh ${artifact.type}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.className = 'artifact-link';
  link.href = objectUrl;
  link.download = filename;
  link.textContent = label;
  return { link, objectUrl, blob };
}

/**
 * Keterangan: Mengambil detail run beserta artifact, lalu menampilkan tombol
 * putar video (modal, lihat openVideoPreview) dan tautan unduhan
 * trace/console/network di panel bukti TERPISAH di bawah panel live
 * Playwright. Panel live view (live-frame/live-placeholder) SENGAJA TIDAK
 * disentuh sama sekali di sini — permintaan eksplisit supaya kondisi
 * terakhirnya tidak berganti begitu run selesai.
 */
async function renderFinalArtifacts(runId, panel, button, socket) {
  if (!isActiveRunForPanel(runId, panel) || panel.dataset.finished === 'true') {
    return;
  }
  if (panel.dataset.artifactsRendered === 'true') {
    const pendingAnalysis = pendingAnalysisByRun.get(runId);
    if (pendingAnalysis) {
      renderAnalysisResult(runId, panel, pendingAnalysis, socket);
    }
    return;
  }
  if (panel.dataset.artifactsLoading === 'true') {
    return;
  }
  panel.dataset.artifactsLoading = 'true';

  const artifactsSection = getRunResultArtifactsSection(panel);
  artifactsSection.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'panel-loading';
  loading.innerHTML =
    '<span class="spinner" aria-hidden="true"></span><span>Memuat artifact…</span>';
  artifactsSection.append(loading);

  try {
    const response = await fetch(`/test-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? 'Gagal mengambil artifact');
    }

    updateStatus(panel, data.status);
    artifactsSection.replaceChildren();
    const title = document.createElement('strong');
    title.className = 'run-result-section-title';
    title.textContent = 'Bukti Run';
    artifactsSection.append(title);
    const body = artifactsSection;

    const links = document.createElement('div');
    links.className = 'artifact-links';

    const videoArtifact = data.artifacts.find(
      (artifact) => artifact.type === 'video',
    );
    const traceArtifact = data.artifacts.find(
      (artifact) => artifact.type === 'trace',
    );
    const downloadables = [
      { type: 'trace', label: 'Download trace', filename: 'trace.zip' },
      {
        type: 'console_log',
        label: 'Download console log',
        filename: 'console-log.json',
      },
      {
        type: 'network_log',
        label: 'Download network log',
        filename: 'network-log.json',
      },
    ];

    if (videoArtifact) {
      const videoAsset = await createAuthenticatedArtifactLink(
        runId,
        videoArtifact,
        'Download video',
        'video.webm',
      );
      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'secondary-button compact-test-case-action';
      playButton.textContent = 'Putar Video';
      playButton.addEventListener('click', () => openVideoPreview(videoAsset.objectUrl));
      links.append(playButton, videoAsset.link);
    } else {
      const message = document.createElement('p');
      message.className = 'muted';
      message.textContent = 'Video tidak tersedia untuk run ini.';
      body.append(message);
    }

    for (const item of downloadables) {
      const artifact = data.artifacts.find((entry) => entry.type === item.type);
      if (!artifact) {
        continue;
      }
      const asset = await createAuthenticatedArtifactLink(
        runId,
        artifact,
        item.label,
        item.filename,
      );
      links.append(asset.link);
    }

    if (links.childElementCount > 0) {
      body.append(links);
    }

    const hasEvidence = Boolean(videoArtifact || traceArtifact);
    panel.dataset.artifactsRendered = 'true';
    panel.dataset.evidenceReady = String(hasEvidence);
    if (!hasEvidence) {
      renderAnalysisUnavailable(
        runId,
        panel,
        socket,
        'Bukti video/trace tidak tersedia; kesimpulan AI disembunyikan.',
      );
      return;
    }

    const analysisResult =
      pendingAnalysisByRun.get(runId) ?? data.analysisResult;
    if (analysisResult) {
      renderAnalysisResult(runId, panel, analysisResult, socket);
    } else {
      showAnalysisLoading(panel);
      stopPolling(runId);
      const timer = setInterval(() => {
        void syncRunStatus(runId, panel, button, socket).catch(() => undefined);
      }, 2000);
      pollTimers.set(runId, timer);
    }
  } catch (error) {
    artifactsSection.textContent =
      error instanceof Error ? error.message : 'Gagal mengambil artifact';
    renderAnalysisUnavailable(
      runId,
      panel,
      socket,
      'Analysis tidak ditampilkan karena bukti gagal dimuat.',
    );
  } finally {
    panel.dataset.artifactsLoading = 'false';
    setRunButtonLoading(button, false);
  }
}

/**
 * Keterangan: Menyinkronkan status run dari REST agar late subscribe atau
 * event WS yang terlewat tetap bisa menyelesaikan panel live view.
 */
async function syncRunStatus(runId, panel, button, socket) {
  if (panel.dataset.finished === 'true') {
    return;
  }
  if (!isActiveRunForPanel(runId, panel)) {
    return;
  }

  const response = await fetch(`/test-runs/${runId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? 'Gagal menyinkronkan status run');
  }

  updateStatus(panel, data.status);
  if (TERMINAL_STATUSES.includes(data.status)) {
    await renderFinalArtifacts(runId, panel, button, socket);
    if (panel.dataset.finished === 'true') {
      return;
    }
    if (data.analysisResult) {
      renderAnalysisResult(runId, panel, data.analysisResult, socket);
      return;
    }

    const attempts = Number(panel.dataset.analysisPollAttempts ?? '0') + 1;
    panel.dataset.analysisPollAttempts = String(attempts);
    if (attempts >= MAX_ANALYSIS_POLL_ATTEMPTS) {
      renderAnalysisUnavailable(
        runId,
        panel,
        socket,
        'Analysis AI belum tersedia. Jalankan ulang atau periksa konfigurasi provider.',
      );
    }
  }
}

/**
 * Keterangan: Memproses event frame/step/status/analysis; kesimpulan analysis
 * tetap menunggu bukti video/trace siap sebelum ditampilkan.
 */
function handleRunEvent(event, runId, panel, button, socket) {
  const activeRunId = panel.dataset.activeRunId;
  const activeCaseRunId = panel.dataset.activeCaseRunId;
  const isSessionMode = panel.dataset.sessionMode === 'true';
  const matchesSession =
    isSessionMode &&
    (event.runId === activeRunId || event.runId === activeCaseRunId);
  const matchesRun = event.runId === runId && activeRunId === runId;
  if (!matchesSession && !matchesRun) {
    return;
  }

  if (event.type === 'run:frame') {
    const content = getRunContentElement(panel);
    const image = content?.querySelector('.live-frame') ?? panel.querySelector('.live-frame');
    if (!image) {
      return;
    }
    image.src = `data:image/jpeg;base64,${event.frame}`;
    image.hidden = false;
    const placeholder =
      content?.querySelector('.live-placeholder') ?? panel.querySelector('.live-placeholder');
    if (placeholder) {
      placeholder.hidden = true;
    }
  } else if (event.type === 'run:step') {
    appendStepEvent(panel, event);
  } else if (event.type === 'run:suite-case') {
    updateTestCaseRunBadge(event.testCaseId, event.status);
    if (event.status === 'running') {
      panel.dataset.activeTestCaseId = event.testCaseId;
      panel.dataset.activeCaseRunId = event.testRunId ?? '';
      panel.dataset.finished = 'false';
      findTestCaseItem(event.testCaseId)
        ?.querySelector('.step-events')
        ?.replaceChildren();
    } else if (isSessionMode && TERMINAL_STATUSES.includes(event.status)) {
      panel.dataset.activeCaseRunId = event.testRunId ?? panel.dataset.activeCaseRunId;
      void renderFinalArtifacts(
        event.testRunId ?? panel.dataset.activeCaseRunId,
        panel,
        button,
        socket,
      ).finally(() => {
        setRunButtonLoading(button, false);
        setStopRunEnabled(false);
      });
    }
  } else if (event.type === 'run:suite-done') {
    updateStatus(panel, event.status);
    panel.dataset.finished = 'true';
    panel.dataset.suiteMode = 'false';
    if (button) {
      setRunButtonLoading(button, false);
    }
    setStopRunEnabled(false);
    stopPolling(runId);
    const placeholder = getRunContentElement(panel)?.querySelector('.live-placeholder');
    if (placeholder) {
      placeholder.hidden = false;
      placeholder.textContent = 'Suite selesai — pilih Putar Ulang pada test case untuk melihat rekaman.';
    }
    // Socket TIDAK langsung ditutup — Suite Analysis (lintas fitur) baru
    // selesai setelah semua analisis individual tuntas, biasanya beberapa
    // saat setelah suite run sendiri selesai. finishRunWatch dipanggil nanti
    // saat suite:analysis/suite:analysis-error tiba, atau batas tunggu habis.
    showSuiteAnalysisLoading();
    clearSuiteAnalysisTimer(runId);
    suiteAnalysisTimers.set(
      runId,
      setTimeout(() => {
        showSuiteAnalysisUnavailable(
          'Analisis lintas fitur belum tersedia dalam batas waktu tunggu.',
        );
        finishRunWatch(runId, panel, socket);
      }, SUITE_ANALYSIS_WAIT_MS),
    );
  } else if (event.type === 'suite:analysis') {
    clearSuiteAnalysisTimer(runId);
    renderSuiteAnalysisResult(event.result);
    finishRunWatch(runId, panel, socket);
  } else if (event.type === 'suite:analysis-error') {
    clearSuiteAnalysisTimer(runId);
    showSuiteAnalysisUnavailable(event.message || 'Analisis lintas fitur gagal.');
    finishRunWatch(runId, panel, socket);
  } else if (event.type === 'run:status') {
    if (isSessionMode && event.runId === activeCaseRunId) {
      updateStatus(panel, event.status);
      if (TERMINAL_STATUSES.includes(event.status)) {
        void renderFinalArtifacts(event.runId, panel, button, socket).finally(() => {
          setRunButtonLoading(button, false);
          setStopRunEnabled(false);
        });
      }
      return;
    }
    updateStatus(panel, event.status);
    if (TERMINAL_STATUSES.includes(event.status)) {
      if (panel.dataset.suiteMode === 'true') {
        return;
      }
      void renderFinalArtifacts(runId, panel, button, socket);
    }
  } else if (event.type === 'run:analysis') {
    renderAnalysisResult(event.runId, panel, event.analysisResult, socket);
  }
}

/**
 * Keterangan: Membuka koneksi WS persisten ke sessionId untuk live view antar
 * run test case individual tanpa browser baru setiap klik Run.
 */
function watchRunSession(sessionId, panel) {
  const previousRunId = panel.dataset.activeRunId;
  if (previousRunId && previousRunId !== sessionId) {
    closeSocketForRun(previousRunId);
  }

  panel.dataset.activeRunId = sessionId;
  if (activeSockets.has(sessionId)) {
    return activeSockets.get(sessionId);
  }

  const socket = new WebSocket(createWebSocketUrl());
  activeSockets.set(sessionId, socket);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe:run', runId: sessionId }));
  });
  socket.addEventListener('message', (message) => {
    try {
      const event = JSON.parse(message.data);
      const button = findTestCaseItem(panel.dataset.activeTestCaseId)?.querySelector(
        '.run-button',
      );
      handleRunEvent(event, sessionId, panel, button, socket);
    } catch {
      // Event malformed diabaikan; koneksi tetap dipertahankan.
    }
  });
  socket.addEventListener('close', () => {
    activeSockets.delete(sessionId);
  });

  return socket;
}

/**
 * Keterangan: Membuka sesi Playwright persisten untuk project halaman test case.
 */
async function ensureRunSession(projectId, panel) {
  if (activeRunSessionId && activeRunSessionProjectId === projectId) {
    watchRunSession(activeRunSessionId, panel);
    return activeRunSessionId;
  }

  if (activeRunSessionId) {
    await stopRunSession(activeRunSessionProjectId, activeRunSessionId);
  }

  const data = await requestJson(`/projects/${projectId}/test-runs/session`, 'POST', {});
  if (!data.sessionId) {
    throw new Error('Sesi run tidak mengembalikan sessionId');
  }

  activeRunSessionId = data.sessionId;
  activeRunSessionProjectId = projectId;
  panel.dataset.sessionMode = 'true';
  panel.dataset.suiteMode = 'false';
  watchRunSession(data.sessionId, panel);
  return data.sessionId;
}

/**
 * Keterangan: Menutup sesi Playwright persisten saat suite run atau user
 * meninggalkan halaman test case.
 */
async function stopRunSession(projectId, sessionId) {
  if (!projectId || !sessionId) {
    return;
  }

  try {
    await requestJson(
      `/projects/${projectId}/test-runs/session/${sessionId}/stop`,
      'POST',
      {},
    );
  } catch {
    // Sesi mungkin sudah ditutup server-side.
  }

  closeSocketForRun(sessionId);
  if (activeRunSessionId === sessionId) {
    activeRunSessionId = null;
    activeRunSessionProjectId = null;
  }
}

/**
 * Keterangan: Membuka koneksi WS, subscribe ke runId, langsung resync REST,
 * dan memasang polling safety-net sampai status terminal diketahui.
 */
function watchRun(runId, panel, button) {
  const previousRunId = panel.dataset.activeRunId;
  if (previousRunId && previousRunId !== runId) {
    closeSocketForRun(previousRunId);
  }

  panel.dataset.activeRunId = runId;
  const socket = new WebSocket(createWebSocketUrl());
  activeSockets.set(runId, socket);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe:run', runId }));
    if (panel.dataset.suiteMode !== 'true') {
      void syncRunStatus(runId, panel, button, socket).catch(() => undefined);
    }
  });
  socket.addEventListener('message', (message) => {
    try {
      const event = JSON.parse(message.data);
      handleRunEvent(event, runId, panel, button, socket);
    } catch {
      // Event malformed diabaikan; koneksi tetap dipertahankan.
    }
  });
  socket.addEventListener('close', () => {
    activeSockets.delete(runId);
    if (panel.dataset.activeRunId !== runId || panel.dataset.finished === 'true') {
      return;
    }
    if (panel.dataset.suiteMode === 'true' || panel.dataset.sessionMode === 'true') {
      return;
    }
    const placeholder = getRunContentElement(panel)?.querySelector('.live-placeholder');
    if (placeholder) {
      placeholder.textContent =
        'Koneksi live view terputus, menyinkronkan status…';
    }
    void syncRunStatus(runId, panel, button, null)
      .catch(() => {
        if (panel.dataset.finished !== 'true') {
          updateStatus(panel, 'error');
          const activePlaceholder = panel.querySelector('.live-placeholder');
          if (activePlaceholder) {
            activePlaceholder.textContent = 'Koneksi live view terputus.';
          }
          setRunButtonLoading(button, false);
        }
      });
  });

  stopPolling(runId);
  if (panel.dataset.suiteMode !== 'true') {
    const timer = setInterval(() => {
      void syncRunStatus(runId, panel, button, activeSockets.get(runId) ?? null).catch(
        () => undefined,
      );
    }, 2000);
    pollTimers.set(runId, timer);
  }
}

/**
 * Keterangan: Mengembalikan area bukti (video/log) dan analysis ke state awal
 * agar tombol Run dapat dipakai berulang tanpa elemen stale dari run
 * sebelumnya. Panel live Playwright (live-frame/live-placeholder) SENGAJA
 * TIDAK disentuh di sini — kondisi terakhirnya (frame terakhir yang sempat
 * tampil) dibiarkan apa adanya sampai frame run baru datang lewat run:frame,
 * bukan direset ke placeholder kosong.
 */
function resetRunEvidencePanel(panel) {
  const resultPanel = panel.querySelector('.run-result-panel');
  if (!resultPanel) {
    return;
  }
  resultPanel.hidden = true;
  resultPanel.querySelector('.run-result-artifacts')?.replaceChildren();
  const analysisSection = resultPanel.querySelector('.run-result-analysis');
  if (analysisSection) {
    analysisSection.replaceChildren();
    analysisSection.className = 'run-result-analysis';
  }
  const body = resultPanel.querySelector('.panel-body');
  if (body) {
    body.hidden = false;
  }
}

/**
 * Keterangan: Memicu POST run dari tombol, menyiapkan panel live tanpa reload,
 * lalu mulai subscribe WebSocket menggunakan runId dari API.
 */
async function startRun(button) {
  if (button.disabled) {
    return;
  }

  const testCaseId = button.dataset.testCaseId;
  const workspace = document.querySelector('#testcases-workspace');
  const panel =
    workspace?.querySelector('.run-workspace-panel') ??
    button.closest('.test-case')?.querySelector('.run-panel');
  const projectId = workspace?.dataset.projectId;
  if (!panel) {
    return;
  }

  let runStarted = false;

  setRunButtonLoading(button, true);
  panel.hidden = false;
  panel.dataset.finished = 'false';
  panel.dataset.suiteMode = 'false';
  panel.dataset.replayMode = 'false';
  panel.dataset.activeTestCaseId = testCaseId;
  panel.dataset.activeCaseRunId = '';
  panel.dataset.artifactsRendered = 'false';
  panel.dataset.artifactsLoading = 'false';
  panel.dataset.evidenceReady = 'false';
  panel.dataset.analysisPollAttempts = '0';
  pendingAnalysisByRun.delete(panel.dataset.activeCaseRunId);
  updateStatus(panel, 'queued');
  findTestCaseItem(testCaseId)?.querySelector('.step-events')?.replaceChildren();
  resetRunEvidencePanel(panel);

  try {
    if (workspace && projectId) {
      panel.dataset.sessionMode = 'true';
      const sessionId = await ensureRunSession(projectId, panel);
      const data = await requestJson(
        `/projects/${projectId}/test-runs/session/${sessionId}/run`,
        'POST',
        { testCaseId },
      );
      if (!data.testRunId) {
        throw new Error('Run sesi tidak mengembalikan testRunId');
      }

      panel.dataset.activeCaseRunId = data.testRunId;
      const socket = watchRunSession(sessionId, panel);
      subscribeSocketToRun(socket, data.testRunId);
      setStopRunEnabled(true);
      runStarted = true;
      return;
    }

    if (panel.dataset.activeRunId) {
      closeSocketForRun(panel.dataset.activeRunId);
    }
    panel.dataset.sessionMode = 'false';

    const response = await fetch(`/test-cases/${testCaseId}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? 'Gagal menjalankan test case');
    }

    runStarted = true;
    watchRun(data.runId, panel, button);
  } catch (error) {
    updateStatus(panel, 'error');
    const placeholder = getRunContentElement(panel)?.querySelector('.live-placeholder');
    if (placeholder) {
      placeholder.textContent =
        error instanceof Error ? error.message : 'Gagal menjalankan test case';
    }
  } finally {
    if (!runStarted) {
      setRunButtonLoading(button, false);
      setStopRunEnabled(false);
    }
  }
}

/**
 * Keterangan: Menjalankan seluruh test case project dalam satu sesi Playwright
 * (cookie/session shared) dengan live view di panel kanan.
 */
async function startSuiteRun(button) {
  if (button.disabled) {
    return;
  }

  const workspace = document.querySelector('#testcases-workspace');
  const panel = workspace?.querySelector('.run-workspace-panel');
  const projectId = workspace?.dataset.projectId;
  if (!workspace || !panel || !projectId) {
    return;
  }

  const testCaseIds = [...workspace.querySelectorAll('.test-case-item')]
    .map((item) => item.dataset.testCaseId)
    .filter(Boolean);
  if (testCaseIds.length === 0) {
    window.alert('Belum ada test case untuk dijalankan.');
    return;
  }

  if (activeRunSessionId) {
    await stopRunSession(projectId, activeRunSessionId);
    panel.dataset.sessionMode = 'false';
  }

  if (panel.dataset.activeRunId) {
    closeSocketForRun(panel.dataset.activeRunId);
  }

  setSubmitButtonLoading(button, true);
  panel.dataset.finished = 'false';
  panel.dataset.suiteMode = 'true';
  panel.dataset.replayMode = 'false';
  panel.dataset.artifactsRendered = 'false';
  panel.dataset.artifactsLoading = 'false';
  panel.dataset.evidenceReady = 'false';
  panel.dataset.analysisPollAttempts = '0';
  updateStatus(panel, 'queued');
  workspace.querySelectorAll('.test-case-item .step-events').forEach((list) => {
    list.replaceChildren();
  });
  workspace.querySelectorAll('.test-case-run-badge').forEach((badge) => {
    badge.hidden = true;
  });
  resetRunEvidencePanel(panel);
  const suiteAnalysisPanel = document.querySelector('#suite-analysis-panel');
  if (suiteAnalysisPanel) {
    suiteAnalysisPanel.replaceChildren();
    suiteAnalysisPanel.className = 'suite-analysis-panel';
    suiteAnalysisPanel.hidden = true;
  }

  let runStarted = false;
  try {
    const data = await requestJson(
      `/projects/${projectId}/test-cases/run-suite`,
      'POST',
      { testCaseIds },
    );
    if (!data.suiteRunId) {
      throw new Error('Suite run tidak mengembalikan suiteRunId');
    }
    runStarted = true;
    setStopRunEnabled(true);
    watchRun(data.suiteRunId, panel, button);
  } catch (error) {
    updateStatus(panel, 'error');
    panel.dataset.suiteMode = 'false';
    const placeholder = getRunContentElement(panel)?.querySelector('.live-placeholder');
    if (placeholder) {
      placeholder.textContent =
        error instanceof Error ? error.message : 'Gagal menjalankan suite';
    }
  } finally {
    if (!runStarted) {
      setSubmitButtonLoading(button, false);
      setStopRunEnabled(false);
    }
  }
}

/**
 * Keterangan: Menghentikan paksa run Playwright yang sedang aktif (satu test
 * case di sesi persisten, atau suite) tanpa menunggu step selesai.
 */
async function abortActiveRun(button) {
  if (button.disabled) {
    return;
  }

  const workspace = document.querySelector('#testcases-workspace');
  const panel = workspace?.querySelector('.run-workspace-panel');
  const projectId = workspace?.dataset.projectId;
  if (!workspace || !panel || !projectId) {
    return;
  }

  setRunButtonLoading(button, true);
  updateStatus(panel, 'error');
  const placeholder = getRunContentElement(panel)?.querySelector('.live-placeholder');
  if (placeholder) {
    placeholder.hidden = false;
    placeholder.textContent = 'Menghentikan run…';
  }

  try {
    if (panel.dataset.suiteMode === 'true' && panel.dataset.activeRunId) {
      await requestJson(
        `/projects/${projectId}/test-cases/suite/${panel.dataset.activeRunId}/abort`,
        'POST',
        {},
      );
      return;
    }
    if (activeRunSessionId) {
      await requestJson(
        `/projects/${projectId}/test-runs/session/${activeRunSessionId}/abort`,
        'POST',
        {},
      );
    }
  } catch (error) {
    setRunButtonLoading(button, false);
    setStopRunEnabled(false);
    if (placeholder) {
      placeholder.textContent =
        error instanceof Error ? error.message : 'Gagal menghentikan run';
    }
  }
}

/**
 * Keterangan: Memutar ulang rekaman (video/trace) run terakhir test case di
 * panel kanan halaman test case.
 */
async function replayLatestRun(button) {
  if (button.disabled) {
    return;
  }

  const testCaseId = button.dataset.testCaseId;
  const panel = document.querySelector('.run-workspace-panel');
  if (!testCaseId || !panel) {
    return;
  }

  button.disabled = true;
  try {
    const response = await fetch(`/test-cases/${testCaseId}/runs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const runs = await response.json();
    if (!response.ok) {
      throw new Error(runs.error ?? 'Gagal mengambil riwayat run');
    }
    if (!Array.isArray(runs) || runs.length === 0) {
      window.alert('Belum ada rekaman run untuk test case ini.');
      return;
    }

    const latestRun =
      runs.find((item) => TERMINAL_STATUSES.includes(item.status)) ?? runs[0];
    panel.dataset.finished = 'false';
    panel.dataset.suiteMode = 'false';
    panel.dataset.replayMode = 'true';
    panel.dataset.activeTestCaseId = testCaseId;
    panel.dataset.activeCaseRunId = latestRun.id;
    panel.dataset.artifactsRendered = 'false';
    panel.dataset.artifactsLoading = 'false';
    panel.dataset.evidenceReady = 'false';
    updateStatus(panel, latestRun.status);
    resetRunEvidencePanel(panel);
    await renderFinalArtifacts(latestRun.id, panel, button, null);
    panel.dataset.finished = 'true';
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'Gagal memutar rekaman');
  } finally {
    button.disabled = false;
  }
}

/**
 * Keterangan: Menambahkan baris status ke panel kiri generate agar progres
 * AI (menganalisis, generate, simpan) terlihat berurutan.
 */
function appendGenerateLog(panel, message, className = 'active') {
  const list = panel.querySelector('.generate-log-list');
  if (!list) {
    return;
  }
  list.querySelectorAll('.generate-log-item.active').forEach((item) => {
    item.classList.remove('active');
  });
  const item = document.createElement('li');
  item.className = `generate-log-item ${className}`;
  item.textContent = message;
  list.append(item);
  item.scrollIntoView({ block: 'nearest' });
}

/**
 * Keterangan: Menampilkan judul dan keterangan test case yang baru jadi
 * pada log generate sebelum dashboard dimuat ulang.
 */
function appendGeneratedTestCases(panel, testCases) {
  const list = panel.querySelector('.generate-log-list');
  if (!list) {
    return;
  }
  for (const testCase of testCases) {
    const item = document.createElement('li');
    item.className = 'generate-log-item done';
    const title = document.createElement('div');
    title.className = 'generate-result-title';
    title.textContent = testCase.title;
    const description = document.createElement('div');
    description.className = 'generate-result-desc';
    description.textContent = testCase.description || 'Tidak ada keterangan';
    item.append(title, description);
    list.append(item);
  }
}

/**
 * Keterangan: Mengembalikan panel generate ke state awal sebelum job baru.
 */
function resetGeneratePanel(panel) {
  const list = panel.querySelector('.generate-log-list');
  list?.replaceChildren();
  const placeholder = panel.querySelector('.live-placeholder');
  if (placeholder) {
    placeholder.hidden = false;
    placeholder.textContent = 'Menunggu tampilan Playwright…';
  }
  const image = panel.querySelector('.live-frame');
  if (image) {
    image.hidden = true;
    image.removeAttribute('src');
  }
  hideAuthInputPanel(panel);
  updateStatus(panel, 'queued');
}

/**
 * Keterangan: Mengembalikan elemen dialog input auth (modal backdrop).
 */
function getAuthInputDialog() {
  return document.querySelector('#generate-auth-dialog');
}

/**
 * Keterangan: Menyembunyikan modal input auth dinamis.
 */
function hideAuthInputPanel(_panel) {
  const dialog = getAuthInputDialog();
  if (!dialog) {
    return;
  }
  if (dialog.open) {
    dialog.close();
  }
  dialog.dataset.zoneId = '';
  const form = dialog.querySelector('.generate-auth-form');
  form?.reset();
  const error = dialog.querySelector('.generate-auth-error');
  if (error) {
    error.hidden = true;
    error.textContent = '';
  }
  const fieldsHost = dialog.querySelector('.generate-auth-fields');
  fieldsHost?.replaceChildren();
}

/**
 * Keterangan: Menampilkan modal input auth dinamis dari event generate:need-input.
 */
function showAuthInputPanel(panel, event) {
  const dialog = getAuthInputDialog();
  if (!dialog) {
    return;
  }
  dialog.dataset.zoneId = event.zoneId;
  const message = dialog.querySelector('.generate-auth-message');
  if (message) {
    message.textContent =
      event.message ||
      `Input autentikasi diperlukan untuk "${event.pageTitle || event.pageUrl}"`;
  }
  const fieldsHost = dialog.querySelector('.generate-auth-fields');
  if (!fieldsHost) {
    return;
  }
  fieldsHost.replaceChildren();
  for (const field of event.fields ?? []) {
    const wrap = document.createElement('div');
    wrap.className = 'generate-auth-field';
    const label = document.createElement('label');
    label.textContent = field.label || field.key;
    label.setAttribute('for', `auth-field-${field.key}`);
    const input = document.createElement('input');
    input.id = `auth-field-${field.key}`;
    input.name = field.key;
    input.type = field.secret ? 'password' : field.inputType || 'text';
    input.required = true;
    input.autocomplete = field.secret ? 'off' : 'username';
    wrap.append(label, input);
    fieldsHost.append(wrap);
  }
  if (!dialog.dataset.cancelWired) {
    dialog.dataset.cancelWired = 'true';
    dialog.addEventListener('cancel', (cancelEvent) => {
      cancelEvent.preventDefault();
    });
  }
  if (!dialog.open) {
    dialog.showModal();
  }
  const firstInput = fieldsHost.querySelector('input');
  firstInput?.focus();
  appendGenerateLog(
    panel,
    'Menunggu input autentikasi untuk melanjutkan eksplorasi…',
    'active',
  );
}

/**
 * Keterangan: Mengirim input auth dinamis ke backend agar job generate lanjut.
 */
async function submitAuthInputForm(panel, projectId, generateId, zoneId, values) {
  const dialog = getAuthInputDialog();
  const submitButton = dialog?.querySelector('.generate-auth-submit');
  const skipButton = dialog?.querySelector('.generate-auth-skip');
  const errorEl = dialog?.querySelector('.generate-auth-error');
  if (submitButton) {
    setSubmitButtonLoading(submitButton, true);
  }
  if (skipButton) {
    skipButton.disabled = true;
  }
  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }
  try {
    await requestJson(
      `/projects/${projectId}/generate/${generateId}/auth-input`,
      'POST',
      { zoneId, values },
    );
    hideAuthInputPanel(panel);
    appendGenerateLog(panel, 'Input autentikasi diterima, melanjutkan eksplorasi…', 'done');
  } catch (error) {
    if (errorEl) {
      errorEl.textContent =
        error instanceof Error ? error.message : 'Gagal mengirim input autentikasi';
      errorEl.hidden = false;
    }
  } finally {
    if (submitButton) {
      setSubmitButtonLoading(submitButton, false);
    }
    if (skipButton) {
      skipButton.disabled = false;
    }
  }
}

/**
 * Keterangan: Melewati zona auth yang terkunci tanpa menghentikan seluruh job.
 */
async function skipAuthInputZone(panel, projectId, generateId, zoneId) {
  const dialog = getAuthInputDialog();
  const submitButton = dialog?.querySelector('.generate-auth-submit');
  const skipButton = dialog?.querySelector('.generate-auth-skip');
  if (skipButton) {
    setSubmitButtonLoading(skipButton, true);
  }
  if (submitButton) {
    submitButton.disabled = true;
  }
  try {
    await requestJson(
      `/projects/${projectId}/generate/${generateId}/auth-input`,
      'POST',
      { zoneId, values: {}, skip: true },
    );
    hideAuthInputPanel(panel);
    appendGenerateLog(panel, 'Zona autentikasi dilewati, melanjutkan bagian lain…', 'done');
  } catch (error) {
    appendGenerateLog(
      panel,
      error instanceof Error ? error.message : 'Gagal melewati zona auth',
      'error',
    );
  } finally {
    if (skipButton) {
      setSubmitButtonLoading(skipButton, false);
    }
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

/**
 * Keterangan: Wire form auth dinamis di panel generate (submit + skip).
 */
function wireAuthInputPanel(panel, projectId, generateId) {
  const dialog = getAuthInputDialog();
  const form = dialog?.querySelector('.generate-auth-form');
  const skipButton = dialog?.querySelector('.generate-auth-skip');
  if (!form || form.dataset.wired === 'true') {
    return;
  }
  form.dataset.wired = 'true';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const zoneId = dialog?.dataset.zoneId;
    if (!zoneId) {
      return;
    }
    const values = {};
    const inputs = form.querySelectorAll('input[name]');
    for (const input of inputs) {
      if (input instanceof HTMLInputElement && input.name) {
        values[input.name] = input.value;
      }
    }
    void submitAuthInputForm(panel, projectId, generateId, zoneId, values);
  });
  skipButton?.addEventListener('click', () => {
    const zoneId = dialog?.dataset.zoneId;
    if (!zoneId) {
      return;
    }
    void skipAuthInputZone(panel, projectId, generateId, zoneId);
  });
}

/**
 * Keterangan: Memproses event live generate: frame Playwright, status AI,
 * hasil test case, atau error.
 */
function handleGenerateEvent(event, generateId, panel) {
  if (event.runId !== generateId || panel.dataset.activeGenerateId !== generateId) {
    return;
  }

  if (event.type === 'run:frame') {
    const image = panel.querySelector('.live-frame');
    if (!image) {
      return;
    }
    image.src = `data:image/jpeg;base64,${event.frame}`;
    image.hidden = false;
    const placeholder = panel.querySelector('.live-placeholder');
    if (placeholder) {
      placeholder.hidden = true;
    }
  } else if (event.type === 'generate:status') {
    updateStatus(panel, event.phase === 'done' ? 'passed' : 'running');
    appendGenerateLog(panel, event.message, 'active');
  } else if (event.type === 'generate:need-input') {
    updateStatus(panel, 'running');
    showAuthInputPanel(panel, event);
  } else if (event.type === 'generate:done') {
    updateStatus(panel, 'passed');
    appendGeneratedTestCases(panel, event.testCases ?? []);
    panel.dataset.finished = 'true';
    closeSocketForRun(generateId);
    window.setTimeout(() => {
      window.location.href = '/dashboard';
    }, 1600);
  } else if (event.type === 'generate:error') {
    updateStatus(panel, 'error');
    appendGenerateLog(
      panel,
      event.message || 'Generate test case gagal',
      'error',
    );
    panel.dataset.finished = 'true';
    closeSocketForRun(generateId);
  }
}

/**
 * Keterangan: Subscribe WebSocket ke generateId (reuse channel run) agar
 * log kiri dan frame Playwright kanan ter-update tanpa reload.
 */
function watchGenerate(generateId, panel) {
  const previousId = panel.dataset.activeGenerateId;
  if (previousId && previousId !== generateId) {
    closeSocketForRun(previousId);
  }

  panel.dataset.activeGenerateId = generateId;
  panel.dataset.finished = 'false';
  const socket = new WebSocket(createWebSocketUrl());
  activeSockets.set(generateId, socket);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe:run', runId: generateId }));
  });
  socket.addEventListener('message', (message) => {
    try {
      const event = JSON.parse(message.data);
      handleGenerateEvent(event, generateId, panel);
    } catch {
      // Event malformed diabaikan; koneksi tetap dipertahankan.
    }
  });
  socket.addEventListener('close', () => {
    activeSockets.delete(generateId);
    if (panel.dataset.activeGenerateId !== generateId || panel.dataset.finished === 'true') {
      return;
    }
    appendGenerateLog(
      panel,
      'Koneksi live terputus. Generate tetap berjalan di server — muat ulang beberapa saat lagi bila hasil belum muncul.',
      'error',
    );
  });
}

/**
 * Keterangan: Menampilkan panel generate lalu subscribe job live (log + Playwright).
 */
function startGenerate(projectId, generateId) {
  const panel = document.querySelector('.generate-panel');
  if (!panel) {
    window.location.href = `/dashboard/projects/${projectId}/generate`;
    return;
  }

  panel.hidden = false;
  resetGeneratePanel(panel);
  appendGenerateLog(panel, 'Menunggu Playwright…', 'active');
  wireAuthInputPanel(panel, projectId, generateId);
  watchGenerate(generateId, panel);
}

/**
 * Keterangan: Mengambil kartu project dari tombol aksi footer atau id project.
 */
function findProjectCard(projectId, button) {
  return (
    button?.closest('.project-card') ??
    document.querySelector(`.project-card[data-project-id="${projectId}"]`)
  );
}

/**
 * Keterangan: Menghitung jumlah test case project dari dataset tombol atau badge kartu.
 */
function getProjectTestCaseCount(button, card) {
  if (button?.dataset?.testCaseCount !== undefined) {
    const fromButton = Number(button.dataset.testCaseCount);
    return Number.isFinite(fromButton) ? fromButton : 0;
  }
  const fromBadge = Number(card?.querySelector('.count')?.textContent?.match(/\d+/)?.[0] ?? '');
  return Number.isFinite(fromBadge) ? fromBadge : 0;
}

/**
 * Keterangan: Membuka halaman generate full-width bila instruction sudah
 * tersimpan; jika belum, minta user menyimpan Instruction dulu. Bila project
 * sudah punya test case, konfirmasi replace dulu.
 */
function startGenerateFromProject(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const projectId = button.dataset.projectId;
  const targetUrl =
    button.dataset.generateUrl || `/dashboard/projects/${projectId}/generate`;
  const card = findProjectCard(projectId, button);
  const testCaseCount = getProjectTestCaseCount(button, card);
  let project = {};
  try {
    project = JSON.parse(card?.dataset.project || '{}');
  } catch {
    project = {};
  }
  if (!project.instruction?.trim()) {
    openInstructionDialog(projectId);
    return;
  }
  if (testCaseCount > 0) {
    openGenerateReplaceDialog(projectId, testCaseCount, targetUrl);
    return;
  }
  window.location.href = targetUrl;
}

/**
 * Keterangan: Modal konfirmasi sebelum Ai Test Script mengganti seluruh test
 * case project yang sudah ada.
 */
function openGenerateReplaceDialog(projectId, testCaseCount, targetUrl) {
  const dialog = document.querySelector('#generate-replace-dialog');
  if (!dialog) {
    sessionStorage.setItem('generateReplaceExisting', '1');
    window.location.href = targetUrl;
    return;
  }
  const countEl = dialog.querySelector('#generate-replace-count');
  if (countEl) {
    countEl.textContent = String(testCaseCount);
  }
  dialog.dataset.projectId = projectId;
  dialog.dataset.targetUrl = targetUrl;
  dialog.showModal();
}

/**
 * Keterangan: Melanjutkan ke halaman generate dengan flag replace existing.
 */
function confirmGenerateReplace() {
  const dialog = document.querySelector('#generate-replace-dialog');
  const button = dialog?.querySelector('#generate-replace-confirm-button');
  const targetUrl = dialog?.dataset.targetUrl;
  if (!dialog || !targetUrl) {
    return;
  }
  setSubmitButtonLoading(button, true);
  sessionStorage.setItem('generateReplaceExisting', '1');
  window.location.href = targetUrl;
}

/**
 * Keterangan: Menyetel state loading pada tombol submit dialog agar request
 * create/update tidak dapat terkirim dua kali.
 */
function setSubmitButtonLoading(button, isLoading) {
  button.disabled = isLoading;
  button.querySelector('.button-label').hidden = isLoading;
  button.querySelector('.spinner').hidden = !isLoading;
}

/**
 * Keterangan: Menampilkan pesan error aman pada form tanpa menyisipkan HTML
 * dari response API.
 */
function showFormError(form, message) {
  const errorElement = form.querySelector('.form-error');
  errorElement.textContent = message;
  errorElement.hidden = false;
}

/**
 * Keterangan: Menghapus pesan error lama saat dialog dibuka atau submit baru
 * dimulai.
 */
function clearFormError(form) {
  const errorElement = form.querySelector('.form-error');
  errorElement.textContent = '';
  errorElement.hidden = true;
}

/**
 * Keterangan: Mengirim request JSON terautentikasi dan mengubah response error
 * API menjadi Error yang dapat langsung ditampilkan pada form.
 */
async function requestJson(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? 'Request gagal diproses');
  }
  return data;
}

/**
 * Keterangan: Mengambil provider yang dicentang Default pada daftar API key.
 */
function getSelectedDefaultProvider() {
  const checked = document.querySelector(
    '#provider-key-list [name="isDefault"]:checked',
  );
  return (
    checked?.closest('.provider-key-row')?.querySelector('[name="providerName"]')
      ?.value ?? ''
  );
}

/**
 * Keterangan: Memastikan hanya satu baris provider yang berstatus Default.
 */
function setExclusiveDefault(selectedRow) {
  document.querySelectorAll('#provider-key-list .provider-key-row').forEach((row) => {
    const box = row.querySelector('[name="isDefault"]');
    if (box) {
      box.checked = row === selectedRow;
    }
  });
  updateProviderHint();
}

/**
 * Keterangan: Memperbarui petunjuk model sesuai provider yang dicentang Default.
 */
function updateProviderHint() {
  const hint = document.querySelector('#provider-model-hint');
  if (!hint) {
    return;
  }
  const provider = getSelectedDefaultProvider();
  const productNote =
    provider === 'opencode' || provider === 'opencode-go'
      ? ' OpenCode Zen dan Go bisa memakai API key yang sama, tempel di baris masing-masing. Go butuh subscription.'
      : '';
  if (!provider) {
    hint.textContent = `Centang Default pada satu baris. Urutan baris = urutan fallback.${productNote}`;
    return;
  }
  hint.textContent = `Default: ${PROVIDER_LABELS[provider] || provider}. Daftar model diambil dari API provider.${productNote}`;
}

/**
 * Keterangan: Mengambil katalog provider/model melalui POST agar form project
 * menampilkan konfigurasi runtime tanpa mengekspos API key.
 */
async function loadProviderCatalogs() {
  const data = await requestJson('/ai/models', 'POST', {});
  for (const catalog of data.providers ?? []) {
    providerCatalogs.set(catalog.provider, catalog);
  }
  updateProviderHint();
}

/**
 * Keterangan: Mengambil katalog satu provider dari API resmi lewat backend.
 * API key hanya dikirim ke server (tidak disimpan di sini); bila edit project,
 * projectId memakai key terenkripsi di DB.
 */
async function fetchCatalogForProvider(provider, apiKey, projectId) {
  const body = {
    provider,
    forceRefresh: Boolean(apiKey),
  };
  if (apiKey) {
    body.apiKey = apiKey;
  } else if (projectId) {
    body.projectId = projectId;
  }
  const data = await requestJson('/ai/models', 'POST', body);
  if (data?.provider === provider) {
    return data;
  }
  return (data?.providers ?? []).find((item) => item.provider === provider);
}

/**
 * Keterangan: Mengisi dropdown model dari katalog provider, tanpa daftar
 * hardcoded. Model tersimpan yang belum ada di katalog tetap ditampilkan.
 */
function fillModelOptions(select, catalog, preferred) {
  const list = [...(catalog?.models ?? [])];
  if (preferred && !list.includes(preferred)) {
    list.unshift(preferred);
  }
  select.replaceChildren();
  if (list.length === 0) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Model belum tersedia — isi API key';
    select.append(empty);
    return;
  }
  const selected =
    (preferred && list.includes(preferred) && preferred) ||
    (catalog?.defaultModel && list.includes(catalog.defaultModel)
      ? catalog.defaultModel
      : list[0]);
  for (const modelId of list) {
    const option = document.createElement('option');
    option.value = modelId;
    option.textContent = modelId;
    option.selected = modelId === selected;
    select.append(option);
  }
}

/**
 * Keterangan: Memuat ulang dropdown model satu baris dari endpoint provider,
 * dengan spinner di label selama request.
 */
async function refreshRowModels(row, preferredModel) {
  const select = row.querySelector('[name="defaultModel"]');
  const spinner = row.querySelector('.model-spinner');
  const provider = row.querySelector('[name="providerName"]').value;
  const apiKey = row.querySelector('[name="apiKey"]').value.trim();
  const projectId = document.querySelector('#project-form [name="projectId"]')?.value;
  if (!select) {
    return;
  }
  select.disabled = true;
  if (spinner) {
    spinner.hidden = false;
  }
  try {
    const catalog = await fetchCatalogForProvider(provider, apiKey, projectId);
    if (catalog) {
      providerCatalogs.set(provider, catalog);
    }
    fillModelOptions(select, catalog, preferredModel ?? select.value);
  } catch {
    fillModelOptions(select, providerCatalogs.get(provider), preferredModel);
  } finally {
    select.disabled = false;
    if (spinner) {
      spinner.hidden = true;
    }
  }
}

/**
 * Keterangan: Mengisi opsi select provider pada baris API key project.
 */
function fillProviderOptions(select, selected) {
  select.replaceChildren();
  for (const [value, label] of Object.entries(PROVIDER_LABELS)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  }
}

/**
 * Keterangan: Membuat satu baris provider + API key + dropdown model, plus
 * checkbox Default. Key lama hanya ditampilkan ter-mask.
 */
function createProviderKeyRow(entry = {}) {
  const row = document.createElement('article');
  row.className = 'provider-key-row';
  row.dataset.hasKey = entry.hasApiKey ? 'true' : 'false';

  const fields = document.createElement('div');
  fields.className = 'provider-key-fields';

  const defaultLabel = document.createElement('label');
  defaultLabel.className = 'default-provider-check';
  defaultLabel.append('Default');
  const defaultBox = document.createElement('input');
  defaultBox.type = 'checkbox';
  defaultBox.name = 'isDefault';
  defaultBox.checked = Boolean(entry.isDefault);
  defaultBox.addEventListener('change', () => {
    if (defaultBox.checked) {
      setExclusiveDefault(row);
      return;
    }
    const anyChecked = [...document.querySelectorAll('#provider-key-list [name="isDefault"]')].some(
      (box) => box.checked,
    );
    if (!anyChecked) {
      defaultBox.checked = true;
    }
    updateProviderHint();
  });
  defaultLabel.append(defaultBox);

  const providerLabel = document.createElement('label');
  providerLabel.textContent = 'Provider';
  const providerSelect = document.createElement('select');
  providerSelect.name = 'providerName';
  providerSelect.required = true;
  fillProviderOptions(providerSelect, entry.provider || 'claude');
  providerLabel.append(providerSelect);

  const keyLabel = document.createElement('label');
  keyLabel.textContent = 'API key';
  const keyInput = document.createElement('input');
  keyInput.name = 'apiKey';
  keyInput.type = 'password';
  keyInput.autocomplete = 'off';
  keyInput.placeholder = entry.apiKeyMasked
    ? `Tersimpan ${entry.apiKeyMasked} — kosongkan jika tidak diganti`
    : 'sk-...';
  keyLabel.append(keyInput);

  const modelLabel = document.createElement('label');
  const modelHeading = document.createElement('span');
  modelHeading.className = 'model-label-row';
  modelHeading.append('Model');
  const modelSpinner = document.createElement('span');
  modelSpinner.className = 'spinner spinner-small spinner-inline model-spinner';
  modelSpinner.setAttribute('aria-hidden', 'true');
  modelSpinner.hidden = true;
  modelHeading.append(modelSpinner);
  modelLabel.append(modelHeading);
  const modelSelect = document.createElement('select');
  modelSelect.name = 'defaultModel';
  fillModelOptions(
    modelSelect,
    providerCatalogs.get(providerSelect.value),
    entry.defaultModel ?? '',
  );
  modelLabel.append(modelSelect);

  providerSelect.addEventListener('change', () => {
    void refreshRowModels(row, '');
    if (defaultBox.checked) {
      updateProviderHint();
    }
  });
  keyInput.addEventListener('blur', () => {
    if (keyInput.value.trim()) {
      void refreshRowModels(row, modelSelect.value);
    }
  });

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'icon-button danger-button';
  removeButton.setAttribute('aria-label', 'Hapus provider');
  removeButton.title = 'Hapus provider';
  removeButton.append(createIconSvg(ICON_TRASH));
  removeButton.addEventListener('click', () => {
    const list = document.querySelector('#provider-key-list');
    const rows = list.querySelectorAll('.provider-key-row');
    if (rows.length <= 1) {
      return;
    }
    const wasDefault = defaultBox.checked;
    row.remove();
    if (wasDefault) {
      const first = list.querySelector('.provider-key-row');
      if (first) {
        setExclusiveDefault(first);
      }
    }
  });

  fields.append(defaultLabel, providerLabel, keyLabel, modelLabel, removeButton);
  row.append(fields);
  void refreshRowModels(row, entry.defaultModel ?? '');
  return row;
}

/**
 * Keterangan: Mengisi ulang daftar API key provider pada dialog project dan
 * mencentang baris yang menjadi default.
 */
function renderProviderKeyRows(entries, defaultProvider) {
  const list = document.querySelector('#provider-key-list');
  if (!list) {
    return;
  }
  list.replaceChildren();
  const rows =
    Array.isArray(entries) && entries.length > 0 ? entries : [{ provider: 'claude' }];
  rows.forEach((entry, index) => {
    const isDefault = defaultProvider
      ? entry.provider === defaultProvider
      : index === 0;
    list.append(createProviderKeyRow({ ...entry, isDefault }));
  });
  if (!list.querySelector('[name="isDefault"]:checked')) {
    const first = list.querySelector('.provider-key-row');
    if (first) {
      setExclusiveDefault(first);
    }
  }
}

/**
 * Keterangan: Mengumpulkan payload providers dari baris form, tanpa mengirim
 * API key kosong (edit = pertahankan key lama di server).
 */
function collectProjectProviders() {
  return [...document.querySelectorAll('#provider-key-list .provider-key-row')].map(
    (row) => {
      const apiKey = row.querySelector('[name="apiKey"]').value.trim();
      const defaultModel = row.querySelector('[name="defaultModel"]').value.trim();
      const payload = {
        provider: row.querySelector('[name="providerName"]').value,
      };
      if (apiKey) {
        payload.apiKey = apiKey;
      }
      if (defaultModel) {
        payload.defaultModel = defaultModel;
      }
      return payload;
    },
  );
}

/**
 * Keterangan: Membuat input berlabel untuk field step dan mengaktifkan
 * validasi browser pada seluruh nilai action yang wajib.
 */
function createStepField(name, labelText, value, placeholder) {
  const label = document.createElement('label');
  label.className = 'step-field';
  label.textContent = labelText;
  const input = document.createElement('input');
  input.name = name;
  input.value = value ?? '';
  input.placeholder = placeholder;
  input.required = true;
  input.autocomplete = 'off';
  label.append(input);
  return label;
}

/**
 * Keterangan: Merender field yang sesuai dengan action step sehingga user
 * tidak perlu menulis struktur JSON secara manual.
 */
function renderStepFields(row, step = {}) {
  const action = row.querySelector('[name="action"]').value;
  const fields = row.querySelector('.step-fields');
  fields.replaceChildren();
  if (action === 'goto') {
    fields.append(
      createStepField('url', 'URL / path', step.url, '/login atau https://…'),
    );
    return;
  }
  if (action === 'assertUrl') {
    fields.append(
      createStepField('value', 'URL / potongan URL', step.value, '/dashboard'),
    );
    return;
  }
  fields.append(
    createStepField(
      'selector',
      'Selector',
      step.selector,
      '[data-testid="submit"]',
    ),
  );
  if (
    action === 'fill' ||
    action === 'select' ||
    action === 'assertText' ||
    action === 'assertValue' ||
    action === 'assertCount'
  ) {
    fields.append(
      createStepField('value', 'Value', step.value, 'Nilai input'),
    );
  }
}

/**
 * Keterangan: Menomori ulang step dan memperbarui kondisi tombol urutan/hapus
 * setelah step ditambah, dipindah, atau dihapus.
 */
function refreshStepRows() {
  const rows = [...document.querySelectorAll('#step-list .step-builder-row')];
  rows.forEach((row, index) => {
    row.querySelector('.step-number').textContent = `Step ${index + 1}`;
    row.querySelector('[data-move="up"]').disabled = index === 0;
    row.querySelector('[data-move="down"]').disabled = index === rows.length - 1;
    row.querySelector('[data-remove-step]').disabled = rows.length === 1;
  });
}

/**
 * Keterangan: Membuat satu baris step interaktif lengkap dengan pilihan action,
 * field kontekstual, pengurutan, dan penghapusan.
 */
function createStepRow(step = { action: 'goto' }) {
  const row = document.createElement('article');
  row.className = 'step-builder-row';

  const header = document.createElement('div');
  header.className = 'step-builder-header';
  const number = document.createElement('strong');
  number.className = 'step-number';
  const controls = document.createElement('div');
  controls.className = 'step-controls';

  for (const [direction, label] of [
    ['up', 'Naik'],
    ['down', 'Turun'],
  ]) {
    const moveButton = document.createElement('button');
    moveButton.type = 'button';
    moveButton.className = 'small-button';
    moveButton.dataset.move = direction;
    moveButton.textContent = label;
    moveButton.addEventListener('click', () => {
      const sibling =
        direction === 'up' ? row.previousElementSibling : row.nextElementSibling;
      if (sibling) {
        if (direction === 'up') {
          sibling.before(row);
        } else {
          sibling.after(row);
        }
        refreshStepRows();
      }
    });
    controls.append(moveButton);
  }

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'small-button danger-button';
  removeButton.dataset.removeStep = '';
  removeButton.textContent = 'Hapus';
  removeButton.addEventListener('click', () => {
    row.remove();
    refreshStepRows();
  });
  controls.append(removeButton);
  header.append(number, controls);

  const actionLabel = document.createElement('label');
  actionLabel.className = 'step-action';
  actionLabel.textContent = 'Action';
  const actionSelect = document.createElement('select');
  actionSelect.name = 'action';
  for (const action of STEP_ACTIONS) {
    const option = document.createElement('option');
    option.value = action;
    option.textContent = action;
    option.selected = action === step.action;
    actionSelect.append(option);
  }
  actionSelect.addEventListener('change', () => renderStepFields(row));
  actionLabel.append(actionSelect);

  const fields = document.createElement('div');
  fields.className = 'step-fields';
  row.append(header, actionLabel, fields);
  renderStepFields(row, step);
  return row;
}

/**
 * Keterangan: Menambahkan step baru ke builder dan menjaga penomoran serta
 * fokus input agar pengisian keyboard tetap nyaman.
 */
function addStep(step) {
  const list = document.querySelector('#step-list');
  const row = createStepRow(step);
  list.append(row);
  refreshStepRows();
  row.querySelector('select').focus();
}

/**
 * Keterangan: Mengubah seluruh baris builder menjadi payload steps sesuai
 * schema API tanpa membawa field yang tidak relevan.
 */
function collectSteps() {
  return [...document.querySelectorAll('#step-list .step-builder-row')].map(
    (row) => {
      const action = row.querySelector('[name="action"]').value;
      if (action === 'goto') {
        return { action, url: row.querySelector('[name="url"]').value.trim() };
      }
      if (action === 'assertUrl') {
        return { action, value: row.querySelector('[name="value"]').value.trim() };
      }
      const step = {
        action,
        selector: row.querySelector('[name="selector"]').value.trim(),
      };
      const valueInput = row.querySelector('[name="value"]');
      if (valueInput) {
        step.value = valueInput.value.trim();
      }
      return step;
    },
  );
}

/**
 * Keterangan: Membuka form project untuk mode create atau edit, lalu mengisi
 * field dari data project yang sudah ada bila sedang mengedit.
 */
function openProjectDialog(project = null) {
  const dialog = document.querySelector('#project-dialog');
  const form = document.querySelector('#project-form');
  form.reset();
  clearFormError(form);
  form.elements.projectId.value = project?.id ?? '';
  form.elements.name.value = project?.name ?? '';
  form.elements.baseUrl.value = project?.baseUrl ?? '';
  document.querySelector('#project-dialog-title').textContent = project
    ? 'Edit Project'
    : 'Buat Project';
  renderProviderKeyRows(
    Array.isArray(project?.providers) && project.providers.length > 0
      ? project.providers
      : [{ provider: 'claude' }],
    project?.defaultProvider || 'claude',
  );
  updateProviderHint();
  dialog.showModal();
  form.elements.name.focus();
}

/**
 * Keterangan: Membuka dialog Instruction dan mengisi teks yang sudah disimpan
 * di project, tanpa langsung generate.
 */
function openInstructionDialog(projectId) {
  const dialog = document.querySelector('#instruction-dialog');
  const form = document.querySelector('#instruction-form');
  if (!dialog || !form) {
    return;
  }
  const card = document.querySelector(
    `.project-card[data-project-id="${projectId}"]`,
  );
  let project = {};
  try {
    project = JSON.parse(card?.dataset.project || '{}');
  } catch {
    project = {};
  }
  form.reset();
  clearFormError(form);
  form.elements.projectId.value = projectId;
  form.elements.prompt.value = project.instruction ?? '';
  form.elements.extraData.value = project.extraData ?? '';
  dialog.showModal();
  form.elements.prompt.focus();
}

/**
 * Keterangan: Mengganti mode dialog test case antara "Langkah manual" dan
 * "Deskripsikan dengan AI" — title/expected hanya wajib diisi di mode
 * manual (mode AI menyimpan sendiri lewat endpoint guided-generate, bukan
 * lewat submit form utama).
 */
function setTestCaseDialogMode(mode) {
  const dialog = document.querySelector('#test-case-dialog');
  if (!dialog) {
    return;
  }
  dialog.dataset.mode = mode;
  dialog.querySelectorAll('.mode-toggle-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  });
  const form = document.querySelector('#test-case-form');
  const manualFields = document.querySelector('#test-case-manual-fields');
  const guidedPanel = document.querySelector('#guided-generate-panel');
  const submitButton = form?.querySelector('.submit-button');
  const isGuided = mode === 'ai-guided';
  if (manualFields) {
    manualFields.hidden = isGuided;
  }
  if (guidedPanel) {
    guidedPanel.hidden = !isGuided;
  }
  if (submitButton) {
    submitButton.hidden = isGuided;
  }
  if (form) {
    form.elements.title.required = !isGuided;
    form.elements.expected.required = !isGuided;
  }
}

/**
 * Keterangan: Membuka form test case untuk mode create atau edit dan mengisi
 * builder dari data test case yang sudah ada. Toggle "Deskripsikan dengan AI"
 * tersedia untuk KEDUA mode — mengedit lewat AI berarti AI menjalankan ulang
 * browser sungguhan dari awal (bukan sekadar menulis ulang JSON) lalu
 * meng-update test case ini (lihat startGuidedGenerate/testCaseId).
 */
function openTestCaseDialog(projectId, testCase = null) {
  const dialog = document.querySelector('#test-case-dialog');
  const form = document.querySelector('#test-case-form');
  form.reset();
  clearFormError(form);
  form.elements.projectId.value = projectId;
  form.elements.testCaseId.value = testCase?.id ?? '';
  form.elements.title.value = testCase?.title ?? '';
  form.elements.description.value = testCase?.description ?? '';
  form.elements.expected.value = Array.isArray(testCase?.expected)
    ? testCase.expected.join('\n')
    : '';
  document.querySelector('#test-case-dialog-title').textContent = testCase
    ? 'Edit Test Case'
    : 'Tambah Test Case';

  setTestCaseDialogMode('manual');
  const guidedPrompt = document.querySelector('#guided-generate-prompt');
  if (guidedPrompt) {
    guidedPrompt.value = '';
    guidedPrompt.placeholder = testCase
      ? `Deskripsikan perubahan yang diinginkan, mis. "tambahkan pengisian field email juga" (mengedit: ${testCase.title})`
      : 'mis. buka menu pelanggan, klik tombol tambah, isi form pelanggan dan submit';
  }
  const guidedLog = document.querySelector('.guided-generate-log');
  guidedLog?.replaceChildren();

  const stepList = document.querySelector('#step-list');
  stepList.replaceChildren();
  const steps =
    Array.isArray(testCase?.steps) && testCase.steps.length > 0
      ? testCase.steps
      : [{ action: 'goto' }];
  for (const step of steps) {
    stepList.append(createStepRow(step));
  }
  refreshStepRows();
  dialog.showModal();
  form.elements.title.focus();
}

/**
 * Keterangan: Menghentikan (abort) guided generate yang masih berjalan di
 * panel/modal yang ditutup — dipanggil saat user menutup UI SEBELUM AI
 * selesai, supaya sesi browser langsung bisa dipakai lagi (bukan cuma
 * disembunyikan sementara job tetap sibuk di server).
 */
async function abortGuidedGenerateIfActive(panel, projectId) {
  if (!panel) {
    return;
  }
  const generateId = panel.dataset.activeGenerateId;
  if (!generateId || panel.dataset.finished === 'true') {
    return;
  }
  panel.dataset.finished = 'true';
  closeSocketForRun(generateId);
  if (activeRunSessionId) {
    await fetch(
      `/projects/${projectId}/test-runs/session/${activeRunSessionId}/abort`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        keepalive: true,
      },
    ).catch(() => undefined);
  }
}

/**
 * Keterangan: Membuka panel "Tambah Test Case dengan AI" di sidebar —
 * menyembunyikan pencarian/daftar test case sementara, lalu memastikan
 * sesi browser persisten sudah siap (dibuat kalau belum ada).
 */
async function openGuidedGenerateSidebarPanel(projectId, runPanel) {
  const sidebarPanel = document.querySelector('#guided-generate-sidebar-panel');
  const searchForm = document.querySelector('#test-case-search-form');
  const list = document.querySelector('.test-case-list');
  const emptyMessage = document.querySelector('.test-case-sidebar-empty');
  if (sidebarPanel) {
    sidebarPanel.hidden = false;
  }
  if (searchForm) {
    searchForm.hidden = true;
  }
  if (list) {
    list.hidden = true;
  }
  if (emptyMessage) {
    emptyMessage.hidden = true;
  }
  document.querySelector('#guided-generate-sidebar-prompt')?.focus();
  try {
    await ensureRunSession(projectId, runPanel);
  } catch {
    // Error ditangani/ditampilkan saat tombol "Jalankan AI" diklik.
  }
}

/**
 * Keterangan: Menutup panel sidebar AI — abort job aktif (bila ada), lalu
 * kembalikan tampilan pencarian/daftar test case seperti semula.
 */
async function closeGuidedGenerateSidebarPanel(projectId) {
  const sidebarPanel = document.querySelector('#guided-generate-sidebar-panel');
  await abortGuidedGenerateIfActive(sidebarPanel, projectId);
  if (sidebarPanel) {
    sidebarPanel.hidden = true;
  }
  document.querySelector('#test-case-search-form')?.removeAttribute('hidden');
  document.querySelector('.test-case-list')?.removeAttribute('hidden');
}

/**
 * Keterangan: Memicu guided single-flow generate (Tambah Test Case via
 * prompt AI) — dijalankan di DALAM sesi Playwright persisten yang sudah ada
 * di panel "Live run" kanan (ensureRunSession), BUKAN browser baru. Dipakai
 * dari DUA entry point (toggle AI di modal, dan panel sidebar baru) lewat
 * parameter `elements` supaya satu implementasi saja.
 */
async function startGuidedGenerate(projectId, runPanel, elements) {
  const { promptInput, guidedPanel, runButton, testCaseId } = elements;
  const prompt = promptInput?.value.trim() ?? '';
  if (!prompt) {
    promptInput?.focus();
    return;
  }
  if (!guidedPanel) {
    return;
  }
  const log = guidedPanel.querySelector('.guided-generate-log');
  log?.replaceChildren();
  if (runButton) {
    setSubmitButtonLoading(runButton, true);
  }
  appendGenerateLog(guidedPanel, 'Menyiapkan sesi browser…', 'active');
  try {
    const sessionId = await ensureRunSession(projectId, runPanel);
    if (!sessionId) {
      throw new Error('Sesi browser belum siap, tunggu sebentar lalu coba lagi.');
    }
    const data = await requestJson(
      `/projects/${projectId}/test-cases/generate-guided`,
      'POST',
      testCaseId ? { prompt, sessionId, testCaseId } : { prompt, sessionId },
    );
    if (!data.generateId) {
      throw new Error('Generate tidak mengembalikan generateId');
    }
    watchGuidedGenerate(projectId, data.generateId, guidedPanel, runButton);
  } catch (error) {
    appendGenerateLog(
      guidedPanel,
      error instanceof Error ? error.message : 'Test case gagal digenerate',
      'error',
    );
    if (runButton) {
      setSubmitButtonLoading(runButton, false);
    }
  }
}

/**
 * Keterangan: Memproses satu event WS guided generate — dipisah dari
 * watchGuidedGenerate (bukan inline di socket listener) supaya bisa dites
 * langsung tanpa perlu koneksi WebSocket sungguhan.
 */
function handleGuidedGenerateEvent(event, projectId, generateId, guidedPanel, finish) {
  if (event.runId !== generateId || guidedPanel.dataset.activeGenerateId !== generateId) {
    return;
  }
  if (event.type === 'generate:status') {
    appendGenerateLog(guidedPanel, event.message, 'active');
  } else if (event.type === 'generate:need-input') {
    showAuthInputPanel(guidedPanel, event);
    wireAuthInputPanel(guidedPanel, projectId, generateId);
  } else if (event.type === 'generate:done') {
    appendGenerateLog(guidedPanel, 'Test case tersimpan.', 'done');
    finish();
    // Sengaja TIDAK reload halaman — supaya panel live Playwright (kanan)
    // tetap menampilkan kondisi terakhirnya, sama seperti selesai
    // menjalankan test case biasa. Daftar test case cukup di-refresh
    // sebagian lewat fetch+swap .test-case-list, bukan navigasi penuh.
    void refreshTestCaseList(projectId, document.querySelector('#test-case-form'));
    const dialog = guidedPanel.closest('dialog');
    if (dialog) {
      window.setTimeout(() => dialog.close(), 700);
    } else if (guidedPanel.id === 'guided-generate-sidebar-panel') {
      window.setTimeout(() => {
        guidedPanel.hidden = true;
        document.querySelector('#test-case-search-form')?.removeAttribute('hidden');
        document.querySelector('.test-case-list')?.removeAttribute('hidden');
      }, 700);
    }
  } else if (event.type === 'generate:error') {
    appendGenerateLog(guidedPanel, event.message || 'Generate test case gagal', 'error');
    finish();
  }
}

/**
 * Keterangan: Subscribe WS untuk satu guided generate run — reuse kontrak
 * event yang sama dengan generate proyek (generate:status/need-input/
 * done/error). Frame live view TIDAK disubscribe di sini — sudah otomatis
 * tampil di panel "Live run" kanan lewat sessionId yang sama (screencast
 * sesi di-retarget server-side, lihat withSessionPage).
 */
function watchGuidedGenerate(projectId, generateId, guidedPanel, runButton) {
  const previousId = guidedPanel.dataset.activeGenerateId;
  if (previousId && previousId !== generateId) {
    closeSocketForRun(previousId);
  }
  guidedPanel.dataset.activeGenerateId = generateId;
  guidedPanel.dataset.finished = 'false';

  const socket = new WebSocket(createWebSocketUrl());
  activeSockets.set(generateId, socket);

  const finish = () => {
    guidedPanel.dataset.finished = 'true';
    closeSocketForRun(generateId);
    if (runButton) {
      setSubmitButtonLoading(runButton, false);
    }
  };

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe:run', runId: generateId }));
  });
  socket.addEventListener('message', (message) => {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    handleGuidedGenerateEvent(event, projectId, generateId, guidedPanel, finish);
  });
  socket.addEventListener('close', () => {
    activeSockets.delete(generateId);
    if (guidedPanel.dataset.activeGenerateId !== generateId || guidedPanel.dataset.finished === 'true') {
      return;
    }
    appendGenerateLog(
      guidedPanel,
      'Koneksi live terputus. Generate tetap berjalan di server — muat ulang beberapa saat lagi bila hasil belum muncul.',
      'error',
    );
  });
}

/**
 * Keterangan: Menyimpan project baru atau hasil edit melalui API, lalu memuat
 * ulang dashboard agar data server langsung tampil konsisten.
 */
async function submitProjectForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) {
    return;
  }
  const projectId = form.elements.projectId.value;
  const providers = collectProjectProviders();
  const defaultProvider = getSelectedDefaultProvider();
  const defaultRow = providers.find((entry) => entry.provider === defaultProvider);
  if (!defaultProvider) {
    showFormError(form, 'Centang Default pada salah satu provider.');
    return;
  }
  if (!projectId && !defaultRow?.apiKey) {
    showFormError(form, 'API key untuk provider default wajib diisi.');
    return;
  }
  const submitButton = form.querySelector('.submit-button');
  clearFormError(form);
  setSubmitButtonLoading(submitButton, true);
  try {
    const baseUrl = form.elements.baseUrl.value.trim();
    await requestJson(
      projectId ? `/projects/${projectId}` : '/projects',
      projectId ? 'PATCH' : 'POST',
      {
        name: form.elements.name.value.trim(),
        baseUrl: baseUrl || null,
        defaultProvider,
        providers,
      },
    );
    window.location.reload();
  } catch (error) {
    showFormError(
      form,
      error instanceof Error ? error.message : 'Project gagal disimpan',
    );
    setSubmitButtonLoading(submitButton, false);
  }
}

/**
 * Keterangan: Menyimpan instruction ke project tanpa menjalankan generate.
 */
async function submitInstructionForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) {
    return;
  }
  const projectId = form.elements.projectId.value;
  const prompt = form.elements.prompt.value.trim();
  const extraData = form.elements.extraData.value.trim();
  if (!prompt) {
    showFormError(form, 'Instruction wajib diisi.');
    return;
  }
  const submitButton = form.querySelector('.submit-button');
  const dialog = document.querySelector('#instruction-dialog');
  clearFormError(form);
  setSubmitButtonLoading(submitButton, true);
  try {
    const saved = await requestJson(`/projects/${projectId}/instruction`, 'POST', {
      prompt,
      extraData,
    });
    const card = document.querySelector(
      `.project-card[data-project-id="${projectId}"]`,
    );
    if (card) {
      try {
        const project = JSON.parse(card.dataset.project || '{}');
        card.dataset.project = JSON.stringify({
          ...project,
          instruction: saved.instruction ?? prompt,
          extraData: saved.extraData ?? extraData,
        });
      } catch {
        // Dataset gagal di-update; generate tetap membaca instruction dari server.
      }
    }
    dialog?.close();
  } catch (error) {
    showFormError(
      form,
      error instanceof Error ? error.message : 'Instruction gagal disimpan',
    );
  } finally {
    setSubmitButtonLoading(submitButton, false);
  }
}

/**
 * Keterangan: Menyimpan test case create/edit dari step builder memakai
 * kontrak API yang tersedia dan spinner tombol selama request berjalan.
 */
async function submitTestCaseForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) {
    return;
  }
  const expected = form.elements.expected.value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
  if (expected.length === 0) {
    showFormError(form, 'Expected result wajib minimal satu baris.');
    return;
  }

  const submitButton = form.querySelector('.submit-button');
  clearFormError(form);
  setSubmitButtonLoading(submitButton, true);
  const testCaseId = form.elements.testCaseId.value;
  const projectId = form.elements.projectId.value;
  try {
    await requestJson(
      testCaseId
        ? `/test-cases/${testCaseId}`
        : `/projects/${projectId}/test-cases`,
      testCaseId ? 'PATCH' : 'POST',
      {
        title: form.elements.title.value.trim(),
        description: form.elements.description.value.trim(),
        steps: collectSteps(),
        expected,
      },
    );
    window.location.reload();
  } catch (error) {
    showFormError(
      form,
      error instanceof Error ? error.message : 'Test case gagal disimpan',
    );
    setSubmitButtonLoading(submitButton, false);
  }
}

/**
 * Keterangan: Menghapus project setelah konfirmasi, dengan spinner pada
 * tombol ikon selama request.
 */
async function deleteProject(button) {
  const projectId = button.dataset.projectId;
  const name = button.dataset.projectName || 'project ini';
  if (!window.confirm(`Hapus project "${name}"? Test case dan hasil run ikut terhapus.`)) {
    return;
  }
  setIconButtonLoading(button, true);
  try {
    await requestJson(`/projects/${projectId}/delete`, 'POST', {});
    window.location.reload();
  } catch (error) {
    setIconButtonLoading(button, false);
    window.alert(error instanceof Error ? error.message : 'Project gagal dihapus');
  }
}

/**
 * Keterangan: Memasang seluruh event dialog CRUD dashboard satu kali setelah
 * token tersedia dan elemen halaman siap.
 */
function initializeManagementUi() {
  const projectForm = document.querySelector('#project-form');
  if (!projectForm) {
    return;
  }
  const testCaseForm = document.querySelector('#test-case-form');
  document
    .querySelector('#new-project-button')
    .addEventListener('click', () => openProjectDialog());
  document.querySelectorAll('.edit-project-button').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.project-card');
      try {
        openProjectDialog(JSON.parse(card.dataset.project));
      } catch {
        openProjectDialog();
        showFormError(
          projectForm,
          'Data project gagal dibaca. Muat ulang dashboard.',
        );
      }
    });
  });
  document.querySelectorAll('.delete-project-button').forEach((button) => {
    button.addEventListener('click', () => void deleteProject(button));
  });
  document
    .querySelector('#add-step-button')
    ?.addEventListener('click', () => addStep({ action: 'goto' }));
  document
    .querySelector('#add-provider-key-button')
    ?.addEventListener('click', () => {
      const list = document.querySelector('#provider-key-list');
      list?.append(createProviderKeyRow({ provider: 'openai' }));
    });
  projectForm.addEventListener('submit', (event) => void submitProjectForm(event));
  if (testCaseForm) {
    testCaseForm.addEventListener('submit', (event) =>
      void submitTestCaseForm(event),
    );
    document
      .querySelector('#add-step-button')
      ?.addEventListener('click', () => addStep({ action: 'goto' }));
    document.querySelectorAll('.edit-test-case-button').forEach((button) => {
      button.addEventListener('click', () => {
        const article = button.closest('.test-case');
        try {
          openTestCaseDialog(
            article.dataset.projectId,
            JSON.parse(article.dataset.testCase),
          );
        } catch {
          openTestCaseDialog(article.dataset.projectId);
          showFormError(
            testCaseForm,
            'Data test case gagal dibaca. Muat ulang halaman.',
          );
        }
      });
    });
  }
  document
    .querySelector('#instruction-form')
    ?.addEventListener('submit', (event) => void submitInstructionForm(event));

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  document.querySelectorAll('.instruction-button').forEach((button) => {
    button.addEventListener('click', () =>
      openInstructionDialog(button.dataset.projectId),
    );
  });
  document.querySelectorAll('.ai-test-script-button').forEach((button) => {
    button.addEventListener('click', (event) => startGenerateFromProject(event));
  });
  document
    .querySelector('#generate-replace-confirm-button')
    ?.addEventListener('click', () => confirmGenerateReplace());
}

/**
 * Keterangan: Mendekode payload JWT (tanpa verifikasi signature — hanya untuk
 * menampilkan username milik user sendiri di navbar, bukan keputusan auth).
 */
function decodeJwtPayload(rawToken) {
  try {
    const payloadSegment = rawToken.split('.')[1];
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Keterangan: Menampilkan username dari token pada tombol menu user di navbar.
 */
function renderUserIdentity() {
  const nameEl = document.querySelector('#user-name');
  const avatarEl = document.querySelector('#user-avatar');
  if (!nameEl || !avatarEl || !token) {
    return;
  }
  const payload = decodeJwtPayload(token);
  const username = payload?.username || 'User';
  nameEl.textContent = username;
  avatarEl.textContent = username.slice(0, 2).toUpperCase();
}

/**
 * Keterangan: Membuka/menutup dropdown menu user di navbar; dipakai juga
 * untuk menutup otomatis saat klik di luar area menu atau tombol Escape.
 */
function setUserMenuOpen(isOpen) {
  const menu = document.querySelector('#user-menu');
  const button = document.querySelector('#user-menu-button');
  if (!menu || !button) {
    return;
  }
  menu.hidden = !isOpen;
  button.setAttribute('aria-expanded', String(isOpen));
}

/**
 * Keterangan: Memasang toggle dropdown user menu beserta penutup otomatis
 * saat klik di luar area menu atau menekan Escape.
 */
function wireUserMenu() {
  const button = document.querySelector('#user-menu-button');
  const menu = document.querySelector('#user-menu');
  if (!button || !menu) {
    return;
  }
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setUserMenuOpen(menu.hidden);
  });
  document.addEventListener('click', (event) => {
    if (!menu.hidden && !event.target.closest('.navbar-user')) {
      setUserMenuOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setUserMenuOpen(false);
    }
  });
}

/**
 * Keterangan: Mengirim logout ke server (menghapus cookie auth), lalu
 * membersihkan token lokal dan mengarahkan kembali ke halaman login.
 */
async function handleLogout() {
  const button = document.querySelector('#logout-button');
  if (!button || button.disabled) {
    return;
  }
  setSubmitButtonLoading(button, true);
  try {
    await fetch('/auth/logout', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    // Tetap lanjut logout di sisi client walau request gagal (mis. offline).
  } finally {
    sessionStorage.removeItem('pointestingToken');
    window.location.replace('/dashboard/login');
  }
}

/**
 * Keterangan: Memfilter kartu project dan test case berdasarkan teks yang
 * diketik pada kolom pencarian navbar, tanpa memanggil API (murni client-side).
 */
function filterDashboardEntries(rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  const emptyState = document.querySelector('#search-empty-state');
  let anyProjectVisible = false;

  document.querySelectorAll('.project-card').forEach((card) => {
    const projectName =
      card.querySelector('.project-heading h2')?.textContent.toLowerCase() ?? '';
    const projectMatches = query === '' || projectName.includes(query);
    card.hidden = !projectMatches;
    if (projectMatches) {
      anyProjectVisible = true;
    }
  });

  if (emptyState) {
    emptyState.hidden = query === '' || anyProjectVisible;
  }
}

/**
 * Keterangan: Memasang input pencarian navbar dengan debounce ringan agar
 * filter tidak memicu reflow berlebihan pada setiap ketikan.
 */
function wireSearchFilter() {
  const input = document.querySelector('#dashboard-search');
  if (!input) {
    return;
  }
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const value = input.value;
    debounceTimer = setTimeout(() => filterDashboardEntries(value), 120);
  });
}

/**
 * Keterangan: Menutup seluruh subscription ketika halaman ditinggalkan agar
 * subscriber gateway segera dibersihkan.
 */
function closeActiveSockets() {
  const workspace = document.querySelector('#testcases-workspace');
  const projectId = workspace?.dataset.projectId;
  if (activeRunSessionId && projectId && token) {
    void fetch(
      `/projects/${projectId}/test-runs/session/${activeRunSessionId}/stop`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        keepalive: true,
      },
    ).catch(() => undefined);
    activeRunSessionId = null;
    activeRunSessionProjectId = null;
  }

  for (const runId of [...activeSockets.keys()]) {
    closeSocketForRun(runId);
  }
  for (const runId of [...pollTimers.keys()]) {
    stopPolling(runId);
  }
}

/**
 * Keterangan: Memulai job generate di halaman full-width: POST instruction
 * tersimpan, lalu subscribe live log dan Playwright.
 */
async function initializeGenerateWorkspace() {
  const workspace = document.querySelector('#generate-workspace');
  const panel = workspace?.querySelector('.generate-panel');
  const projectId = workspace?.dataset.projectId;
  if (!workspace || !panel || !projectId) {
    return;
  }

  renderUserIdentity();
  wireUserMenu();
  document.querySelector('#logout-button')?.addEventListener('click', () => {
    void handleLogout();
  });
  document.querySelector('#page-loading').hidden = true;
  document.querySelector('#dashboard-content').hidden = false;
  panel.hidden = false;
  resetGeneratePanel(panel);
  appendGenerateLog(panel, 'Menunggu Playwright…', 'active');

  try {
    const replaceExisting = sessionStorage.getItem('generateReplaceExisting') === '1';
    sessionStorage.removeItem('generateReplaceExisting');
    const data = await requestJson(
      `/projects/${projectId}/generate/prompt`,
      'POST',
      { replaceExisting },
    );
    if (!data.generateId) {
      throw new Error('Generate tidak mengembalikan generateId');
    }
    startGenerate(projectId, data.generateId);
  } catch (error) {
    updateStatus(panel, 'error');
    appendGenerateLog(
      panel,
      error instanceof Error ? error.message : 'Test case gagal digenerate',
      'error',
    );
  }
}

/**
 * Keterangan: Memasang listener Edit/Run/Putar Ulang untuk setiap item di
 * daftar test case sidebar — dipisah jadi fungsi sendiri (bukan inline di
 * initializeTestCasesWorkspace) supaya bisa dipanggil ULANG setelah
 * refreshTestCaseList mengganti isi .test-case-list dengan markup baru dari
 * server (item lama beserta listener-nya ikut hilang saat diganti).
 */
function wireTestCaseListButtons(testCaseForm) {
  document.querySelectorAll('.edit-test-case-button').forEach((button) => {
    if (button.dataset.wired === 'true') {
      return;
    }
    button.dataset.wired = 'true';
    button.addEventListener('click', () => {
      const article = button.closest('.test-case');
      try {
        openTestCaseDialog(
          article.dataset.projectId,
          JSON.parse(article.dataset.testCase),
        );
      } catch {
        openTestCaseDialog(article.dataset.projectId);
        if (testCaseForm) {
          showFormError(
            testCaseForm,
            'Data test case gagal dibaca. Muat ulang halaman.',
          );
        }
      }
    });
  });
  document.querySelectorAll('.run-button').forEach((button) => {
    if (button.dataset.wired === 'true') {
      return;
    }
    button.dataset.wired = 'true';
    button.addEventListener('click', () => void startRun(button));
  });
  document.querySelectorAll('.replay-button').forEach((button) => {
    if (button.dataset.wired === 'true') {
      return;
    }
    button.dataset.wired = 'true';
    button.addEventListener('click', () => void replayLatestRun(button));
  });
}

/**
 * Keterangan: Mengambil ulang daftar test case dari server (fetch halaman
 * yang sama, ambil markup .test-case-list terbaru) lalu menukarnya di DOM —
 * TANPA reload penuh, supaya panel live Playwright (kanan) tidak ikut reset
 * kondisi terakhirnya. Dipakai setelah guided generate selesai menyimpan
 * test case baru.
 */
async function refreshTestCaseList(projectId, testCaseForm) {
  try {
    const response = await fetch(window.location.pathname);
    if (!response.ok) {
      return false;
    }
    const html = await response.text();
    const newDocument = new DOMParser().parseFromString(html, 'text/html');
    const newList = newDocument.querySelector('.test-case-list');
    const currentList = document.querySelector('.test-case-list');
    if (!newList || !currentList) {
      return false;
    }
    currentList.replaceWith(newList);
    if (newList.childElementCount > 0) {
      document.querySelector('.test-case-sidebar-empty')?.setAttribute('hidden', '');
    }
    wireTestCaseListButtons(testCaseForm);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keterangan: Filter daftar test case di sidebar halaman test case lewat
 * search navbar (sama seperti dashboard).
 */
function wireTestCaseSearchFilter() {
  const workspace = document.querySelector('#testcases-workspace');
  const form = document.querySelector('#test-case-search-form');
  const sidebarInput = document.querySelector('#test-case-search');
  const navInput = document.querySelector('#dashboard-search');
  const inputs = [sidebarInput, navInput].filter(Boolean);
  if (!workspace || inputs.length === 0) {
    return;
  }

  const applyFilter = (source) => {
    const value = (source?.value ?? sidebarInput?.value ?? '').trim().toLowerCase();
    let visibleCount = 0;
    workspace.querySelectorAll('.test-case-item').forEach((item) => {
      const title = item.querySelector('h3')?.textContent?.toLowerCase() ?? '';
      const description =
        item.querySelector('.test-case-description')?.textContent?.toLowerCase() ?? '';
      const match = value === '' || title.includes(value) || description.includes(value);
      item.hidden = !match;
      if (match) {
        visibleCount += 1;
      }
    });
    const empty = workspace.querySelector('.test-case-search-empty');
    if (empty) {
      empty.hidden = value === '' || visibleCount > 0;
    }
  };

  for (const input of inputs) {
    input.addEventListener('input', () => applyFilter(input));
  }
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    applyFilter(sidebarInput ?? navInput);
  });
}

/**
 * Keterangan: Menginisialisasi halaman test case full-width: sidebar kiri daftar
 * test case, panel kanan live Playwright / replay rekaman.
 */
function initializeTestCasesWorkspace() {
  const workspace = document.querySelector('#testcases-workspace');
  const panel = workspace?.querySelector('.run-workspace-panel');
  const projectId = workspace?.dataset.projectId;
  if (!workspace || !panel || !projectId) {
    return;
  }

  renderUserIdentity();
  wireUserMenu();
  wireTestCaseSearchFilter();
  document.querySelector('#logout-button')?.addEventListener('click', () => {
    void handleLogout();
  });

  const testCaseForm = document.querySelector('#test-case-form');
  if (testCaseForm) {
    testCaseForm.addEventListener('submit', (event) =>
      void submitTestCaseForm(event),
    );
    document
      .querySelector('#add-step-button')
      ?.addEventListener('click', () => addStep({ action: 'goto' }));
    document.querySelectorAll('#test-case-mode-toggle .mode-toggle-button').forEach((button) => {
      button.addEventListener('click', () => setTestCaseDialogMode(button.dataset.mode));
    });
    document
      .querySelector('#guided-generate-run-button')
      ?.addEventListener('click', () =>
        void startGuidedGenerate(projectId, panel, {
          promptInput: document.querySelector('#guided-generate-prompt'),
          guidedPanel: document.querySelector('#guided-generate-panel'),
          runButton: document.querySelector('#guided-generate-run-button'),
          // Kosong (create) kalau modal sedang mode "Tambah Test Case",
          // terisi (edit) kalau modal sedang mode "Edit Test Case" — hasil
          // guided flow lalu meng-update test case ini alih-alih membuat baru.
          testCaseId: document.querySelector('#test-case-form')?.elements.testCaseId.value || undefined,
        }),
      );
    document.querySelector('#test-case-dialog')?.addEventListener('close', () => {
      void abortGuidedGenerateIfActive(document.querySelector('#guided-generate-panel'), projectId);
    });
  }
  wireTestCaseListButtons(testCaseForm);

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });

  document.querySelector('#run-suite-button')?.addEventListener('click', (event) => {
    void startSuiteRun(event.currentTarget);
  });
  document.querySelector('#stop-run-button')?.addEventListener('click', (event) => {
    void abortActiveRun(event.currentTarget);
  });
  document.querySelector('#add-test-case-button')?.addEventListener('click', () => {
    openTestCaseDialog(projectId);
  });

  document.querySelector('#add-test-case-ai-button')?.addEventListener('click', () => {
    void openGuidedGenerateSidebarPanel(projectId, panel);
  });
  document.querySelector('#guided-generate-sidebar-close')?.addEventListener('click', () => {
    void closeGuidedGenerateSidebarPanel(projectId);
  });
  document.querySelector('#guided-generate-sidebar-run')?.addEventListener('click', () =>
    void startGuidedGenerate(projectId, panel, {
      promptInput: document.querySelector('#guided-generate-sidebar-prompt'),
      guidedPanel: document.querySelector('#guided-generate-sidebar-panel'),
      runButton: document.querySelector('#guided-generate-sidebar-run'),
    }),
  );

  const params = new URLSearchParams(window.location.search);
  if (params.get('create') === '1') {
    openTestCaseDialog(projectId);
    window.history.replaceState({}, '', window.location.pathname);
  }

  document.querySelector('#page-loading').hidden = true;
  document.querySelector('#dashboard-content').hidden = false;

  void ensureRunSession(projectId, panel).catch((error) => {
    updateStatus(panel, 'error');
    const placeholder = getRunContentElement(panel)?.querySelector('.live-placeholder');
    if (placeholder) {
      placeholder.textContent =
        error instanceof Error
          ? error.message
          : 'Gagal membuka sesi browser persisten';
    }
  });
  void loadLatestSuiteAnalysis(projectId);
}

/**
 * Keterangan: Menginisialisasi dashboard, memuat katalog provider saat spinner
 * halaman aktif, lalu menampilkan seluruh fitur CRUD dan eksekusi.
 */
async function initializeDashboard() {
  if (!token) {
    window.location.replace('/dashboard/login');
    return;
  }
  if (document.querySelector('#generate-workspace')) {
    await initializeGenerateWorkspace();
    return;
  }
  if (document.querySelector('#testcases-workspace')) {
    initializeTestCasesWorkspace();
    return;
  }
  initializeManagementUi();
  renderUserIdentity();
  wireUserMenu();
  wireSearchFilter();
  document.querySelector('#logout-button')?.addEventListener('click', () => {
    void handleLogout();
  });
  try {
    await loadProviderCatalogs();
  } catch {
    updateProviderHint();
  }
  document.querySelector('#page-loading').hidden = true;
  document.querySelector('#dashboard-content').hidden = false;
}

void initializeDashboard();
window.addEventListener('beforeunload', closeActiveSockets);
