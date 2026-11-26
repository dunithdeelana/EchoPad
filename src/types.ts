export interface Sound {
  id: string;
  name: string;
  /** File name inside the app's sounds directory. */
  file: string;
  /** Electron accelerator string, e.g. "Ctrl+Shift+1". */
  hotkey: string | null;
  /** Per-sound volume, 0..1.5 */
  volume: number;
  color: string;
  favorite: boolean;
  /** Seconds; filled in after first decode. */
  duration?: number;
  addedAt: number;
  plays?: number;
}

export type RetriggerMode = 'restart' | 'stop' | 'overlap';

export interface Settings {
  /** Virtual cable device that Discord listens to (e.g. "CABLE Input"). */
  outputDeviceId: string;
  outputDeviceLabel: string;
  outputVolume: number;

  /** Your headphones/speakers so you can hear the sounds too. */
  monitorEnabled: boolean;
  monitorDeviceId: string;
  monitorDeviceLabel: string;
  monitorVolume: number;

  /** Route your real microphone into the virtual cable so friends still hear you. */
  micPassthrough: boolean;
  micDeviceId: string;
  micDeviceLabel: string;
  micVolume: number;

  retrigger: RetriggerMode;
  allowSimultaneous: boolean;
  stopAllHotkey: string | null;

  closeToTray: boolean;
  onboarded: boolean;
}

export interface Library {
  version: 1;
  sounds: Sound[];
  settings: Settings;
}

export interface ImportResult {
  imported: { id: string; name: string; file: string }[];
  skipped: string[];
}

export interface EchopadApi {
  loadLibrary(): Promise<Library | null>;
  saveLibrary(data: Library): Promise<boolean>;
  pickSounds(): Promise<ImportResult>;
  importFiles(files: FileList | File[]): Promise<ImportResult>;
  readSound(file: string): Promise<ArrayBuffer>;
  deleteSound(file: string): Promise<boolean>;
  revealSound(file: string): Promise<boolean>;
  exportSound(file: string, name: string): Promise<boolean>;
  setHotkeys(map: Record<string, string>): Promise<string[]>;
  suspendHotkeys(suspended: boolean): Promise<string[]>;
  onHotkey(cb: (action: string) => void): () => void;
  onStopAll(cb: () => void): () => void;
  openExternal(url: string): Promise<boolean>;
  getLoginItem(): Promise<boolean>;
  setLoginItem(enabled: boolean): Promise<boolean>;
  appInfo(): Promise<{ version: string; platform: string; dataDir: string }>;
  openDataDir(): Promise<unknown>;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximized(cb: (max: boolean) => void): () => void;
}
