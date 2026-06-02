'use strict';

const state = {
  configs: [], selectedConfigId: '', mode: 'proxy',
  proxyHost: '127.0.0.1', proxyPort: 10805,
  runInBackground: true, autoConnect: false,
  isConnected: false, connectionStatus: 'disconnected',
  pingResults: {}, currentPanel: 'home', editingConfigId: null,
};

let logAutoscroll = true;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const s = await window.npvt.getState();
  Object.assign(state, s);
  state.connectionStatus = s.isConnected ? 'connected' : 'disconnected';

  window.npvt.on('connection-status', (status) => {
    state.connectionStatus = status;
    state.isConnected = status === 'connected';
    renderStatus();
    renderPowerBtn();
  });

  window.npvt.on('connection-error', (msg) => {
    showError(msg);
    state.connectionStatus = 'disconnected';
    state.isConnected = false;
    renderStatus();
    renderPowerBtn();
  });

  window.npvt.on('tunnel-log', ({ msg, level, time }) => {
    appendLog(msg, level, time);
  });

  render();
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  renderStatus();
  renderPowerBtn();
  renderHomeConfig();
  renderModeButtons();
  renderProxyInfo();
  renderConfigsList();
  renderSettings();
}

function renderStatus() {
  const el = document.getElementById('status-text');
  const sub = document.getElementById('status-sub');
  el.className = 'connect-status ' + state.connectionStatus;
  if (state.connectionStatus === 'connected') {
    el.textContent = 'Connected';
    const cfg = activeConfig();
    sub.textContent = cfg ? `${cfg.sshHost}:${cfg.sshPort}` : '';
  } else if (state.connectionStatus === 'connecting') {
    el.textContent = 'Connecting…';
    sub.textContent = 'Establishing tunnel';
  } else {
    el.textContent = 'Disconnected';
    sub.textContent = '—';
  }
}

function renderPowerBtn() {
  const btn = document.getElementById('power-btn');
  if (!btn) return;
  btn.className = 'power-btn';
  btn.disabled = false;
  if (state.connectionStatus === 'connected') btn.classList.add('on');
  else if (state.connectionStatus === 'connecting') { btn.classList.add('connecting'); btn.disabled = true; }
}

function renderHomeConfig() {
  const nameEl = document.getElementById('home-config-name');
  const hostEl = document.getElementById('home-config-host');
  const cfg = activeConfig();
  if (cfg) {
    nameEl.textContent = cfg.remarks || cfg.sshHost;
    nameEl.className = 'config-card-name';
    hostEl.textContent = `${cfg.sshUsername}@${cfg.sshHost}:${cfg.sshPort}`;
    hostEl.style.display = 'block';
  } else {
    nameEl.textContent = 'No config selected — go to Configs';
    nameEl.className = 'config-card-empty';
    hostEl.style.display = 'none';
  }
}

function renderModeButtons() {
  document.getElementById('btn-proxy-mode').classList.toggle('active', state.mode === 'proxy');
  document.getElementById('btn-vpn-mode').classList.toggle('active', state.mode === 'vpn');
  document.getElementById('btn-tun-mode').classList.toggle('active', state.mode === 'vpn-tun');
}

function renderProxyInfo() {
  const info = document.getElementById('proxy-info');
  const addr = document.getElementById('proxy-addr-text');
  if (state.mode === 'proxy') {
    info.style.display = 'block';
    addr.innerHTML = `<span>SOCKS5 · </span>${state.proxyHost}:${state.proxyPort}`;
  } else if (state.mode === 'vpn') {
    info.style.display = 'block';
    addr.innerHTML = `<span>System Proxy · </span>Registry + WinHTTP`;
  } else if (state.mode === 'vpn-tun') {
    info.style.display = 'block';
    addr.innerHTML = `<span>TUN · </span>All system traffic routed`;
  } else {
    info.style.display = 'none';
  }
}

function renderConfigsList() {
  const list = document.getElementById('configs-list');
  if (!list) return;
  if (!state.configs.length) {
    list.innerHTML = `<div class="configs-empty">No configurations yet.<br>Add one via the + Add button.</div>`;
    return;
  }
  list.innerHTML = state.configs.map((cfg) => {
    const ping = state.pingResults[cfg.id];
    const isSelected = cfg.id === state.selectedConfigId;
    return `
      <div class="config-item ${isSelected ? 'selected' : ''}" onclick="selectConfig('${cfg.id}')">
        <div class="config-item-sel"></div>
        <div class="config-item-info">
          <div class="config-item-name">${escHtml(cfg.remarks || cfg.sshHost)}</div>
          <div class="config-item-addr">${escHtml(cfg.sshUsername)}@${escHtml(cfg.sshHost)}:${cfg.sshPort}</div>
        </div>
        <div class="config-item-ping ${pingClass(ping)}" id="ping-${cfg.id}">${renderPingBadge(ping)}</div>
        <div class="config-item-actions" onclick="event.stopPropagation()">
          <button class="ci-btn" onclick="openEdit('${cfg.id}')" title="Edit">✎</button>
          <button class="ci-btn del" onclick="removeConfig('${cfg.id}')" title="Delete">✕</button>
        </div>
      </div>`;
  }).join('');
}

function renderPingBadge(ping) {
  if (!ping) return '—';
  if (ping.error) return ping.error;
  return `${ping.latency}ms`;
}

function pingClass(ping) {
  if (!ping || ping.error) return '';
  if (ping.latency < 100) return 'good';
  if (ping.latency < 300) return 'ok';
  return 'bad';
}

function renderSettings() {
  const portEl = document.getElementById('s-port');
  const bgEl = document.getElementById('s-background');
  const acEl = document.getElementById('s-autoconnect');
  if (portEl) portEl.value = state.proxyPort;
  if (bgEl) bgEl.checked = state.runInBackground;
  if (acEl) acEl.checked = state.autoConnect;
}

// ─── Log ─────────────────────────────────────────────────────────────────────

function appendLog(msg, level, timeIso) {
  const out = document.getElementById('log-output');
  if (!out) return;
  const time = timeIso ? new Date(timeIso).toLocaleTimeString() : new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${escHtml(time)}</span><span class="log-msg ${escHtml(level || 'info')}">${escHtml(msg)}</span>`;
  out.appendChild(line);
  if (logAutoscroll) out.scrollTop = out.scrollHeight;
  // Keep max 500 lines
  while (out.children.length > 500) out.removeChild(out.firstChild);
}

function clearLog() {
  const out = document.getElementById('log-output');
  if (out) out.innerHTML = '';
}

function toggleAutoscroll() {
  logAutoscroll = !logAutoscroll;
  const btn = document.getElementById('log-autoscroll-btn');
  if (btn) btn.textContent = `Autoscroll: ${logAutoscroll ? 'ON' : 'OFF'}`;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function goPanel(name) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.add('active');
  const navBtn = document.getElementById(`nav-${name}`);
  if (navBtn) navBtn.classList.add('active');
  state.currentPanel = name;
  if (name === 'configs') renderConfigsList();
}

// ─── Power button ─────────────────────────────────────────────────────────────

async function onPowerClick() {
  if (state.connectionStatus === 'connecting') return;
  if (state.connectionStatus === 'connected') {
    await window.npvt.disconnect();
  } else {
    if (!state.selectedConfigId) { showError('Select a configuration first'); return; }
    state.connectionStatus = 'connecting';
    renderStatus();
    renderPowerBtn();
    await window.npvt.connect();
  }
}

// ─── Mode ─────────────────────────────────────────────────────────────────────

async function setMode(mode) {
  state.mode = mode;
  renderModeButtons();
  renderProxyInfo();
  await window.npvt.setMode(mode);
}

// ─── Config management ────────────────────────────────────────────────────────

async function selectConfig(id) {
  if (id === state.selectedConfigId) return;
  const res = await window.npvt.selectConfig(id);
  if (res.success) {
    state.selectedConfigId = id;
    state.isConnected = false;
    state.connectionStatus = 'disconnected';
    renderConfigsList();
    renderHomeConfig();
    renderStatus();
    renderPowerBtn();
  }
}

async function removeConfig(id) {
  const cfg = state.configs.find((c) => c.id === id);
  if (!cfg) return;
  if (!confirm(`Remove "${cfg.remarks || cfg.sshHost}"?`)) return;
  const res = await window.npvt.removeConfig(id);
  if (res.success) {
    state.configs = state.configs.filter((c) => c.id !== id);
    if (state.selectedConfigId === id) {
      state.selectedConfigId = state.configs.length ? state.configs[0].id : '';
      state.isConnected = false;
      state.connectionStatus = 'disconnected';
    }
    renderConfigsList();
    renderHomeConfig();
    renderStatus();
    renderPowerBtn();
  }
}

// ─── Add config ───────────────────────────────────────────────────────────────

function switchAddTab(tab) {
  document.querySelectorAll('.add-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'uri') || (i === 1 && tab === 'manual'));
  });
  document.getElementById('add-tab-uri').classList.toggle('hidden', tab !== 'uri');
  document.getElementById('add-tab-manual').classList.toggle('hidden', tab !== 'manual');
}

async function pasteFromClipboard() {
  const text = await window.npvt.pasteClipboard();
  if (text) document.getElementById('uri-input').value = text;
}

async function addConfigFromUri() {
  const raw = document.getElementById('uri-input').value.trim();
  const errEl = document.getElementById('uri-error');
  errEl.textContent = '';
  if (!raw) { errEl.textContent = 'Please paste a npvt-ssh:// URI or JSON config'; return; }
  const res = await window.npvt.addConfig(raw);
  if (res.success) {
    state.configs.push(res.config);
    if (!state.selectedConfigId) state.selectedConfigId = res.config.id;
    document.getElementById('uri-input').value = '';
    renderConfigsList();
    renderHomeConfig();
    goPanel('configs');
  } else {
    errEl.textContent = res.error || 'Failed to add configuration';
  }
}

async function addConfigManual() {
  const errEl = document.getElementById('manual-error');
  errEl.textContent = '';
  const raw = JSON.stringify({
    sshConfigType: 'SSH-Direct',
    remarks: document.getElementById('m-name').value.trim() || '',
    sshHost: document.getElementById('m-host').value.trim(),
    sshPort: parseInt(document.getElementById('m-port').value, 10) || 22,
    sshUsername: document.getElementById('m-user').value.trim(),
    sshPassword: document.getElementById('m-pass').value,
    dnsTTMode: document.getElementById('m-dns').value,
    udpgwTransparentDNS: true,
  });
  const res = await window.npvt.addConfig(raw);
  if (res.success) {
    state.configs.push(res.config);
    if (!state.selectedConfigId) state.selectedConfigId = res.config.id;
    ['m-name','m-host','m-user','m-pass'].forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('m-port').value = '22';
    renderConfigsList();
    renderHomeConfig();
    goPanel('configs');
  } else {
    errEl.textContent = res.error || 'Failed to add configuration';
  }
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function openEdit(id) {
  const cfg = state.configs.find((c) => c.id === id);
  if (!cfg) return;
  state.editingConfigId = id;
  document.getElementById('e-name').value = cfg.remarks || '';
  document.getElementById('e-host').value = cfg.sshHost || '';
  document.getElementById('e-port').value = cfg.sshPort || 22;
  document.getElementById('e-user').value = cfg.sshUsername || '';
  document.getElementById('e-pass').value = '';
  document.getElementById('edit-error').textContent = '';
  document.getElementById('modal-overlay').classList.add('show');
}

async function saveEdit() {
  const id = state.editingConfigId;
  const cfg = state.configs.find((c) => c.id === id);
  if (!cfg) return;
  const errEl = document.getElementById('edit-error');
  errEl.textContent = '';
  const updated = { ...cfg,
    remarks: document.getElementById('e-name').value.trim() || cfg.remarks,
    sshHost: document.getElementById('e-host').value.trim(),
    sshPort: parseInt(document.getElementById('e-port').value, 10) || 22,
    sshUsername: document.getElementById('e-user').value.trim(),
  };
  const newPass = document.getElementById('e-pass').value;
  if (newPass) updated.sshPassword = newPass;
  const res = await window.npvt.updateConfig(updated);
  if (res.success) {
    const idx = state.configs.findIndex((c) => c.id === id);
    if (idx !== -1) state.configs[idx] = res.config;
    closeModal();
    renderConfigsList();
    renderHomeConfig();
  } else {
    errEl.textContent = res.error || 'Failed to save';
  }
}

function closeModal(event) {
  if (event && event.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.remove('show');
  state.editingConfigId = null;
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

// Home panel ping — pings only the selected config
async function runHomePing() {
  const cfg = activeConfig();
  if (!cfg) { showError('No config selected'); return; }

  const labelEl = document.getElementById('home-ping-label');
  const resultEl = document.getElementById('home-ping-result');
  const valueEl = document.getElementById('home-ping-value');

  labelEl.textContent = 'Pinging…';
  resultEl.style.display = 'block';
  valueEl.textContent = '…';

  const res = await window.npvt.pingSelected();
  labelEl.textContent = 'Ping';

  if (res.error) {
    valueEl.textContent = res.error;
    valueEl.style.color = 'var(--red)';
  } else {
    valueEl.textContent = `${res.latency}ms — ${cfg.sshHost}:${cfg.sshPort}`;
    valueEl.style.color = res.latency < 100 ? 'var(--green)' : res.latency < 300 ? 'var(--yellow)' : 'var(--red)';
  }
}

// Configs panel ping all
async function runPingAll() {
  const btn = document.getElementById('ping-all-btn');
  if (btn) { btn.textContent = 'Pinging…'; btn.disabled = true; }

  state.configs.forEach((cfg) => {
    const el = document.getElementById(`ping-${cfg.id}`);
    if (el) { el.textContent = '…'; el.className = 'config-item-ping pinging'; }
  });

  const results = await window.npvt.pingAllConfigs();
  results.forEach((r) => {
    state.pingResults[r.id] = r;
    const el = document.getElementById(`ping-${r.id}`);
    if (el) { el.textContent = renderPingBadge(r); el.className = `config-item-ping ${pingClass(r)}`; }
  });

  if (btn) { btn.textContent = 'Ping All'; btn.disabled = false; }
}

// ─── Speed test ───────────────────────────────────────────────────────────────

async function runSpeedTest() {
  if (!state.isConnected) { showError('Connect first to run a speed test'); return; }
  const result = document.getElementById('speed-result');
  const num = document.getElementById('speed-number');
  result.style.display = 'block';
  num.innerHTML = '<div class="speed-running"><div class="spinner"></div> Testing…</div>';
  const res = await window.npvt.speedTest();
  if (res.success) { num.textContent = res.downloadMbps.toFixed(2); }
  else { num.textContent = '—'; showError(res.error || 'Speed test failed'); }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function saveSetting(key, value) {
  await window.npvt.setSetting(key, value);
  state[key] = value;
  renderProxyInfo();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function activeConfig() {
  return state.configs.find((c) => c.id === state.selectedConfigId) || null;
}

function showError(msg) {
  const toast = document.getElementById('error-toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 4000);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init().catch((err) => console.error('Init error:', err));
