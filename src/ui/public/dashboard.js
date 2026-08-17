const token = sessionStorage.getItem('pointestingToken');
const activeSockets = new Map();
const pollTimers = new Map();
const pendingAnalysisByRun = new Map();
const TERMINAL_STATUSES = ['passed', 'failed', 'error'];
const MAX_ANALYSIS_POLL_ATTEMPTS = 30;
const providerCatalogs = new Map();
const STEP_ACTIONS = ['goto', 'fill', 'click', 'check', 'select', 'waitFor'];

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
 * Keterangan: Memperbarui informasi model runtime dan kesiapan kredensial
 * untuk provider yang dipilih pada form project.
 */
function updateProviderHint() {
  const providerSelect = document.querySelector('#project-provider');
  const hint = document.querySelector('#provider-model-hint');
  if (!providerSelect || !hint) {
    return;
  }
  const catalog = providerCatalogs.get(providerSelect.value);
  if (!catalog) {
    hint.textContent = 'Model runtime mengikuti konfigurasi environment provider.';
    hint.className = 'field-hint';
    return;
  }
  const readiness = catalog.configured
    ? 'Provider siap digunakan.'
    : 'API key provider belum dikonfigurasi.';
  hint.textContent = `Model aktif: ${catalog.defaultModel || 'belum diatur'}. ${readiness}`;
  hint.className = catalog.configured
    ? 'field-hint'
    : 'field-hint field-warning';
}

/**
 * Keterangan: Mengambil katalog provider/model melalui POST agar form project
 * menampilkan konfigurasi runtime tanpa mengekspos API key.
 */
async function loadProviderCatalogs() {
  const providerSelect = document.querySelector('#project-provider');
  if (!providerSelect) {
    return;
  }
  const data = await requestJson('/ai/models', 'POST', {});
  for (const catalog of data.providers ?? []) {
    providerCatalogs.set(catalog.provider, catalog);
    const option = providerSelect.querySelector(
      `option[value="${catalog.provider}"]`,
    );
    if (option) {
      option.textContent = `${option.textContent} · ${
        catalog.configured ? 'siap' : 'belum dikonfigurasi'
      }`;
    }
  }
  updateProviderHint();
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
 * Keterangan: Membuka form project dalam kondisi bersih untuk membuat data
 * baru dari dashboard.
 */
function openProjectDialog() {
  const dialog = document.querySelector('#project-dialog');
  const form = document.querySelector('#project-form');
  form.reset();
  clearFormError(form);
  updateProviderHint();
  dialog.showModal();
  form.elements.name.focus();
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
 * Keterangan: Menyimpan project baru melalui API lalu memuat ulang dashboard
 * agar struktur project hasil server langsung tampil konsisten.
 */
async function submitProjectForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) {
    return;
  }
  const submitButton = form.querySelector('.submit-button');
  clearFormError(form);
  setSubmitButtonLoading(submitButton, true);
  try {
    const baseUrl = form.elements.baseUrl.value.trim();
    await requestJson('/projects', 'POST', {
      name: form.elements.name.value.trim(),
      baseUrl: baseUrl || null,
      defaultProvider: form.elements.defaultProvider.value,
    });
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
    .addEventListener('click', openProjectDialog);
  document
    .querySelector('#project-provider')
    .addEventListener('change', updateProviderHint);
  document
    .querySelector('#add-step-button')
    .addEventListener('click', () => addStep({ action: 'goto' }));
  projectForm.addEventListener('submit', (event) => void submitProjectForm(event));
  testCaseForm.addEventListener('submit', (event) =>
    void submitTestCaseForm(event),
  );

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  document.querySelectorAll('.add-test-case-button').forEach((button) => {
    button.addEventListener('click', () =>
      openTestCaseDialog(button.dataset.projectId),
    );
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
 * Keterangan: Menginisialisasi dashboard, memuat katalog provider saat spinner
 * halaman aktif, lalu menampilkan seluruh fitur CRUD dan eksekusi.
 */
async function initializeDashboard() {
  if (!token) {
    window.location.replace('/dashboard/login');
    return;
  }
  initializeManagementUi();
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
