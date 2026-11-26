import type { EchopadApi, ImportResult, Library } from './types';

declare global {
  interface Window {
    echopad?: EchopadApi;
  }
}

/**
 * Browser fallback so the UI can be previewed with `npm run dev` outside Electron.
 * Sounds are synthesised tones; nothing is persisted.
 */
function createMockApi(): EchopadApi {
  const listeners = new Set<(a: string) => void>();
  let lib: Library | null = null;

  const tone = (seed: number): ArrayBuffer => {
    const rate = 44100;
    const len = Math.floor(rate * (0.6 + (seed % 5) * 0.35));
    const buf = new ArrayBuffer(44 + len * 2);
    const v = new DataView(buf);
    const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF');
    v.setUint32(4, 36 + len * 2, true);
    w(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, len * 2, true);
    const f = 220 + (seed % 7) * 70;
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / 400) * Math.max(0, 1 - i / len);
      v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * f * i) / rate) * 9000 * env, true);
    }
    return buf;
  };

  const demo = (name: string): ImportResult['imported'][number] => ({
    id: crypto.randomUUID(),
    name,
    file: `${Math.floor(Math.random() * 1000)}.wav`,
  });

  return {
    loadLibrary: async () => lib,
    saveLibrary: async (d) => {
      lib = d;
      return true;
    },
    pickSounds: async () => ({ imported: [demo('New sound')], skipped: [] }),
    importFiles: async (files) => ({
      imported: Array.from(files).map((f) => demo(f.name.replace(/\.[^.]+$/, ''))),
      skipped: [],
    }),
    readSound: async (file) => tone(parseInt(file, 10) || 1),
    deleteSound: async () => true,
    revealSound: async () => true,
    exportSound: async () => true,
    setHotkeys: async () => [],
    suspendHotkeys: async () => [],
    onHotkey: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onStopAll: () => () => {},
    openExternal: async (url) => {
      window.open(url, '_blank');
      return true;
    },
    getLoginItem: async () => false,
    setLoginItem: async (e) => e,
    appInfo: async () => ({ version: '1.0.0', platform: 'browser', dataDir: '(browser preview)' }),
    openDataDir: async () => undefined,
    systemCheck: async () => ({ supported: false, phase: 'ready', checks: [], log: [] }),
    systemLast: async () => ({ supported: false, phase: 'ready', checks: [], log: [] }),
    systemAction: async () => null,
    onSystemReport: () => () => {},
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: async () => false,
    onMaximized: () => () => {},
  };
}

export const api: EchopadApi = window.echopad ?? createMockApi();
export const isElectron = !!window.echopad;
