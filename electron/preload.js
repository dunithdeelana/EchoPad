'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel, cb) {
  const listener = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('echopad', {
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  saveLibrary: (data) => ipcRenderer.invoke('library:save', data),

  pickSounds: () => ipcRenderer.invoke('sounds:pick'),
  importFiles: (files) => {
    const paths = Array.from(files)
      .map((f) => {
        try {
          return webUtils.getPathForFile(f);
        } catch {
          return '';
        }
      })
      .filter(Boolean);
    return ipcRenderer.invoke('sounds:import-paths', paths);
  },
  readSound: (file) => ipcRenderer.invoke('sounds:read', file),
  deleteSound: (file) => ipcRenderer.invoke('sounds:delete', file),
  revealSound: (file) => ipcRenderer.invoke('sounds:reveal', file),
  exportSound: (file, name) => ipcRenderer.invoke('sounds:export', file, name),

  setHotkeys: (map) => ipcRenderer.invoke('hotkeys:set', map),
  suspendHotkeys: (suspended) => ipcRenderer.invoke('hotkeys:suspend', suspended),
  onHotkey: (cb) => on('hotkey', cb),
  onStopAll: (cb) => on('sounds:stop-all', cb),

  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  getLoginItem: () => ipcRenderer.invoke('app:get-login-item'),
  setLoginItem: (enabled) => ipcRenderer.invoke('app:set-login-item', enabled),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),

  systemCheck: () => ipcRenderer.invoke('system:check'),
  systemLast: () => ipcRenderer.invoke('system:last'),
  systemAction: (action) => ipcRenderer.invoke('system:action', action),
  onSystemReport: (cb) => on('system:report', cb),
  copyDiagnostics: () => ipcRenderer.invoke('system:copy-diagnostics'),
  reportProblem: () => ipcRenderer.invoke('system:report-problem'),
  openLogs: () => ipcRenderer.invoke('system:open-logs'),
  log: (level, msg) => ipcRenderer.send('app:log', level, msg),

  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximized: (cb) => on('window:maximized', cb),
});
