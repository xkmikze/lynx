'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, clipboard } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const Store = require('electron-store');
const TunnelManager = require('./tunnel-manager');
const ProxyServer = require('./proxy-server');
const PingService = require('./ping-service');
const SpeedTestService = require('./speed-test');
const { validateConfig, parseNpvtUri } = require('../shared/config-utils');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let mainWindow = null;
let tray = null;
let isQuitting = false;

const store = new Store({
  name: 'lynx-config',
  encryptionKey: 'lynx-local-key-v1',
  schema: {
    configs: { type: 'array', default: [] },
    selectedConfigId: { type: 'string', default: '' },
    mode: { type: 'string', enum: ['vpn-tun', 'vpn', 'proxy'], default: 'proxy' },
    proxyHost: { type: 'string', default: '127.0.0.1' },
    proxyPort: { type: 'number', default: 10805 },
    runInBackground: { type: 'boolean', default: true },
    autoConnect: { type: 'boolean', default: false },
  },
});

const tunnelManager = new TunnelManager(store);
const proxyServer = new ProxyServer(store);
const pingService = new PingService();
const speedTestService = new SpeedTestService();

// Always clean proxy on startup in case previous run left it dirty
cleanupSystemProxy();

tunnelManager.onLog((msg, level) => {
  sendToRenderer('tunnel-log', { msg, level, time: new Date().toISOString() });
});
tunnelManager.onStatus((status) => {
  sendToRenderer('connection-status', status);
  updateTrayMenu();
  updateTrayIcon();
});

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460, height: 680,
    minWidth: 400, minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    resizable: true,
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: process.env.NODE_ENV === 'development',
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('close', (e) => {
    if (!isQuitting && store.get('runInBackground')) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray() {
  // Build tray icon from the icon.png (resize to 16x16 for tray)
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(
      path.join(__dirname, '../../assets/icons/tray.png')
    ).resize({ width: 16, height: 16 });
  } catch (_) {
    // Fallback: create a blank icon if file missing
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('LYNX — Click to open');

  // Double-click to show window
  tray.on('double-click', () => showWindow());
  // Single click also shows on Windows
  tray.on('click', () => showWindow());

  updateTrayMenu();
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const connected = tunnelManager.isConnected();
  const cfg = getActiveConfig();
  const cfgLabel = cfg ? `${cfg.remarks || cfg.sshHost}` : 'No config selected';

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: connected ? `● Connected — ${cfgLabel}` : `○ Disconnected`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: connected ? 'Disconnect' : 'Connect',
      click: () => { connected ? handleDisconnect() : handleConnect(); },
    },
    { type: 'separator' },
    { label: 'Open LYNX', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Exit',
      click: async () => {
        isQuitting = true;
        await handleDisconnect();
        cleanupSystemProxy();
        app.quit();
      },
    },
  ]));
}

function updateTrayIcon() {
  if (!tray) return;
  const connected = tunnelManager.isConnected();
  tray.setToolTip(connected ? 'LYNX — Connected' : 'LYNX — Disconnected');
}

// ─── Connection ───────────────────────────────────────────────────────────────

async function handleConnect() {
  const selectedId = store.get('selectedConfigId');
  if (!selectedId) { sendToRenderer('connection-error', 'No configuration selected'); return; }
  const configs = store.get('configs');
  const config = configs.find((c) => c.id === selectedId);
  if (!config) { sendToRenderer('connection-error', 'Config not found'); return; }

  try {
    sendToRenderer('connection-status', 'connecting');
    await tunnelManager.connect(config);
    sendToRenderer('connection-status', 'connected');
    updateTrayMenu();
    updateTrayIcon();
  } catch (err) {
    sendToRenderer('connection-status', 'disconnected');
    sendToRenderer('connection-error', err.message || 'Connection failed');
    updateTrayMenu();
  }
}

async function handleDisconnect() {
  try {
    await tunnelManager.disconnect();
  } catch (_) {}
  cleanupSystemProxy();
  sendToRenderer('connection-status', 'disconnected');
  updateTrayMenu();
  updateTrayIcon();
}

// Always clean up system proxy — called on disconnect, exit, and startup
function cleanupSystemProxy() {
  exec(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`, () => {});
  exec(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /f`, () => {});
  exec(`netsh winhttp reset proxy`, () => {});
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function getActiveConfig() {
  const id = store.get('selectedConfigId');
  return store.get('configs').find((c) => c.id === id) || null;
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

ipcMain.handle('get-state', () => ({
  configs: store.get('configs'),
  selectedConfigId: store.get('selectedConfigId'),
  mode: store.get('mode'),
  proxyHost: store.get('proxyHost'),
  proxyPort: store.get('proxyPort'),
  runInBackground: store.get('runInBackground'),
  autoConnect: store.get('autoConnect'),
  isConnected: tunnelManager.isConnected(),
  platform: process.platform,
}));

ipcMain.handle('connect', async () => handleConnect());
ipcMain.handle('disconnect', async () => handleDisconnect());

ipcMain.handle('add-config', async (_, rawInput) => {
  try {
    let cfg;
    if (typeof rawInput === 'string' && rawInput.startsWith('npvt-ssh://')) {
      cfg = parseNpvtUri(rawInput);
    } else {
      cfg = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    }
    const error = validateConfig(cfg);
    if (error) throw new Error(error);
    cfg.id = generateId();
    cfg.createdAt = Date.now();
    const configs = store.get('configs');
    configs.push(cfg);
    store.set('configs', configs);
    if (!store.get('selectedConfigId')) store.set('selectedConfigId', cfg.id);
    return { success: true, config: cfg };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('paste-clipboard', async () => clipboard.readText().trim());

ipcMain.handle('remove-config', async (_, id) => {
  let configs = store.get('configs');
  configs = configs.filter((c) => c.id !== id);
  store.set('configs', configs);
  if (store.get('selectedConfigId') === id) {
    store.set('selectedConfigId', configs.length ? configs[0].id : '');
    if (tunnelManager.isConnected()) await handleDisconnect();
  }
  return { success: true };
});

ipcMain.handle('update-config', async (_, updatedConfig) => {
  const error = validateConfig(updatedConfig);
  if (error) return { success: false, error };
  const configs = store.get('configs');
  const idx = configs.findIndex((c) => c.id === updatedConfig.id);
  if (idx === -1) return { success: false, error: 'Config not found' };
  configs[idx] = { ...configs[idx], ...updatedConfig, id: configs[idx].id };
  store.set('configs', configs);
  return { success: true, config: configs[idx] };
});

ipcMain.handle('select-config', async (_, id) => {
  const configs = store.get('configs');
  if (!configs.find((c) => c.id === id)) return { success: false, error: 'Not found' };
  if (tunnelManager.isConnected()) await handleDisconnect();
  store.set('selectedConfigId', id);
  return { success: true };
});

ipcMain.handle('ping-config', async (_, id) => {
  const configs = store.get('configs');
  const cfg = configs.find((c) => c.id === id);
  if (!cfg) return { id, latency: -1, error: 'Not found' };
  return { id, ...(await pingService.ping(cfg.sshHost, cfg.sshPort)) };
});

ipcMain.handle('ping-all-configs', async () => {
  const configs = store.get('configs');
  return Promise.all(configs.map((cfg) =>
    pingService.ping(cfg.sshHost, cfg.sshPort).then((r) => ({ id: cfg.id, ...r }))
  ));
});

ipcMain.handle('ping-selected', async () => {
  const cfg = getActiveConfig();
  if (!cfg) return { latency: -1, error: 'No config selected' };
  return pingService.ping(cfg.sshHost, cfg.sshPort);
});

ipcMain.handle('speed-test', async () => {
  if (!tunnelManager.isConnected()) return { success: false, error: 'Not connected' };
  try { return { success: true, ...(await speedTestService.run()) }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('set-mode', async (_, mode) => {
  store.set('mode', mode);
  if (tunnelManager.isConnected()) { await handleDisconnect(); await handleConnect(); }
  return { success: true };
});

ipcMain.handle('set-setting', async (_, { key, value }) => {
  const allowed = ['runInBackground', 'autoConnect', 'proxyPort', 'proxyHost'];
  if (!allowed.includes(key)) return { success: false, error: 'Unknown setting' };
  store.set(key, value);
  return { success: true };
});

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-close', () => {
  if (store.get('runInBackground')) { mainWindow?.hide(); }
  else { isQuitting = true; handleDisconnect().finally(() => { cleanupSystemProxy(); app.quit(); }); }
});
ipcMain.handle('open-external', (_, url) => {
  if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();
  if (store.get('autoConnect')) setTimeout(handleConnect, 1500);
});

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('window-all-closed', () => {
  if (!store.get('runInBackground')) app.quit();
});

// Critical: always clean up proxy on quit
app.on('before-quit', async () => {
  isQuitting = true;
  try { await tunnelManager.disconnect(); } catch (_) {}
  cleanupSystemProxy();
});

app.on('will-quit', () => {
  cleanupSystemProxy();
});

// Also handle process kill signals
process.on('SIGINT', () => { cleanupSystemProxy(); process.exit(0); });
process.on('SIGTERM', () => { cleanupSystemProxy(); process.exit(0); });
process.on('uncaughtException', (err) => { console.error('Uncaught:', err); });
process.on('unhandledRejection', (r) => { console.error('Unhandled:', r); });

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}