const token = sessionStorage.getItem('pointestingToken');
const activeSockets = new Map();
const pollTimers = new Map();
const pendingAnalysisByRun = new Map();
const TERMINAL_STATUSES = ['passed', 'failed', 'error'];
const MAX_ANALYSIS_POLL_ATTEMPTS = 30;
const providerCatalogs = new Map();
const STEP_ACTIONS = ['goto', 'fill', 'click', 'check', 'select', 'waitFor'];
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
  button.disabled = isLoading;
  button.querySelector('.button-label').hidden = isLoading;
  button.querySelector('.spinner').hidden = !isLoading;
}

/**
 * Keterangan: Mengubah teks dan warna indikator status run pada panel terkait.
 */
function updateStatus(panel, status) {
  const badge = panel.querySelector('.status-badge');
  badge.textContent = status;
  badge.className = `status-badge status-${status}`;
}

/**
 * Keterangan: Menambahkan event hasil step ke daftar progres pada panel run.
 */
function appendStepEvent(panel, event) {
  const item = document.createElement('li');
  item.textContent = `Step ${event.stepIndex + 1} · ${event.action} · ${event.status}`;
  item.className = `step-${event.status}`;
  panel.querySelector('.step-events').append(item);
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
 * Keterangan: Menampilkan spinner area analysis selama worker AI masih
 * memproses artifact setelah status browser sudah terminal.
 */
function showAnalysisLoading(panel) {
  const analysisPanel = panel.querySelector('.analysis-panel');
  analysisPanel.hidden = false;
  analysisPanel.className = 'analysis-panel analysis-loading';
  analysisPanel.innerHTML =
    '<span class="spinner" aria-hidden="true"></span><span>Menunggu analisis AI…</span>';
}

/**
 * Keterangan: Menambahkan satu field label/value ke card analysis memakai
 * textContent agar output provider tidak dapat menyisipkan HTML.
 */
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
  const testCase = panel.closest('.test-case');
  const summary = testCase.querySelector('.latest-analysis-summary');
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
 * Keterangan: Merender kesimpulan AI hanya setelah video/trace siap pada panel
 * yang sama; event lebih cepat disimpan sementara sampai bukti tersedia.
 */
function renderAnalysisResult(runId, panel, analysisResult, socket) {
  if (
    panel.dataset.activeRunId !== runId ||
    panel.dataset.finished === 'true'
  ) {
    return;
  }
  if (panel.dataset.evidenceReady !== 'true') {
    pendingAnalysisByRun.set(runId, analysisResult);
    showAnalysisLoading(panel);
    return;
  }

  const analysisPanel = panel.querySelector('.analysis-panel');
  analysisPanel.replaceChildren();
  analysisPanel.hidden = false;
  analysisPanel.className = 'analysis-panel';

  const header = document.createElement('div');
  header.className = 'analysis-header';
  const title = document.createElement('strong');
  title.textContent = 'AI Analysis';
  const badge = document.createElement('span');
  badge.className = `analysis-badge analysis-status-${analysisResult.status}`;
  badge.textContent = analysisResult.status;
  header.append(title, badge);
  analysisPanel.append(header);

  const provider = document.createElement('p');
  provider.className = 'analysis-provider';
  provider.textContent = `Provider: ${analysisResult.provider}`;
  analysisPanel.append(provider);

  if (analysisResult.status === 'success') {
    appendAnalysisField(
      analysisPanel,
      'Bukti keberhasilan',
      analysisResult.reason || 'Tidak ada reason dari provider.',
    );
  } else {
    appendAnalysisField(
      analysisPanel,
      'Detail / root cause',
      analysisResult.detail || 'Tidak ada detail dari provider.',
    );
    appendAnalysisField(
      analysisPanel,
      'Solusi',
      analysisResult.solution || 'Tidak ada solusi dari provider.',
    );
  }

  updateLatestAnalysisSummary(panel, analysisResult);
  finishRunWatch(runId, panel, socket);
}

/**
 * Keterangan: Menampilkan kondisi analysis belum tersedia setelah polling
 * terukur berhenti, tanpa menampilkan kesimpulan yang tidak punya bukti.
 */
function renderAnalysisUnavailable(runId, panel, socket, message) {
  const analysisPanel = panel.querySelector('.analysis-panel');
  analysisPanel.hidden = false;
  analysisPanel.className = 'analysis-panel analysis-unavailable';
  analysisPanel.textContent = message;
  finishRunWatch(runId, panel, socket);
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
 * Keterangan: Mengambil detail run beserta artifact, lalu mengganti live frame
 * dengan video player dan tautan unduhan trace/console/network ketika status
 * terminal sudah diketahui dari WS atau resync REST.
 */
async function renderFinalArtifacts(runId, panel, button, socket) {
  if (
    panel.dataset.activeRunId !== runId ||
    panel.dataset.finished === 'true'
  ) {
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

  const content = panel.querySelector('.run-content');
  content.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'panel-loading';
  loading.innerHTML =
    '<span class="spinner" aria-hidden="true"></span><span>Memuat artifact…</span>';
  content.append(loading);

  try {
    const response = await fetch(`/test-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? 'Gagal mengambil artifact');
    }

    updateStatus(panel, data.status);
    content.replaceChildren();
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
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.src = videoAsset.objectUrl;
      content.append(video);
      links.append(videoAsset.link);
    } else {
      const message = document.createElement('p');
      message.className = 'muted';
      message.textContent = 'Video tidak tersedia untuk run ini.';
      content.append(message);
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
      content.append(links);
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
    }
  } catch (error) {
    content.textContent =
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
  if (panel.dataset.activeRunId !== runId || panel.dataset.finished === 'true') {
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
  if (event.runId !== runId || panel.dataset.activeRunId !== runId) {
    return;
  }

  if (event.type === 'run:frame') {
    const image = panel.querySelector('.live-frame');
    image.src = `data:image/jpeg;base64,${event.frame}`;
    image.hidden = false;
    panel.querySelector('.live-placeholder').hidden = true;
  } else if (event.type === 'run:step') {
    appendStepEvent(panel, event);
  } else if (event.type === 'run:status') {
    updateStatus(panel, event.status);
    if (TERMINAL_STATUSES.includes(event.status)) {
      void renderFinalArtifacts(runId, panel, button, socket);
    }
  } else if (event.type === 'run:analysis') {
    renderAnalysisResult(runId, panel, event.analysisResult, socket);
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
    void syncRunStatus(runId, panel, button, socket).catch(() => undefined);
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
    const placeholder = panel.querySelector('.live-placeholder');
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
  const timer = setInterval(() => {
    void syncRunStatus(runId, panel, button, activeSockets.get(runId) ?? null).catch(
      () => undefined,
    );
  }, 2000);
  pollTimers.set(runId, timer);
}

/**
 * Keterangan: Mengembalikan area bukti dan analysis ke state awal agar tombol
 * Run dapat dipakai berulang pada test case yang sama tanpa elemen stale.
 */
function resetRunEvidencePanel(panel) {
  const content = panel.querySelector('.run-content');
  content.replaceChildren();
  const placeholder = document.createElement('div');
  placeholder.className = 'live-placeholder';
  placeholder.textContent = 'Menunggu frame browser…';
  const image = document.createElement('img');
  image.className = 'live-frame';
  image.alt = 'Live browser view';
  image.hidden = true;
  content.append(placeholder, image);

  const analysisPanel = panel.querySelector('.analysis-panel');
  analysisPanel.replaceChildren();
  analysisPanel.className = 'analysis-panel';
  analysisPanel.hidden = true;
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
  const testCase = button.closest('.test-case');
  const panel = testCase.querySelector('.run-panel');
  let runStarted = false;

  if (panel.dataset.activeRunId) {
    closeSocketForRun(panel.dataset.activeRunId);
  }

  setRunButtonLoading(button, true);
  panel.hidden = false;
  panel.dataset.finished = 'false';
  panel.dataset.artifactsRendered = 'false';
  panel.dataset.artifactsLoading = 'false';
  panel.dataset.evidenceReady = 'false';
  panel.dataset.analysisPollAttempts = '0';
  pendingAnalysisByRun.delete(panel.dataset.activeRunId);
  updateStatus(panel, 'queued');
  panel.querySelector('.step-events').replaceChildren();
  resetRunEvidencePanel(panel);

  try {
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
    panel.querySelector('.live-placeholder').textContent =
      error instanceof Error ? error.message : 'Gagal menjalankan test case';
  } finally {
    if (!runStarted) {
      setRunButtonLoading(button, false);
    }
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
  updateStatus(panel, 'queued');
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
  watchGenerate(generateId, panel);
}

/**
 * Keterangan: Membuka halaman generate full-width bila instruction sudah
 * tersimpan; jika belum, minta user menyimpan Instruction dulu.
 */
function startGenerateFromProject(event) {
  const button = event.currentTarget;
  const projectId = button.dataset.projectId;
  const card = button.closest('.project-card');
  let project = {};
  try {
    project = JSON.parse(card?.dataset.project || '{}');
  } catch {
    project = {};
  }
  if (!project.instruction?.trim()) {
    event.preventDefault();
    window.alert('Simpan Instruction dulu lewat tombol Instruction.');
  }
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
  fields.append(
    createStepField(
      'selector',
      'Selector',
      step.selector,
      '[data-testid="submit"]',
    ),
  );
  if (action === 'fill' || action === 'select') {
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
 * Keterangan: Membuka form test case untuk mode create atau edit dan mengisi
 * builder dari data test case yang sudah ada.
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
  const testCaseForm = document.querySelector('#test-case-form');
  if (!projectForm || !testCaseForm) {
    return;
  }
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
    .addEventListener('click', () => addStep({ action: 'goto' }));
  document
    .querySelector('#add-provider-key-button')
    ?.addEventListener('click', () => {
      const list = document.querySelector('#provider-key-list');
      list?.append(createProviderKeyRow({ provider: 'openai' }));
    });
  projectForm.addEventListener('submit', (event) => void submitProjectForm(event));
  testCaseForm.addEventListener('submit', (event) =>
    void submitTestCaseForm(event),
  );
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
  document.querySelectorAll('.generate-script-button').forEach((button) => {
    button.addEventListener('click', (event) => startGenerateFromProject(event));
  });
  document
    .querySelector('#manual-test-case-button')
    ?.addEventListener('click', () => {
      const instructionForm = document.querySelector('#instruction-form');
      const projectId = instructionForm?.elements.projectId.value;
      document.querySelector('#instruction-dialog')?.close();
      if (projectId) {
        openTestCaseDialog(projectId);
      }
    });
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
          'Data test case gagal dibaca. Muat ulang dashboard.',
        );
      }
    });
  });
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
    let anyTestCaseVisible = false;

    card.querySelectorAll('.test-case').forEach((testCase) => {
      const title = testCase.querySelector('h3')?.textContent.toLowerCase() ?? '';
      const testCaseMatches = projectMatches || title.includes(query);
      testCase.hidden = !testCaseMatches;
      if (testCaseMatches) {
        anyTestCaseVisible = true;
      }
    });

    const cardVisible = projectMatches || anyTestCaseVisible;
    card.hidden = !cardVisible;
    if (cardVisible) {
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
    const data = await requestJson(
      `/projects/${projectId}/generate/prompt`,
      'POST',
      {},
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
  initializeManagementUi();
  renderUserIdentity();
  wireUserMenu();
  wireSearchFilter();
  document.querySelector('#logout-button')?.addEventListener('click', () => {
    void handleLogout();
  });
  document.querySelectorAll('.run-button').forEach((button) => {
    button.addEventListener('click', () => void startRun(button));
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
