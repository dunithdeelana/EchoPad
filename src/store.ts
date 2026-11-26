import { create } from 'zustand';
import { api } from './api';
import { engine } from './audio';
import type { Library, Settings, Sound } from './types';

export const PALETTE = [
  '#7c5cff',
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#84cc16',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
];

export const DEFAULT_SETTINGS: Settings = {
  outputDeviceId: '',
  outputDeviceLabel: '',
  outputVolume: 1,
  monitorEnabled: true,
  monitorDeviceId: 'default',
  monitorDeviceLabel: '',
  monitorVolume: 0.7,
  micPassthrough: true,
  micDeviceId: 'default',
  micDeviceLabel: '',
  micVolume: 1,
  retrigger: 'restart',
  allowSimultaneous: true,
  stopAllHotkey: 'Ctrl+Shift+Backspace',
  closeToTray: true,
  onboarded: false,
};

export type View = 'all' | 'favorites' | 'settings' | 'guide';
export type SortMode = 'manual' | 'name' | 'recent' | 'plays';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

interface State {
  ready: boolean;
  sounds: Sound[];
  settings: Settings;
  view: View;
  query: string;
  sort: SortMode;
  failedHotkeys: string[];
  recordingHotkey: boolean;
  toasts: Toast[];
  editingId: string | null;

  init(): Promise<void>;
  setView(v: View): void;
  setQuery(q: string): void;
  setSort(s: SortMode): void;
  updateSettings(patch: Partial<Settings>): void;
  addImported(items: { id: string; name: string; file: string }[]): void;
  updateSound(id: string, patch: Partial<Sound>): void;
  removeSound(id: string): Promise<void>;
  moveSound(fromId: string, toId: string): void;
  playSound(id: string): void;
  setFailedHotkeys(list: string[]): void;
  setRecordingHotkey(on: boolean): void;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
  setEditing(id: string | null): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastId = 0;

export const useStore = create<State>((set, get) => {
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { sounds, settings } = get();
      const data: Library = { version: 1, sounds, settings };
      api.saveLibrary(data);
    }, 250);
  };

  return {
    ready: false,
    sounds: [],
    settings: DEFAULT_SETTINGS,
    view: 'all',
    query: '',
    sort: 'manual',
    failedHotkeys: [],
    recordingHotkey: false,
    toasts: [],
    editingId: null,

    async init() {
      const lib = await api.loadLibrary();
      const sounds: Sound[] = (lib?.sounds ?? []).map((s: Partial<Sound>, i) => ({
        ...(s as Sound),
        volume: s.volume ?? 1,
        favorite: s.favorite ?? false,
        hotkey: s.hotkey ?? null,
        color: s.color ?? PALETTE[i % PALETTE.length],
        addedAt: s.addedAt ?? Date.now(),
        plays: s.plays ?? 0,
      }));
      set({ sounds, settings: { ...DEFAULT_SETTINGS, ...(lib?.settings ?? {}) }, ready: true });
      if (!lib) persist();
    },

    setView: (view) => set({ view }),
    setQuery: (query) => set({ query }),
    setSort: (sort) => set({ sort }),

    updateSettings(patch) {
      set({ settings: { ...get().settings, ...patch } });
      persist();
    },

    addImported(items) {
      const existing = get().sounds;
      const now = Date.now();
      const added: Sound[] = items.map((it, i) => ({
        id: it.id,
        name: it.name,
        file: it.file,
        hotkey: null,
        volume: 1,
        color: PALETTE[(existing.length + i) % PALETTE.length],
        favorite: get().view === 'favorites',
        addedAt: now + i,
        plays: 0,
      }));
      set({ sounds: [...existing, ...added] });
      persist();
      // Decode in the background to learn durations.
      added.forEach((s) =>
        engine
          .load(s)
          .then((buf) => get().updateSound(s.id, { duration: buf.duration }))
          .catch(() => get().toast('error', `Couldn't decode “${s.name}”. The file may be corrupt.`)),
      );
    },

    updateSound(id, patch) {
      set({ sounds: get().sounds.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
      if (patch.volume !== undefined) engine.setSoundVolume(id, patch.volume);
      persist();
    },

    async removeSound(id) {
      const s = get().sounds.find((x) => x.id === id);
      if (!s) return;
      engine.forget(id);
      set({ sounds: get().sounds.filter((x) => x.id !== id) });
      persist();
      await api.deleteSound(s.file);
    },

    moveSound(fromId, toId) {
      const list = [...get().sounds];
      const from = list.findIndex((s) => s.id === fromId);
      const to = list.findIndex((s) => s.id === toId);
      if (from < 0 || to < 0 || from === to) return;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      set({ sounds: list });
      persist();
    },

    playSound(id) {
      const { sounds, settings } = get();
      const s = sounds.find((x) => x.id === id);
      if (!s) return;
      const wasPlaying = engine.isPlaying(id);
      engine
        .play(s, { retrigger: settings.retrigger, allowSimultaneous: settings.allowSimultaneous })
        .then(() => {
          if (!(wasPlaying && settings.retrigger === 'stop')) {
            set({
              sounds: get().sounds.map((x) => (x.id === id ? { ...x, plays: (x.plays ?? 0) + 1 } : x)),
            });
            persist();
          }
        })
        .catch(() => get().toast('error', `Couldn't play “${s.name}”.`));
    },

    setFailedHotkeys: (failedHotkeys) => set({ failedHotkeys }),
    setRecordingHotkey: (recordingHotkey) => set({ recordingHotkey }),

    toast(kind, text) {
      const id = ++toastId;
      set({ toasts: [...get().toasts, { id, kind, text }] });
      setTimeout(() => get().dismissToast(id), 4500);
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    setEditing: (editingId) => set({ editingId }),
  };
});
