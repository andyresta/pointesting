const token = sessionStorage.getItem('pointestingToken');
const activeSockets = new Map();
const pollTimers = new Map();
const pendingAnalysisByRun = new Map();
const TERMINAL_STATUSES = ['passed', 'failed', 'error'];
const MAX_ANALYSIS_POLL_ATTEMPTS = 30;

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

if (!token) {
  window.location.replace('/dashboard/login');
} else {
  document.querySelectorAll('.run-button').forEach((button) => {
    button.addEventListener('click', () => void startRun(button));
  });
  document.querySelector('#page-loading').hidden = true;
  document.querySelector('#dashboard-content').hidden = false;
}

window.addEventListener('beforeunload', closeActiveSockets);
