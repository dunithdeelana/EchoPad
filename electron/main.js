'use strict';

const {
  app,
  clipboard,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  dialog,
  shell,
  Tray,
  Menu,
  nativeImage,
  session,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { SystemController } = require('./system');

const APP_NAME = 'Echopad';
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm'];

app.setName(APP_NAME);
if (process.env.ECHOPAD_USER_DATA) app.setPath('userData', process.env.ECHOPAD_USER_DATA);
if (process.platform === 'win32') app.setAppUserModelId('com.echopad.app');

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------
const RESTORE_FLAG = '--restore-audio';
if (!app.requestSingleInstanceLock()) {
  // A running instance receives our argv (incl. --restore-audio from the uninstaller) via 'second-instance'.
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Paths & persistence
// ---------------------------------------------------------------------------
const userDir = () => app.getPath('userData');
const soundsDir = () => path.join(userDir(), 'sounds');
const libraryFile = () => path.join(userDir(), 'library.json');
const windowStateFile = () => path.join(userDir(), 'window-state.json');

function ensureDirs() {
  fs.mkdirSync(soundsDir(), { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

// Serialise library writes so we never interleave two renames.
let writeChain = Promise.resolve();
function saveLibrary(data) {
  writeChain = writeChain
    .then(() => writeJsonAtomic(libraryFile(), data))
    .catch((err) => console.error('Failed to save library', err));
  return writeChain;
}

/** Resolve a stored sound filename to an absolute path, refusing anything outside the sounds dir. */
function resolveSoundFile(fileName) {
  if (typeof fileName !== 'string' || !fileName) throw new Error('Invalid file name');
  const base = path.basename(fileName);
  if (base !== fileName) throw new Error('Invalid file name');
  return path.join(soundsDir(), base);
}

function prettyName(filePath) {
  const stem = path.basename(filePath, path.extname(filePath));
  return stem.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled';
}

async function importFiles(paths) {
  const imported = [];
  const skipped = [];
  for (const src of paths) {
    try {
      const ext = path.extname(src).slice(1).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) {
        skipped.push(path.basename(src));
        continue;
      }
      const stat = await fsp.stat(src);
      if (!stat.isFile()) continue;
      if (stat.size > 50 * 1024 * 1024) {
        skipped.push(path.basename(src));
        continue;
      }
      const id = crypto.randomUUID();
      const fileName = `${id}.${ext}`;
      await fsp.copyFile(src, path.join(soundsDir(), fileName));
      imported.push({ id, name: prettyName(src), file: fileName });
    } catch (err) {
      console.error('Import failed', src, err);
      skipped.push(path.basename(src));
    }
  }
  return { imported, skipped };
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let mainWindow = null;
let tray = null;
let isQuitting = false;
let closeToTray = true;

function assetPath(...p) {
  return path.join(__dirname, '..', 'build', ...p);
}

function createWindow() {
  const state = readJson(windowStateFile(), { width: 1200, height: 780 });
  mainWindow = new BrowserWindow({
    width: state.width || 1200,
    height: state.height || 780,
    x: state.x,
    y: state.y,
    minWidth: 880,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#0d0f14',
    icon: assetPath('icon.png'),
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });

  if (state.maximized) mainWindow.maximize();

  const devUrl = process.env.ECHOPAD_DEV_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) mainWindow.show();
  });

  const sendMaxState = () =>
    mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized());
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);

  mainWindow.on('close', (e) => {
    persistWindowState();
    if (!isQuitting && closeToTray && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Never navigate away or open new windows inside the app.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow.webContents.getURL()) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function persistWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  try {
    fs.writeFileSync(windowStateFile(), JSON.stringify({ ...bounds, maximized }));
  } catch {
    /* ignore */
  }
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const img = nativeImage.createFromPath(assetPath('tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: showWindow },
      { label: 'Stop all sounds', click: () => mainWindow?.webContents.send('sounds:stop-all') },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

// ---------------------------------------------------------------------------
// Automatic system setup / self-healing
// ---------------------------------------------------------------------------
let system = null;
let healthTimer = null;
let restoredOnQuit = false;

function startSystem() {
  system = new SystemController((report) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('system:report', report);
  });
  const firstRun = !system.state.setupStarted;
  if (firstRun) {
    system.state.setupStarted = Date.now();
    // Be ready whenever the PC starts: launch minimised to the tray at login.
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
  }
  const autoInstall = !system.state.autoInstallDeclined;
  // Give the window a moment to appear so the user sees what's happening.
  setTimeout(() => system.check({ autoFix: true, firstRun: autoInstall }), 1200);
  healthTimer = setInterval(() => system.check({ autoFix: true }), 30_000);
}

async function restoreAudioAndQuit() {
  try {
    if (!system) system = new SystemController(() => {});
    await Promise.race([system.restore(), new Promise((r) => setTimeout(r, 6000))]);
  } finally {
    restoredOnQuit = true;
    isQuitting = true;
    app.quit();
  }
}

// ---------------------------------------------------------------------------
// Global hotkeys
// ---------------------------------------------------------------------------
let hotkeyMap = {}; // accelerator -> action string ("sound:<id>" | "stop-all")
let hotkeysSuspended = false;

function applyHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  if (hotkeysSuspended) return failed;
  for (const [accel, action] of Object.entries(hotkeyMap)) {
    try {
      const ok = globalShortcut.register(accel, () => {
        mainWindow?.webContents.send('hotkey', action);
      });
      if (!ok) failed.push(accel);
    } catch {
      failed.push(accel);
    }
  }
  return failed;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('library:load', async () => {
    ensureDirs();
    return readJson(libraryFile(), null);
  });

  ipcMain.handle('library:save', async (_e, data) => {
    if (data && typeof data === 'object') {
      if (data.settings) {
        closeToTray = data.settings.closeToTray !== false;
      }
      await saveLibrary(data);
    }
    return true;
  });

  ipcMain.handle('sounds:pick', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Add sounds',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio files', extensions: AUDIO_EXTENSIONS },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (res.canceled) return { imported: [], skipped: [] };
    return importFiles(res.filePaths);
  });

  ipcMain.handle('sounds:import-paths', async (_e, paths) => {
    if (!Array.isArray(paths)) return { imported: [], skipped: [] };
    return importFiles(paths.filter((p) => typeof p === 'string'));
  });

  ipcMain.handle('sounds:read', async (_e, fileName) => {
    const buf = await fsp.readFile(resolveSoundFile(fileName));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle('sounds:delete', async (_e, fileName) => {
    try {
      await fsp.unlink(resolveSoundFile(fileName));
    } catch {
      /* already gone */
    }
    return true;
  });

  ipcMain.handle('sounds:reveal', async (_e, fileName) => {
    shell.showItemInFolder(resolveSoundFile(fileName));
    return true;
  });

  ipcMain.handle('sounds:export', async (_e, fileName, suggestedName) => {
    const src = resolveSoundFile(fileName);
    const ext = path.extname(src);
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export sound',
      defaultPath: `${String(suggestedName || 'sound').replace(/[\\/:*?"<>|]/g, '_')}${ext}`,
    });
    if (res.canceled || !res.filePath) return false;
    await fsp.copyFile(src, res.filePath);
    return true;
  });

  ipcMain.handle('hotkeys:set', async (_e, map) => {
    hotkeyMap = map && typeof map === 'object' ? map : {};
    return applyHotkeys();
  });

  ipcMain.handle('hotkeys:suspend', async (_e, suspended) => {
    hotkeysSuspended = !!suspended;
    return applyHotkeys();
  });

  ipcMain.handle('app:open-external', async (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('app:get-login-item', async () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('app:set-login-item', async (_e, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--hidden'] });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: userDir(),
  }));
  ipcMain.handle('app:open-data-dir', async () => shell.openPath(userDir()));

  ipcMain.handle('system:check', async () => system?.check({ autoFix: true }));
  ipcMain.handle('system:copy-diagnostics', async () => {
    if (!system) return '';
    await system.check({ autoFix: false });
    const text = system.diagnostics();
    clipboard.writeText(text);
    return text;
  });
  ipcMain.handle('system:last', async () => system?.lastReport ?? null);
  ipcMain.handle('system:action', async (_e, action) => {
    if (!system) return null;
    switch (action) {
      case 'install-driver':
      case 'repair-driver':
        return system.installDriver();
      case 'enable-device':
        return system.enableDevice();
      case 'fix-privacy':
        return system.fixPrivacy();
      case 'open-privacy':
        return shell.openExternal('ms-settings:privacy-microphone');
      case 'open-sound-settings':
        return shell.openExternal('ms-settings:sound');
      case 'open-discord':
        return shell.openExternal('discord://-/settings/voice').catch(() => null);
      case 'restart':
        if (process.platform === 'win32') execFile('shutdown', ['/r', '/t', '5', '/c', 'Restarting to finish Echopad setup'], { windowsHide: true });
        return true;
      default:
        return system.check({ autoFix: true });
    }
  });

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => !!mainWindow?.isMaximized());
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.on('second-instance', (_e, argv) => {
  if (argv.includes(RESTORE_FLAG)) restoreAudioAndQuit();
  else showWindow();
});

app.whenReady().then(() => {
  if (process.argv.includes(RESTORE_FLAG)) {
    restoreAudioAndQuit();
    return;
  }
  ensureDirs();
  const lib = readJson(libraryFile(), null);
  closeToTray = lib?.settings?.closeToTray !== false;

  // Allow microphone access (for mic passthrough) and device enumeration.
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'speaker-selection', 'audioCapture'].includes(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'speaker-selection', 'audioCapture'].includes(permission),
  );

  // Strict CSP for packaged builds.
  if (!process.env.ECHOPAD_DEV_URL) {
    ses.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'",
          ],
        },
      });
    });
  }

  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  createTray();
  startSystem();
});

app.on('before-quit', (e) => {
  isQuitting = true;
  persistWindowState();
  // Give the user's real microphone back to Windows before exiting.
  if (!restoredOnQuit && system) {
    e.preventDefault();
    clearInterval(healthTimer);
    restoreAudioAndQuit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
