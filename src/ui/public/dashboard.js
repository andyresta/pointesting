const token = sessionStorage.getItem('pointestingToken');
const activeSockets = new Map();
const pollTimers = new Map();
const TERMINAL_STATUSES = ['passed', 'failed', 'error'];

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
  if (panel.dataset.activeRunId !== runId || panel.dataset.finished === 'true') {
    return;
  }
  panel.dataset.finished = 'true';
  stopPolling(runId);

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
  } catch (error) {
    content.textContent =
      error instanceof Error ? error.message : 'Gagal mengambil artifact';
  } finally {
    setRunButtonLoading(button, false);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'unsubscribe:run', runId }));
    }
    if (socket) {
      socket.close();
    }
    activeSockets.delete(runId);
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
  }
}

/**
 * Keterangan: Memproses satu event server; frame memperbarui img, status
 * memperbarui badge, dan status terminal memicu pengambilan artifact.
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
    panel.querySelector('.live-placeholder').textContent =
      'Koneksi live view terputus, menyinkronkan status…';
    void syncRunStatus(runId, panel, button, null)
      .catch(() => {
        if (panel.dataset.finished !== 'true') {
          updateStatus(panel, 'error');
          panel.querySelector('.live-placeholder').textContent =
            'Koneksi live view terputus.';
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
  updateStatus(panel, 'queued');
  panel.querySelector('.step-events').replaceChildren();
  panel.querySelector('.live-frame').hidden = true;
  panel.querySelector('.live-placeholder').hidden = false;
  panel.querySelector('.live-placeholder').textContent =
    'Menunggu frame browser…';

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
